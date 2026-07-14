# Dashboard example

A presentable, multi-user browser dashboard for `@gorets/wildix-callcontrol`: one PBX domain, any number of
independently-connected users, each with its own card showing live calls, devices, presence, and inbound
routing mode, plus full call control.

## Run

1. From the repository root: `npm install`
2. `npm run demo` — this builds the library (`npm run build`) and starts a Vite dev server, opening the
   dashboard in your browser automatically.
3. Enter your PBX domain once, then use "Add user" to connect one or more real extensions (extension + SIP
   password). Each becomes its own independent card.
4. Domain, extensions, and SIP passwords are all saved to this browser's `localStorage` — reloading the page
   reconnects every previously-added user automatically, no re-entry needed. Use each card's "Remove" button
   to disconnect a user and forget it.
5. Optionally set a "Webhook URL". When set, every event from every connected user's `CallControl` instance
   (`registered`, `reconnecting`, `error`, `callStart`, `callUpdate`, `callEnd`, `devicesChanged`,
   `presenceChanged`, `activeDeviceChanged`) is POSTed there as JSON:
   `{ event, extension, pbxAddress, timestamp, data }`. Delivery failures are logged in that session's Event
   log; successes are not. The URL is saved to `localStorage` alongside the PBX domain, and takes effect
   immediately for already-connected sessions.

**Security note:** SIP passwords are stored in plain text in browser `localStorage` for this local dev-only
convenience — don't use this dashboard on a shared or untrusted machine with real production credentials.

This is a manual verification tool, not an automated test — it requires a real, reachable Wildix PBX.
