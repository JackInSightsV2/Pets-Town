# Turn lifecycle presentation

This change supplies strict source normalization, passive Windows/Mac reader compositions, additive snapshot/event wire support, and a presentation controller. Scene orchestration is integrated separately on the combined preview branch. These adapters never create, resume, interrupt, reply to, archive, or delete runtime sessions.

## Runnable composite adapters

Windows preserves PR35's existing names/activity observer and adds lifecycle over the same configured files or discovery root and exact directory allowlist:

```sh
npm run office -- --adapter ./src/codex/lifecycle/windows-adapter.ts
```

Use the existing `PETSTOWN_ROLLOUT_ROOT`/`PETSTOWN_ROLLOUT_FILES` and `PETSTOWN_METADATA_CWDS` settings. The reader does not expand the allowlist. The Windows entrypoint requires the PR35 activity adapter and main's bounded discovery module, supplied by the combined preview.

Mac preserves the existing live-handoff adapter and adds a separately owned verified history reader:

```sh
npm run office -- --adapter ./src/codex/lifecycle/mac-adapter.ts
```

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

Windows metadata alone still cannot establish presence. The new separate rollout reader maintains an ordered per-turn projection of explicit start, ErrorEvent, abort, and completion records. It preserves failure/interruption across completion, ignores tool failures, and requires a correlated explicit start before terminal evidence. Missing abort identity, unknown error variants, rollback, unsupported versions, and ambiguous ownership fail closed. Runtime `idle`, `error`, `unknown`, disappearance from a loaded list, and connection loss are not lifecycle evidence.

The deployed Windows session headers were verified as `0.166.0-alpha.5.1`; the unrelated PATH CLI reported a different version. The exact source tag resolves to `f79b26ccbb3116b052544666a181012fb45dc49b`. Relevant history projection, recorder, error semantics and task terminal rules match the audited release. [Exact deployed event rules](https://github.com/openai/codex/blob/f79b26ccbb3116b052544666a181012fb45dc49b/codex-rs/app-server-protocol/src/protocol/thread_history.rs#L1377-L1504).

Copied parent history is excluded by `subagent_history_start_ordinal`. The first child header remains authoritative; copied parent headers below that boundary are ignored. The exact deployed source also proves that paginated `subagent`/`guardian_review` initialization without inheritance markers has no copied lifecycle prefix; copied initialization under those discriminators writes a boundary. [Ownership initialization](https://github.com/openai/codex/blob/f79b26ccbb3116b052544666a181012fb45dc49b/codex-rs/core/src/session/session.rs#L913-L919), [copied-prefix boundary](https://github.com/openai/codex/blob/f79b26ccbb3116b052544666a181012fb45dc49b/codex-rs/core/src/session/session.rs#L1126-L1143).

Native app-server root sessions are supported for `source: vscode` without inheritance markers. Normal root forks retain the original conversation identity before snapshot conversion and set the fork marker; markerless supplied app-server history accepts only response items, not lifecycle records. CLI/exec/internal roots are outside this audit and remain unsupported. [Root fork marker preservation](https://github.com/openai/codex/blob/f79b26ccbb3116b052544666a181012fb45dc49b/codex-rs/core/src/thread_manager.rs#L1701-L1743), [supplied-history boundary](https://github.com/openai/codex/blob/f79b26ccbb3116b052544666a181012fb45dc49b/codex-rs/app-server/src/request_processors/thread_processor.rs#L4921-L4935).

Initial inventory is history, including an incomplete initial line completed later. A later-discovered, ownership-verified file can produce a live arrival only when its latest turn remains open and source `started_at` is after observer cutover and no later than receipt time. The outer record timestamp is writer time and is never used to infer freshness. A later-discovered already-completed turn updates presence silently. Existing unfinished bootstrap work remains unestablished without independent current-work evidence. Integer-second start precision deliberately rejects the ambiguous first partial second. [Writer timestamp semantics](https://github.com/openai/codex/blob/f79b26ccbb3116b052544666a181012fb45dc49b/codex-rs/rollout/src/recorder.rs#L2142-L2155).

Different-turn wire replacement requires strictly increasing known source start times. Missing/equal times cannot establish ordering and are rejected. Source compositions omit standalone null-start baselines so they cannot block later genuine starts; same-turn terminal updates retain an already known source start. The wire does not yet encode an authoritative source ordinal, so two distinct turns starting in the same second remain unavailable rather than accepting stale evidence by arrival order.

An initial unsupported row has `visible: null`; the presentation owner must choose an explicit fallback. This implementation does not silently classify unknown as working or finished. Existing known presentation is retained when subsequent metadata adds no outcome evidence.

## Smallest integration

1. The composite source adapters now perform source normalization, correlation and baseline/live classification. They hash turn/event identity and omit raw IDs, errors, prompts, paths, and items. Do not print or persist raw responses.
2. The implemented wire is `OfficeSnapshot.latestTurns?: TurnLifecycleObservation[]` and `OfficeEvent {type: 'agent.turn.observed', data: {observation}}`. Client/server validators check source/owner correlation and snapshot roster membership. Stores preserve latest lifecycle separately from runtime state; `agent.work.completed` retains its previous semantics. Read the dedicated accepted event to distinguish live effects from source rebaseline, rather than diffing snapshots.
3. At the accepted snapshot/event boundary in `src/client/handoffs.ts`, keep one controller instance. Call `baseline({agents, latestTurns, connected, presentation})` only for accepted authoritative snapshots and capture its returned delivery generation. Feed validated normalized observations to `observe(observation, capturedGeneration)`. Call `suspend()` on continuity loss and obtain a new baseline before delivering more live observations. It is not enough to set a connection flag to connected.
4. Send roster/request updates through `setAgents()` and global presentation changes through `setPresentation()`. Runtime metadata updates alone produce no lifecycle outcome. If a terminal event arrives without its matching active turn, obtain a fresh latest-turn baseline rather than inventing the missed start or animating old work.
5. Expose `getState()`, `drainEffects()`, and `complete(token)` to the scene owner. PR30 at `87c444732f9070507f90776f640119106da35d89` provides entrance/home placement and `NativePet(animationName)`. Reuse those coordinates for enter/exit and the animation override for sleep/death. Keep layout allocation based on `snapshot.agents`; alter only sprite presentation.
6. Lifecycle placement takes priority over handoffs. Admit only `meetingEligible` sprites, cancel ineligible active meetings, and reject stale meeting-return callbacks. A freshly discovered source-backed started turn may still have Windows metadata `runtimeState: unknown`; use its verified lifecycle status/phase for presentation/check-in eligibility instead of requiring metadata `working`. Render attention in the roster/inspector as well as the scene. `visible: null` requires the chosen unknown-presence fallback.
7. Bound every animation with a token-based completion callback. Completion must also occur for reduced motion, missing artwork, or scene cleanup; never depend only on CSS `animationend`. Death is a one-shot presentation, even though the existing atlas renderer loops its rows. The checked-in manifest declares `failed` and `waiting`, but no `dead` or `sleeping` rows: the scene owner must use declared artwork plus an explicit visual treatment, not invent atlas rows. A new start, snapshot, suspension, or presentation reset invalidates stale callbacks.

The controller remembers turn/event identities without eviction; capacity exhaustion returns `unavailable`, so the owner should expose unavailable lifecycle support instead of recreating an empty controller and replaying history. Source history must be seeded before live delivery. The timestamps are supporting ordering evidence, never a timeout-based outcome inference.

## Verification

Synthetic tests cover explicit source outcomes; rejection of method-only completion, raw rollout completion, inferred historical completion and malformed correlation; opaque stable identity; successful exit/return; death/disappearance; sleep/wake; stale animation callbacks; repeated and conflicting terminals; stale baselines; missing starts; reconnect generations; request/wait attention; parent/child independence; membership removal; presentation pauses; and bounded deduplication.

Run the focused suites with:

```sh
node node_modules/tsx/dist/cli.mjs --test src/codex/lifecycle/normalizer.test.ts src/office/lifecycle/controller.test.ts src/office/lifecycle/outcomes.test.ts
npm run build
```

The Windows pipeline test uses a real temporary JSONL file through reader, composite adapter, HTTP/SSE, client store and lifecycle controller for unknown bootstrap, genuine start, success, failure, interruption, wake and reconnect. No original logs are modified. A separate read-only real Windows probe observed 111 verified latest outcomes across 120 scoped files (108 succeeded, three interrupted), zero initial animated observations and zero quarantines. This aggregate probe did not generate runtime work and does not claim a live failure was observed. Browser scene validation belongs to the combined preview owner.
