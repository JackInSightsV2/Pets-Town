---
issue: 3
stream: client-store-and-connection
started: 2026-11-01T13:19:32Z
updated: 2026-11-01T13:19:32Z
status: completed
---

## Scope

Implemented only `src/client/**` and this progress note. No commits, shared contract changes, UI changes, or server changes.

## Delivered

- Immutable, externally subscribable office store using stable agent selection and per-agent activity history.
- Exact request opened/resolved correlation; scene changes, selection, metadata upserts and source/transport disconnection do not clear unresolved requests.
- Missing request details remain unknown. In-office reply capabilities remain disabled pending S7 verification.
- Runtime status stays separate from browser transport and source connection health. Work completion does not imply session closure or a newly idle runtime.
- Epoch/sequence tracking, duplicate suppression, minimum-sequence recovery after gaps, retired-epoch rejection and stale-snapshot protection.
- Snapshot fetch followed by cursor-based SSE (`office` event), safe refresh generations, abort/stop handling and reconnect snapshots. Native EventSource hides HTTP409 details, so all stream errors recover by fetching current state.
- Runtime validation of snapshots/events before reduction; malformed payloads preserve the last known data.
- Presentation POST helper uses the snapshot control token and browser-provided Origin, then fetches the authoritative snapshot.

## Verification

- `./node_modules/.bin/tsx --test src/client/*.test.ts`: 16 passing tests covering lifecycles, immutability, ordering, replay, restarts, gaps, refresh races, stale callbacks, malformed data, transport failure and presentation requests.
- `./node_modules/.bin/tsc --noEmit`: passed across the current worktree.
- JEV check: `UNAVAILABLE kind=code`; no JEV validation result. Continued with direct tests/typecheck as instructed.
- No browser or live Codex acceptance performed by this stream. Root owns browser verification; issue #3 still requires the specified real request/resolution evidence.

## Integration notes

- `connectOffice(store, { baseUrl? })` returns `{ stop, refresh }`.
- `presentationAction(store, action, baseUrl?)` accepts `start`, `skip`, or `reset`.
- Store callbacks are closure-bound and `getState()` identity is stable between updates for `useSyncExternalStore`.
- Server worker confirmed synchronous cursor replay and the POST presentation response shape.
- Shared snapshot has no completed-work animation field. This client deliberately does not invent a runtime transition on `agent.work.completed`; a later scene event seam must consume verified completion if needed.
