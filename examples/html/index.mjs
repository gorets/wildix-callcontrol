// src/CallControl.ts
import { EventEmitter } from 'events';
import { Publisher, Registerer, RegistererState, Subscriber, SubscriptionState, UserAgent } from 'sip.js';

// src/constants.ts
var DIALOG_EVENT_PACKAGE = 'dialog';
var REG_EVENT_PACKAGE = 'reg';
var ACTIVE_DEVICE_EVENT_PACKAGE = 'active-device';
var TAPI_EVENT_PACKAGE = 'wildixtsp/action';
var SUBSCRIPTION_EXPIRES_SECONDS = 3600;
var TAPI_PUBLISH_EXPIRES_SECONDS = 1;
var DEFAULT_USER_AGENT = 'callcontrol';
var RESUBSCRIBE_MIN_DELAY_MS = 3e3;
var RESUBSCRIBE_MAX_DELAY_MS = 3e4;
var RESUBSCRIBE_STEPS = 5;
var WILDIX_PARAMS = {
  STATE: 'X-Wildix-state',
  CUSTOM: 'X-Wildix-custom',
  TAGS: 'X-Wildix-tags',
};
var SYSTEM_USER_AGENT_MARKERS = ['wildixgw', 'wildix tapi'];

// src/backoff.ts
function getResubscribeDelayMs(attempt) {
  const clampedAttempt = Math.min(Math.max(attempt, 1), RESUBSCRIBE_STEPS);
  const a = (RESUBSCRIBE_MAX_DELAY_MS - RESUBSCRIBE_MIN_DELAY_MS) / (RESUBSCRIBE_STEPS - 1) ** 2;
  return Math.round(a * (clampedAttempt - 1) ** 2 + RESUBSCRIBE_MIN_DELAY_MS);
}

// src/state/activeDeviceState.ts
var KNOWN_TYPES = ['device', 'any_device', 'mobility'];
function toActiveDevice(parsed) {
  const type = KNOWN_TYPES.includes(parsed.type) ? parsed.type : 'unknown';
  return { type, contactUri: parsed.contactUri, userAgent: parsed.userAgent };
}
function activeDeviceEqual(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
var ActiveDeviceStateTracker = class {
  apply(parsed) {
    const next = parsed ? toActiveDevice(parsed) : void 0;
    const changed = !activeDeviceEqual(this.activeDevice, next);
    this.activeDevice = next;
    return { changed, activeDevice: next };
  }
  getActiveDevice() {
    return this.activeDevice;
  }
};

// src/state/callState.ts
function toCallState(rawState, hold) {
  if (rawState === 'confirmed') {
    return hold ? 'held' : 'answered';
  }
  if (rawState === 'terminated') {
    return 'ended';
  }
  return 'ringing';
}
function toCall(parsed) {
  return {
    id: parsed.id,
    direction: parsed.direction,
    state: toCallState(parsed.rawState, parsed.hold),
    remoteNumber: parsed.remoteNumber,
    remoteName: parsed.remoteName,
    tags: parsed.tags,
  };
}
function callsEqual(a, b) {
  return (
    a.state === b.state &&
    a.remoteNumber === b.remoteNumber &&
    a.remoteName === b.remoteName &&
    JSON.stringify(a.tags ?? []) === JSON.stringify(b.tags ?? [])
  );
}
var CallStateTracker = class {
  constructor() {
    this.calls = /* @__PURE__ */ new Map();
  }
  apply(parsedDialogs) {
    const started = [];
    const updated = [];
    const ended = [];
    const seenIds = /* @__PURE__ */ new Set();
    for (const parsed of parsedDialogs) {
      seenIds.add(parsed.id);
      const nextCall = toCall(parsed);
      if (nextCall.state === 'ended') {
        const existing2 = this.calls.get(parsed.id);
        if (existing2) {
          ended.push({ ...existing2, state: 'ended' });
          this.calls.delete(parsed.id);
        }
        continue;
      }
      const existing = this.calls.get(parsed.id);
      if (!existing) {
        started.push(nextCall);
        this.calls.set(parsed.id, nextCall);
      } else if (!callsEqual(existing, nextCall)) {
        updated.push(nextCall);
        this.calls.set(parsed.id, nextCall);
      }
    }
    for (const [id, call] of this.calls) {
      if (!seenIds.has(id)) {
        ended.push({ ...call, state: 'ended' });
        this.calls.delete(id);
      }
    }
    return { started, updated, ended };
  }
  getActiveCalls() {
    return Array.from(this.calls.values());
  }
};

// src/deviceName.ts
var VERSION_LIKE = /^\d+(\.\d+)*$/;
var UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function deriveDeviceName(userAgent) {
  if (!userAgent) {
    return 'Unknown device';
  }
  const meaningfulTokens = userAgent
    .split(' ')
    .filter((token) => token.length > 0 && !VERSION_LIKE.test(token) && !UUID_LIKE.test(token));
  return meaningfulTokens.length > 0 ? meaningfulTokens.join(' ') : userAgent;
}

// src/state/deviceState.ts
function toDevice(parsed) {
  return {
    uri: parsed.uri,
    userAgent: parsed.userAgent,
    deviceName: deriveDeviceName(parsed.userAgent),
    isLocalRegistration: parsed.isLocalRegistration,
  };
}
function devicesEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  const sortedA = [...a].sort((x, y) => x.uri.localeCompare(y.uri));
  const sortedB = [...b].sort((x, y) => x.uri.localeCompare(y.uri));
  return sortedA.every((device, index) => JSON.stringify(device) === JSON.stringify(sortedB[index]));
}
var DeviceStateTracker = class {
  constructor() {
    this.devices = [];
  }
  apply(parsedDevices) {
    const nextDevices = parsedDevices.map(toDevice);
    const changed = !devicesEqual(this.devices, nextDevices);
    this.devices = nextDevices;
    return { changed, devices: nextDevices };
  }
  getDevices() {
    return this.devices;
  }
};

// src/state/presenceState.ts
function presenceEqual(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
var PresenceStateTracker = class {
  apply(parsedPresence) {
    const nextPresence = parsedPresence ? { ...parsedPresence } : void 0;
    const changed = !presenceEqual(this.presence, nextPresence);
    this.presence = nextPresence;
    return { changed, presence: nextPresence };
  }
  getPresence() {
    return this.presence;
  }
};

// src/tapi.ts
function buildTapiExtraHeaders(command, param1, param2) {
  const headers = [`W-TapiCommand: ${command}`];
  if (param1 !== void 0) {
    headers.push(`W-TapiParam1: ${param1}`);
  }
  if (param2 !== void 0) {
    headers.push(`W-TapiParam2: ${param2}`);
  }
  headers.push(`Event: ${TAPI_EVENT_PACKAGE}`);
  headers.push(`Expires: ${TAPI_PUBLISH_EXPIRES_SECONDS}`);
  return headers;
}

// src/xml/activeDeviceParser.ts
import { parse } from 'ltx';

function parseActiveDeviceXml(xmlBody) {
  const root = parse(xmlBody.trim());
  const type = root.getChild('type')?.getText();
  if (!type) {
    return null;
  }
  return {
    type,
    userAgent: root.getChild('user-agent')?.getText() || void 0,
    contactUri: root.getChild('contact')?.getText() || void 0,
  };
}

// src/xml/dialogInfoParser.ts
import { parse as parse2 } from 'ltx';

function parseDialogInfoXml(xmlBody) {
  const root = parse2(xmlBody.trim());
  const dialogs = [];
  let presence = null;
  for (const dialogEl of root.getChildren('dialog')) {
    presence = applyPresenceParams(dialogEl.getChildren('param'), presence);
    const targetParams = dialogEl.getChild('remote')?.getChild('target')?.getChildren('param') ?? [];
    presence = applyPresenceParams(targetParams, presence);
    let tags;
    for (const paramEl of targetParams) {
      if (paramEl.attrs.pname === WILDIX_PARAMS.TAGS && paramEl.attrs.pval) {
        tags = String(paramEl.attrs.pval)
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean);
      }
    }
    const id = dialogEl.attrs['call-id'];
    if (!id) {
      continue;
    }
    const direction = dialogEl.attrs.direction === 'initiator' ? 'outbound' : 'inbound';
    const rawState = dialogEl.getChild('state')?.getText();
    const hold = dialogEl.getChild('note')?.getText() === 'On hold';
    let remoteName;
    let remoteNumber;
    const identityEl = dialogEl.getChild('local')?.getChild('identity');
    if (identityEl) {
      remoteName = identityEl.attrs.display || void 0;
      const uri = identityEl.getText();
      remoteNumber = uri ? (uri.startsWith('sip:') ? uri.slice(4).split('@')[0] : uri) : void 0;
    }
    dialogs.push({ id, direction, rawState, hold, remoteName, remoteNumber, tags });
  }
  return { dialogs, presence };
}
function applyPresenceParams(paramEls, presence) {
  for (const paramEl of paramEls) {
    const pname = paramEl.attrs.pname;
    const pval = paramEl.attrs.pval;
    if (pname === WILDIX_PARAMS.STATE && pval) {
      presence = { ...(presence ?? {}), status: String(pval).toLowerCase() };
    }
    if (pname === WILDIX_PARAMS.CUSTOM && pval) {
      presence = { ...(presence ?? {}), ...parseWildixCustomStatus(String(pval)) };
    }
  }
  return presence;
}
function parseWildixCustomStatus(base64Value) {
  try {
    const binary = atob(base64Value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const decoded = new TextDecoder('utf-8').decode(bytes);
    const parsed = JSON.parse(decoded);
    return {
      message: typeof parsed.message === 'string' ? parsed.message : void 0,
      until: typeof parsed.untilTime === 'string' ? parsed.untilTime : void 0,
    };
  } catch {
    return {};
  }
}

// src/xml/registrationInfoParser.ts
import { parse as parse3 } from 'ltx';

function parseRegistrationInfoXml(xmlBody, localViaHost) {
  const root = parse3(xmlBody.trim());
  const devices = [];
  for (const registrationEl of root.getChildren('registration')) {
    for (const contactEl of registrationEl.getChildren('contact')) {
      const state = contactEl.attrs.state;
      const userAgent = contactEl.attrs['user-agent'] ?? '';
      const uri = contactEl.getChild('uri')?.getText();
      if (state !== 'active' || !uri || !userAgent) {
        continue;
      }
      const lowerUserAgent = userAgent.toLowerCase();
      if (SYSTEM_USER_AGENT_MARKERS.some((marker) => lowerUserAgent.includes(marker))) {
        continue;
      }
      devices.push({
        uri,
        userAgent,
        isLocalRegistration: Boolean(localViaHost) && uri.includes(localViaHost),
      });
    }
  }
  return devices;
}

// src/CallControl.ts
function buildAor(extension, pbxAddress) {
  return `sip:${extension}@${pbxAddress}`;
}
var TapiPublisher = class extends Publisher {
  publishRequest() {
    return this.send();
  }
};
var CallControl = class extends EventEmitter {
  constructor(config) {
    super();
    this.stopping = false;
    // Bumped every time registerAndSubscribe() runs. Each registerer/subscriber's
    // stateChange listener captures the generation it was created under; a
    // Terminated event from a stale generation (fired during or after disposal,
    // synchronously or later) is ignored instead of scheduling a redundant
    // reconnect/resubscribe on top of the ones already created for the current
    // generation.
    this.registrationGeneration = 0;
    this.reconnectAttempt = 0;
    this.dialogResubscribeAttempt = 0;
    this.regResubscribeAttempt = 0;
    this.activeDeviceResubscribeAttempt = 0;
    this.callState = new CallStateTracker();
    this.deviceState = new DeviceStateTracker();
    this.presenceState = new PresenceStateTracker();
    this.activeDeviceState = new ActiveDeviceStateTracker();
    this.config = config;
    const uri = UserAgent.makeURI(buildAor(config.extension, config.pbxAddress));
    if (!uri) {
      throw new Error(
        `CallControl: invalid extension/pbxAddress combination: ${config.extension}@${config.pbxAddress}`,
      );
    }
    this.aorUri = uri;
  }
  async connect() {
    this.stopping = false;
    this.ua = new UserAgent({
      uri: this.aorUri,
      authorizationUsername: this.config.extension,
      authorizationPassword: this.config.sipPassword,
      contactName: this.config.extension,
      userAgentString: this.config.userAgent ?? DEFAULT_USER_AGENT,
      transportOptions: {
        server: `wss://${this.config.pbxAddress}/sip/`,
      },
      logLevel: this.config.logLevel ?? 'error',
      logConnector: this.config.logger,
      logBuiltinEnabled: this.config.logToConsole ?? this.config.logger === void 0,
      logConfiguration: false,
      delegate: {
        onInvite: (invitation) => {
          invitation.reject({ statusCode: 480, reasonPhrase: 'Not a call-handling device' }).catch((error) => {
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
  async disconnect() {
    this.stopping = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = void 0;
    }
    await this.disposeRegistrationAndSubscriptions();
    await this.ua?.stop();
    this.ua = void 0;
  }
  getActiveCalls() {
    return this.callState.getActiveCalls();
  }
  getDevices() {
    return this.deviceState.getDevices();
  }
  getPresence() {
    return this.presenceState.getPresence();
  }
  getActiveDevice() {
    return this.activeDeviceState.getActiveDevice();
  }
  async makeCall(destination) {
    await this.sendTapiCommand('originate', destination, 'any');
  }
  async answer(callId, deviceUri) {
    await this.sendTapiCommand('talk', callId, deviceUri);
  }
  async hangup(callId) {
    await this.sendTapiCommand('hangup', callId);
  }
  async hold(callId) {
    await this.sendTapiCommand('hold', callId);
  }
  async resume(callId) {
    await this.sendTapiCommand('talk', callId);
  }
  async sendDTMF(callId, digits) {
    await this.sendTapiCommand('senddigits', callId, digits);
  }
  async transfer(callId, destination) {
    await this.sendTapiCommand('transfer', callId, destination);
  }
  async attendedTransfer(callId1, callId2) {
    await this.sendTapiCommand('atttransfer', callId1, callId2);
  }
  sendTapiCommand(command, param1, param2) {
    if (!this.ua) {
      return Promise.reject(new Error('CallControl: not connected'));
    }
    const extraHeaders = buildTapiExtraHeaders(command, param1, param2);
    const publisher = new TapiPublisher(this.ua, this.aorUri, TAPI_EVENT_PACKAGE, { extraHeaders });
    return new Promise((resolve, reject) => {
      const request = publisher.publishRequest();
      request.delegate = {
        onAccept: () => resolve(),
        onReject: (response) =>
          reject(
            new Error(
              `TAPI command "${command}" rejected: ${response.message.statusCode} ${response.message.reasonPhrase}`,
            ),
          ),
      };
    });
  }
  async registerAndSubscribe() {
    if (!this.ua) {
      return;
    }
    this.registrationGeneration += 1;
    const generation = this.registrationGeneration;
    await this.disposeRegistrationAndSubscriptions();
    this.registerer = new Registerer(this.ua, {
      expires: SUBSCRIPTION_EXPIRES_SECONDS,
      extraHeaders: ['X-Disable-DirectRTP: yes'],
    });
    this.registerer.stateChange.addListener((state) => {
      if (state === RegistererState.Terminated && !this.stopping && generation === this.registrationGeneration) {
        this.scheduleReconnect();
      }
    });
    await this.registerer.register();
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
  async disposeRegistrationAndSubscriptions() {
    await this.dialogSubscriber?.dispose().catch(() => void 0);
    await this.regSubscriber?.dispose().catch(() => void 0);
    await this.activeDeviceSubscriber?.dispose().catch(() => void 0);
    await this.registerer?.unregister().catch(() => void 0);
    this.dialogSubscriber = void 0;
    this.regSubscriber = void 0;
    this.activeDeviceSubscriber = void 0;
    this.registerer = void 0;
  }
  subscribeToDialogEvents(generation) {
    if (!this.ua || generation !== this.registrationGeneration) {
      return;
    }
    const subscriber = new Subscriber(this.ua, this.aorUri, DIALOG_EVENT_PACKAGE, {
      expires: SUBSCRIPTION_EXPIRES_SECONDS,
    });
    subscriber.delegate = {
      onNotify: (notification) => {
        notification.accept().catch(() => void 0);
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
    subscriber.subscribe().catch((error) => this.emit('error', error));
  }
  subscribeToRegEvents(generation) {
    if (!this.ua || generation !== this.registrationGeneration) {
      return;
    }
    const subscriber = new Subscriber(this.ua, this.aorUri, REG_EVENT_PACKAGE, {
      expires: SUBSCRIPTION_EXPIRES_SECONDS,
    });
    subscriber.delegate = {
      onNotify: (notification) => {
        notification.accept().catch(() => void 0);
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
    subscriber.subscribe().catch((error) => this.emit('error', error));
  }
  subscribeToActiveDeviceEvents(generation) {
    if (!this.ua || generation !== this.registrationGeneration) {
      return;
    }
    const subscriber = new Subscriber(this.ua, this.aorUri, ACTIVE_DEVICE_EVENT_PACKAGE, {
      expires: SUBSCRIPTION_EXPIRES_SECONDS,
    });
    subscriber.delegate = {
      onNotify: (notification) => {
        notification.accept().catch(() => void 0);
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
    subscriber.subscribe().catch((error) => this.emit('error', error));
  }
  handleDialogNotify(xmlBody) {
    if (!xmlBody) {
      return;
    }
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
  handleRegNotify(xmlBody) {
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
  handleActiveDeviceNotify(xmlBody) {
    if (!xmlBody) {
      return;
    }
    const parsed = parseActiveDeviceXml(xmlBody);
    const { changed, activeDevice } = this.activeDeviceState.apply(parsed);
    if (changed && activeDevice) {
      this.emit('activeDeviceChanged', activeDevice);
    }
  }
  scheduleReconnect() {
    if (this.stopping || this.reconnectTimer) {
      return;
    }
    this.reconnectAttempt += 1;
    this.emit('reconnecting', { attempt: this.reconnectAttempt });
    const delayMs = getResubscribeDelayMs(this.reconnectAttempt);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = void 0;
      this.reconnect();
    }, delayMs);
  }
  async reconnect() {
    if (this.stopping || !this.ua) {
      return;
    }
    try {
      await this.ua.start();
      await this.registerAndSubscribe();
      this.reconnectAttempt = 0;
      this.emit('registered');
    } catch (error) {
      this.emit('error', error);
      this.scheduleReconnect();
    }
  }
};

export { CallControl };
//# sourceMappingURL=index.mjs.map
