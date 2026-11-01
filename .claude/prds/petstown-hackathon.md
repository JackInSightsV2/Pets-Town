---
name: petstown-hackathon
description: A presenter-controlled pet office that visualizes existing Codex agents and real collaboration.
status: backlog
created: 2026-11-01T12:49:59Z
updated: 2026-11-01T13:05:05Z
---

# PRD: PetsTown hackathon

## Executive Summary

PetsTown opens a local browser office from Codex CLI. Start the day brings genuine ChatGPT/Codex pets into a shared office, introduces their actual work, and presents live agent activity through movement, inspection and a real water-cooler handoff. Existing Codex agents own their execution throughout.

[design.md](../../design.md) is the authoritative experience specification. [Reconciliation](../../docs/colleague-reconciliation.md) records the additional team context and the user's resolution of conflicting choices.

## Problem Statement

Several concurrent agents are difficult to follow through separate chats. A readable office should make who is working, who needs attention and who is collaborating visible at a glance. For the hackathon, the pets and real activity are the demonstrable value; completing a specific website feature is not the acceptance target.

## User Stories and acceptance

| ID | Story | Acceptance |
| --- | --- | --- |
| US01 | As a user, open Office from Codex CLI. | A supported launcher opens a localhost page, discovers existing work, and presents Start the day without starting agents. |
| US02 | As a presenter, control the opening. | Start the day plays one arrival and standup sequence; skip goes to live activity without changing execution. |
| US03 | As a user, recognize my actual agents as pets. | Genuine ChatGPT/Codex assets map to stable existing agent identities; no substitute characters or fixture data are presented as live. |
| US04 | As a user, see all active project teams without clutter. | One office has distinct project areas, main pets and optional subagents, expandable groups and visible attention for hidden pets. |
| US05 | As a user, inspect a pet's real work. | Selection shows its identity, task, recent visible activity and outstanding request when available. |
| US06 | As a judge, see meaningful collaboration. | A real exchange with sender and recipient identities causes a water-cooler meeting, factual bubbles and return to work. |
| US07 | As a user, notice and resolve a request. | Unresolved requests retain attention; an in-office reply reaches the correct real request and clears only when resolution is observed. |
| US08 | As a user, understand completion, failure and lost contact. | Completion celebrates then rests; errors and disconnection remain distinguishable; unaffected agents continue. |
| US09 | As a user, see pets work in suitable places. | Observed activity drives locations with playful variation; decorative animation does not claim new work. |
| US10 | As a presenter, optionally hear the pets. | After earlier gates, optional voice speaks the same factual text; mute or audio failure preserves the text experience. |
| US11 | As a presenter, optionally inspect a live computer view. | After voice, an explicitly associated live view is identified as current and does not replace the pet detail panel. |

## Functional Requirements

- The office observes current agents; preparation of the three-agent demo cohort happens outside PetsTown.
- The launcher and browser are local to one demo Mac. A plugin is a packaging option; literal /office spelling is not mandatory.
- Start the day controls choreography, never agent execution or assignment.
- Standups use one brief factual update per main pet, summarize subagents, include personality and allow skipping.
- All active projects remain in scope. Three demo agents and the four desk clusters in the generated image are not product limits.
- Clicking a pet opens a side panel. Inspection is in the first checkpoint; direct replies follow it.
- Handoffs require authentic agent exchange evidence. Co-location or a timer is not a handoff.
- Native pet artwork is mandatory. The generated office background contains no characters.
- Text is the baseline. Voice and live computer views are separate stretch capabilities.
- Closing or refreshing the browser does not stop agents. Reopening or resetting the scene never restarts their work.

## Non-Functional Requirements

- Live events, local presentation events and development fixtures are distinguishable end to end.
- The adapter owns Codex protocol details; the renderer consumes the agreed office contract.
- Reconnection restores a snapshot without duplicating pets, requests or handoff ceremonies.
- Local server endpoints bind to loopback. State-changing requests validate origin/session identity; the browser does not receive Codex credentials.
- Summaries contain visible work facts, not hidden reasoning or guessed completion.
- Asset references have recorded source, dimensions and animation mapping. Do not redistribute native assets without establishing the relevant permission.
- A teammate can install prerequisites, launch the office and run the demo from the documented checkout.

## Success Criteria

First checkpoint: on the demo Mac, existing agents produce real activity visible in the office; Start the day, genuine pets, standup, movement, click inspection, one real handoff and honest failure handling work together in a rehearsed 90-second presentation.

Second checkpoint: an office response resolves an actual pending request on the intended agent, including visible confirmation. Merely submitting text or navigating to the source chat does not pass this checkpoint.

Stretch checkpoints: voice first, then a live computer view. All original L1-L3 experience goals remain; checkpoint order does not delete later requirements.

## Constraints & Assumptions

- Three teammates; responsibility is assigned by role until people claim slices.
- Colleague self-selected the Codex integration workstream.
- The shared discussion describes a five-hour build budget, not a verified current deadline.
- The repository contains the published documentation and generated office PNG; application implementation has not started.
- Existing renderer code in the user's agency repository is a candidate for selective reuse, not a pre-integrated dependency.
- Genuine asset retrieval and cross-client observation/replies are not yet proven.
- ImageGen 2.5 was requested for the environment; the available built-in tool did not expose version selection.

## Out of Scope

- A new agency, agent scheduler or office-owned task execution system.
- Modifying the native desktop UI.
- Cross-machine coordination for this demo.
- Invented work events, fake handoffs or silently substituted replay.
- Generating substitute pet artwork.
- Requiring agents to spend model turns deciding how their sprites move.

## Dependencies

See [integration notes](../../docs/integration-notes.md), [office contract](../../docs/contracts/office-v1.md) and the [technical epic](../epics/petstown-hackathon/epic.md). Technical discovery is a bounded first slice; changes to the agreed experience must be raised explicitly.
