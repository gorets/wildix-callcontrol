# Dashboard example

A presentable, multi-user browser dashboard for `@gorets/wildix-callcontrol`: any number of independently-
connected users, each with its own card showing live calls, devices, presence, and inbound routing mode, plus
full call control. Each user can belong to a different PBX — the PBX domain is entered per user, not shared.

## Run

1. From the repository root: `npm install`
2. `npm run demo` — this builds the library (`npm run build`) and starts a Vite dev server, opening the
   dashboard in your browser automatically.
3. Enter the PBX domain for a user, then use "Add user" to connect it (extension + SIP password). Each becomes
   its own independent card, labeled with the PBX domain it's connected to. Repeat with a different PBX domain
   to connect users from another PBX in the same dashboard.
4. The PBX domain, extension, and SIP password for every user, plus the webhook URL, are all saved to this
   browser's `localStorage` — reloading the page reconnects every previously-added user automatically, no
   re-entry needed. Use each card's remove (trash) button to disconnect a user and forget it.
5. Optionally set a "Webhook URL". When set, every event from every connected user's `CallControl` instance
   (`registered`, `reconnecting`, `error`, `callStart`, `callUpdate`, `callEnd`, `devicesChanged`,
   `presenceChanged`, `activeDeviceChanged`) is POSTed there as JSON:
   `{ event, extension, pbxAddress, timestamp, data }`. Delivery failures are logged in that session's Event
   log; successes are not. The URL is saved to `localStorage` alongside each user's PBX domain, and takes
   effect immediately for already-connected sessions.

**Security note:** SIP passwords are stored in plain text in browser `localStorage` for this local dev-only
convenience — don't use this dashboard on a shared or untrusted machine with real production credentials.

This is a manual verification tool, not an automated test — it requires a real, reachable Wildix PBX.

## Layout

- With no users connected, the connect form (PBX host, extension, SIP password) is shown in full. Once at least
  one user is connected it folds into an "Add user" button next to the filters, and opens again when the last
  user is removed.
- The toolbar above the cards filters them (All / In call / Idle, with counts) and finds an extension; the
  webhook field shows whether events are being forwarded.
- A card with a live call is outlined. Each call shows its direction, remote party, state and a duration
  timer (counted from when this dashboard first saw the call). Answer / Hold / Resume / Hang up are always
  visible, disabled when they don't apply; DTMF, Transfer and Attended transfer sit behind their own buttons
  and open an inline form (Enter sends, Esc closes). "Answer on" appears only while an inbound call rings.
