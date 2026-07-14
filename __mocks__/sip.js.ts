export class MockStateChangeEmitter {
  private listeners: Array<(state: string) => void> = [];

  addListener(listener: (state: string) => void): void {
    this.listeners.push(listener);
  }

  emit(state: string): void {
    this.listeners.forEach((listener) => {
      listener(state);
    });
  }
}

export const RegistererState = {
  Initial: 'Initial',
  Registered: 'Registered',
  Unregistered: 'Unregistered',
  Terminated: 'Terminated',
};

export class UserAgent {
  static instances: UserAgent[] = [];

  static makeURI(uriString: string) {
    return { toString: () => uriString, raw: uriString };
  }

  options: any;
  userAgentCore = { configuration: { viaHost: 'mock-via-host.invalid' } };
  start = jest.fn().mockResolvedValue(undefined);
  // Real sip.js: start() is a no-op (resolves immediately, doesn't touch the
  // transport) once the UA's internal Started/Stopped state is already
  // Started — only reconnect() re-opens the transport after that point.
  reconnect = jest.fn().mockResolvedValue(undefined);
  stop = jest.fn().mockResolvedValue(undefined);

  constructor(options: any) {
    this.options = options;
    UserAgent.instances.push(this);
  }
}

export class Registerer {
  static instances: Registerer[] = [];
  // Mirrors real sip.js: register() dispatches the REGISTER and resolves
  // immediately, independent of the eventual response — the actual outcome
  // only reaches the caller via requestDelegate.onAccept/onReject, invoked
  // asynchronously once the (possibly digest-challenged) response arrives.
  // Configurable here so tests can simulate a rejected REGISTER (e.g. bad
  // credentials) without needing a response object at every call site.
  static nextRegisterResponse: { statusCode: number; reasonPhrase: string } = {
    statusCode: 200,
    reasonPhrase: 'OK',
  };

  ua: UserAgent;
  options: any;
  stateChange = new MockStateChangeEmitter();
  register = jest.fn((registerOptions?: any) => {
    const response = { message: Registerer.nextRegisterResponse };
    if (Registerer.nextRegisterResponse.statusCode < 300) {
      registerOptions?.requestDelegate?.onAccept?.(response);
    } else {
      registerOptions?.requestDelegate?.onReject?.(response);
    }
    return Promise.resolve(undefined);
  });
  unregister = jest.fn().mockResolvedValue(undefined);

  constructor(ua: UserAgent, options: any) {
    this.ua = ua;
    this.options = options;
    Registerer.instances.push(this);
  }
}

export const SubscriptionState = {
  Initial: 'Initial',
  NotifyWait: 'NotifyWait',
  Pending: 'Pending',
  Subscribed: 'Subscribed',
  Terminated: 'Terminated',
};

export class Subscriber {
  static instances: Subscriber[] = [];

  ua: UserAgent;
  uri: any;
  event: string;
  options: any;
  delegate: any;
  stateChange = new MockStateChangeEmitter();
  subscribe = jest.fn().mockResolvedValue(undefined);
  dispose = jest.fn().mockResolvedValue(undefined);

  constructor(ua: UserAgent, uri: any, event: string, options: any) {
    this.ua = ua;
    this.uri = uri;
    this.event = event;
    this.options = options;
    Subscriber.instances.push(this);
  }
}

export class Publisher {
  static instances: Publisher[] = [];
  static requests: Array<{ delegate?: any }> = [];

  ua: UserAgent;
  uri: any;
  event: string;
  options: any;

  constructor(ua: UserAgent, uri: any, event: string, options: any) {
    this.ua = ua;
    this.uri = uri;
    this.event = event;
    this.options = options;
    Publisher.instances.push(this);
  }

  send(): { delegate?: any } {
    const request: { delegate?: any } = {};
    Publisher.requests.push(request);
    return request;
  }
}
