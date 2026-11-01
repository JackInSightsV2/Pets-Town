# Session prompt for issue 4

You are the main implementation agent for PetsTown issue #4:
https://github.com/JackInSightsV2/Pets-Town/issues/4

Your accountable human owner is Alex, GitHub getmateri. Build the path from a genuine observed exchange between existing agents to one water-cooler meeting for the correct pair.

## Read first

Refresh current main, inspect repo instructions/code, and read:
- plan.md and design.md
- docs/contracts/office-v1.md
- docs/research/codex-pets/README.md
- docs/research/codex-pets/teammate-integration.md and current PR #10
- docs/research/codex-pets/protocol.md
- docs/research/codex-pets/contract-audit.md
- The current #4 acceptance criteria and #1's baseline/interface evidence

#4 is blocked by #1 for delivery. You may investigate source capabilities and build an isolated fixture-tested module now. A fixture-only meeting does not pass this issue.

## Ownership

Use a suitable isolated checkout/worktree or create one with the available tool, on an issue branch such as codex/s4-handoffs.

Own a dedicated handoff normalizer/deduplicator and its tests, plus the minimum dedicated meeting module needed for the vertical slice. Proposed areas are src/codex/handoffs and src/office/handoffs; adopt the actual repository layout.

Do not rewrite #1's connection/discovery code or lane A's general scene/arrivals. Define a small interface with the observer and scene owners. Lane C owns package/entrypoint changes and shared contract integration.

## Use subagents immediately

Delegate at least two independent tasks with disjoint ownership:
1. Source investigator: identify actual native collaboration event/tool shapes, sender/recipient IDs, correlation and whether a passive client can receive them. Return exact evidence; no manufactured exchange.
2. Normalizer worker: implement source-correlated stable handoffId, duplicate/replay handling and focused negative tests in the dedicated adapter module.
3. Choreography worker or independent reviewer: implement/review an isolated pair-meeting queue that composes with lane A's scene interface.

Keep two or three workers active where useful. You integrate and verify the complete path. Assign files before editing.

## Product invariants

PetsTown only observes existing work. Do not create turns or send results between agents to manufacture a handoff. Parent-child identity, simultaneous activity, proximity or a timer is not evidence of an exchange.

Conform to handoff.observed in Office v1. Preserve stable source correlation and both participants. Unknown or unsupported exchange data must stay unavailable. Text bubbles summarize visible factual evidence, not invented dialogue.

Never place a pet in two active meetings. Queue overlapping exchanges according to Office v1 and make queue capacity/overflow behaviour explicit. Deduplicate by handoffId across replay. Cancel obsolete choreography when an agent closes/fails; return remaining pets to their actual work state. A hidden participant remains hidden unless the user expands its group. Animation must never delay the underlying exchange.

Start/Skip/Reset are presentation-only. Reset invalidates stale animation callbacks without touching agents or requests. Snapshot/reconnect must not reenact old meetings accidentally.

## Work in parallel without faking completion

While #1's live trace is pending, prepare the minimal typed boundary, an explicitly synthetic scenario and queue/deduplication tests. Do not claim passive event reception is working.

Once #1 provides the verified runtime and adapter interface, capture one authentic exchange from the externally prepared cohort and pass that exact correlation through the bridge to the scene. Minimal pair movement can be demonstrated before visual polish, but must compose with #2 rather than replace its animation system.

## Verification and finish

Test duplicate events, reconnect replay, overlapping handoffs, hidden participants, closure/failure, stale reset callbacks and source IDs missing or inconsistent. Distinguish fixture coverage from the separate real trace.

Demonstrate the real existing-agent exchange becoming one meeting with truthful bubbles. Keep #4 open until that live path passes and #1's prerequisite is satisfied. Produce a focused commit/PR, exact evidence and the adapter/scene interface for integration. Never close the issue solely because a fixture animation looks correct.

## Stay aligned with the other sessions

Register your task/host, branch, owned modules, base main SHA and PR with the Dot coordinator when available. Inspect teammates' relevant PRs and refresh main at startup, before shared-interface changes, and before integration/merge. Report exact interface changes and dependencies; do not overwrite another lane's flow. Use docs/research/codex-pets/coordination.md. Keep useful independent work moving while a live prerequisite is unavailable.

## Research pack location

This pack is published on branch codex/research-handoff until its documentation PR is merged. If docs/research/codex-pets is absent from your current main, read it from https://github.com/JackInSightsV2/Pets-Town/tree/codex/research-handoff/docs/research/codex-pets or fetch that branch and use git show to read the documents. Keep application work based on the latest appropriate integration baseline; do not reset a working checkout to retrieve these docs.
