# Office mapping and environment handoff

Issue #5 owns project areas, stable desk allocation and readable agent groups. Elliot owns the environment artwork and its geometry; #2 owns arrival/activity choreography and walkable paths.

Edit `src/office/environment.ts` to supply `officeGeometry`. `App` passes it to `OfficeScene`; the inspection store and real agent execution are independent of these coordinates.

```ts
import type { OfficeGeometry } from './layout';

export const officeGeometry: Partial<OfficeGeometry> = {
  canvas: { width: 1000, height: 720 },
  entrance: { x: 500, y: 660 },
  standup: { x: 500, y: 350 },
  waterCooler: [{ x: 460, y: 350 }, { x: 580, y: 350 }],
  rest: { x: 500, y: 560 },
  // Optional areas: non-overlapping rectangles for project desks.
  // Omitted fields use DEFAULT_OFFICE_GEOMETRY in layout.ts.
};
```

Coordinates are logical pixels, with pet positions measured at their centers. Area padding must be at least half the desk spacing; rendered pet footprints must fit that spacing. Reserve a 28-pixel gutter above each area for its label. Invalid or overlapping areas are rejected. Replacing geometry intentionally creates a new mapping.

The mapper consumes all observed identities, including hidden pets. It retains project areas and per-project desk slots for its mounted lifetime. Reordering, hiding, joining and leaving do not reassign other agents' seats. Moving an agent to a different source project moves that agent only. Additional projects and desks extend the same scrollable floor beyond the initial artwork; the artwork's four clusters are not a capacity limit.

The roster uses direct parent identity within the same project. Descendants share their root's group; missing or cross-project parents have an explicit “Parent not observed” group. Cycles are broken deterministically and every identity appears once. Closed parents disappear from the active roster while their still-active children remain inspectable.

Both main agents and subagents show by default. Groups with more than three children initially show three, with an expandable total. Global hiding and group collapse use the same visible set for scene pets and meeting admission. Hidden requests and waiting flags retain attention and inspection actions; inspecting a hidden agent does not reveal it or clear its request.

Native handoff events temporarily override the exact pair's home coordinates with the configured cooler positions. Completion returns them to their current mapped desks. This does not establish a native handoff source, assign tasks, infer activity, or implement the #2 ceremony.


## Verification

Three mapping checks cover six projects, ten children, additional overflow, stable homes across source changes, malformed parent relationships and custom geometry. Two labelled browser stress checks cover expansion, hidden request inspection, joins/departures and missing/closed parents. Separate live observation on the Mac confirmed one real parent and three real subagents in the correct group, with unchanged parent coordinates when children were hidden and no browser errors.

The stress screenshots are fixture-backed; the live parent-mapping screenshot is real metadata. Final artwork alignment and #2 arrival/activity paths remain Elliot's environment integration, and no real request/handoff source is claimed by these tests.
