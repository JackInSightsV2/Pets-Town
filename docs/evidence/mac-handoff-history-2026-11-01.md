# Sanitized Mac handoff-history observation

Observed on 2026-11-01; completion timestamp captured at approximately 14:40:56 UTC. Checkout HEAD at inspection: a268a36. This is read-only evidence, not an Office handoff acceptance result.

Command (from /Users/jackinsights/Coding/PetsTown):

```sh
npx tsx tests/manual/handoff-history-probe.ts
```

Probe exited 0 with result `finished`. Initial baseline: loaded=4, readable=4, rejected=0, newlyBaselined=4, historyInteractions=181, newInteractions=0. During the subsequent bounded 60-second poll window it reported **7 new interactions**, each with a distinct temporary pseudonymized item correlation. Every reported poll retained loaded=4, readable=4, rejected=0; no late thread baselines were added. No raw thread/item IDs, paths, prompts, messages or transcripts are retained here. No agent-control operations were executed and office port 4319 was untouched.

Read-only wire methods: initialize, initialized notification, thread/loaded/list, thread/read with includeTurns:true. The probe matches existing history items with type=subAgentActivity, kind=interacted, nonempty item/recipient IDs, distinct sender/recipient, and source turn correlation. Previously observed item correlations are deduplicated; initial history is not counted as new. CLI reports `codex-cli 0.166.0`; the probe discards the initialize result, so this does NOT independently establish the running daemon version.

## PR #21 inspection

Open PR: https://github.com/JackInSightsV2/Pets-Town/pull/21
Head inspected: d86b5afb52f7c2a90086aaa136c2a6bbbf6ce1da.

The PR adds createHandoffHistoryAdapter({base,reader,sourceNamespace,sourceVerified,pollMs?,now?}). VerifiedHistoryReader requires readonly generation:string, read(threadId):Promise<unknown> returning a thread/read response including turns, and close():void|Promise<void>. It has no Mac transport implementation. Existing MetadataRpc explicitly rejects includeTurns:true, so it cannot be reused unchanged as the history reader.

Required concrete adapter: a separate passive WebSocket-over-Unix reader using the already existing daemon socket; initialize once, read only the requested scoped thread IDs with includeTurns:true, maintain connection generation, sanitize diagnostics, and close only its own connection. Compose with the production metadata observer, preserving scoped participant checks and silent initial/late/reconnect baselines. Do not weaken the metadata reader's includeTurns:false boundary globally.

## Remaining verification and C integration

These seven new history records establish that fresh correlated interacted items are observable on this Mac. They do not independently prove delivery-success semantics or a browser meeting. The normalizer's source claim is that the v2 handler emits interacted after a successful send receipt. sourceVerified=true requires matching that source implementation/projection to the actual daemon runtime/version (not merely the installed CLI), plus successful full baseline reads for the scoped roster. The item shape has no independent receipt-status field checked by this probe; source provenance supplies that meaning. Avoid relabeling arbitrary history items as completed notifications without that evidence.

Use a stable sourceNamespace identifying the verified runtime, distinct from a connection generation. Verify scoped sender and recipient, source item correlation, silent replay/reconnect, and one genuine new event reaching Office SSE and rendered once. Preserve neutral 'Sent a message.' summary; no transcript synthesis is required.

C integration: this branch adds capabilities.changed propagation through server snapshots/SSE and client state, with cancellation of active/queued meetings on support loss. The PR #21 wrapper must emit this event when its history capability changes; its current internal snapshot mutation alone still cannot reach connected browsers. Metadata health remains separate. A real browser handoff and timed team demo remain unverified.

## Supplemental daemon identity check


A separate bounded read-only WebSocket connection to the same existing Unix control socket sent initialize and initialized only, extracted a version from result.userAgent, and closed its own connection. Only the sanitized version and field name were printed:

```json
{"daemonVersion":"0.166.0","field":"userAgent"}
```

This independently verifies the running daemon reports 0.166.0, matching the installed CLI version. No full handshake response, machine paths or account data were retained. The connection did not read turns or control agents.

Cached repository source map (`docs/research/codex-pets/source-map.md`, opening paragraph) pins OpenAI source commit 67f0994b532b8740f14b5b738af7b7b2a915b1d6, dated 2026-10-31, and explicitly warns that the pin does not establish installed runtime parity. `protocol.md` records the same pin but its schema audit target was Windows0.158.0, with Mac0.166.0 previously reported separately. `src/codex/handoffs/normalizer.ts` documents the successful-send receipt semantics but does not identify a daemon build/source commit mapping.

Therefore the daemon version gap is now closed, but the cached evidence does not by itself prove that source pin is the exact build/source mapping for 0.166.0. Required next evidence is the already-audited receipt handler/source revision mapped to daemon0.166.0 (or a targeted equivalent source audit). Do not turn sourceVerified on solely because a semver was recovered. No browsing, repository edits or Git mutations were performed for this supplemental check.
