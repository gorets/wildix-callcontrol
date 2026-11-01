import { EventEmitter } from 'events';
import {
  type Core,
  Publisher,
  Registerer,
  RegistererState,
  Subscriber,
  SubscriptionState,
  type URI,
  UserAgent,
} from 'sip.js';

import { getResubscribeDelayMs } from './backoff';
import {
  ACTIVE_DEVICE_EVENT_PACKAGE,
  DEFAULT_DISCONNECT_TIMEOUT_MS,
  DEFAULT_READY_TIMEOUT_MS,
  DEFAULT_USER_AGENT,
  DIALOG_EVENT_PACKAGE,
  REG_EVENT_PACKAGE,
  SUBSCRIPTION_DISPOSE_GRACE_MS,
  SUBSCRIPTION_EXPIRES_SECONDS,
  TAPI_EVENT_PACKAGE,
} from './constants';
import { ActiveDeviceStateTracker } from './state/activeDeviceState';
import { CallStateTracker } from './state/callState';
import { DeviceStateTracker } from './state/deviceState';
import { PresenceStateTracker } from './state/presenceState';
import { buildTapiExtraHeaders, type TapiCommand } from './tapi';
import type { ActiveDevice, Call, CallControlConfig, Device, Presence, RecordAction } from './types';
import { parseActiveDeviceXml } from './xml/activeDeviceParser';
import { parseDialogInfoXml } from './xml/dialogInfoParser';
import { parseRegistrationInfoXml } from './xml/registrationInfoParser';

// Runs `action` and gives back a promise that never rejects: a failing or throwing teardown step must not stop the others.
function attempt(action: () => Promise<unknown> | undefined): Promise<unknown> {
  try {
    return Promise.resolve(action()).catch(() => undefined);
  } catch {
    return Promise.resolve();
  }
}

function buildAor(extension: string, pbxAddress: string): string {
  return `sip:${extension}@${pbxAddress}`;
}

// sip.js's Publisher.send() is protected — this subclass exposes it, the same
// pattern used elsewhere for one-shot (non-refreshing) PUBLISH requests.
class TapiPublisher extends Publisher {
  publishRequest(): Core.OutgoingPublishRequest {
    return this.send();
  }
}

const RECORD_ACTIONS: readonly RecordAction[] = ['on', 'off', 'pause', 'unpause'];

export class CallControl extends EventEmitter {
  private readonly config: CallControlConfig;
  private readonly aorUri: URI;
  private readonly expiresSeconds: number;
  private readonly disconnectTimeoutMs: number;

  private ua: UserAgent | undefined;
  private registerer: Registerer | undefined;
  private dialogSubscriber: Subscriber | undefined;
  private regSubscriber: Subscriber | undefined;
  private activeDeviceSubscriber: Subscriber | undefined;
  private stopping = false;
  // True once the first dialog NOTIFY of the current registration has been applied, i.e. `getActiveCalls()` can be
  // trusted. Reset whenever the registration is re-created.
  private ready = false;
  // Bumped every time registerAndSubscribe() runs. Each registerer/subscriber's
  // stateChange listener captures the generation it was created under; a
  // Terminated event from a stale generation (fired during or after disposal,
  // synchronously or later) is ignored instead of scheduling a redundant
  // reconnect/resubscribe on top of the ones already created for the current
  // generation.
  private registrationGeneration = 0;

  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private dialogResubscribeAttempt = 0;
  private regResubscribeAttempt = 0;
  private activeDeviceResubscribeAttempt = 0;

  private readonly callState = new CallStateTracker();
  private readonly deviceState = new DeviceStateTracker();
  private readonly presenceState = new PresenceStateTracker();
  private readonly activeDeviceState = new ActiveDeviceStateTracker();

  constructor(config: CallControlConfig) {
    super();
    this.config = config;
    this.expiresSeconds = config.expiresSeconds ?? SUBSCRIPTION_EXPIRES_SECONDS;
    if (!Number.isInteger(this.expiresSeconds) || this.expiresSeconds <= 0) {
      throw new Error(`CallControl: expiresSeconds must be a positive integer, got ${config.expiresSeconds}`);
    }
    this.disconnectTimeoutMs = config.disconnectTimeoutMs ?? DEFAULT_DISCONNECT_TIMEOUT_MS;
    if (!(this.disconnectTimeoutMs > 0) || !Number.isFinite(this.disconnectTimeoutMs)) {
      throw new Error(`CallControl: disconnectTimeoutMs must be a positive number, got ${config.disconnectTimeoutMs}`);
    }
    const uri = UserAgent.makeURI(buildAor(config.extension, config.pbxAddress));
    if (!uri) {
      throw new Error(
        `CallControl: invalid extension/pbxAddress combination: ${config.extension}@${config.pbxAddress}`,
      );
    }
    this.aorUri = uri;
  }

  async connect(): Promise<void> {
    this.stopping = false;
    this.ua = new UserAgent({
      uri: this.aorUri,
      authorizationUsername: this.config.extension,
      authorizationPassword: this.config.sipPassword,
      contactName: this.config.extension,
      userAgentString: this.config.userAgent ?? DEFAULT_USER_AGENT,
      transportOptions: {
        ...this.config.transportOptions,
        server: `wss://${this.config.pbxAddress}/sip/`,
        keepAliveInterval: this.config.keepAliveInterval ?? this.config.transportOptions?.keepAliveInterval ?? 30,
      },
      logLevel: this.config.logLevel ?? 'error',
      logConnector: this.config.logger,
      logBuiltinEnabled: this.config.logToConsole ?? this.config.logger === undefined,
      logConfiguration: false,
      delegate: {
        onInvite: (invitation) => {
          invitation.reject({ statusCode: 480, reasonPhrase: 'Not a call-handling device' }).catch((error: Error) => {
            this.emit('error', error);
          });
        },
        onDisconnect: () => {
          if (!this.stopping) {
            this.scheduleReconnect();
          }
        },
      },
    });

    await this.ua.start();
    await this.registerAndSubscribe();
    this.reconnectAttempt = 0;
    this.emit('registered');
  }

  async disconnect(): Promise<void> {
    this.stopping = true;
    this.ready = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    await this.disposeRegistrationAndSubscriptions();
    await this.bounded(attempt(() => this.ua?.stop()));
    this.ua = undefined;
  }

  /** Whether the first dialog NOTIFY of the current registration has been applied, so `getActiveCalls()` is current. */
  isReady(): boolean {
    return this.ready;
  }

  /**
   * Resolves once `getActiveCalls()` is current: the PBX has reported the user's dialogs after the last (re)connect.
   * `connect()` resolves when the registration is accepted, which is earlier, so right after it a call that is already
   * going on may not be known yet. Rejects when nothing arrives within `timeoutMs` (default 10 s).
   */
  waitUntilReady(timeoutMs = DEFAULT_READY_TIMEOUT_MS): Promise<void> {
    if (this.ready) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const onReady = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        this.off('ready', onReady);
        reject(new Error(`CallControl: no initial dialog state within ${timeoutMs} ms`));
      }, timeoutMs);
      this.once('ready', onReady);
    });
  }

  getActiveCalls(): Call[] {
    return this.callState.getActiveCalls();
  }

  getDevices(): Device[] {
    return this.deviceState.getDevices();
  }

  getPresence(): Presence | undefined {
    return this.presenceState.getPresence();
  }

  getActiveDevice(): ActiveDevice | undefined {
    return this.activeDeviceState.getActiveDevice();
  }

  async makeCall(destination: string, deviceUri?: string): Promise<void> {
    if (deviceUri) {
      await this.sendTapiCommand('originate', destination, 'device', deviceUri);
    } else {
      await this.sendTapiCommand('originate', destination, 'any');
    }
  }

  /** Calls the user's mobile first (Wildix mobility) and, once it answers, the destination. */
  async makeMobilityCall(destination: string): Promise<void> {
    await this.sendTapiCommand('originate', destination, 'mobility');
  }

  async answer(callId: string, deviceUri?: string): Promise<void> {
    await this.sendTapiCommand('talk', callId, deviceUri);
  }

  async hangup(callId: string): Promise<void> {
    await this.sendTapiCommand('hangup', callId);
  }

  async hold(callId: string): Promise<void> {
    await this.sendTapiCommand('hold', callId);
  }

  async resume(callId: string): Promise<void> {
    await this.sendTapiCommand('talk', callId);
  }

  async sendDTMF(callId: string, digits: string): Promise<void> {
    await this.sendTapiCommand('senddigits', callId, digits);
  }

  async transfer(callId: string, destination: string): Promise<void> {
    await this.sendTapiCommand('transfer', callId, destination);
  }

  async conferenceTransfer(callId: string, destination: string): Promise<void> {
    await this.sendTapiCommand('conftransfer', callId, destination);
  }

  async record(callId: string, action: RecordAction): Promise<void> {
    if (!RECORD_ACTIONS.includes(action)) {
      throw new Error(`CallControl: record action must be one of ${RECORD_ACTIONS.join(', ')}`);
    }
    await this.sendTapiCommand('record', callId, action);
  }

  async attendedTransfer(callId1: string, callId2: string): Promise<void> {
    await this.sendTapiCommand('atttransfer', callId1, callId2);
  }

  private sendTapiCommand(command: TapiCommand, param1?: string, param2?: string, param3?: string): Promise<void> {
    if (!this.ua) {
      return Promise.reject(new Error('CallControl: not connected'));
    }
    const extraHeaders = buildTapiExtraHeaders(command, param1, param2, param3);
    const publisher = new TapiPublisher(this.ua, this.aorUri, TAPI_EVENT_PACKAGE, { extraHeaders });

    return new Promise((resolve, reject) => {
      const request = publisher.publishRequest();
      request.delegate = {
        onAccept: () => resolve(),
        onReject: (response: Core.IncomingResponse) =>
          reject(
            new Error(
              `TAPI command "${command}" rejected: ${response.message.statusCode} ${response.message.reasonPhrase}`,
            ),
          ),
      };
    });
  }

  private async registerAndSubscribe(): Promise<void> {
    if (!this.ua) {
      return;
    }
    this.registrationGeneration += 1;
    const generation = this.registrationGeneration;
    this.ready = false;
    await this.disposeRegistrationAndSubscriptions();

    this.registerer = new Registerer(this.ua, {
      expires: this.expiresSeconds,
      extraHeaders: ['X-Disable-DirectRTP: yes'],
    });
    this.registerer.stateChange.addListener((state) => {
      if (state === RegistererState.Terminated && !this.stopping && generation === this.registrationGeneration) {
        this.scheduleReconnect();
      }
    });
    await new Promise<void>((resolve, reject) => {
      this.registerer?.register({
        requestDelegate: {
          onAccept: () => resolve(),
          onReject: (response: Core.IncomingResponse) =>
            reject(new Error(`REGISTER rejected: ${response.message.statusCode} ${response.message.reasonPhrase}`)),
        },
      });
    });
    this.dialogResubscribeAttempt = 0;
    this.regResubscribeAttempt = 0;
    this.activeDeviceResubscribeAttempt = 0;
    this.subscribeToDialogEvents(generation);
    this.subscribeToRegEvents(generation);
    this.subscribeToActiveDeviceEvents(generation);
  }

  // Disposes the current registration and all subscriptions. Their
  // stateChange listeners were created under the previous generation, so any
  // Terminated event this triggers (immediately or later) is a no-op per the
  // generation check in each listener — see registrationGeneration above.
  //
  // The unregistration and the unsubscriptions go out together. The registration is the one that matters, so it is
  // waited for until it is reported ended (`unregister()` itself resolves as soon as the request is sent), at most
  // `disconnectTimeoutMs`; a PBX (or a socket that is already gone) that never answers must not hold the caller up. The
  // unsubscriptions only get a short grace period: a real PBX never completes `Subscriber.dispose()`.
  private async disposeRegistrationAndSubscriptions(): Promise<void> {
    const registerer = this.registerer;
    const dialogSubscriber = this.dialogSubscriber;
    const regSubscriber = this.regSubscriber;
    const activeDeviceSubscriber = this.activeDeviceSubscriber;
    this.dialogSubscriber = undefined;
    this.regSubscriber = undefined;
    this.activeDeviceSubscriber = undefined;
    this.registerer = undefined;

    const unregistered = registerer ? this.unregister(registerer) : Promise.resolve();
    const unsubscribed = Promise.all([
      attempt(() => dialogSubscriber?.dispose()),
      attempt(() => regSubscriber?.dispose()),
      attempt(() => activeDeviceSubscriber?.dispose()),
    ]);

    await this.bounded(
      Promise.all([unregistered, this.bounded(unsubscribed, SUBSCRIPTION_DISPOSE_GRACE_MS)]),
      this.disconnectTimeoutMs,
    );
  }

  // Sends the unregistration and resolves once the registerer reports it ended, or the request fails (a failed request
  // never changes the state).
  private unregister(registerer: Registerer): Promise<void> {
    return new Promise<void>((resolve) => {
      const isOver = (state: RegistererState) =>
        state === RegistererState.Unregistered || state === RegistererState.Terminated;

      if (isOver(registerer.state)) {
        resolve();
        return;
      }
      registerer.stateChange.addListener((state) => {
        if (isOver(state)) {
          resolve();
        }
      });
      try {
        Promise.resolve(registerer.unregister()).catch(() => resolve());
      } catch {
        resolve();
      }
    });
  }

  // Waits for `work`, but no longer than `timeoutMs`.
  private async bounded(work: Promise<unknown>, timeoutMs: number = this.disconnectTimeoutMs): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    try {
      await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private subscribeToDialogEvents(generation: number): void {
    if (!this.ua || generation !== this.registrationGeneration) {
      return;
    }
    const subscriber = new Subscriber(this.ua, this.aorUri, DIALOG_EVENT_PACKAGE, {
      expires: this.expiresSeconds,
    });
    subscriber.delegate = {
      onNotify: (notification) => {
        notification.accept().catch(() => undefined);
        this.handleDialogNotify(notification.request.body ?? '');
      },
    };
    subscriber.stateChange.addListener((state) => {
      if (state === SubscriptionState.Subscribed) {
        this.dialogResubscribeAttempt = 0;
      } else if (
        state === SubscriptionState.Terminated &&
        !this.stopping &&
        generation === this.registrationGeneration
      ) {
        this.dialogResubscribeAttempt += 1;
        const delayMs = getResubscribeDelayMs(this.dialogResubscribeAttempt);
        setTimeout(() => {
          if (!this.stopping) {
            this.subscribeToDialogEvents(generation);
          }
        }, delayMs);
      }
    });
    this.dialogSubscriber = subscriber;
    subscriber.subscribe().catch((error: Error) => this.emit('error', error));
  }

  private subscribeToRegEvents(generation: number): void {
    if (!this.ua || generation !== this.registrationGeneration) {
      return;
    }
    const subscriber = new Subscriber(this.ua, this.aorUri, REG_EVENT_PACKAGE, {
      expires: this.expiresSeconds,
    });
    subscriber.delegate = {
      onNotify: (notification) => {
        notification.accept().catch(() => undefined);
        this.handleRegNotify(notification.request.body ?? '');
      },
    };
    subscriber.stateChange.addListener((state) => {
      if (state === SubscriptionState.Subscribed) {
        this.regResubscribeAttempt = 0;
      } else if (
        state === SubscriptionState.Terminated &&
        !this.stopping &&
        generation === this.registrationGeneration
      ) {
        this.regResubscribeAttempt += 1;
        const delayMs = getResubscribeDelayMs(this.regResubscribeAttempt);
        setTimeout(() => {
          if (!this.stopping) {
            this.subscribeToRegEvents(generation);
          }
        }, delayMs);
      }
    });
    this.regSubscriber = subscriber;
    subscriber.subscribe().catch((error: Error) => this.emit('error', error));
  }

  private subscribeToActiveDeviceEvents(generation: number): void {
    if (!this.ua || generation !== this.registrationGeneration) {
      return;
    }
    const subscriber = new Subscriber(this.ua, this.aorUri, ACTIVE_DEVICE_EVENT_PACKAGE, {
      expires: this.expiresSeconds,
    });
    subscriber.delegate = {
      onNotify: (notification) => {
        notification.accept().catch(() => undefined);
        this.handleActiveDeviceNotify(notification.request.body ?? '');
      },
    };
    subscriber.stateChange.addListener((state) => {
      if (state === SubscriptionState.Subscribed) {
        this.activeDeviceResubscribeAttempt = 0;
      } else if (
        state === SubscriptionState.Terminated &&
        !this.stopping &&
        generation === this.registrationGeneration
      ) {
        this.activeDeviceResubscribeAttempt += 1;
        const delayMs = getResubscribeDelayMs(this.activeDeviceResubscribeAttempt);
        setTimeout(() => {
          if (!this.stopping) {
            this.subscribeToActiveDeviceEvents(generation);
          }
        }, delayMs);
      }
    });
    this.activeDeviceSubscriber = subscriber;
    subscriber.subscribe().catch((error: Error) => this.emit('error', error));
  }

  private handleDialogNotify(xmlBody: string): void {
    if (xmlBody) {
      this.applyDialogInfo(xmlBody);
    }
    // An empty first NOTIFY is a state too: the user has no dialogs.
    if (!this.ready) {
      this.ready = true;
      this.emit('ready');
    }
  }

  private applyDialogInfo(xmlBody: string): void {
    const { dialogs, presence } = parseDialogInfoXml(xmlBody);

    const { started, updated, ended } = this.callState.apply(dialogs);
    started.forEach((call) => {
      this.emit('callStart', call);
    });
    updated.forEach((call) => {
      this.emit('callUpdate', call);
    });
    ended.forEach((call) => {
      this.emit('callEnd', call);
    });

    const presenceDiff = this.presenceState.apply(presence);
    if (presenceDiff.changed && presenceDiff.presence) {
      this.emit('presenceChanged', presenceDiff.presence);
    }
  }

  private handleRegNotify(xmlBody: string): void {
    if (!xmlBody || !this.ua) {
      return;
    }
    const localViaHost = this.ua.userAgentCore.configuration.viaHost;
    const parsedDevices = parseRegistrationInfoXml(xmlBody, localViaHost);
    const { changed, devices } = this.deviceState.apply(parsedDevices);
    if (changed) {
      this.emit('devicesChanged', devices);
    }
  }

  private handleActiveDeviceNotify(xmlBody: string): void {
    if (!xmlBody) {
      return;
    }
    const parsed = parseActiveDeviceXml(xmlBody);
    const { changed, activeDevice } = this.activeDeviceState.apply(parsed);
    if (changed && activeDevice) {
      this.emit('activeDeviceChanged', activeDevice);
    }
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.reconnectTimer) {
      return;
    }
    this.reconnectAttempt += 1;
    this.emit('reconnecting', { attempt: this.reconnectAttempt });
    const delayMs = getResubscribeDelayMs(this.reconnectAttempt);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.reconnect();
    }, delayMs);
  }

  private async reconnect(): Promise<void> {
    if (this.stopping || !this.ua) {
      return;
    }
    try {
      // Not ua.start(): sip.js's UserAgent tracks its own Started/Stopped
      // state separately from the transport's connection state, and start()
      // is a no-op once already Started (only ua.stop() resets it) — it
      // would never actually reopen the transport here. reconnect() is the
      // dedicated method for re-establishing the transport after it drops.
      await this.ua.reconnect();
      await this.registerAndSubscribe();
      this.reconnectAttempt = 0;
      this.emit('registered');
    } catch (error) {
      this.emit('error', error);
      this.scheduleReconnect();
    }
  }
}
