---
issue: 3
title: C-track live inspection and app integration
analyzed: 2026-11-01T13:07:53Z
---

# Parallel work analysis

Branch: `issue-3/track-c`. Worktree: `/Users/jackinsights/Coding/PetsTown-track-c`.

## Active streams

- Client state and transport: `src/client/` and its tests. Stable selection, precise request lifecycle, snapshot/event resynchronization and disconnected state.
- Inspection UI: `src/ui/`, `src/main.tsx`. Detail panel, roster selection seam, attention, missing facts, responsive accessibility and visible development-data provenance.
- Local bridge and launcher: `src/server/`, `scripts/`. HTTP snapshot, SSE, guarded presentation controls, adapter seam, local launcher and HTTP tests.
- Root integrator: `src/shared/`, package/build configuration, browser tests, runbook, PR and team coordination.

All streams share `src/shared/contract.ts`; only the root integrator edits that file. Workers edit their assigned paths and do not commit other streams' changes. Root performs integration commits and final verification.

Issue #1 remains a live-evidence dependency. Development fixtures must be labelled; no fake pets or fabricated live request evidence. C-track can implement and test the contract-backed path before B supplies the real observer, but cannot claim the live acceptance gate passed without observing it.

Immediate target: issue #3 and the C-owned app/recovery/launcher portions of #6. Voice and live computer-view capabilities remain part of the C-track goal and follow their approved dependencies; investigate feasibility while the core is integrated.
