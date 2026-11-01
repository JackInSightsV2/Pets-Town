---
issue: 3
status: in_progress
branch: issue-3/track-c
---

# C-track implementation progress

Implemented the typed office contract, immutable inspection state, reconnecting snapshot/SSE client, responsive pet detail panel, genuine native sprite rendering, local bridge and launcher. Development mode is explicitly labelled; default mode is honestly empty until a Codex adapter is supplied.

## Observed checks

- `npm test`: 25 focused tests passed in under one second.
- `npm run build`: TypeScript and production Vite build passed.
- `npm run test:e2e`: three Chromium smoke checks passed, covering request persistence/exact resolution, missing details, independent runtime/connection errors, scene selection, mobile overflow and offline recovery.
- Actual desktop screenshot inspected: genuine locally cached Codex/ChatGPT sprite sheets render in the office and inspection panel.
- Launcher opened the local browser at `http://127.0.0.1:4317` in explicit fixture mode.
- Review found and fixed cross-agent request resolution, the adapter bootstrap event gap, explicit-adapter port reuse, approved-asset filtering and browser offline detection.
- JEV review returned UNAVAILABLE; no advisory pass is claimed.

## Evidence boundary

All current browser request traces are controlled development fixtures flowing through the actual HTTP/SSE bridge. They do not establish observation of a real Codex pending request or resolution in the original client. That live acceptance still depends on the adapter from #1; #3 remains open.

The launcher and reconnect behavior support C-owned parts of #6. The complete three-agent handoff demo, in-office replies, voice and live computer view are not claimed complete.

## Integration seams

- `src/server/adapter.ts`: existing-agent adapter factory with initialSnapshot, subscribe and stop.
- `src/shared/contract.ts`: concrete payload types matching the documented office protocol.
- `petstown:select-agent` browser event with `{ agentId }`: lane A can select a pet in the inspector without knowing UI state internals.
- `docs/track-c.md`: launch and adapter instructions.

No agent execution is started or stopped by office presentation controls.
