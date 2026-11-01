# Codex 0.166.0 handoff source proof

Verified read-only against the official openai/codex repository on 2026-11-01. No repository or runtime changes. Source files were downloaded to /tmp/petstown-0166-source with normal HTTPS certificate verification (system curl); the Python certificate-store failure was not bypassed.

## Exact release mapping

GitHub API `GET /repos/openai/codex/git/ref/tags/rust-v0.166.0` returns annotated tag object `593389380740f7b4762771573c447ccfdc59742f`. Dereferencing that tag returns commit **6ff1e1ca3b30fc8b914720681fcf5fe62e95f856**.

- https://api.github.com/repos/openai/codex/git/ref/tags/rust-v0.166.0
- https://api.github.com/repos/openai/codex/git/tags/593389380740f7b4762771573c447ccfdc59742f
- https://github.com/openai/codex/releases/tag/rust-v0.166.0

The existing Mac daemon independently reports 0.166.0 in initialize.result.userAgent (sanitized check in /tmp/petstown-live-handoff-evidence.md). Thus this is the matching official release source, replacing the earlier unrelated source pin. This establishes version/source correspondence, not a cryptographic attestation that the local binary is unmodified.

## Successful send → interacted

1. The shared v2 message handler serves send_message and followup_task. It awaits agent_control.send; failure propagates before emission. Only a successful receipt with receiver agent path reaches creation of SubAgentActivityItem(kind: Interacted), using the tool call ID as item ID and the actual receiver thread ID.
   https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/core/src/tools/handlers/multi_agents_v2/message_tool.rs#L41-L100

2. The local controller's Message branch awaits send_inter_agent_communication with `?`; only success produces DeliveryReceipt containing target, metadata and submission_id. QueueOnly and TriggerTurn are distinct accepted delivery modes. This proves successful message submission/delivery acceptance, not recipient consumption or task completion.
   https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/core/src/agent/control/api.rs#L122-L177

3. emit_sub_agent_activity emits the same item as started, then completed. Both occur after the successful send receipt above, so even the brief started history projection of an interacted item already follows send acceptance.
   https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/core/src/tools/handlers/multi_agents_v2.rs#L44-L52

## History projection preserves correlation

4. thread/read forwards includeTurns through its read path. For loaded threads, includeTurns:true reads the actual history: paginated mode persists current context and retrieves full turns; legacy mode loads history and reconstructs API turns. It does not synthesize agent exchanges. The paginated route can cause a persistence flush, although it is an observation method and performs no start/resume/interrupt action.
   https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/app-server/src/request_processors/thread_processor.rs#L958-L977
   https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/app-server/src/request_processors/thread_processor.rs#L3290-L3318

5. Completed rollout items are projected with their original turn ID and converted payload. The history builder handles ItemCompleted, materializes SubAgentActivity, and upserts it under the source turn. The compatibility SubAgentActivity event projection likewise retains event ID, kind and recipient thread ID.
   https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/app-server-protocol/src/protocol/thread_history_projection.rs#L78-L83
   https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/app-server-protocol/src/protocol/thread_history.rs#L699-L714
   https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/app-server-protocol/src/protocol/thread_history.rs#L739-L778
   https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/app-server-protocol/src/protocol/thread_history.rs#L1151-L1164

6. The API payload conversion preserves id, kind and agentThreadId; the public enum serializes camelCase Interacted as interacted. No prompt or successful-recipient-response is supplied by this record.
   https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L1047-L1054
   https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L1327-L1344

## Conclusion and integration gate

For the verified standard 0.166.0 runtime, subAgentActivity/interacted source items establish a successful send receipt. The fresh history records observed on the existing Mac daemon can be normalized into **Sent a message.**, retaining sender thread + turn + item + recipient correlation. They must not be described as work completion, a reply, or a recipient acknowledgement.

The source-semantic gap is now resolved for this release and observed wire shape. A narrowly version-gated Mac reader may use this evidence for sourceVerified after its own handshake matches0.166.0 and all scoped baseline reads succeed. Keep initial, newly discovered-thread and reconnect history silent; deduplicate stable source correlations; restrict both participants to the observed scope. Unknown versions remain unsupported until separately verified.

Remaining: implement the separate passive includeTurns:true reader, propagate capability failure to the bridge/browser independently from metadata health, then prove one genuine new source event renders exactly one Office meeting. The existing7new-record probe establishes source availability; it does not replace that browser integration acceptance.
