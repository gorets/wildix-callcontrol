jest.mock('sip.js');

import { Publisher, Registerer, RegistererState, Subscriber, SubscriptionState, UserAgent } from 'sip.js';
import { CallControl } from '../src/CallControl';

const config = { pbxAddress: 'pbx.example.com', extension: '10090', sipPassword: 'secret' };

// Reconnect/resubscribe chains cross several nested async functions, each
// adding its own microtask tick; rather than hand-counting exact tick counts
// (which has proven fragile as the chain grows), flush generously.
async function flushMicrotasks(times = 20): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

afterEach(() => {
  (Registerer as any).nextRegisterResponse = { statusCode: 200, reasonPhrase: 'OK' };
});

describe('CallControl connection lifecycle', () => {
  beforeEach(() => {
    (UserAgent as any).instances = [];
    (Registerer as any).instances = [];
  });

  test('connect() starts the UserAgent, registers with the expected options, and emits "registered"', async () => {
    const callControl = new CallControl(config);
    const registeredHandler = jest.fn();
    callControl.on('registered', registeredHandler);

    await callControl.connect();

    const ua = (UserAgent as any).instances[0];
    expect(ua.start).toHaveBeenCalledTimes(1);
    expect(ua.options.authorizationUsername).toBe('10090');
    expect(ua.options.authorizationPassword).toBe('secret');
    expect(ua.options.contactName).toBe('10090');
    expect(ua.options.transportOptions.server).toBe('wss://pbx.example.com/sip/');
    expect(ua.options.userAgentString).toBe('callcontrol');

    const registerer = (Registerer as any).instances[0];
    expect(registerer.register).toHaveBeenCalledTimes(1);
    expect(registerer.options.expires).toBe(3600);
    expect(registerer.options.extraHeaders).toContain('X-Disable-DirectRTP: yes');

    expect(registeredHandler).toHaveBeenCalledTimes(1);
  });

  test('connect() rejects and does not emit "registered" when REGISTER is rejected (e.g. wrong credentials)', async () => {
    (Registerer as any).nextRegisterResponse = { statusCode: 401, reasonPhrase: 'Unauthorized' };
    const callControl = new CallControl(config);
    const registeredHandler = jest.fn();
    callControl.on('registered', registeredHandler);

    await expect(callControl.connect()).rejects.toThrow(/401/);

    expect(registeredHandler).not.toHaveBeenCalled();
  });

  test('connect() uses a custom User-Agent header when configured', async () => {
    const callControl = new CallControl({ ...config, userAgent: 'my-app/1.0' });
    await callControl.connect();
    expect((UserAgent as any).instances[0].options.userAgentString).toBe('my-app/1.0');
  });

  test('connect() defaults to quiet, console-only logging when no logging config is given', async () => {
    const callControl = new CallControl(config);
    await callControl.connect();
    const ua = (UserAgent as any).instances[0];

    expect(ua.options.logLevel).toBe('error');
    expect(ua.options.logConnector).toBeUndefined();
    expect(ua.options.logBuiltinEnabled).toBe(true);
    expect(ua.options.logConfiguration).toBe(false);
  });

  test('connect() passes through a custom logLevel', async () => {
    const callControl = new CallControl({ ...config, logLevel: 'debug' });
    await callControl.connect();
    expect((UserAgent as any).instances[0].options.logLevel).toBe('debug');
  });

  test('connect() wires a custom logger and disables built-in console logging by default', async () => {
    const logger = jest.fn();
    const callControl = new CallControl({ ...config, logger });
    await callControl.connect();
    const ua = (UserAgent as any).instances[0];

    expect(ua.options.logConnector).toBe(logger);
    expect(ua.options.logBuiltinEnabled).toBe(false);
  });

  test('connect() keeps console logging on alongside a custom logger when logToConsole is explicitly true', async () => {
    const logger = jest.fn();
    const callControl = new CallControl({ ...config, logger, logToConsole: true });
    await callControl.connect();
    expect((UserAgent as any).instances[0].options.logBuiltinEnabled).toBe(true);
  });

  test('incoming INVITE is immediately rejected with 480', async () => {
    const callControl = new CallControl(config);
    await callControl.connect();
    const ua = (UserAgent as any).instances[0];
    const fakeInvitation = { reject: jest.fn().mockResolvedValue(undefined) };

    ua.options.delegate.onInvite(fakeInvitation);

    expect(fakeInvitation.reject).toHaveBeenCalledWith({
      statusCode: 480,
      reasonPhrase: 'Not a call-handling device',
    });
  });

  test('disconnect() unregisters and stops the UserAgent', async () => {
    const callControl = new CallControl(config);
    await callControl.connect();
    const ua = (UserAgent as any).instances[0];
    const registerer = (Registerer as any).instances[0];

    await callControl.disconnect();

    expect(registerer.unregister).toHaveBeenCalledTimes(1);
    expect(ua.stop).toHaveBeenCalledTimes(1);
  });
});

describe('CallControl reconnect', () => {
  beforeEach(() => {
    (UserAgent as any).instances = [];
    (Registerer as any).instances = [];
    (Subscriber as any).instances = [];
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('a transport disconnect schedules a reconnect and eventually re-registers', async () => {
    const callControl = new CallControl(config);
    await callControl.connect();
    const reconnectingHandler = jest.fn();
    const registeredHandler = jest.fn();
    callControl.on('reconnecting', reconnectingHandler);
    callControl.on('registered', registeredHandler);

    const ua = (UserAgent as any).instances[0];
    ua.options.delegate.onDisconnect();

    expect(reconnectingHandler).toHaveBeenCalledWith({ attempt: 1 });

    jest.advanceTimersByTime(3000);
    await flushMicrotasks();

    // Not a second ua.start(): real sip.js's UserAgent.start() is a no-op
    // once its internal Started/Stopped state is already Started (only
    // ua.stop() resets it) — it wouldn't reopen the transport here.
    // ua.reconnect() is the dedicated method for that.
    expect(ua.start).toHaveBeenCalledTimes(1);
    expect(ua.reconnect).toHaveBeenCalledTimes(1);
    expect(registeredHandler).toHaveBeenCalledTimes(1);
  });

  test('reconnect disposes the previous registration and subscriptions, and their late Terminated events do not trigger duplicate reconnects/resubscribes', async () => {
    const callControl = new CallControl(config);
    await callControl.connect();

    const firstRegisterer = (Registerer as any).instances[0];
    const firstDialogSubscriber = (Subscriber as any).instances.find((s: any) => s.event === 'dialog');
    const firstRegSubscriber = (Subscriber as any).instances.find((s: any) => s.event === 'reg');
    const firstActiveDeviceSubscriber = (Subscriber as any).instances.find((s: any) => s.event === 'active-device');

    const ua = (UserAgent as any).instances[0];
    ua.options.delegate.onDisconnect();
    jest.advanceTimersByTime(3000);
    await flushMicrotasks();

    // The old registration/subscriptions were disposed as part of reconnecting.
    expect(firstRegisterer.unregister).toHaveBeenCalledTimes(1);
    expect(firstDialogSubscriber.dispose).toHaveBeenCalledTimes(1);
    expect(firstRegSubscriber.dispose).toHaveBeenCalledTimes(1);
    expect(firstActiveDeviceSubscriber.dispose).toHaveBeenCalledTimes(1);

    // Exactly one fresh Subscriber per event package exists after the reconnect.
    const dialogSubscribers = (Subscriber as any).instances.filter((s: any) => s.event === 'dialog');
    const regSubscribers = (Subscriber as any).instances.filter((s: any) => s.event === 'reg');
    const activeDeviceSubscribers = (Subscriber as any).instances.filter((s: any) => s.event === 'active-device');
    expect(dialogSubscribers).toHaveLength(2);
    expect(regSubscribers).toHaveLength(2);
    expect(activeDeviceSubscribers).toHaveLength(2);

    // If the disposed instances' stateChange listeners still fire Terminated
    // (as real sip.js does on dispose/unregister), that must not schedule
    // another reconnect or resubscribe on top of the ones just created.
    const reconnectingHandler = jest.fn();
    callControl.on('reconnecting', reconnectingHandler);
    firstRegisterer.stateChange.emit(RegistererState.Terminated);
    firstDialogSubscriber.stateChange.emit(SubscriptionState.Terminated);
    firstRegSubscriber.stateChange.emit(SubscriptionState.Terminated);
    firstActiveDeviceSubscriber.stateChange.emit(SubscriptionState.Terminated);

    expect(reconnectingHandler).not.toHaveBeenCalled();
    expect((Subscriber as any).instances.filter((s: any) => s.event === 'dialog')).toHaveLength(2);
    expect((Subscriber as any).instances.filter((s: any) => s.event === 'reg')).toHaveLength(2);
    expect((Subscriber as any).instances.filter((s: any) => s.event === 'active-device')).toHaveLength(2);
  });

  test('Registerer termination also schedules a reconnect', async () => {
    const callControl = new CallControl(config);
    await callControl.connect();
    const reconnectingHandler = jest.fn();
    callControl.on('reconnecting', reconnectingHandler);

    const registerer = (Registerer as any).instances[0];
    registerer.stateChange.emit(RegistererState.Terminated);

    expect(reconnectingHandler).toHaveBeenCalledWith({ attempt: 1 });
  });

  test('disconnect() cancels a pending reconnect attempt', async () => {
    const callControl = new CallControl(config);
    await callControl.connect();
    const ua = (UserAgent as any).instances[0];

    ua.options.delegate.onDisconnect();
    await callControl.disconnect();
    jest.advanceTimersByTime(30000);

    expect(ua.start).toHaveBeenCalledTimes(1);
  });
});

describe('CallControl dialog events', () => {
  beforeEach(() => {
    (UserAgent as any).instances = [];
    (Registerer as any).instances = [];
    (Subscriber as any).instances = [];
  });

  function ringingDialogXml(callId: string): string {
    return `<?xml version="1.0"?>
<dialog-info xmlns="urn:ietf:params:xml:ns:dialog-info" entity="sip:10090@pbx.example.com">
  <dialog call-id="${callId}" direction="recipient">
    <state>early</state>
    <local><identity display="Jane Roe">sip:79001112233@pbx.example.com</identity></local>
  </dialog>
</dialog-info>`;
  }

  function answeredDialogXml(callId: string): string {
    return `<?xml version="1.0"?>
<dialog-info xmlns="urn:ietf:params:xml:ns:dialog-info" entity="sip:10090@pbx.example.com">
  <dialog call-id="${callId}" direction="recipient">
    <state>confirmed</state>
    <local><identity display="Jane Roe">sip:79001112233@pbx.example.com</identity></local>
  </dialog>
</dialog-info>`;
  }

  function emptyDialogInfoXml(): string {
    return `<?xml version="1.0"?><dialog-info xmlns="urn:ietf:params:xml:ns:dialog-info" entity="sip:10090@pbx.example.com"></dialog-info>`;
  }

  function notificationWith(body: string) {
    return { request: { body }, accept: jest.fn().mockResolvedValue(undefined) };
  }

  async function connectAndGetDialogSubscriber() {
    const callControl = new CallControl(config);
    await callControl.connect();
    const subscriber = (Subscriber as any).instances[0];
    return { callControl, subscriber };
  }

  test('subscribes to the dialog event package on connect', async () => {
    const { subscriber } = await connectAndGetDialogSubscriber();
    expect(subscriber.event).toBe('dialog');
    expect(subscriber.uri.toString()).toBe('sip:10090@pbx.example.com');
    expect(subscriber.options.expires).toBe(3600);
    expect(subscriber.subscribe).toHaveBeenCalledTimes(1);
  });

  test('emits callStart for a new dialog and accepts the NOTIFY', async () => {
    const { callControl, subscriber } = await connectAndGetDialogSubscriber();
    const callStartHandler = jest.fn();
    callControl.on('callStart', callStartHandler);
    const notification = notificationWith(ringingDialogXml('call-1'));

    subscriber.delegate.onNotify(notification);

    expect(notification.accept).toHaveBeenCalledTimes(1);
    expect(callStartHandler).toHaveBeenCalledWith({
      id: 'call-1',
      direction: 'inbound',
      state: 'ringing',
      remoteNumber: '79001112233',
      remoteName: 'Jane Roe',
      tags: undefined,
    });
    expect(callControl.getActiveCalls()).toHaveLength(1);
  });

  test('emits callUpdate when an existing dialog changes state', async () => {
    const { callControl, subscriber } = await connectAndGetDialogSubscriber();
    subscriber.delegate.onNotify(notificationWith(ringingDialogXml('call-1')));
    const callUpdateHandler = jest.fn();
    callControl.on('callUpdate', callUpdateHandler);

    subscriber.delegate.onNotify(notificationWith(answeredDialogXml('call-1')));

    expect(callUpdateHandler).toHaveBeenCalledWith(expect.objectContaining({ id: 'call-1', state: 'answered' }));
  });

  test('emits callEnd when a dialog disappears from the NOTIFY body', async () => {
    const { callControl, subscriber } = await connectAndGetDialogSubscriber();
    subscriber.delegate.onNotify(notificationWith(answeredDialogXml('call-1')));
    const callEndHandler = jest.fn();
    callControl.on('callEnd', callEndHandler);

    subscriber.delegate.onNotify(notificationWith(emptyDialogInfoXml()));

    expect(callEndHandler).toHaveBeenCalledWith(expect.objectContaining({ id: 'call-1', state: 'ended' }));
    expect(callControl.getActiveCalls()).toHaveLength(0);
  });
});

describe('CallControl presence events', () => {
  beforeEach(() => {
    (UserAgent as any).instances = [];
    (Registerer as any).instances = [];
    (Subscriber as any).instances = [];
  });

  test('emits presenceChanged when Wildix presence params appear in a dialog NOTIFY', async () => {
    const callControl = new CallControl(config);
    await callControl.connect();
    const subscriber = (Subscriber as any).instances[0];
    const presenceHandler = jest.fn();
    callControl.on('presenceChanged', presenceHandler);

    const xml = `<?xml version="1.0"?>
<dialog-info xmlns="urn:ietf:params:xml:ns:dialog-info" entity="sip:10090@pbx.example.com">
  <dialog call-id="call-9" direction="initiator">
    <state>confirmed</state>
    <local><identity display="Me">sip:10090@pbx.example.com</identity></local>
    <remote><target uri="sip:200@pbx.example.com">
      <param pname="X-Wildix-state" pval="away"/>
    </target></remote>
  </dialog>
</dialog-info>`;

    subscriber.delegate.onNotify({ request: { body: xml }, accept: jest.fn().mockResolvedValue(undefined) });

    expect(presenceHandler).toHaveBeenCalledWith({ status: 'away' });
    expect(callControl.getPresence()).toEqual({ status: 'away' });
  });
});

describe('CallControl device events', () => {
  beforeEach(() => {
    (UserAgent as any).instances = [];
    (Registerer as any).instances = [];
    (Subscriber as any).instances = [];
  });

  test('subscribes to the reg event package on connect, after the dialog subscription', async () => {
    const callControl = new CallControl(config);
    await callControl.connect();

    const subscribers = (Subscriber as any).instances;
    expect(subscribers).toHaveLength(3);
    expect(subscribers[0].event).toBe('dialog');
    expect(subscribers[1].event).toBe('reg');
    expect(subscribers[1].subscribe).toHaveBeenCalledTimes(1);
  });

  test('emits devicesChanged with the parsed, filtered device list', async () => {
    const callControl = new CallControl(config);
    await callControl.connect();
    const regSubscriber = (Subscriber as any).instances[1];
    const devicesHandler = jest.fn();
    callControl.on('devicesChanged', devicesHandler);

    const xml = `<?xml version="1.0"?>
<reginfo xmlns="urn:ietf:params:xml:ns:reginfo">
  <registration aor="sip:10090@pbx.example.com" state="active">
    <contact state="active" user_agent="x-bees Web 2.71.0.2886527 734fadce-b3fd-45af-9f55-ac957c1c999b">
      <uri>sip:10090@mock-via-host.invalid;transport=ws</uri>
    </contact>
    <contact state="active" user_agent="Wildix TAPI">
      <uri>sip:10090@10.0.0.5:5060</uri>
    </contact>
  </registration>
</reginfo>`;

    regSubscriber.delegate.onNotify({ request: { body: xml }, accept: jest.fn().mockResolvedValue(undefined) });

    expect(devicesHandler).toHaveBeenCalledWith([
      {
        uri: 'sip:10090@mock-via-host.invalid;transport=ws',
        userAgent: 'x-bees Web 2.71.0.2886527 734fadce-b3fd-45af-9f55-ac957c1c999b',
        deviceName: 'x-bees Web',
        isLocalRegistration: true,
      },
    ]);
    expect(callControl.getDevices()).toHaveLength(1);
  });
});

describe('CallControl resubscribe on termination', () => {
  beforeEach(() => {
    (UserAgent as any).instances = [];
    (Registerer as any).instances = [];
    (Subscriber as any).instances = [];
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('recreates the dialog subscription after it terminates, waiting the backoff delay', async () => {
    const callControl = new CallControl(config);
    await callControl.connect();
    const firstDialogSubscriber = (Subscriber as any).instances[0];

    firstDialogSubscriber.stateChange.emit(SubscriptionState.Terminated);
    jest.advanceTimersByTime(3000);

    const dialogSubscribers = (Subscriber as any).instances.filter((s: any) => s.event === 'dialog');
    expect(dialogSubscribers).toHaveLength(2);
    expect(dialogSubscribers[1].subscribe).toHaveBeenCalledTimes(1);
  });

  test('recreates the reg subscription after it terminates, waiting the backoff delay', async () => {
    const callControl = new CallControl(config);
    await callControl.connect();
    const firstRegSubscriber = (Subscriber as any).instances[1];

    firstRegSubscriber.stateChange.emit(SubscriptionState.Terminated);
    jest.advanceTimersByTime(3000);

    const regSubscribers = (Subscriber as any).instances.filter((s: any) => s.event === 'reg');
    expect(regSubscribers).toHaveLength(2);
    expect(regSubscribers[1].subscribe).toHaveBeenCalledTimes(1);
  });

  test('does not recreate a subscription after disconnect() has been called', async () => {
    const callControl = new CallControl(config);
    await callControl.connect();
    const firstDialogSubscriber = (Subscriber as any).instances[0];

    await callControl.disconnect();
    firstDialogSubscriber.stateChange.emit(SubscriptionState.Terminated);
    jest.advanceTimersByTime(30000);

    const dialogSubscribers = (Subscriber as any).instances.filter((s: any) => s.event === 'dialog');
    expect(dialogSubscribers).toHaveLength(1);
  });
});

describe('CallControl commands', () => {
  beforeEach(() => {
    (UserAgent as any).instances = [];
    (Registerer as any).instances = [];
    (Subscriber as any).instances = [];
    (Publisher as any).instances = [];
    (Publisher as any).requests = [];
  });

  async function connectedCallControl() {
    const callControl = new CallControl(config);
    await callControl.connect();
    return callControl;
  }

  function resolveLastPublish() {
    const request = (Publisher as any).requests[(Publisher as any).requests.length - 1];
    request.delegate.onAccept();
  }

  test('makeCall sends an originate PUBLISH with the destination as param1 and "any" as param2', async () => {
    const callControl = await connectedCallControl();
    const promise = callControl.makeCall('+31612345678');
    resolveLastPublish();
    await promise;

    const publisher = (Publisher as any).instances[0];
    expect(publisher.event).toBe('wildixtsp/action');
    expect(publisher.uri.toString()).toBe('sip:10090@pbx.example.com');
    expect(publisher.options.extraHeaders).toEqual([
      'W-TapiCommand: originate',
      'W-TapiParam1: +31612345678',
      'W-TapiParam2: any',
      'Event: wildixtsp/action',
      'Expires: 1',
    ]);
  });

  test('makeCall targets a specific device when deviceUri is given, instead of "any"', async () => {
    const callControl = await connectedCallControl();
    const promise = callControl.makeCall('+31612345678', 'sip:10090@device-a.invalid;transport=ws');
    resolveLastPublish();
    await promise;

    expect((Publisher as any).instances[0].options.extraHeaders).toEqual([
      'W-TapiCommand: originate',
      'W-TapiParam1: +31612345678',
      'W-TapiParam2: device',
      'W-TapiParam3: sip:10090@device-a.invalid;transport=ws',
      'Event: wildixtsp/action',
      'Expires: 1',
    ]);
  });

  test('answer sends a talk PUBLISH with the callId', async () => {
    const callControl = await connectedCallControl();
    const promise = callControl.answer('call-1');
    resolveLastPublish();
    await promise;

    expect((Publisher as any).instances[0].options.extraHeaders).toEqual([
      'W-TapiCommand: talk',
      'W-TapiParam1: call-1',
      'Event: wildixtsp/action',
      'Expires: 1',
    ]);
  });

  test('answer with a deviceUri adds it as param2', async () => {
    const callControl = await connectedCallControl();
    const promise = callControl.answer('call-1', 'sip:101@10.0.0.5:5060');
    resolveLastPublish();
    await promise;

    expect((Publisher as any).instances[0].options.extraHeaders).toEqual([
      'W-TapiCommand: talk',
      'W-TapiParam1: call-1',
      'W-TapiParam2: sip:101@10.0.0.5:5060',
      'Event: wildixtsp/action',
      'Expires: 1',
    ]);
  });

  test('resume sends a talk PUBLISH with the callId, matching answer', async () => {
    const callControl = await connectedCallControl();
    const promise = callControl.resume('call-1');
    resolveLastPublish();
    await promise;

    expect((Publisher as any).instances[0].options.extraHeaders).toEqual([
      'W-TapiCommand: talk',
      'W-TapiParam1: call-1',
      'Event: wildixtsp/action',
      'Expires: 1',
    ]);
  });

  test('hangup sends a hangup PUBLISH with the callId', async () => {
    const callControl = await connectedCallControl();
    const promise = callControl.hangup('call-1');
    resolveLastPublish();
    await promise;

    expect((Publisher as any).instances[0].options.extraHeaders).toEqual([
      'W-TapiCommand: hangup',
      'W-TapiParam1: call-1',
      'Event: wildixtsp/action',
      'Expires: 1',
    ]);
  });

  test('hold sends a hold PUBLISH with the callId', async () => {
    const callControl = await connectedCallControl();
    const promise = callControl.hold('call-1');
    resolveLastPublish();
    await promise;

    expect((Publisher as any).instances[0].options.extraHeaders).toEqual([
      'W-TapiCommand: hold',
      'W-TapiParam1: call-1',
      'Event: wildixtsp/action',
      'Expires: 1',
    ]);
  });

  test('sendDTMF sends a senddigits PUBLISH with callId and digits', async () => {
    const callControl = await connectedCallControl();
    const promise = callControl.sendDTMF('call-1', '123#');
    resolveLastPublish();
    await promise;

    expect((Publisher as any).instances[0].options.extraHeaders).toEqual([
      'W-TapiCommand: senddigits',
      'W-TapiParam1: call-1',
      'W-TapiParam2: 123#',
      'Event: wildixtsp/action',
      'Expires: 1',
    ]);
  });

  test('transfer sends a transfer PUBLISH with callId and destination', async () => {
    const callControl = await connectedCallControl();
    const promise = callControl.transfer('call-1', '203');
    resolveLastPublish();
    await promise;

    expect((Publisher as any).instances[0].options.extraHeaders).toEqual([
      'W-TapiCommand: transfer',
      'W-TapiParam1: call-1',
      'W-TapiParam2: 203',
      'Event: wildixtsp/action',
      'Expires: 1',
    ]);
  });

  test('attendedTransfer sends an atttransfer PUBLISH with both call ids', async () => {
    const callControl = await connectedCallControl();
    const promise = callControl.attendedTransfer('call-1', 'call-2');
    resolveLastPublish();
    await promise;

    expect((Publisher as any).instances[0].options.extraHeaders).toEqual([
      'W-TapiCommand: atttransfer',
      'W-TapiParam1: call-1',
      'W-TapiParam2: call-2',
      'Event: wildixtsp/action',
      'Expires: 1',
    ]);
  });

  test('a command rejects when the PBX rejects the PUBLISH', async () => {
    const callControl = await connectedCallControl();
    const promise = callControl.hangup('call-1');

    const request = (Publisher as any).requests[(Publisher as any).requests.length - 1];
    request.delegate.onReject({ message: { statusCode: 481, reasonPhrase: 'Call/Transaction Does Not Exist' } });

    await expect(promise).rejects.toThrow('TAPI command "hangup" rejected: 481 Call/Transaction Does Not Exist');
  });

  test('a command rejects immediately when not connected', async () => {
    const callControl = new CallControl(config);
    await expect(callControl.hangup('call-1')).rejects.toThrow('CallControl: not connected');
  });
});

describe('CallControl active-device events', () => {
  beforeEach(() => {
    (UserAgent as any).instances = [];
    (Registerer as any).instances = [];
    (Subscriber as any).instances = [];
  });

  test('subscribes to the active-device event package on connect, after dialog and reg', async () => {
    const callControl = new CallControl(config);
    await callControl.connect();

    const subscribers = (Subscriber as any).instances;
    expect(subscribers).toHaveLength(3);
    expect(subscribers[0].event).toBe('dialog');
    expect(subscribers[1].event).toBe('reg');
    expect(subscribers[2].event).toBe('active-device');
    expect(subscribers[2].subscribe).toHaveBeenCalledTimes(1);
  });

  test('emits activeDeviceChanged with the parsed value', async () => {
    const callControl = new CallControl(config);
    await callControl.connect();
    const activeDeviceSubscriber = (Subscriber as any).instances[2];
    const activeDeviceHandler = jest.fn();
    callControl.on('activeDeviceChanged', activeDeviceHandler);

    const xml = `<?xml version="1.0"?>
<active-device xmlns="urn:ietf:params:xml:ns:active-device" version="0" state="full">
  <user-agent>x-bees Web 2.71.0.2886527</user-agent>
  <contact>sip:10090@4e73kbfe3ms6.invalid;transport=ws</contact>
  <type>any_device</type>
</active-device>`;

    activeDeviceSubscriber.delegate.onNotify({
      request: { body: xml },
      accept: jest.fn().mockResolvedValue(undefined),
    });

    expect(activeDeviceHandler).toHaveBeenCalledWith({
      type: 'any_device',
      userAgent: 'x-bees Web 2.71.0.2886527',
      contactUri: 'sip:10090@4e73kbfe3ms6.invalid;transport=ws',
    });
    expect(callControl.getActiveDevice()).toEqual({
      type: 'any_device',
      userAgent: 'x-bees Web 2.71.0.2886527',
      contactUri: 'sip:10090@4e73kbfe3ms6.invalid;transport=ws',
    });
  });

  test('recreates the active-device subscription after it terminates, waiting the backoff delay', async () => {
    jest.useFakeTimers();
    const callControl = new CallControl(config);
    await callControl.connect();
    const firstActiveDeviceSubscriber = (Subscriber as any).instances[2];

    firstActiveDeviceSubscriber.stateChange.emit(SubscriptionState.Terminated);
    jest.advanceTimersByTime(3000);

    const activeDeviceSubscribers = (Subscriber as any).instances.filter((s: any) => s.event === 'active-device');
    expect(activeDeviceSubscribers).toHaveLength(2);
    expect(activeDeviceSubscribers[1].subscribe).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});
