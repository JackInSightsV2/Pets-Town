# Office contract v1 — proposed implementation contract

This contract is the shared seam for the three implementation owners. It is a design contract, not an API already implemented. The first live slice verifies its mapping to the available Codex runtime. Amend this file before changing producer/consumer semantics.

## Responsibilities

- **Codex adapter:** discover and observe existing sessions; normalize identities, runtime activity, requests and authentic handoffs. Own all version-specific protocol behavior.
- **Local bridge:** maintain the current snapshot, order and replay office events, serve approved assets, expose the local browser endpoints, and route supported replies.
- **Office UI:** render project areas, sprites, movement and the detail panel from the snapshot/events. Own choreography, not Codex execution.
- **Launcher:** start or reuse the bridge and open the browser. It must not start agents.

Suggested implementation: one TypeScript workspace with a local Node server, a browser UI using React and Canvas 2D, and shared contracts. Use a supported Node LTS verified at implementation time; do not add a database or cloud backend for the demo.

## Identity and clock rules

- agentId is the existing Codex thread identity, never an array index or nickname.
- parentAgentId is nullable and reflects the observed parent relationship.
- projectId prefers the runtime's project identity; otherwise use a consistently canonicalized repository root or working directory. Keep a separate display name.
- officeSessionId identifies presentation state, not an agent execution.
- bridgeEpoch changes on bridge restart. seq increases strictly within an epoch.
- eventId is unique and stable across replay. occurredAt is an ISO timestamp; it is not the ordering authority.
- requestId and handoffId retain their source correlation. If the source cannot establish a handoff identity, derive a stable ID from a verified source event rather than manufacture an exchange.

## Snapshot

GET /api/office returns:
- protocolVersion: 1, bridgeEpoch, lastSeq, officeSessionId.
- connection: connected | reconnecting | disconnected | unsupported, plus lastObservedAt.
- capabilities, including observeAgents, observeHandoffs and respondToRequests. Each capability has supported: boolean and a concise reason when unavailable.
- presentation: ready | arrivals | standup | live; skip availability.
- agents, projects, pendingRequests and recentHandoffs.
- A stable mapping from agentId to an approved pet asset identifier.

Each agent includes agentId, parentAgentId, projectId, displayName, role when known, task summary when known, runtimeState, activityKind, lastObservedAt and pendingRequestIds. Unknown facts are null/unknown, not generated guesses.

runtimeState: working | idle | waiting-for-input | waiting-for-approval | error | closed | unknown.
activityKind: reading | editing | running-command | researching | communicating | unknown.

Connection health is separate from runtime state. Losing the bridge cannot turn working into completed. A completed work item may leave its session idle; it does not imply the session closed.

## Events

GET /api/events is an SSE stream with id set from bridgeEpoch and seq. The bridge supports Last-Event-ID, or explicitly requires a fresh snapshot if the cursor is unavailable.

Common envelope:

```json
{
  "protocolVersion": 1,
  "bridgeEpoch": "bridge-example",
  "seq": 42,
  "eventId": "event-example",
  "occurredAt": "2026-11-01T13:00:00Z",
  "source": "codex",
  "type": "agent.activity",
  "agentId": "existing-thread-id",
  "data": {}
}
```

The JSON is an illustrative fixture, not evidence of a real run. source is codex | office | fixture; fixture streams are visibly labelled during development and never used as live acceptance evidence.

| Type | Required meaning/payload |
| --- | --- |
| project.upserted | Current projectId, displayName and cwd; agentId null. Publish before agents referencing a newly observed project so empty-start and later projects need no office restart. |
| agent.upserted | Current normalized agent metadata; safe to apply repeatedly. |
| agent.activity | Activity kind, short visible summary and source item correlation when available. |
| agent.state.changed | New runtime state; do not infer closure from idle. |
| agent.work.completed | A verified completed turn/work item, with source correlation; may trigger a brief celebration. |
| agent.closed | Observed closure or removal under the chosen runtime lifecycle; no timeout masquerading as successful completion. |
| request.opened | Agent, request ID, kind, visible prompt/options when available, response capability and reason if unavailable. |
| request.resolved | Exact request correlation and known resolution reason, including cancellation/interruption where appropriate. |
| handoff.observed | Stable handoff ID, fromAgentId, toAgentId, concise supported summary and source correlation. |
| capabilities.changed | Full replacement capabilities object; agentId null. Publish when observation support changes after bootstrap. This bridge continues to force replies unsupported. Loss of handoff support cancels active/queued visual meetings without clearing request attention; recovery does not replay old meetings. |
| connection.changed | Bridge health and last observation; not agent success/failure. |
| presentation.changed | Office session and presentation state; source office, never codex. |

A waiting flag without request details may display Needs input with details unavailable. It must not fabricate a question or enable an unsupported response.

## Browser actions

- POST /api/presentation/start starts one visual sequence using the current snapshot. Duplicate clicks are idempotent while a sequence is active.
- POST /api/presentation/skip advances the current ceremony to live view.
- POST /api/presentation/reset returns the presentation to ready with current live data. It changes no underlying agent or request.
- POST /api/requests/:requestId/respond accepts agentId, expected request revision if available, an idempotency key, and a response matching that request's schema.

Presentation actions never call Codex start, stop, fork, resume-with-overrides, or assignment methods. Viewing an existing agent must not silently restart its execution.

Reply handling must confirm that this bridge is permitted to answer the particular request. Ordinary chat input is not a substitute for an approval response. Unsupported requests stay visible with an honest limitation. Submission acknowledgement does not clear attention; source resolution does. Duplicate or already-resolved replies return an explicit result without sending another answer.

## Choreography rules

- A snapshot can update while arrivals and standup run. New real requests appear promptly and are not hidden until the ceremony ends.
- Late arrivals join their project area without restarting everyone's standup.
- At most one queued water-cooler meeting per pet at a time. Deduplicate by handoffId; animation queues do not delay the real exchange.
- If one participant is hidden, show an identifiable, expandable group handoff signal. Respect the user's hide setting; reveal the participant only when the user expands its group.
- If an agent closes or fails before its queued animation, cancel or shorten the animation and preserve the true state.
- Refresh restores presentation/current status; it does not create another standup. Reset + Start the day intentionally replays presentation using current facts.
- Check-in bubbles follow observed activity; ordinary decorative gestures make no claim of new work.

## Assets and geometry

Serve only approved local assets. Each pet entry records origin, asset key, dimensions, frame grid, available animation rows and any fallback animation within that same genuine asset. Do not assume desktop and web atlas formats match.

The office PNG is a background, not a collision map. Scene geometry must identify entrances, project zones, walkable paths, the standup location and a water-cooler waypoint. The current artwork has a coffee counter but no clearly distinct water cooler; add a separate matching environment prop or update the environment art during the visual slice. This does not authorize generating new pet characters.

Project layout is independent of the four illustrated desk clusters. Acceptance includes more than four project areas without treating that illustration as a product cap.

## Required contract evidence

A shared development trace covers two projects, main/subagent relationships, a request, resolution elsewhere, an authentic-shaped handoff, completion, disconnection and rejoin. It is labelled fixture data.

Separately capture a sanitized real trace for one existing agent's state change and one real handoff. Use that live evidence to validate the adapter mapping; simulated traces alone cannot pass the demo gate.
