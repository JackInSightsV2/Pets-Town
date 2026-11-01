# Stream UI — S3 inspection

Status: implemented, integrated build passes; browser smoke owned by root.

## Delivered

- `src/main.tsx` mounts React against one stable `createOfficeStore` and starts the SSE connection.
- Responsive office view, generated background, project roster, subagent visibility, persistent selected-agent panel.
- Genuine native pet atlas frames are rendered only from the supplied validated `PetAsset` manifest. Missing art shows neutral agent identity and an honest empty scene.
- Requests are displayed from source request records and unresolved IDs. Scene selection/reset never mutates them. Waiting without a prompt has an explicit unavailable-details message.
- Agent error, bridge/source connection loss and retained stale state are separate visual states.
- In-office reply textarea and submit remain disabled with an explanation to use the original Codex conversation.
- Fixture banner applies to fixture snapshots or any fixture activity, including hidden agents.
- Start/skip/reset call `presentationAction`. UI does not start, pause, assign or resolve agent work.

## Integration seam

`OfficeScene` receives snapshot, selected identity, visible agents and `onSelectAgent`. A later office renderer may replace it independently. `window.dispatchEvent(new CustomEvent('petstown:select-agent', { detail: { agentId } }))` also selects through the store.

Current scene places native pets at stable display positions; arrival, pathing and handoff animation remain with the scene implementation lane. No actual work completion is inferred from idle state.

## Check

`npm run build` passed on 2026-11-01: TypeScript and Vite production bundle. JEV disabled by task instruction. No extra unit suite added under the user's shortened coding window. Runtime/browser and live Codex evidence remain separate from this build result.

Follow-up: inspected the local Codex native sheet and checked all three files with `sips`; each is 1536×1872, giving 192×208 frames in the declared 8×9 atlas. NativePet now displays loading/error text, validates loaded dimensions, and reports `data-pet-load`. A stalled request changes to unavailable after eight seconds and may recover on a late successful load. Build passed after this fix; local-cache browser verification remains with root.

## Browser selectors

`office-app`, `fixture-banner`, `connection-status`, `connection-notice`, `office-scene`, `presentation-state`, `start-day`, `skip-standup`, `reset-scene`, `agent-button-{id}`, `scene-agent-{id}`, `agent-inspector`, `selected-agent-name`, `agent-task`, `request-{id}`, `attention-{id}`, `waiting-details-unavailable`, `reply-input`, `reply-submit`, `reply-explanation`, `agent-error`, `stale-agent-data`, `recent-activity`, `no-pending-requests`, `native-pet-empty-state`, `hidden-subagent-attention`.

Accessible action names: Start the day; Skip to live office; Reset scene; Select {displayName}; Inspect {displayName}; Show subagents.
