# Parent/subagent proximity integration

`planFamilyProximity` in `src/office/family-proximity.ts` is a pure presentation
planner. It uses only observed identity, `parentAgentId`, and `runtimeState`.
Project, name, task text and paths are neither inputs nor grouping signals.

Working children seek a free position near their immediate rendered parent.
Parents that are themselves working children are placed first, so nested families
follow the actual chain. A parent may be idle or waiting: its position comes from
the lifecycle owner, not a state guess in this planner. Missing or hidden parents
stay missing. Cyclic ancestry and ambiguous duplicate identities do not create
family roots. Nonworking children keep the supplied lifecycle destination.

The caller supplies bounds, footprint spacing and `maxRings` (1–4); there is no
new product default. At most 80 candidate centers are examined per moving child.
Each move must be closer to the parent, within bounds, and clear of all rendered
positions and reservations. A safe already-near position is retained. If there is
no candidate, the original destination is retained with a `no-room` outcome.
Baseline destinations must already fit the bounds and avoid overlap; this module
does not repair an invalid upstream layout or grow the world to force a fit.

## Scene seam

PR30 at `87c4447` computes normal positions in `OfficeScene.tsx` inside `placed`,
then applies its water-cooler/home override. Split that computation at the override:

1. Build normal settled destinations only for pets actually rendered by the scene.
   In the live phase, use the lifecycle owner's selected home/rest/sleep position.
   Keep ready, arrivals and standup unchanged.
2. Run the planner on those normal destinations. Pass every allocated source home
   as `reservedHomes`, including homes of hidden identities. Pass both configured
   cooler endpoints as `reservedPoints` even when no meeting is active.
3. A real handoff token owns its return destinations. On admission, capture the
   last planned positions for its pair; feed those positions into the next plan
   and list the pair in `fixedAgentIds` throughout approach/exchange/return. The
   fixed rendered positions themselves reserve those return points for the pair.
4. Apply the existing meeting override after proximity. The cooler is never a
   family anchor. Return uses the captured destination; clearing/cancelling the
   token releases those captures. Lifecycle removal and source/session changes
   remain authoritative and must clear stale captures.
5. Compute scene bounds/viewport from the final placed points as PR30 already
   does. `data-home-*` for a participant should describe its actual captured
   return destination, not an unrelated raw allocator point.

The essential planner call is:

```ts
const familyPlan = planFamilyProximity({
  agents: snapshot.agents,
  positions: normalLivePositions, // rendered IDs only; includes captured returns
  bounds: liveBounds,            // includes current home/rest destinations
  spacing: sceneGeometry.spacing,
  maxRings: familySearchRings,   // supplied by the scene owner
  reservedHomes: layout.homes,
  reservedPoints: layout.waterCooler,
  fixedAgentIds: meetingParticipantIds,
});
// Use familyPlan.positions before the real meeting's final position override.
```

When a captured return differs from a source home, preserve both reservations:
keep the source home in `reservedHomes`, and use the pair's captured points as
fixed rendered `positions` (which already block every other pet). Do not replace
a previously planned return with a newly computed raw home on meeting admission.

This module does not emit handoffs, start timers, modify snapshots, render project
overlays or control Codex chats. It does not move desk artwork. Endpoint separation
does not establish collision-free travel along CSS animation paths; that belongs
to the motion owner. No `OfficeScene` change is included until its integration
owner assigns that seam.

## Synthetic verification

`src/office/family-proximity.test.ts` exercises nested families, concurrent roots,
reordered input, hidden/missing parents, paused children, cycles, crowded bounds,
hidden homes and water-cooler/meeting-return reservations. Tests use synthetic
identities and coordinates only. They validate settled positions, not live source
behavior or rendered motion.
