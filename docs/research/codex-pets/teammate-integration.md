# Integrating with Jack's existing app flow

Repository monitoring found [PR #10](https://github.com/JackInSightsV2/Pets-Town/pull/10), Add C-track inspection UI and local office bridge. Its inspected head is `1df6a73a8913ebad336ab8c730bf480e18d4e04f`. It was open when checked; refresh its current state before basing work on it. Do not merge it merely because this research references it.

The PR supplies the TypeScript/Vite scaffold, HTTP/SSE server, client store, inspection UI, launcher, genuine asset loading path and fixture tests. The author reports passing tests and browser checks; this preparation inspected the source but did not rerun those tests. Live observation remains open.

## Reuse the concrete adapter seam

[OfficeAdapter](https://github.com/JackInSightsV2/Pets-Town/blob/1df6a73a8913ebad336ab8c730bf480e18d4e04f/src/server/adapter.ts) is:

```ts
interface OfficeAdapter {
  initialSnapshot(): OfficeSnapshot | Promise<OfficeSnapshot>;
  subscribe(listener: (event: OfficeEvent) => void): () => void;
  stop(): void | Promise<void>;
}
```

Use its [shared Office types](https://github.com/JackInSightsV2/Pets-Town/blob/1df6a73a8913ebad336ab8c730bf480e18d4e04f/src/shared/contract.ts). Export named createAdapter, a default factory (async is accepted), or a default adapter object. The loader checks all three methods.

The documented launch is:

```sh
npm run office -- --adapter ./path/to/adapter.ts
```

The path is illustrative; substitute the implemented module. The factory is called without arguments in this version. Read [Track C's handoff](https://github.com/JackInSightsV2/Pets-Town/blob/1df6a73a8913ebad336ab8c730bf480e18d4e04f/docs/track-c.md) before implementation.

stop releases the observer's subscriptions/connections only. It must not terminate the existing Codex daemon or its agents.

## Ordering and snapshots

The [server](https://github.com/JackInSightsV2/Pets-Town/blob/1df6a73a8913ebad336ab8c730bf480e18d4e04f/src/server/server.ts) subscribes before awaiting initialSnapshot and buffers observations meanwhile. It compares buffered events with the initial snapshot's adapter epoch/lastSeq, then gives browser events a fresh bridge epoch and sequence.

Your adapter must therefore provide a consistent observation snapshot and its matching local observation cursor. Do not return a meaningless zero cursor when the snapshot already includes buffered events. Native source IDs/correlation stay intact even when the bridge rewrites its browser delivery clock.

The current implementation also supplies:
- GET /api/events?cursor=bridgeEpoch:seq and named office SSE messages.
- HTTP409 snapshot_required for an invalid, expired or different-epoch cursor.
- A client that resnapshots on stream failure.
- Nullable agentId on global events, exact event payload types, and snapshot source:codex|fixture.
- /api/health identifying petstown-office.
- Same-origin presentation POSTs with X-Office-Token from the snapshot.

These are source-inspected implementation choices in the open PR, not newly proposed replacements. Review the actual merged revision for changes.

## Per-session integration

| Session | Plug in here | Avoid duplicating |
| --- | --- | --- |
| #1 observation | A module implementing OfficeAdapter and importing src/shared/contract.ts | package manifest, HTTP/SSE server, launcher, client store, inspection panel |
| #4 handoffs | Emit handoff.observed with OfficeHandoff source correlation; expose dedicated scene choreography | general arrivals/layout and #1 connection management |
| #7 requests | Request state/correlation now; a separately agreed verified response interface later | the panel or an invented generic chat-as-approval route |

The current OfficeAdapter has no response method. The server deliberately returns501 for request POSTs and forces respondToRequests unsupported. #7 must coordinate a typed, proven reply path with lane C after the gate; changing a capability flag alone cannot make replies work.

Lane A can select an agent through the documented petstown:select-agent CustomEvent carrying detail.agentId. The inspection panel already handles that stable identity.

## Reconcile before integrating

Inspect the latest PR/branch, source types and Track C handoff. When the scaffold merges, rebase/reconcile normally and run its existing focused checks plus the adapter's real proof. Keep fixtures visibly labelled. Do not claim #1/#3 live acceptance from the PR author's fixture results.
