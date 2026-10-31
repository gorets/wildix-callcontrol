jest.mock('sip.js');

import { Registerer, Subscriber, UserAgent } from 'sip.js';
import { CallControl } from '../src/CallControl';

const config = { pbxAddress: 'pbx.example.com', extension: '10090', sipPassword: 'secret' };

async function flushMicrotasks(times = 20): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

function resetMocks(): void {
  (UserAgent as any).instances = [];
  (Registerer as any).instances = [];
  (Subscriber as any).instances = [];
}

const dialogInfoXml = `<?xml version="1.0"?><dialog-info xmlns="urn:ietf:params:xml:ns:dialog-info" entity="sip:10090@pbx.example.com"></dialog-info>`;

function notify(body: string) {
  return { request: { body }, accept: jest.fn().mockResolvedValue(undefined) };
}

const dialogSubscriber = () => (Subscriber as any).instances.find((s: any) => s.event === 'dialog');

describe('CallControl readiness', () => {
  beforeEach(() => {
    resetMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('is not ready after connect() until the first dialog NOTIFY, and emits "ready" once', async () => {
    const callControl = new CallControl(config);
    const readyHandler = jest.fn();
    callControl.on('ready', readyHandler);
    await callControl.connect();

    expect(callControl.isReady()).toBe(false);
    expect(readyHandler).not.toHaveBeenCalled();

    dialogSubscriber().delegate.onNotify(notify(dialogInfoXml));
    dialogSubscriber().delegate.onNotify(notify(dialogInfoXml));

    expect(callControl.isReady()).toBe(true);
    expect(readyHandler).toHaveBeenCalledTimes(1);
  });

  test('an initial NOTIFY with an empty body (no dialogs) makes it ready too', async () => {
    const callControl = new CallControl(config);
    await callControl.connect();

    dialogSubscriber().delegate.onNotify(notify(''));

    expect(callControl.isReady()).toBe(true);
  });

  test('the calls of the initial NOTIFY are known by the time "ready" is emitted', async () => {
    const callControl = new CallControl(config);
    const callsAtReady: number[] = [];
    callControl.on('ready', () => callsAtReady.push(callControl.getActiveCalls().length));
    await callControl.connect();

    dialogSubscriber().delegate.onNotify(
      notify(`<?xml version="1.0"?><dialog-info xmlns="urn:ietf:params:xml:ns:dialog-info" entity="sip:10090@pbx.example.com">
  <dialog call-id="c1" direction="recipient"><state>early</state><local><identity display="J">sip:201@pbx.example.com</identity></local></dialog>
</dialog-info>`),
    );

    expect(callsAtReady).toEqual([1]);
  });

  test('waitUntilReady() resolves when the first dialog NOTIFY arrives, and at once when it already has', async () => {
    const callControl = new CallControl(config);
    await callControl.connect();

    const waiting = callControl.waitUntilReady();
    dialogSubscriber().delegate.onNotify(notify(dialogInfoXml));
    await expect(waiting).resolves.toBeUndefined();
    await expect(callControl.waitUntilReady()).resolves.toBeUndefined();
  });

  test('waitUntilReady() rejects after the timeout when no dialog NOTIFY comes', async () => {
    const callControl = new CallControl(config);
    await callControl.connect();

    const waiting = callControl.waitUntilReady(500);
    const assertion = expect(waiting).rejects.toThrow(/initial dialog state.*500 ms/);
    await jest.advanceTimersByTimeAsync(500);

    await assertion;
  });

  test('waitUntilReady() waits 10 s by default', async () => {
    const callControl = new CallControl(config);
    await callControl.connect();

    const settled = jest.fn();
    callControl.waitUntilReady().catch(settled);
    await jest.advanceTimersByTimeAsync(9999);
    expect(settled).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  test('a reconnect makes it not ready again until the new subscription reports', async () => {
    const callControl = new CallControl(config);
    const readyHandler = jest.fn();
    callControl.on('ready', readyHandler);
    await callControl.connect();
    dialogSubscriber().delegate.onNotify(notify(dialogInfoXml));
    expect(callControl.isReady()).toBe(true);

    (UserAgent as any).instances[0].options.delegate.onDisconnect();
    await jest.advanceTimersByTimeAsync(3000);
    await flushMicrotasks();
    expect(callControl.isReady()).toBe(false);

    const secondDialogSubscriber = (Subscriber as any).instances.filter((s: any) => s.event === 'dialog')[1];
    secondDialogSubscriber.delegate.onNotify(notify(dialogInfoXml));

    expect(callControl.isReady()).toBe(true);
    expect(readyHandler).toHaveBeenCalledTimes(2);
  });

  test('disconnect() makes it not ready', async () => {
    const callControl = new CallControl(config);
    await callControl.connect();
    dialogSubscriber().delegate.onNotify(notify(dialogInfoXml));

    await callControl.disconnect();

    expect(callControl.isReady()).toBe(false);
  });
});

describe('CallControl disconnect', () => {
  beforeEach(() => {
    resetMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const never = () => new Promise<void>(() => {});

  test('ends the registration at once, without waiting for the subscriptions to be disposed', async () => {
    const callControl = new CallControl(config);
    await callControl.connect();
    for (const subscriber of (Subscriber as any).instances) {
      subscriber.dispose.mockImplementation(never);
    }
    const registerer = (Registerer as any).instances[0];

    callControl.disconnect();
    await flushMicrotasks();

    expect(registerer.unregister).toHaveBeenCalledTimes(1);
  });

  // The real PBX never completes `Subscriber.dispose()` (no state change either) although the subscription is gone
  // within a fraction of a second, so the subscriptions get only a short grace period.
  test('gives a subscription that never answers half a second, then stops the UserAgent', async () => {
    const callControl = new CallControl(config);
    await callControl.connect();
    for (const subscriber of (Subscriber as any).instances) {
      subscriber.dispose.mockImplementation(never);
    }
    const ua = (UserAgent as any).instances[0];

    const finished = jest.fn();
    callControl.disconnect().then(finished);
    await jest.advanceTimersByTimeAsync(499);
    expect(finished).not.toHaveBeenCalled();
    expect(ua.stop).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(finished).toHaveBeenCalledTimes(1);
    expect(ua.stop).toHaveBeenCalledTimes(1);
  });

  test('waits for the registration to be reported ended, not only for the request to be sent', async () => {
    const callControl = new CallControl(config);
    await callControl.connect();
    const registerer = (Registerer as any).instances[0];
    registerer.unregister.mockImplementation(() => Promise.resolve(undefined));
    const ua = (UserAgent as any).instances[0];

    const finished = jest.fn();
    callControl.disconnect().then(finished);
    await jest.advanceTimersByTimeAsync(2000);
    expect(finished).not.toHaveBeenCalled();
    expect(ua.stop).not.toHaveBeenCalled();

    registerer.stateChange.emit('Unregistered');
    await jest.advanceTimersByTimeAsync(0);
    expect(finished).toHaveBeenCalledTimes(1);
    expect(ua.stop).toHaveBeenCalledTimes(1);
  });

  test('does not wait for a registration that is already unregistered or terminated', async () => {
    for (const state of ['Unregistered', 'Terminated']) {
      resetMocks();
      const callControl = new CallControl(config);
      await callControl.connect();
      const registerer = (Registerer as any).instances[0];
      registerer.state = state;
      registerer.unregister.mockImplementation(() => new Promise<void>(() => {}));

      const finished = jest.fn();
      callControl.disconnect().then(finished);
      await jest.advanceTimersByTimeAsync(500);

      expect(finished).toHaveBeenCalledTimes(1);
    }
  });

  test('waits 10 s by default for a registration that never ends, and still stops the UserAgent', async () => {
    const callControl = new CallControl(config);
    await callControl.connect();
    (Registerer as any).instances[0].unregister.mockImplementation(never);
    const ua = (UserAgent as any).instances[0];

    const finished = jest.fn();
    callControl.disconnect().then(finished);
    await jest.advanceTimersByTimeAsync(9999);
    expect(finished).not.toHaveBeenCalled();
    expect(ua.stop).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(finished).toHaveBeenCalledTimes(1);
    expect(ua.stop).toHaveBeenCalledTimes(1);
  });

  test('disconnectTimeoutMs sets how long it waits', async () => {
    const callControl = new CallControl({ ...config, disconnectTimeoutMs: 200 });
    await callControl.connect();
    (Registerer as any).instances[0].unregister.mockImplementation(never);
    const ua = (UserAgent as any).instances[0];

    const finished = jest.fn();
    callControl.disconnect().then(finished);
    await jest.advanceTimersByTimeAsync(200);

    expect(finished).toHaveBeenCalledTimes(1);
    expect(ua.stop).toHaveBeenCalledTimes(1);
  });

  test('stops the UserAgent even when ending the registration fails', async () => {
    const callControl = new CallControl(config);
    await callControl.connect();
    (Registerer as any).instances[0].unregister.mockRejectedValue(new Error('socket closed'));
    const ua = (UserAgent as any).instances[0];

    await expect(callControl.disconnect()).resolves.toBeUndefined();

    expect(ua.stop).toHaveBeenCalledTimes(1);
  });

  test('stops the UserAgent even when it takes too long to stop, and does not hang', async () => {
    const callControl = new CallControl({ ...config, disconnectTimeoutMs: 100 });
    await callControl.connect();
    (UserAgent as any).instances[0].stop.mockImplementation(never);

    const finished = jest.fn();
    callControl.disconnect().then(finished);
    await jest.advanceTimersByTimeAsync(300);

    expect(finished).toHaveBeenCalledTimes(1);
  });

  test('a disconnect that is quick does not wait for the timeout', async () => {
    const callControl = new CallControl(config);
    await callControl.connect();

    await expect(callControl.disconnect()).resolves.toBeUndefined();
  });
});

describe('CallControl expiresSeconds', () => {
  beforeEach(resetMocks);

  test('defaults to 3600 for the registration and every subscription', async () => {
    await new CallControl(config).connect();

    expect((Registerer as any).instances[0].options.expires).toBe(3600);
    const expires = (Subscriber as any).instances.map((s: any) => s.options.expires);
    expect(expires).toEqual([3600, 3600, 3600]);
  });

  test('sets the registration and every subscription', async () => {
    await new CallControl({ ...config, expiresSeconds: 120 }).connect();

    expect((Registerer as any).instances[0].options.expires).toBe(120);
    const expires = (Subscriber as any).instances.map((s: any) => s.options.expires);
    expect(expires).toEqual([120, 120, 120]);
  });

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses %p', (value) => {
    expect(() => new CallControl({ ...config, expiresSeconds: value })).toThrow(/expiresSeconds/);
  });

  test('refuses a disconnectTimeoutMs that is not a positive number', () => {
    for (const value of [0, -5, Number.NaN]) {
      expect(() => new CallControl({ ...config, disconnectTimeoutMs: value })).toThrow(/disconnectTimeoutMs/);
    }
  });
});
