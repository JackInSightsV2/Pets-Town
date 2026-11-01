# PetsTown research and implementation handoff

Use this pack to begin the Codex integration work without repeating the investigation. The user confirmed the current repository design and issues as the source of truth on 1 November 2026. The office observes existing agents; it does not launch a new agent team.

Read [the delivery plan](../../../plan.md), [design](../../../design.md), and [Office contract v1](../../contracts/office-v1.md) first. This research supplements those documents. It does not replace their contract or change issue dependencies.

## Start the parallel sessions

Alex's GitHub account, `getmateri`, is assigned to:

| Issue | Responsibility | Session prompt |
| --- | --- | --- |
| [#1](https://github.com/JackInSightsV2/Pets-Town/issues/1) | Prove observation of an existing agent and its genuine pet | [Observation and baseline](prompts/01-observation.md) |
| [#4](https://github.com/JackInSightsV2/Pets-Town/issues/4) | Correlate a real handoff and present the water-cooler meeting | [Handoffs](prompts/04-handoffs.md) |
| [#7](https://github.com/JackInSightsV2/Pets-Town/issues/7) | Prove and implement correctly owned request responses | [Requests](prompts/07-requests.md) |

Use [parallel session coordination](parallel-sessions.md) before launching the prompts. To let your Dot manage them, paste the [Dot coordinator prompt](prompts/00-dot-coordinator.md); see [coordination and repository monitoring](coordination.md). Each main session must delegate independent work to subagents, keep file ownership separate, and integrate its own results. Start #1's live proof immediately. #4 and #7 may investigate and prepare isolated modules concurrently, but their delivery gates remain unchanged.

JackInSightsV2 owns #3 and has opened [PR #10](https://github.com/JackInSightsV2/Pets-Town/pull/10) with the app/bridge scaffold. Read [the concrete teammate integration seam](teammate-integration.md) before coding. Implement its OfficeAdapter rather than starting a competing server, launcher or UI.

## Current product boundaries

- Existing Codex agents continue running when the office opens, starts its ceremony, skips, resets, refreshes, or closes.
- Three externally prepared agents are the demo cohort, not a product limit. Main agents, subagents and multiple project areas remain in scope.
- Start the day controls arrivals and a short factual standup. It does not create, resume, assign, fork, interrupt or terminate work.
- Use genuine existing ChatGPT/Codex pet assets. Generated replacement characters do not meet the agreed asset requirement.
- A water-cooler meeting represents a verified existing exchange. The observer cannot manufacture a handoff by sending new work between agents.
- Live inspection plus a real handoff is the first complete checkpoint. Replies follow; then voice; then a live computer view.
- The demo is 90 seconds on a teammate's Mac. A failed pet stays honest while the others continue. No feature freeze or silent replay fallback was selected.

Earlier proposals involving three office-owned threads, reset-by-interruption, a bridge-created exchange, or newly generated pet characters are superseded. The [reconciliation](../../colleague-reconciliation.md) records that change.

## Research map

| Read | Purpose |
| --- | --- |
| [Teammate integration](teammate-integration.md) | Exact OfficeAdapter and scaffold from Jack's open PR #10 |
| [Protocol and observer evidence](protocol.md) | Same-daemon discovery, status broadcasts, request ownership, and the live proofs still needed |
| [CLI source map](source-map.md) | Pinned files and symbols to inspect |
| [Pets format and asset boundaries](pets.md) | Genuine assets, v1/v2 atlas differences, valid rows and native animation semantics |
| [Launcher](launcher.md) | Supported skill entry and presentation-only lifecycle |
| [Contract audit](contract-audit.md) | Small wire-level decisions required before producer/consumer code diverges |
| [Verification ledger](verification.md) | What was actually checked and what has not run |
| [Fixture scenario plan](fixture-scenarios.json) | Synthetic coverage to turn into a shared fixture after the contract's wire details are settled |

## First implementation actions

1. Refresh current main and inspect any application code that has landed since the research snapshot. At reviewed commit `ddd4163bea84af84deb5af317498c7a2fa17867e`, the repository contained planning documents and an office PNG, with no application source or dependency manifest.
2. Confirm the actual demo Mac's Codex version, authentication, existing-daemon connection and genuine asset location.
3. Prove one already-running agent's identity and real state change without changing its execution. A fresh private app-server process is not this proof.
4. Agree the few [contract details](contract-audit.md) with the app integration owner. Reuse contract v1.
5. Save a sanitized real observation trace and one explicitly synthetic fixture. Then fan out the complete #2/#3/#4 slices.
6. Keep source-backed, fixture-tested and live-tested results distinct. A passed fixture is never evidence that a cross-client capability exists.

The Windows preparation verified CLI 0.158.0 schemas; the repository reports a Mac CLI 0.166.0. Neither is proof that the other runtime behaves identically. Regenerate the schema on the actual target.

Host filesystem operations stalled during this preparation. The published research is authoritative for this handoff; publication does not claim the local checkout is synchronized. If older untracked `docs/handoff` drafts appear locally, inspect them before reuse because they may describe the superseded owned-agent design.

## Research pack location

This pack is published on branch codex/research-handoff until its documentation PR is merged. If docs/research/codex-pets is absent from your current main, read it from https://github.com/JackInSightsV2/Pets-Town/tree/codex/research-handoff/docs/research/codex-pets or fetch that branch and use git show to read the documents. Keep application work based on the latest appropriate integration baseline; do not reset a working checkout to retrieve these docs.
