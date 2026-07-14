import type { LogConnector, LogLevel, Web } from 'sip.js';

export type CallDirection = 'inbound' | 'outbound';
export type CallState = 'ringing' | 'answered' | 'held' | 'ended';

export interface Call {
  id: string;
  direction: CallDirection;
  state: CallState;
  remoteNumber?: string;
  remoteName?: string;
  tags?: string[];
  /**
   * Raw, PBX-supplied reason the call ended (only set once `state` is
   * `'ended'`) — e.g. `"cancelled"`. Not a fixed enum: only that one value is
   * confirmed against a real Wildix PBX so far, so treat this as an opaque,
   * best-effort string rather than a known set of outcomes.
   */
  endReason?: string;
}

export interface Device {
  uri: string;
  userAgent: string;
  deviceName: string;
  isLocalRegistration: boolean;
}

export interface Presence {
  status?: string;
  message?: string;
  until?: string;
}

export type ActiveDeviceType = 'device' | 'any_device' | 'mobility' | 'unknown';

export interface ActiveDevice {
  type: ActiveDeviceType;
  contactUri?: string;
  userAgent?: string;
}

export interface CallControlConfig {
  pbxAddress: string;
  extension: string;
  sipPassword: string;
  userAgent?: string;
  /**
   * Verbosity of sip.js's own internal logging. Defaults to 'error' — sip.js's
   * own default ('log') is very verbose (dumps the full UA configuration on
   * connect, every SIP message sent/received, every state transition), which
   * is normally not wanted in production.
   */
  logLevel?: LogLevel;
  /**
   * Receives every log line sip.js generates, at any level (independent of
   * `logLevel`, which only affects what the built-in console writer prints —
   * sip.js documents `logLevel` as filtering console output, not this hook).
   * When provided, the built-in console writer is disabled by default (see
   * `logToConsole`) so logs aren't duplicated.
   */
  logger?: LogConnector;
  /**
   * Whether sip.js should also write logs to the console via its built-in
   * writer, filtered by `logLevel`. Defaults to `true` when no `logger` is
   * given, and `false` when one is — set explicitly to override either way.
   */
  logToConsole?: boolean;
  /**
   * Seconds between WebSocket keep-alive pings (a double-CRLF sequence sent
   * to the PBX, which replies with a single CRLF). sip.js disables this by
   * default (`0`); this library defaults it to `30` instead, since without it
   * the connection can be silently dropped by intermediate proxies/NATs with
   * no `onDisconnect` signal until the PBX's own dialog subscription expires.
   * Set to `0` to disable.
   */
  keepAliveInterval?: number;
  /**
   * Escape hatch passed straight through to sip.js's WebSocket transport,
   * merged underneath this library's own computed options — `server` is
   * always fixed to the PBX's WS endpoint and cannot be overridden here, and
   * `keepAliveInterval` above takes priority over the same key here if both
   * are set. Use this for anything else sip.js's transport exposes (e.g.
   * `connectionTimeout`, `keepAliveDebounce`, `traceSip`), at the cost of
   * coupling to sip.js's API surface.
   */
  transportOptions?: Partial<Omit<Web.TransportOptions, 'server'>>;
}
