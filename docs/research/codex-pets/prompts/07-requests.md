# Session prompt for issue 7

You are the main implementation agent for PetsTown issue #7:
https://github.com/JackInSightsV2/Pets-Town/issues/7

Your accountable human owner is Alex, GitHub getmateri. Prove a supported way for the office to answer a particular existing Codex request, then implement exact correlation, ownership and duplicate/stale handling.

## Read first

Refresh current main, inspect repo instructions/code, and read:
- plan.md and design.md
- docs/contracts/office-v1.md
- docs/research/codex-pets/README.md
- docs/research/codex-pets/teammate-integration.md and current PR #10
- docs/research/codex-pets/protocol.md
- docs/research/codex-pets/contract-audit.md
- The current #7 issue, #1's observer evidence and #3's panel interface

#7 is a delivered checkpoint after #6. Its issue explicitly permits earlier response-feasibility investigation. Work on that evidence and isolated modules now; do not bypass the product gate or enable unproven reply controls.

## Ownership

Use a suitable isolated checkout/worktree or create one with the available tool, on an issue branch such as codex/s7-request-routing.

Own dedicated request correlation/state/response-adapter modules and focused tests; proposed area src/codex/requests. Adopt the actual source layout. Do not replace #1's transport or lane C's panel/server. Jack already owns #3; provide a narrow supported response interface for that panel.

## Use subagents immediately

Delegate at least two independent tasks with exact file boundaries:
1. Protocol/ownership investigator: inspect pending-request replay triggers, recipient authorization and per-kind response schemas on the actual supported runtime. Read-only investigation first.
2. State-machine worker: implement immutable request correlation, revisions/idempotency and stale/already-resolved outcomes in a dedicated module using explicit fixtures.
3. Independent reviewer/test worker: exercise duplicate clicks, resolution elsewhere, reconnect, wrong agent/request pairing, cancellation and unsupported reply capabilities.

You own integration and the live proof. Keep two or three useful workers active; do not let them all edit a shared client or package manifest.

## Capability proof

Source contains request replay code, but that does not prove a second connection may answer all pending requests. Prove the supported access trigger and response ownership rather than assuming an RPC response ID grants permission.

A waiting flag is not the request's contents. An ordinary chat turn is not an approval response. Command, file-change, permission and user-input requests have distinct response schemas. Correlate the JSON-RPC request with its daemon/connection context, existing agent, source request identity and revision where available.

Use a deliberately prepared benign test request. Do not answer unrelated live requests merely to test transport. Obtain the intended test answer from the operator where needed.

A submission acknowledgement does not clear the pet's !. Only observed source resolution does, and resolution can mean cancellation/interruption rather than approval. The original client may answer first; handle that as an explicit stale/already-resolved result and avoid a second submission.

## Parallel deliverable

Before #6, deliver:
- Verified capability/ownership evidence or a precise unsupported reason.
- A separately fixture-tested request state machine and proposed typed boundary.
- A small integration note for the existing panel and bridge owners.

Keep reply controls disabled while capability is unproven. Do not silently substitute navigation to another client for successful in-office delivery, and do not mutate observed execution through resume/start/interrupt shortcuts.

After the #6 checkpoint and only where supported, wire the exact endpoint in Office v1, demonstrate one request answered from the office with continued source progress, and verify duplicate/stale/original-client resolution cases.

## Verification and finish

Use focused correlation/idempotency tests, then a real controlled pending request on the demo runtime. Record version, method/request kind, source correlation and outcomes without credentials or private prompts.

A schema or fixture does not prove ownership. Keep #7 open until its live acceptance and dependency gate pass. Produce a focused commit/PR and clear evidence, or report the precise capability limitation while preserving the useful inspection path.

## Stay aligned with the other sessions

Register your task/host, branch, owned modules, base main SHA and PR with the Dot coordinator when available. Inspect teammates' relevant PRs and refresh main at startup, before shared-interface changes, and before integration/merge. Report exact interface changes and dependencies; do not overwrite another lane's flow. Use docs/research/codex-pets/coordination.md. Keep useful independent work moving while a live prerequisite is unavailable.

PR #10's OfficeAdapter currently has no response method; its server returns501 for replies and forces the capability off. Propose the narrow typed reply extension only after ownership is proven and integrate it with lane C. Flipping a flag is not a working reply path.

## Research pack location

This pack is published on branch codex/research-handoff until its documentation PR is merged. If docs/research/codex-pets is absent from your current main, read it from https://github.com/JackInSightsV2/Pets-Town/tree/codex/research-handoff/docs/research/codex-pets or fetch that branch and use git show to read the documents. Keep application work based on the latest appropriate integration baseline; do not reset a working checkout to retrieve these docs.
