# Live office movement and inspection checkpoint

Run the explicit Mac observer as documented in [live-office-loop.md](live-office-loop.md), open port 4320, refresh, and use Reset scene → Start the day to replay the presentation. Existing agent execution continues throughout.

## Implemented

- Ready pets gather at the configured entrance; arrivals stagger towards standup using genuine native running frames.
- Standup gathers the pets and displays available main-agent tasks plus the observed subagent count.
- Live working, waiting and error states retain their stable project homes. Observed idle pets use rest positions. Errors remain visibly marked. Hidden pets retain identity/position allocation.
- Real source-correlated handoffs override placement for the water-cooler trip and return.
- Skip/reset cancel presentation movement without altering runtime state. Reduced motion disables arrival travel.
- New completed/failed command records appear as “Ran a command.” in recent activity. Their contents are never sent to the browser. A completed record does not change current runtime/activity state. Metadata updates preserve the latest 50 entries; initial/reconnect history is silent.

## Observed on the live Mac

Four real pets remained present through ready, arrivals, standup and live phases. Browser inspection confirmed entrance → standup → home locations, correct selection, and no page errors. One independently observed idle pet moved to rest. Real completed command activity appeared in the selected agent's panel, without a fixture banner.

Screenshots: [standup](live-movement-standup.png), [live office](live-movement-live.png), [command inspection](live-command-inspection.png).

Focused verification: four browser movement/handoff checks passed; 16 activity/history checks passed; build/typecheck passed. JEV was unavailable. Controlled fixture checks prove idle/working/waiting transitions, skip/reset cancellation, and existing handoff behavior; they do not replace the live observations above.

## Remaining

This is not completion of every S2/S3/S6 acceptance item: reading/editing/research location changes, source-verified completion celebrations, a dedicated final water-cooler prop, in-office replies, real pending-request lifecycle, final environment geometry and the team's timed 90-second rehearsal remain outstanding. Closed sessions are removed under the existing observed lifecycle rather than a new exit animation.
