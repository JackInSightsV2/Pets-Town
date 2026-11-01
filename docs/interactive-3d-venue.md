# Interactive 3D venue and shared pets

The default scene is now a real Three.js room. It is a simplified reconstruction guided by a private venue scan and a cartoon study, not the scan with a filter. Furniture and architectural details are approximate. No original scan, photo texture or generated reference image is included in this branch.

The room contains named, separate objects: floor, cutaway walls, curtains, stage, worktables, chairs, laptops, plants, lounge and water cooler. **Export room** downloads a GLB containing the environment only, without pet artwork, names, tasks or requests.

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

## Share a room with teammates

This adds an opt-in LAN room gateway; the existing local observation bridge stays bound to loopback. Use a trusted private network or private network tunnel. The LAN endpoint uses HTTP, not public internet hosting or TLS. Hackathon guest Wi-Fi may block device-to-device connections; a teammate hotspot or private overlay network may be needed. Do not port-forward this endpoint to the public internet.

On the host Mac, after building:

```sh
npm run room:host -- --lan
```

The terminal prints invitation links and a publisher token. Send a LAN invitation link to teammates. Opening it accepts a room session; the token is removed from the browser address and placed in an HttpOnly, SameSite cookie. The room's **Invite teammates** button copies the invitation when the browser permits clipboard access.

Each teammate runs their existing local office bridge, then lists available agents:

```sh
npm run room:share -- --list
```

Set `PETSTOWN_ROOM_TOKEN` locally to the host's publisher token, then explicitly choose IDs:

```sh
npm run room:share -- --room http://HOST_IP:4320 --name Alice --agents THREAD_ID,THREAD_ID
```

The command publishes only those selected agents every two seconds. Names, pet identity, runtime state and waiting indicators are shared. Tasks, activity text, request prompts, request options and local project paths are excluded by default. Add `--share-details` only when the teammate wants those text details visible to the room. Local paths are always removed. The host's own pets join using the same command.

Room identities are namespaced per enrolled participant, so matching thread IDs from two Macs do not collide. Each publisher receives a separate credential. Initial handoff history does not trigger fake new meetings; subsequent observed handoffs among shared agents do. The room cannot create cross-Mac handoffs or send replies. Open a teammate's original Codex chat on their Mac.

After 15 seconds without updates, pets retain their last presence and request indicators with unknown runtime state (last observed waiting states stay visible); the room reports the lost connection. This is not agent completion. Ctrl-C on a publisher stops sharing; Ctrl-C on the host ends the room. Neither stops Codex agents. Restart the room to clear old participant entries or rotate all invitations. This bounded implementation accepts 12 enrolled teammates and 100 selected agents per update; it is not a production collaboration service.

## Validation and limits

Automated checks cover floor routing, stable placements, identity namespacing, request isolation, invitation authentication, publisher credentials, disconnect/recovery and handoff deduplication. Browser checks use the genuine cached native sprites with explicit fixture data. A real two-Mac run still requires teammates to run their publishers; two synthetic publishers on one Mac do not establish Wi-Fi connectivity or live Codex observation on another machine.

The shared snapshot/events preserve the existing bridge contract. Room endpoints are `/api/room/session`, `/api/room/info`, `/api/room/enroll` and `/api/room/publish`. Replies remain unsupported. Native pet images remain sourced through the existing official asset mechanism, not redistributed in the repository or GLB. Three.js and its controls/exporter use the MIT license.

Validation on the implementation Mac: the existing metadata adapter returned source disconnected with zero observed agents. No live agent or two-Mac acceptance is claimed. The interactive visual preview and shared-room checks use explicitly labelled fixtures.
