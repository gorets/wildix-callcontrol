# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository. `CLAUDE.md` is a link to this file. Skills live
in `.agents/skills/<name>/`. `.claude` is a symlink to `.agents`, so Claude Code finds them without a link per skill;
put new skills in `.agents/skills/` and never create real files under `.claude/`.

## What this repo is

`@gorets/wildix-callcontrol`: a headless SIP user for one Wildix extension. It watches every call, device, presence and
routing change of that user (SIP `SUBSCRIBE`) and commands calls (`PUBLISH wildixtsp/action`) without carrying any media.
It is a **public npm package** (and a public repo), used by `rnc` for E2E and by anyone who needs call control.

| Path | What it holds |
| --- | --- |
| `src/CallControl.ts` | the class: connection, subscriptions, reconnect, commands, `ready`, bounded `disconnect()` |
| `src/state/`, `src/xml/` | the trackers (calls, devices, presence, active device) and the parsers of the PBX's XML |
| `src/tapi.ts`, `src/constants.ts`, `src/types.ts`, `src/deviceName.ts` | command headers, constants, public types, `KNOWN_DEVICE_NAMES` |
| `test/` | mirrors `src/`; runs on a manual `sip.js` mock (`__mocks__/sip.js.ts`), no PBX |
| `examples/node`, `examples/html`, `examples/dashboard` | the manual, real-PBX verification path; the dashboard is the GitHub Pages demo |
| `.github/workflows/` | `npm-publish.yml` (release) and `pages.yml` (demo) |

## Build and check

```bash
npm install
npm run typecheck && npm test && npm run lint     # all three before you hand work over
npm run lint:fix                                   # Biome: single quotes, 2 spaces, 120 columns, semicolons, trailing commas
npm run build                                      # tsup: dist/ as ESM + CJS + .d.ts
npm run demo                                       # build, then the dashboard dev server
```

Node `>=24`. `sip.js@^0.21.2` is a **peer** dependency; do not bundle or bump it casually. Commit messages are one
imperative sentence in English, no ticket prefix (`Make disconnect() quick on a real PBX`); a release is `0.3.1`.

## Rules

- **English only** in code, comments, commit messages, identifiers and docs.
- **Nothing real in the repo.** It is public: no PBX host, extension, SIP password, token, customer name or call content
  in code, tests, fixtures, READMEs, commit messages or logs. Examples use `your-pbx.wildixin.com` and `10090`. `.env`
  is git-ignored; `.env.example` lists names only. Never print a secret to a terminal you share.
- **Public API is a contract.** A change to `CallControlConfig`, the methods, the events or the data models is documented
  in the README table in the same commit, with a default that keeps old callers working. Features bump the minor
  version, fixes the patch (the package is 0.x).
- **Teardown never rejects and never hangs.** `disconnect()` is bounded (`disconnectTimeoutMs`); a failing teardown
  step must not stop the others (`attempt()` in `CallControl.ts`).
- **Comments** say what the code cannot: a PBX behaviour, a sip.js quirk, a workaround, with the fact behind it
  ("`Subscriber.dispose()` never completes on a real PBX"). No history, no commented-out code.
- **Tests:** write the test first and watch it fail for the reason you expect; positive and negative cases; time is
  fake. A case that never went red gets a **mutant**: break the code it guards by hand, see it fail on its own
  assertion, undo with the inverse edit (never `git checkout` / `git restore` / `git stash`). Report one line per
  mutant. What only a real PBX shows (timings, ordering) is checked with the examples, and the PR says so.
- **Real PBX checks** are the examples with a test account. Commands act on real calls: test accounts only, end what
  you start.

## Releasing

A push to `main` that raises `version` in `package.json` releases it: typecheck, test, lint, build, `npm publish
--provenance`, a tag and a GitHub Release (`.github/workflows/npm-publish.yml`). A push that does not change the version
releases nothing.

```bash
npm version <x.y.z> --no-git-tag-version
git commit -am "<x.y.z>" && git push
```

**Agents never push, tag, publish or release without the user asking for exactly that**, each time. The workflow file
is the truth when it and the README's "Releasing" section disagree.

## Non-goals

No media or WebRTC, no `mute`, no presence or active-device **management** (read-only; setting a status is a REST call
with a Cognito id token), no vendor event schema. A request that needs one of these belongs in the caller.

## Where the detail lives

| Question | Read |
| --- | --- |
| API, events, data models, how it works | `README.md` |
| Debugging a call, reading the PBX's view, symptoms and PBX facts | `.agents/skills/call-control-debug/SKILL.md` |
| Running the examples against a PBX | `examples/*/README.md` |
| Using it from `rnc` E2E | `rnc` repo, `.agents/skills/rnc-live-e2e/SKILL.md` |
