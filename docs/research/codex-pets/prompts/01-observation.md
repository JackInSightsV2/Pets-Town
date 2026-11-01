# Session prompt for issue 1

You are the main implementation agent for PetsTown issue #1:
https://github.com/JackInSightsV2/Pets-Town/issues/1

Your accountable human owner is Alex, GitHub getmateri. Implement the smallest complete live baseline: a supported office launch displays one genuine pet tied to an agent that was already running before the office connected.

## Read first

Refresh current main and inspect repository instructions and any code that has landed. Read:
- plan.md and design.md
- docs/contracts/office-v1.md
- docs/integration-notes.md
- docs/research/codex-pets/README.md
- docs/research/codex-pets/teammate-integration.md and current PR #10
- docs/research/codex-pets/protocol.md
- docs/research/codex-pets/contract-audit.md
- docs/research/codex-pets/pets.md
- The current #1 acceptance criteria

The user confirmed the repository's observer design. Historical owned-agent proposals are superseded. Three agents are externally prepared for the demo; the office is not capped at three.

## Working boundary

Use a suitable isolated checkout/worktree; otherwise create one using the available worktree tool and an issue branch such as codex/s1-observer. Do not switch branches in a shared live checkout.

Own only the Codex connection, discovery and status-normalization modules, with focused tests. Explicitly exclude the handoffs and requests submodules reserved for the #4 and #7 sessions. Prefer the existing source layout; choose named files under src/codex rather than claiming the entire subtree. Lane C owns shared server/package/entrypoint integration; Jack already claimed #3. Coordinate the minimum shell and genuine asset contribution with the existing owners rather than scaffolding a second app.

No launcher, Start, Skip, Reset or close action may create, resume, fork, interrupt, assign or stop Codex work. No generated substitute pets.

## Use subagents immediately

Delegate at least two independent tasks; keep two or three active where useful:
1. A runtime/source investigator verifies the target CLI version, existing-daemon/proxy discovery, read-only list/read operations and safe live status delivery. Give this worker read-only ownership of capability evidence.
2. An adapter worker implements stable identity/project/parent normalization and connection/runtime-state separation in a named disjoint module, using fixtures clearly marked synthetic.
3. An independent reviewer checks observer non-mutation, duplicate/reconnect behaviour, contract mapping and evidence claims.

You integrate their work. Set exact file ownership before any edits; do not have multiple workers change the contract or package entrypoints.

## First live experiment

The source suggests same-daemon status broadcasts, but that is not a passed integration test. A newly started private app-server is not proof of observing other processes. thread/read does not subscribe. Do not use thread/resume as a shortcut.

On the actual demo runtime:
- Record codex --version and the supported existing-daemon/proxy invocation.
- Discover an already-running agent with stable identity, project and parent metadata where available.
- Observe a real change while leaving its execution untouched.
- Close/reconnect the observer and confirm the original work continues.
- Record item/activity and request capabilities independently; unavailable details stay unknown.

The Windows audit used CLI0.158.0, while repo notes report Mac0.166.0. Regenerate schemas on the target. Keep tokens, account responses and private task text out of evidence.

If the live Mac or prepared agent is unavailable, ask for the precise prerequisite while continuing isolated source/fixture work. Do not replace the task with a synthetic roster, newly created agents, or a different product.

## Contract and baseline

Conform to Office v1: existing agentId, bridgeEpoch, seq/eventId, officeSessionId, snapshot plus SSE, capabilities and independent connection health. Settle the P1 cursor/payload/fixture-label details with lane C before wiring the producer and browser consumer. Do not create a competing runId contract.

Deliver one visible path: existing runtime -> adapter -> bridge -> browser -> genuine pet. Inspect a real sprite sequence using the actual asset manifest. The office PNG is already in assets/office; its presence is not a working renderer.

Provide a sanitized real observation trace and a separately labelled fixture. Establish a small adapter interface that #4 handoffs and #7 requests can extend without editing your transport internals.

## Verification and finish

Run focused normalization/reconnect/duplicate checks and the real baseline on the intended runtime. Prove the office did not change agent execution. Record the exact command, version, revision, asset provenance and pass/fail evidence.

Keep #1 open if its live gate has not passed. Prepare a focused commit/PR with implementation, evidence and the stable interfaces the other sessions should consume. Report any unsupported capability precisely; do not claim success from schemas or fixtures.

## Stay aligned with the other sessions

Register your task/host, branch, owned modules, base main SHA and PR with the Dot coordinator when available. Inspect teammates' relevant PRs and refresh main at startup, before shared-interface changes, and before integration/merge. Report exact interface changes and dependencies; do not overwrite another lane's flow. Use docs/research/codex-pets/coordination.md. Keep useful independent work moving while a live prerequisite is unavailable.

Jack's PR #10 already supplies the app and server. Implement its OfficeAdapter (initialSnapshot, subscribe, stop), export createAdapter or the supported default, and use the existing --adapter loader. Its server subscribes before snapshot and relies on your consistent adapter cursor; preserve real source correlation. Do not rebuild its package scaffold, SSE transport or launcher.

## Research pack location

This pack is published on branch codex/research-handoff until its documentation PR is merged. If docs/research/codex-pets is absent from your current main, read it from https://github.com/JackInSightsV2/Pets-Town/tree/codex/research-handoff/docs/research/codex-pets or fetch that branch and use git show to read the documents. Keep application work based on the latest appropriate integration baseline; do not reset a working checkout to retrieve these docs.
