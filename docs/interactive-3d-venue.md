# Interactive 3D venue

The default scene is a real Three.js room. The layout comes from a traced orthographic view of the private scan; the cartoon study supplies the visual style only. The stage and six worktable footprints use coordinates extracted from visible surfaces. The central audience chairs, smaller right wing and projecting entrances replace the earlier estimated layout. See [scan layout notes](scan-layout-notes.md) for measurement limits. No original scan, photo texture or generated reference image is included in this branch.

The room contains named, separate objects: floor, cutaway brick walls, curtains, stage, worktables, audience chairs, laptops, plants, equipment and water cooler. **Export room** downloads a GLB containing the environment only, without pet artwork, names, tasks or requests.

## Run on one Mac

```sh
npm ci
npm run pets:fetch
npm run build
npm run office
```

Use the existing observer configuration in the main README to select the Codex working directories. For a clearly labelled visual test, use `npm run office -- --fixture`.

- Drag to orbit, scroll to zoom, right-drag to pan.
- Focus the canvas and use arrow keys to orbit, + / − to zoom, Home to reset.
- Click a native pet or its name to open the existing details panel.
- Home view, Top view, Walls and Find pet change the camera or room visibility.
- Explore lets a selected pet walk to clear floor. This changes presentation only.
- 2D view restores the existing scene. `?view=2d` opens it directly.
- Reduced motion stops atlas animation and snaps movement to its destination.

The 3D renderer uses the existing native pet manifests and `animationFor`, with atlas frames on camera-facing Three.js sprites. It consumes the same `OfficeSceneProps`, snapshot, selection callback and handoff queue. It does not launch, resume or control an agent. Room movement uses a floor grid and furniture obstacles. Placement is stable across ordering and visibility changes. Handoffs move the observed pair to the cooler and complete the existing queue token after they return.

Child pets retain the smaller scale introduced in the latest team update. The existing 2D chair seating and decorative small talk remain available in 2D; the 3D venue uses its own desk-area and rest-area placement.

## Embedded plugin

The venue also replaces the embedded office viewport. Chat controls, selection context and ordered host-tool updates remain in the existing shell. The iframe uses its bundled renderer and approved pet artwork; it does not fetch room endpoints. Export and invitations are available only where the standalone host supports them.

Idle pets show zz. Verified live lifecycle observations retain sleep, return and one-shot death presentation; historical snapshots and disconnects do not replay death. Main pets use a 0.81 world-unit width and children 0.54, retaining the 75%/50% ratio.

The 2D renderer remains an explicit fallback for browsers without WebGL. Room-sharing gateway and publisher changes from the source branch are outside this viewport integration.

## Validation

Unit checks cover placement, navigation and rendering geometry. Browser checks exercise the default 3D viewport, camera controls, selection, lifecycle events and embedded host bridge. The renderer is sourced from `codex/interactive-3d-venue`, including the marked-corner banner placement.

## Demo crowd

Demo mode adds eight different built-in pet characters beside the real team. It is enabled initially for the busy-office preview and can be toggled off in the venue controls. Demo labels and details identify their simulated tasks; they cycle through working, reviewing, walking and breaks. These agents exist only in the rendered view: they never enter the observer, send instructions, or contribute simulated facts to ChatGPT context. Selecting one opens local demo details.

Click **Celebrate**, or ask **@petstown celebrate** in a new plugin-enabled conversation, to play the one-shot demo: arrival, work, cheering with confetti, and departure. It uses simulated pets only and leaves the real team unchanged. Reduced motion replaces falling confetti with a static celebration.

Pets share reserved floor positions across real, demo and celebration actors. Arrivals use separate entrance slots; walkers yield or reroute around occupied space rather than stacking at shared destinations.
