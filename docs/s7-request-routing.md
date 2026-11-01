# Request routing checkpoint for S7

The isolated module in `src/codex/requests/state.ts` implements correlation and submission state. It is not connected to the office server. Replies remain disabled; issue #7 stays open behind #6 and a live ownership proof.

## Implemented boundary

- Identity binds daemon generation, connection generation, existing agent and typed JSON-RPC ID. Numeric `7` and string `"7"` are different requests. Use a new daemon/connection generation after restart/reconnect; never rebind old UI requests by ID alone.
- An opaque source revision and a local numeric CAS revision prevent stale answers. The adapter supplies monotonically ordered observations. A request body must be immutable within its identity/revision; if an unversioned source changes the body, derive a revision from the canonical full request or reject conflicting replay.
- `beginResponse` returns a lease only for the matching owner, kind, revision and per-request capability evidence. Its returned state must be persisted synchronously before transport dispatch. Call `canDispatch` against current state immediately before writing, serialized with source updates and with no await gap. Both in-flight and uncertain attempts suppress additional sends.
- The trusted adapter validates the exact runtime/kind schema and computes the canonical response fingerprint. Neither an evidence ID nor this pure module proves authorization. Browser-provided evidence/fingerprints must never be trusted.
- `recordSubmission` records a transport outcome only. `needsAttention` stays true until `observeResolution` matches the source identity/revision. Resolution reasons include cancellation, interruption and unknown cleanup.
- Retain state/attempts while the request is outstanding. After a bridge restart, do not restore response capability until authoritative reconciliation; in-memory idempotency alone cannot establish delivery across process crashes.

Lane C retains `OfficeAdapter`, shared Office v1 types, panel and HTTP ownership. No response method, endpoint or capability flag was changed. A typed source response adapter and OfficeAdapter extension are deferred until ownership is proven. This module provides the separately testable state boundary for that later integration.

## Capability evidence and exact blocker

Reviewed main `17cce0a0211d79f83edfd421e1a8f33e45cabca8` after PR #10 merged (final head `8e69ab5e897227edf123f75edcc4ae19d83d5a1f`). Reused/evaluated its existing [metadata probe](../tests/manual/codex-metadata-adapter.ts); no replacement observer was built. It polls metadata, ignores unsolicited server requests, supplies no request details, and explicitly disables responses/handoffs. Its Unix socket path handling rejects ordinary Windows absolute paths.

Local read-only execution verified `codex-cli 0.158.0` and `app-server proxy --help` (existing daemon, Unix socket). The demo documentation reports Mac 0.166.0; that runtime was not executed here. Version-matched source shows pending request replay inside `thread/resume`: [0.158.0](https://github.com/openai/codex/blob/064c6b8c737f5b41d171fdda80bd9ef10ad06eb3/codex-rs/app-server/src/request_processors/thread_lifecycle.rs#L808), [0.166.0](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/app-server/src/request_processors/thread_lifecycle.rs#L1258). That trigger violates the agreed no-resume observation constraint. No supported passive access to the particular pending request was established.

In 0.166.0, [callback consumption](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/app-server/src/outgoing_message.rs#L593) is atomic and precedes typed response parsing. Duplicates do not receive a structured submission acknowledgement. A socket write cannot be reported as accepted. The source replay tests use the original connection, not an independent observer. The newer research pin's human-command recipient checks must not be assumed present in 0.158.0/0.166.0.

The next live proof requires a supported passive access route, the demo runtime's exact schema, and an operator-prepared benign request/intended answer. Then verify source progress, duplicate clicks, original-client-first resolution and cancellation. No live requests were answered or agent execution changed in this checkpoint.

## Verification

Fixtures cover ownership, typed IDs, immutable snapshots, replay ordering, stale revisions, duplicate keys/payload conflicts, unsupported capabilities, disconnect, ambiguous delivery and source resolution. They establish state behavior only, not runtime authorization.

Verified: 26/26 focused tests passed (`npx tsx --test src/codex/requests/*.test.ts`); `npm run typecheck` passed. The broader `npm test` run passed 50/51 tests. Its existing static-file server test failed before its assertion because Windows refused symlink creation with EPERM; that test and server were not modified.

Owner: Alex/getmateri. Chat: `01a19758-8403-7640-86ac-49e05ca8fa3e`, local Windows host. Branch: `codex/s7-request-routing`. Owned paths: `src/codex/requests/**` and this note. Base main: `17cce0a0211d79f83edfd421e1a8f33e45cabca8`.

