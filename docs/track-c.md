# Track C integration handoff

This branch supplies the local HTTP/SSE bridge, browser office, immutable client store, inspection panel, presentation controls and launch scripts. It supports development fixtures and an injected observation adapter. It does not establish that live Codex observation or the integrated demo has passed acceptance.

Team ownership stays as recorded in the [delivery plan](../plan.md): lane A owns scene choreography and project layout; lane B owns live Codex observation, real handoffs and eventual replies; lane C owns the app shell, inspection and demo packaging. Use the [office contract](contracts/office-v1.md) when integrating across lanes.

## Adapter integration

The source types live in [src/shared/contract.ts](../src/shared/contract.ts). Implement [OfficeAdapter](../src/server/adapter.ts):

```ts
import type { OfficeEvent, OfficeSnapshot } from '../src/shared/contract';

interface OfficeAdapter {
  initialSnapshot(): OfficeSnapshot | Promise<OfficeSnapshot>;
  subscribe(listener: (event: OfficeEvent) => void): () => void;
  stop(): void | Promise<void>;
}

export function createAdapter(): OfficeAdapter {
  // Return the team's observer of existing sessions.
}
```

The import path in this outline must be adjusted for the adapter's location. The loader accepts a named `createAdapter` export, a default factory (including an async factory), or a default adapter object. Launch it with `npm run office -- --adapter ./path/to/adapter.ts`; a relative module path resolves from the current working directory. The adapter is responsible for observing existing sessions and releasing its subscriptions in `stop()`, never creating agent work.

The bridge subscribes before requesting the initial snapshot and buffers observations during bootstrap. The snapshot's adapter epoch/lastSeq must describe which source events it already contains, so buffered events at or below that cursor can be skipped. Supply stable event/request identities and accurate source labels. The bridge assigns a fresh bridge epoch and ordered sequence to browser events. Requests must retain their owning agent identity; unknown details remain null/unknown.

GET `/api/office` returns the current snapshot. GET `/api/events?cursor=<bridgeEpoch:seq>` replays subsequent events and streams named `office` SSE messages. An unavailable cursor requires a new snapshot. Browser transport health and source connection health are separate from agent runtime state. Presentation changes never clear pending requests or control agent execution.

In-office replies remain disabled until lane B verifies the particular response route in [#7](https://github.com/JackInSightsV2/Pets-Town/issues/7). An ordinary chat message is not an approval response, and submission acknowledgement is not request resolution.

## Scene selection seam

Lane A can select an existing agent in the inspection panel without coupling its renderer to React:

```ts
window.dispatchEvent(new CustomEvent('petstown:select-agent', {
  detail: { agentId: existingCodexThreadId },
}));
```

Use the stable `agentId` from the snapshot. The app subscribes to this event and calls `store.selectAgent(agentId)`. Selection does not alter agent execution or dismiss attention. Recent visible activity remains on each `agent.recentActivity`; the shared store is in [src/client/store.ts](../src/client/store.ts).

## Development and acceptance evidence

`npm run office -- --fixture` supplies labelled synthetic agents, requests and handoffs for development. `npm run dev:all -- --fixture` runs the bridge with Vite on the development proxy setup. Both are useful for repeatable inspection and reconnect checks; neither establishes a real Codex integration. Follow the [README](../README.md#run-the-app) for build, options and checks.

For [#3 — live pet inspection](../.claude/epics/petstown-hackathon/3.md), still capture:

- A real pending request on an existing agent and its resolution in the original Codex client; only that matching request disappears.
- Browser evidence that stable selection, correct task/activity, unknown request details, persistent attention, and reconnect/stale-state distinctions work with that live source.
- Reply controls remain disabled with an explanation until #7's verified route exists.

For [#6 — integrated demo](../.claude/epics/petstown-hackathon/6.md), still capture:

- A teammate following the runbook on the actual demo Mac with three externally prepared real agents.
- The rehearsed 90-second sequence: Start the day, arrivals, standup, inspection and a real handoff, integrating lanes A and B.
- Refresh, reset, repeat launch, disconnect/rejoin and failed-agent behavior without restarting real work or duplicating pets, requests or meetings.
- Tested commit/build, runtime, invocation, asset setup and evidence, followed by a known-working checkpoint and team acceptance on the demo Mac.
- If plugin packaging is selected, actual installation and skill completion/invocation testing; copying plugin files is insufficient.

Root will add observed browser results separately. This document does not close #3 or #6, and does not claim voice (#8) or live computer view (#9) delivery.
