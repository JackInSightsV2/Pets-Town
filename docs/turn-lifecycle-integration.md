# Turn lifecycle presentation

This change supplies a strict source normalizer and a presentation controller. It does **not** connect a new observer or modify the source readers, wire contract, scene, runtime sessions, or services. The source and scene owners can integrate these modules at the seams below.

| Verified latest turn | Live observation | Initial snapshot / reconnect |
| --- | --- | --- |
| Started | Return from entrance, or wake in place | Present, settled |
| Succeeded | Walk out, then hide sprite | Absent, no exit replay |
| Failed | Death animation, then hide sprite | Absent, no death replay |
| Interrupted | Sleep in office | Sleeping, settled |
| Unverified | No inferred outcome | `phase: unknown`, `visible: null` if no previous established state |

Runtime membership, inspector selection, layout allocation, pending requests, and parent/child relationships remain unchanged. Unresolved request IDs or waiting flags pin the presentation visible; clearing attention reveals the already-settled presence without replay. Parent completion never affects a child's lifecycle.

## Source evidence and limits

Verified against Codex 0.166.0 source commit `6ff1e1ca3b30fc8b914720681fcf5fe62e95f856`:

- `turn/started` and `turn/completed` carry `{threadId, turn}`. `Turn.status` is `inProgress`, `completed`, `failed`, or `interrupted`. The normalizer requires status/method agreement; the method name alone is insufficient. [Notifications and statuses](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/app-server-protocol/src/protocol/v2/turn.rs).
- Turn projections have nullable integer Unix-second `startedAt` and `completedAt` fields. Historical terminal status requires explicit `completedAt`. Historical `inProgress` requires `startedAt` and independently verified current thread activity. [Turn fields](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs#L384-L411).
- Completion preserves an already failed/interrupted outcome; implicit reconstructed turns can default to completed with no terminal event. Raw `task_complete` with no error cannot establish success by itself. Abort projection copies the terminal timestamp. [Projection handlers and implicit defaults](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/app-server-protocol/src/protocol/thread_history.rs#L1399-L1572).
- Full paginated history is assembled in ascending source order. Choose the last turn from the verified full response. Do not filter out an ambiguous latest turn and fall back to an earlier completed turn. [History ordering](https://github.com/openai/codex/blob/6ff1e1ca3b30fc8b914720681fcf5fe62e95f856/codex-rs/app-server/src/request_processors/thread_processor.rs#L3582-L3608).

The merged Mac reader returns correlated full turns but ignores unsolicited notifications. Its handoff adapter filters `unknown`, `closed`, and `error` agents before reading history. Lifecycle extraction must scan the reader-authorized roster independently of handoff eligibility, or it can miss failed turns. This module's notification path is a tested boundary, not a claim that notification delivery is currently wired.

Windows PR29 at `89baa3f3aee4d970aadcdd70ae9a8d460350dfa9` deliberately maps historical starts/completions to unknown and discards turn outcomes. That metadata cannot establish initial sprite presence. Windows needs a separate verified per-turn projection preserving failure/interruption across completion, or a verified history source. Runtime `idle`, `error`, `unknown`, disappearance from a loaded list, and connection loss are not lifecycle evidence.

Until that projection exists, an initial unknown row has `visible: null`; the presentation owner must choose an explicit fallback. This implementation does not silently classify unknown as working or finished. Existing known presentation is retained when subsequent metadata adds no outcome evidence.

## Smallest integration

1. In the source owner, normalize the latest turn from the existing correlated history response using `normalizeTurnLifecycle({format: 'history-turn', value: {threadId, turn}, ...})`. The first complete read, late discovery, and every reader-generation change are baseline/history. Reuse the private stable source namespace; output hashes turn/event identity and omits raw IDs, errors, prompts, paths, and items. Do not print or persist raw responses.
2. Add a dedicated optional latest-turn snapshot field plus a dedicated turn-observation event to the shared contract and client/server validators. Do not reinterpret `agent.work.completed`, which currently carries neither turn outcome nor reliable turn identity. Preserve the normalizer's `delivery` distinction. Keep agent scoping and transport epoch/sequence validation at the existing boundary.
3. At the accepted snapshot/event boundary in `src/client/handoffs.ts`, keep one controller instance. Call `baseline({agents, latestTurns, connected, presentation})` only for accepted authoritative snapshots and capture its returned delivery generation. Feed validated normalized observations to `observe(observation, capturedGeneration)`. Call `suspend()` on continuity loss and obtain a new baseline before delivering more live observations. It is not enough to set a connection flag to connected.
4. Send roster/request updates through `setAgents()` and global presentation changes through `setPresentation()`. Runtime metadata updates alone produce no lifecycle outcome. If a terminal event arrives without its matching active turn, obtain a fresh latest-turn baseline rather than inventing the missed start or animating old work.
5. Expose `getState()`, `drainEffects()`, and `complete(token)` to the scene owner. PR30 at `87c444732f9070507f90776f640119106da35d89` provides entrance/home placement and `NativePet(animationName)`. Reuse those coordinates for enter/exit and the animation override for sleep/death. Keep layout allocation based on `snapshot.agents`; alter only sprite presentation.
6. Lifecycle placement takes priority over handoffs. Admit only `meetingEligible` sprites, cancel ineligible active meetings, and reject stale meeting-return callbacks. Render attention in the roster/inspector as well as the scene. `visible: null` requires the chosen unknown-presence fallback.
7. Bound every animation with a token-based completion callback. Completion must also occur for reduced motion, missing artwork, or scene cleanup; never depend only on CSS `animationend`. Death is a one-shot presentation, even though the existing atlas renderer loops its rows. The checked-in manifest declares `failed` and `waiting`, but no `dead` or `sleeping` rows: the scene owner must use declared artwork plus an explicit visual treatment, not invent atlas rows. A new start, snapshot, suspension, or presentation reset invalidates stale callbacks.

The controller remembers turn/event identities without eviction; capacity exhaustion returns `unavailable`, so the owner should expose unavailable lifecycle support instead of recreating an empty controller and replaying history. Source history must be seeded before live delivery. The timestamps are supporting ordering evidence, never a timeout-based outcome inference.

## Verification

Synthetic tests cover explicit source outcomes; rejection of method-only completion, raw rollout completion, inferred historical completion and malformed correlation; opaque stable identity; successful exit/return; death/disappearance; sleep/wake; stale animation callbacks; repeated and conflicting terminals; stale baselines; missing starts; reconnect generations; request/wait attention; parent/child independence; membership removal; presentation pauses; and bounded deduplication.

Run the focused suites with:

```sh
node node_modules/tsx/dist/cli.mjs --test src/codex/lifecycle/normalizer.test.ts src/office/lifecycle/controller.test.ts src/office/lifecycle/outcomes.test.ts
npm run build
```

These are module tests and build validation. They do not constitute live observer or browser evidence for the pending source/scene hookups.
