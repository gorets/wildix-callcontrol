# @gorets/wildix-callcontrol

Headless, `EventEmitter`-based SIP call control for Wildix PBX — get real-time call, device, presence, and
routing events straight off the SIP WebSocket connection, and drive calls with simple async methods. No
WebRTC, no media, no UI — just events in, commands out.

```ts
const callControl = new CallControl({
  pbxAddress: 'your-pbx.wildixin.com',
  extension: '10090',
  sipPassword: '...',
});

callControl.on('callStart', (call) => console.log('incoming/outgoing call', call));
callControl.on('callEnd', (call) => console.log('call ended', call));

await callControl.connect();
await callControl.answer(call.id);
```

## Why this exists

Wildix PBX call events are usually consumed via webhooks (`call_start` / `call_update` / `call_end`), which
adds HTTP round-trip latency between something happening on the phone and your application finding out about
it. This library talks to the PBX directly over the same SIP WebSocket a softphone would use, subscribing to
the `dialog`, `reg`, and `active-device` SIP event packages and issuing commands via Wildix's `wildixtsp/action`
PUBLISH mechanism — the same channel real Wildix clients use internally.

**This is not a softphone.** It never negotiates media, never touches `RTCPeerConnection` or `getUserMedia`,
and is not the thing that carries a call's audio. Think of it as a parallel, headless *observer + remote
control* for calls that are already ringing or connected on the user's real phone(s) (desk phone, mobile app,
softphone, etc.) — useful for building integrations, dashboards, or CRM connectors that need low-latency call
awareness and the ability to answer/hold/transfer/hang up calls without owning the media path.

## Features

- 📞 Real-time call lifecycle events (`callStart`, `callUpdate`, `callEnd`) sourced from SIP `dialog` NOTIFYs
- 🎛️ Call control commands: `makeCall`, `answer`, `hangup`, `hold`, `resume`, `sendDTMF`, `transfer`, `attendedTransfer`
- 📱 Registered-device visibility (`devicesChanged` / `getDevices()`) — know which of the user's devices (desk
  phone, mobile, web) are online
- 🟢 Read-only presence (`presenceChanged` / `getPresence()`) and inbound-routing mode (`activeDeviceChanged` /
  `getActiveDevice()`)
- 🔁 Automatic reconnect and resubscribe with backoff on transport/registration loss
- 👥 Multiple independent users per process — one `CallControl` instance per extension, no shared state
- 🌐 Isomorphic — works in Node.js and in a plain browser `<script type="module">`, no bundler required
- 🔇 Quiet by default — sip.js's own (very verbose) internal logging is off unless you opt in

## Install

```bash
npm install @gorets/wildix-callcontrol sip.js
```

`sip.js@^0.21.2` is a peer dependency — you control which version you bundle.

## Quick start

```ts
import { CallControl } from '@gorets/wildix-callcontrol';

const callControl = new CallControl({
  pbxAddress: 'your-pbx.wildixin.com',
  extension: '10090',
  sipPassword: process.env.SIP_PASSWORD,
});

callControl.on('registered', () => console.log('connected'));
callControl.on('error', (err) => console.error(err));

callControl.on('callStart', (call) => console.log('call started', call));
callControl.on('callUpdate', (call) => console.log('call updated', call));
callControl.on('callEnd', (call) => console.log('call ended', call));

callControl.on('devicesChanged', (devices) => console.log('devices', devices));
callControl.on('presenceChanged', (presence) => console.log('presence', presence));
callControl.on('activeDeviceChanged', (activeDevice) => console.log('active device', activeDevice));

await callControl.connect();

// later, e.g. from a button click:
await callControl.answer(call.id);
await callControl.hangup(call.id);
```

See [`examples/node`](examples/node) for a runnable Node.js script, [`examples/html`](examples/html) for a
framework-free browser page, and [`examples/dashboard`](examples/dashboard) for a full multi-user browser
dashboard (Vite-based, [live demo](https://gorets.github.io/wildix-callcontrol/)) with live call control,
devices, presence, and routing-mode panels — all three connect to a real PBX and are the primary way to
manually verify this library end-to-end.

## API

### `new CallControl(config: CallControlConfig)`

| Option | Type | Default | Description |
|---|---|---|---|
| `pbxAddress` | `string` | — | PBX hostname, e.g. `"your-pbx.wildixin.com"` |
| `extension` | `string` | — | SIP extension / username, e.g. `"10090"` |
| `sipPassword` | `string` | — | SIP digest password for the extension |
| `userAgent` | `string` | `"callcontrol"` | SIP `User-Agent` header value |
| `logLevel` | `'debug' \| 'log' \| 'warn' \| 'error'` | `'error'` | sip.js internal log verbosity |
| `logger` | `(level, category, label, content) => void` | — | Receives every sip.js log line, at any level, independent of `logLevel` — plug in your own logging pipeline |
| `logToConsole` | `boolean` | `true`, unless `logger` is set (then `false`) | Whether sip.js also writes to the console via its built-in writer |
| `keepAliveInterval` | `number` | `30` | Seconds between WebSocket keep-alive pings (double-CRLF); set to `0` to disable |
| `transportOptions` | `Partial<Web.TransportOptions>` (sip.js) | — | Escape hatch merged into sip.js's WebSocket transport options — `server` is always fixed and can't be overridden here; use for `connectionTimeout`, `keepAliveDebounce`, `traceSip`, etc. |

By default, sip.js's own (very verbose) internal logging is quiet — only `error`-level output goes to the
console. To route it through your own logging pipeline instead:

```ts
const callControl = new CallControl({
  pbxAddress: 'your-pbx.wildixin.com',
  extension: '10090',
  sipPassword: process.env.SIP_PASSWORD,
  logger: (level, category, label, content) => myLogger.log(level, category, content),
  logToConsole: false, // avoid duplicate output if myLogger already writes to the console
});
```

**`logger` receives every log line regardless of `logLevel`** — `logLevel` (valid values: `'debug' | 'log' |
'warn' | 'error'`) only filters what the built-in console writer (`logToConsole`) prints, which is a separate
path. If you supply your own `logger` and want it quieter too (e.g. to skip the very verbose `'debug'`-level
raw SIP message dumps), filter by `level` yourself inside the callback:

```ts
const LOG_LEVEL_RANK = { error: 0, warn: 1, log: 2, debug: 3 };

logger: (level, category, label, content) => {
  if (LOG_LEVEL_RANK[level] > LOG_LEVEL_RANK.log) return; // skip 'debug'
  myLogger.log(level, category, content);
},
```

### Connection

| Method | Description |
|---|---|
| `connect(): Promise<void>` | Registers with the PBX and subscribes to call/device/presence/routing events. Rejects (and never emits `registered`) if the PBX rejects the initial `REGISTER` — e.g. wrong `sipPassword` |
| `disconnect(): Promise<void>` | Unregisters and tears down the connection; no further reconnect attempts follow |

### Call control

| Method | TAPI command | Description |
|---|---|---|
| `makeCall(destination: string, deviceUri?: string)` | `originate` | Places an outbound call: rings the given device (or, by default, any of the user's own registered devices — a "ring-back" leg), then bridges to `destination` once that ring-back is answered |
| `answer(callId: string, deviceUri?: string)` | `talk` | Answers a ringing call, optionally on a specific device from `getDevices()` |
| `resume(callId: string)` | `talk` | Un-holds a held call |
| `hangup(callId: string)` | `hangup` | Ends a call |
| `hold(callId: string)` | `hold` | Puts a call on hold |
| `sendDTMF(callId: string, digits: string)` | `senddigits` | Sends DTMF tones |
| `transfer(callId: string, destination: string)` | `transfer` | Cold (blind) transfer |
| `attendedTransfer(callId1: string, callId2: string)` | `atttransfer` | Warm transfer between two of the user's own calls |

Every command method resolves once the PBX accepts the underlying `PUBLISH` (200 OK) — that confirms the
command was accepted, not that the action fully completed. Watch for the resulting `callUpdate` / `callEnd`
event to observe actual completion.

**`makeCall` is click-to-dial, not a direct call.** By default it rings the caller's own registered devices
first ("any device" mode) — the destination is only dialed once a real, media-capable device answers that
ring-back leg. This library never answers it itself (it always rejects incoming `INVITE`s — see "How it
works"), so if no real phone/softphone answers within the PBX's ring timeout, the destination is never called
and the attempt is simply cancelled. Pass `deviceUri` (from `getDevices()`) to target one specific device
instead of ringing all of them.

### State accessors

| Method | Returns |
|---|---|
| `getActiveCalls(): Call[]` | Currently active calls |
| `getDevices(): Device[]` | Currently registered devices for this extension |
| `getPresence(): Presence \| undefined` | Current presence status (read-only) |
| `getActiveDevice(): ActiveDevice \| undefined` | Current inbound-routing mode (read-only) |

### Events

| Event | Payload | Emitted when |
|---|---|---|
| `registered` | — | Initial connect or reconnect succeeds |
| `reconnecting` | `{ attempt: number }` | Connection was lost and a reconnect attempt is scheduled |
| `error` | `Error` | An async operation (subscribe, publish, invite rejection) failed |
| `callStart` | `Call` | A new dialog appears |
| `callUpdate` | `Call` | An existing dialog's state changes (e.g. ringing → answered, held) |
| `callEnd` | `Call` | A dialog terminates or disappears from the active set |
| `devicesChanged` | `Device[]` | The user's registered-device list changes |
| `presenceChanged` | `Presence` | The user's presence status changes |
| `activeDeviceChanged` | `ActiveDevice` | The user's inbound-routing mode changes |

### Data models

```ts
interface Call {
  id: string;                              // SIP dialog call-id
  direction: 'inbound' | 'outbound';
  state: 'ringing' | 'answered' | 'held' | 'ended';
  remoteNumber?: string;
  remoteName?: string;
  tags?: string[];
  endReason?: string;                      // set once state is 'ended' — raw PBX reason, e.g. "cancelled"; not a fixed enum
}

interface Device {
  uri: string;                             // Contact URI — usable as the `deviceUri` in answer()
  userAgent: string;
  deviceName: string;
  isLocalRegistration: boolean;
}

interface Presence {
  status?: string;                         // e.g. "online" / "away" / "dnd"
  message?: string;
  until?: string;
}

interface ActiveDevice {
  type: 'device' | 'any_device' | 'mobility' | 'unknown';
  contactUri?: string;
  userAgent?: string;
}
```

### `KNOWN_DEVICE_NAMES`

`Device.deviceName` values are derived from raw, undocumented SIP User-Agent strings — not a fixed enum. For
Wildix's own clients, `KNOWN_DEVICE_NAMES` gives you the exact strings to compare against (e.g. to pick a
default device or label a device type in your UI) instead of hardcoding/guessing them yourself:

```ts
import { KNOWN_DEVICE_NAMES } from '@gorets/wildix-callcontrol';

KNOWN_DEVICE_NAMES.X_BEES_WEB; // 'x-bees Web'
KNOWN_DEVICE_NAMES.COLLABORATION_WEB; // 'Collaboration Web'
KNOWN_DEVICE_NAMES.X_HOPPERS_WEB; // 'x-hoppers Web'
KNOWN_DEVICE_NAMES.COLLABORATION_OLD; // 'Wildix Zero Distance WebRTC' — the old Collaboration 6 client
```

## Multiple users

Each `CallControl` instance is fully independent — its own connection, subscriptions, and in-memory state.
To watch multiple extensions in one process, construct one instance per extension:

```ts
const users = ['10090', '10091', '10092'].map(
  (extension) => new CallControl({ pbxAddress, extension, sipPassword: passwordFor(extension) }),
);

await Promise.all(users.map((cc) => cc.connect()));
```

## How it works

- **Connection** — a `sip.js` `UserAgent` registers over `wss://<pbxAddress>/sip/` using SIP digest auth.
  Since registering creates a real forkable Contact, any real incoming `INVITE` this instance receives is
  immediately rejected with `480 Not a call-handling device` — it never becomes the thing carrying the call.
- **Call events** — a `SUBSCRIBE Event: dialog` (RFC 4235) subscription on the extension's own AOR delivers a
  live feed of every call on any of the user's registered devices, regardless of which physical device is
  handling the media.
- **Device events** — a `SUBSCRIBE Event: reg` (RFC 3680) subscription tracks the user's currently registered
  devices.
- **Routing mode** — a `SUBSCRIBE Event: active-device` subscription (Wildix-proprietary) tracks which
  device/mode currently receives the user's inbound calls.
- **Commands** — `PUBLISH Event: wildixtsp/action` requests with `W-TapiCommand` / `W-TapiParam*` headers act on
  a call by its dialog `call-id`, independent of which device owns the media session.
- **Reconnection** — on transport or registration loss, the library re-registers and recreates all
  subscriptions automatically, with backoff between attempts.

See [`docs/superpowers/specs/2026-07-03-callcontrol-sip-eventemitter-design.md`](docs/superpowers/specs/2026-07-03-callcontrol-sip-eventemitter-design.md)
for the full design rationale, wire-format details, and known open questions.

## Non-goals

- No WebRTC/media handling of any kind, and no `mute` (meaningless without a local media session)
- No presence or active-device **management** — both are read-only; setting them uses entirely different
  mechanisms (REST+Cognito for presence, RFC 3903 state publication for active device) outside this library's
  scope
- No vendor-specific event schema — events are plain SIP/domain terms; mapping to any downstream
  integration's schema is the caller's responsibility

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # jest
npm run lint         # biome check .
npm run build        # tsup — emits dist/ as ESM + CJS + .d.ts
npm run demo         # builds the library, then starts the examples/dashboard dev server
```

Tests live under `test/`, mirroring `src/`'s structure, and rely on a manual `sip.js` mock (`__mocks__/sip.js.ts`)
so they run without a real PBX. The `examples/` are the manual, real-PBX verification path — see their
individual READMEs for setup.

### Releasing

Publishing to npm is automated: bump `version` in `package.json`, then create a GitHub Release (tag it
`vX.Y.Z`) — [`.github/workflows/npm-publish.yml`](.github/workflows/npm-publish.yml) runs typecheck/test/lint,
builds, and publishes to npm on every published release. Requires an `NPM_TOKEN` repo secret (an npm
automation token with publish access to `@gorets/wildix-callcontrol`).

The [`examples/dashboard`](examples/dashboard) demo deploys to GitHub Pages automatically on every push to
`main` — see [`.github/workflows/pages.yml`](.github/workflows/pages.yml).

## License

[MIT](LICENSE)
