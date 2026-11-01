---
name: call-control-debug
description: "Debug calls and call-related state on a real Wildix PBX with @gorets/wildix-callcontrol: watch one or several extensions live, see exactly which calls the PBX reports (id, direction, state, remote number, endReason), command calls (answer, hold, resume, hangup, transfer, conference transfer, attended transfer, DTMF, recording, a mobility call) without a phone, dump the raw SIP, and tell a library bug from a PBX or app behaviour. Use it when a call in x-bees / x-hoppers / Collaboration does something unexpected (a transfer that drops, a line that is rejected, a call that will not end, a status that does not change), when a script or E2E needs the PBX's own view of a user's calls, when a SIP WebSocket closes with 1006, when connect() or disconnect() misbehaves, or when working on this library itself."
---

# Debugging calls with call-control

`@gorets/wildix-callcontrol` is a headless SIP user for one extension. It **sees** every call of that user on any of
their devices (a `SUBSCRIBE Event: dialog`) and **commands** them (a `PUBLISH Event: wildixtsp/action`), but it carries
no media: it rejects any real `INVITE` with `480 Not a call-handling device`. That makes it the neutral witness in a
debugging session: it says what the **PBX** thinks, independent of what an app draws.

Use it to answer "is this the app, the PBX or the library?":
the app's UI disagrees with `getActiveCalls()` → the app. The PBX's own view is odd (a call ended `rejected`) → the PBX
or the call flow. The library's own view is odd (no calls after `connect()`, a hang on `disconnect()`) → here.

## Get access

Three values per extension: PBX host, extension, SIP password (`CALLCONTROL_PBX_ADDRESS`, `CALLCONTROL_EXTENSION`,
`CALLCONTROL_SIP_PASSWORD` for the examples; `.env` is git-ignored here, `.env.example` lists the names).

With an x-bees account you only need its Cognito **id token**: its claims carry the PBX (`custom:pbx_domain`,
`custom:pbx_port`) and the extension (`custom:pbx_user_extension`), and
`GET https://<pbx_domain>:<pbx_port>/api/v1/personal/info?fields=extension,sipPassword,email` with
`Authorization: Bearer <idToken>` returns the SIP password. The rnc repo does this for you from a refresh token
(`.agents/skills/rnc-live-e2e` in `rnc`). **Never print or paste the SIP password or a token**; report extensions only.
Use test accounts: commands act on real calls.

## Watch and command

| Need | Do |
| --- | --- |
| watch one extension, nothing to write | `npm run build`, set the three variables, `node examples/node/index.mjs`, then place a call on that extension |
| watch and command several people, with a UI | `npm run demo` (builds, then the `examples/dashboard` Vite app): live calls, devices, presence, routing mode |
| a script or a test | the pattern below |
| the raw SIP | `new CallControl({..., logger, logLevel: 'debug', transportOptions: {traceSip: true}})`; `logger(level, category, label, content)` gets every sip.js line whatever `logLevel` says; set `logToConsole: false` when your logger prints too |

A script that is safe to run next to a test run (this is what rnc's `pbxObserver.ts` does):

```ts
const cc = new CallControl({pbxAddress, extension, sipPassword, userAgent: 'my-probe', expiresSeconds: 120,
  logToConsole: false, logger: () => undefined});
const seen = new Map<string, Call>();                       // every call since start, last state wins
for (const e of ['callStart', 'callUpdate', 'callEnd'] as const) cc.on(e, (c) => seen.set(c.id, c));
cc.on('error', () => undefined);
await cc.connect();
await cc.waitUntilReady(15_000);                            // only now getActiveCalls() can be trusted
// ... cc.getActiveCalls(), [...seen.values()] (state, endReason), cc.hangup(id) ...
await cc.disconnect();                                      // bounded; never rejects
```

- `expiresSeconds: 120` for anything short-lived: a probe that is killed leaves its REGISTER and subscriptions on the PBX
  for the default hour, and they show up in the next run.
- To end everything: loop `getActiveCalls()` → `hangup(id)` → short pause until the list is empty or a deadline passes
  (a first hangup can be too early; repeat it).
- A command resolves when the PBX accepts the `PUBLISH` (200), not when the action is done. Wait for the `callUpdate` /
  `callEnd` it causes.
- `Call`: `id` (the SIP dialog call-id), `direction`, `state` (`ringing`, `answered`, `held`, `ended`), `remoteNumber`,
  `remoteName`, `tags`, `recording` (`off`, `personal`, `system` for a PBX rule, `paused`; from `X-Wildix-record` on both
  sides of the dialog), `endReason` (the PBX's raw word, not an enum: seen `rejected`, `cancelled`).
- Commands and their TAPI words: `answer`/`resume` → `talk`, `hold`, `hangup`, `sendDTMF` → `senddigits`, `transfer`,
  `conferenceTransfer` → `conftransfer`, `attendedTransfer` → `atttransfer` (the far ends of the user's two calls are
  joined, both of the user's legs end; seen live), `record(id, 'on' | 'off' | 'pause' | 'unpause')`, `makeCall` /
  `makeMobilityCall` → `originate` (`device`, `any`, `mobility`).
- Seen live: `record` moves `recording` `off` → `personal` → `paused` → `personal` → `off`; `on` on a recorded call is
  rejected `500 ... recording already started`, `off` on a stopped one `500 ... recording already stopped` (read
  `recording` first). `conferenceTransfer`: the user and the far end report the destination as their remote number at
  once, the destination rings twice (one invitation per leg; answering one ends the other as `rejected`), all three
  talk, and after the user hangs up the other two stay connected (the destination still shows the user's number).
  `makeMobilityCall` is not checked: it rings the mobile number in the user's PBX settings.
- `makeCall` is click-to-dial: it rings the user's own devices first and dials the destination only when a real device
  answers that leg. This library never answers, so with no phone to answer it nothing is dialed. To start a call in a
  test, use a browser or a phone; use the observer for everything after the ring.

## What the PBX has been seen to do

| Fact | Consequence |
| --- | --- |
| The first dialog NOTIFY arrives about 80 ms after `connect()` resolves | `connect()` is too early to read calls; use `waitUntilReady()` / the `ready` event (again after every reconnect) |
| `Registerer.unregister()` resolves before the registration ends; the `Unregistered` state follows about 60 ms later | `disconnect()` waits for that state, then gives the unsubscriptions a short grace |
| `Subscriber.dispose()` never completes | `disconnect()` is bounded by `disconnectTimeoutMs` (10 s) and carries on |
| Answering a second incoming call ends the first as `rejected` | not a library fault; two live lines come from a call plus an attended transfer |
| A declined call is carried on (voicemail) | do not assert the other side's state after a decline |
| An unclean end (killed process) leaves REGISTER and subscriptions until `expiresSeconds` runs out | short `expiresSeconds` in tests; whether such leftovers can make the PBX refuse a new socket was not established |
| Presence is read-only here (`getPresence()`) | to change it use the PBX REST call `PUT /api/v1/Personal/Presence` with the id token (see the rnc skill) |

## Symptoms

| Symptom | Likely cause and what to do |
| --- | --- |
| The SIP WebSocket closes with code **1006** within about 60 ms of opening | **Not a PBX refusal.** In Node 24 (undici) a `fetch` that returned 200 leaves a keep-alive socket and the next `WebSocket` to the same host is handed it. Send `Connection: close` on every `fetch` to the PBX host that a SIP socket follows. Then, and only then, suspect the PBX (the PBX team confirmed no block or limit on their side) |
| `connect()` rejects | the PBX rejected the initial REGISTER: wrong `sipPassword`, or the extension is not on that PBX. Check the host and extension against the id token's claims |
| `connect()` resolves, `getActiveCalls()` is empty although a call is going on | read too early: `await waitUntilReady()` first |
| A command resolves and nothing happens | accepted, not done: wait for `callUpdate`; the call may have already ended (`endReason`); the app may drop a command that arrives during its own call action (rnc: about 2 s after an answer, 100 ms after hold) |
| `makeCall` never rings the destination | no real device answered the ring-back leg; pass a `deviceUri` from `getDevices()` or answer on a phone |
| `disconnect()` seems to hang | it is bounded (`disconnectTimeoutMs`); the PBX did not answer the unsubscriptions |
| A device is named oddly | `Device.deviceName` comes from raw User-Agent strings; compare with `KNOWN_DEVICE_NAMES` |

## Working on the library

```bash
npm run typecheck && npm test && npm run lint     # tests run on a manual sip.js mock (`__mocks__/sip.js.ts`), no PBX
npm run build                                      # tsup: ESM + CJS + .d.ts
```

- Behaviour that only a real PBX shows (the timings above) is verified with the examples, not with Jest; say so when a
  test cannot cover it, and make a mutant for every case that never went red.
- A push to `main` that changes `version` in `package.json` releases: npm publish with provenance, tag, GitHub Release
  (`.github/workflows/npm-publish.yml`; the README's "Releasing" section still describes the older flow). Bump with
  `npm version <x.y.z> --no-git-tag-version`. Do not push or release unless the user asks.
- rnc pins the version in `pnpm-workspace.yaml` (`minimumReleaseAgeExclude` lets a fresh release in); that line is removed
  once the release ages.
