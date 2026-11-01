# Office contract implementation decisions

The existing [Office contract v1](../../contracts/office-v1.md) is the shared design. Two independent readers audited its version at commit `ddd4163bea84af84deb5af317498c7a2fa17867e` (blob `aeb0709d789e9294b0fb8d8ffd1748521f5f5363`). This audit proposes clarifications; it does not introduce a replacement contract.

Since that baseline audit, [PR #10](https://github.com/JackInSightsV2/Pets-Town/pull/10) supplies concrete types, nullable global-event agent IDs, snapshot fixture labeling, an initial cursor query, and explicit resnapshot handling. Read [teammate integration](teammate-integration.md) first. The table records the baseline concerns to verify against that implementation, not a request to invent parallel solutions. Settle any remaining differences with lane C.

| Priority | Decision | Recommended direction |
| --- | --- | --- |
| P1 | Atomic snapshot-to-stream bootstrap | Return a snapshot at a defined high-water sequence, then allow explicit replay after that cursor. PR #10 uses /api/events?cursor=bridgeEpoch:seq plus snapshot/source buffering. |
| P1 | Initial cursor and reconnect | PR #10 uses epoch:seq, bounded replay, HTTP409 snapshot_required and client resnapshot on stream failure; verify adapter bootstrap and recovery against that implementation. |
| P1 | Exact event payloads | Reuse PR #10 src/shared/contract.ts, which defines payloads/collections and nullable agentId for global events. |
| P1 | Fixture labeling | PR #10 labels snapshot.source as codex or fixture. Preserve that session label; source:office remains legitimate presentation provenance, not evidence of Codex activity. |
| P1 | Completion outcome | Emit agent.work.completed/celebration only for verified successful work. A failed/interrupted turn/completed notification is not success. |
| P2 | Presentation reset and catch-up | Specify officeSessionId changes, invalidate stale animation callbacks, and decide which catch-up exchanges may animate. Refresh must not replay old meetings automatically. |
| P2 | Request response wire shape | Define revision/idempotency fields and accepted, stale, already-resolved, unsupported and failed outcomes. Only observed source resolution clears attention. |

Native EventSource accepts a URL and credentials option, not arbitrary caller-supplied headers. Last-Event-ID is normally generated automatically for reconnects. Therefore "send Last-Event-ID" alone is not a complete initial snapshot bootstrap design. See the [WHATWG SSE specification](https://html.spec.whatwg.org/dev/server-sent-events.html).

PR #10 implements a bounded in-memory replay buffer and a fresh snapshot on cursor failure. Validate its snapshot high-water mapping with the real adapter and reconcile the prose contract with the chosen source types. Remaining work is integration proof and outcome/reset/request semantics, not building a second SSE system.

## Invariants

- Stable existing thread identity remains agentId. Do not introduce an execution runId that implies the office owns the agents.
- Launch, Start, Skip, Reset and close leave underlying execution unchanged.
- handoff.observed requires actual source correlation.
- Connection health, runtime state, outstanding requests and choreography are separate state machines.
- A waiting flag with unavailable request details stays inspectable but cannot manufacture a prompt.
- A snapshot restore must not duplicate pets, attention, or meetings.
- A fixture can test normalization and rendering; it cannot prove observer or response capabilities.
- Three demo pets and four illustrated desk clusters are not product limits.

## Shared fixture

[fixture-scenarios.json](fixture-scenarios.json) is a scenario plan, not serialized API events and not a live trace. Prefer extending PR #10's existing fixtures and focused checks once the remaining wire choices are settled.

Minimum coverage: two projects, a main/subagent relationship, a pending request resolved in the original client, a source-shaped handoff, successful completion into idle, failure/interruption, disconnection/rejoin, duplicates/gaps/new epoch, hidden attention, and presentation reset without runtime mutation.

Do not commit private prompts, raw conversations, credentials or account responses when capturing the separate real trace.
