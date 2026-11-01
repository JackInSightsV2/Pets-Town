# PetsTown implementation handoff

This is the entry point for `to-issues`. The user has approved the nine-slice breakdown, dependencies and three owner lanes. GitHub publication is in progress.

## Agreed outcome

A simple Codex CLI action opens a local browser. **Start the day** brings genuine ChatGPT/Codex pets into one office, delivers a short skippable factual standup and moves into real activity. Clicking a pet shows its work. Real exchanges become water-cooler handoffs.

PetsTown observes existing agents. Three agents are prepared externally for a 90-second demo on one Mac. Existing work keeps running while the office opens, animates, resets or closes.

The first checkpoint is live inspection plus a real handoff. In-office replies follow; voice and a live computer view are later checkpoints. The original main/subagent visibility, project areas, attention, lifecycle and automatic location behavior remain in scope.

## Authoritative inputs

- [Design](design.md): confirmed behavior, asset constraints and checkpoint ordering.
- [PRD](.claude/prds/petstown-hackathon.md): stories US01–US11 and measurable success.
- [Technical epic](.claude/epics/petstown-hackathon/epic.md): full proposed slice descriptions, acceptance criteria, dependencies and ownership.
- [Contract v1](docs/contracts/office-v1.md): identifiers, snapshots, events, replies and presentation actions.
- [Reconciliation](docs/colleague-reconciliation.md): resolved differences with the shared discussion.
- [Integration evidence](docs/integration-notes.md): known capabilities versus unverified runtime behavior.
- [Glossary](GLOSSARY.md) and [ADRs](docs/adr/): vocabulary and architectural boundaries.
- [Office asset](assets/office/office-v1.png) and [provenance](assets/office/office-v1.prompt.md): generated environment; genuine pet assets still need retrieval.

## Three-person split

| Lane | Responsibility | First independent slice after S1 |
| --- | --- | --- |
| A — visual lead | Pet rendering, scene movement, project layout | S2: arrivals, standup and work locations |
| B — Codex integration lead | Existing-agent observation, authentic handoffs, request routing | S4: real handoff through to a visible meeting |
| C — app/demo integration lead | Launcher, browser shell/panel, integration and demonstration | S3: live inspection and request visibility |

B leads the first live baseline, with A/C contributing the minimum asset and shell. C owns integration and shared entrypoints. Named GitHub assignees are not yet provided; lanes are accountability roles, not guessed accounts.

## Approved issue breakdown

| ID | Complete vertical slice | Type | Lead | Blocked by | Stories |
| --- | --- | --- | --- | --- | --- |
| S1 | Open Office and see one existing agent as a genuine pet | HITL | B | None | US01, US03, US08 |
| S2 | Start the day, arrivals, standup and activity-driven locations | AFK | A | S1 | US02, US03, US09 |
| S3 | Click a pet to inspect live work and requests | AFK | C | S1 | US05, US07, US08 |
| S4 | Observe a real handoff and animate the water-cooler meeting | AFK | B | S1 | US06, US09 |
| S5 | Readable project areas, optional subagents and hidden attention | AFK | A | S2, S3 | US04, US07 |
| S6 | Reproducible, resilient 90-second live office on the demo Mac | HITL | C | S4, S5 | US01–US06, US08–US09 |
| S7 | Resolve an existing agent request from its pet panel | HITL | B | S6 | US07 |
| S8 | Optional voice for factual pet updates | AFK | C | S7 | US10 |
| S9 | Inspect an associated live computer view | HITL | C | S8 | US11 |

HITL identifies an actual integration or human validation gate. AFK slices still require tests and observable acceptance; it does not mean evidence-free completion. S7–S9 include deliberate product-priority dependencies, identified in the epic.

## Demo sequence

This is a rehearsal target, not a claim of measured runtime.

| Time | Presenter action and visible evidence |
| --- | --- |
| 0–10 seconds | Open Office and click Start the day. |
| 10–25 seconds | Pets arrive and give short factual updates. |
| 25–40 seconds | Work-state movement; click one pet and inspect its live activity. |
| 40–65 seconds | An authentic observed exchange becomes a water-cooler meeting. |
| 65–80 seconds | Return to work; show an in-office response or voice only if that gate is verified. |
| 80–90 seconds | Return to the whole office and explain the coordination benefit. |

Prepare the cohort and a real exchange before presenting. If the runtime does not expose that exchange, report the missing capability; never invent the meeting to satisfy the timeline. If one pet fails, show its true state and continue with the working pets.

## Readiness and publication checklist

- [x] Direct user decisions reconciled with the shared discussion.
- [x] Three owner lanes and a conflict-aware parallel wave defined.
- [x] Proposed contract and nine independently verifiable slices documented.
- [x] Repository and issue tracker identified; GitHub Issues enabled.
- [x] User approves granularity, blockers and HITL/AFK classification.
- [ ] Publish an initial agreed docs/assets snapshot so teammates can access the same source; exclude personal editor settings.
- [ ] Create needs-triage if still missing, then publish slices in dependency order.
- [ ] Replace planning blocker IDs with actual issue links and retain the lane in each issue.
- [ ] Teammates claim issues; do not assign unspecified GitHub handles.

No implementation, source commit, plugin installation or live office connection is claimed by this planning handoff.
