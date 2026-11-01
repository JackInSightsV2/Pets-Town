# Scan layout basis

The original GLB defines the layout. The generated illustration defines material, colour and detail style only. The first estimated office layout was rejected and replaced.

The private scan was inspected in an orthographic overhead view after a −53° rotation about Y. Dominant vertical triangle normals supplied the initial axis alignment. Horizontal triangles below 1.05 scan units helped distinguish table surfaces from people and chairs. A private overlay places the traced outline, stage and desk rectangles directly on the scan. No scan mesh, texture, people or reference render is included in the repository.

`src/office/three/layout.ts` stores this coordinate system. The room renderer and navigation both use it. Dimensions retain the GLB's units; no physical reference measurement has calibrated them. Do not treat this as a surveyed plan.

| Element | Centre (X, Z) | Footprint in scan units |
| --- | --- | --- |
| Stage | (3.75, −4.00) | 2.50 × 2.50 |
| Rear worktable | (−2.75, −6.20) | 0.80 × 2.65 |
| Middle left worktable | (−3.30, −2.50) | 0.80 × 2.50 |
| Far-left worktable | (−6.50, −2.65) | 2.30 × 0.85 |
| Front crosswise worktable | (−1.80, 1.25) | 2.60 × 0.90 |
| Front worktable A | (1.50, 4.90) | 0.75 × 2.30 |
| Front worktable B | (3.40, 4.95) | 0.75 × 2.25 |

The right wing starts near (4.8, 1.1) and extends to X≈7.9. This replaces the much larger wing in the first attempt. The left counter, wing equipment bench and angled equipment island follow visible scan clusters. The near-stage central area contains audience chairs, not worktables.

## Photo-informed event fixtures — 1 November 2026

Six private venue photos in Game of Coins Drive's Codex Hackathon folder supplied the signage and desk references. The photos remain outside the repository. Signs use editable geometry, including lettering and clipped circle-face artwork, so the room export contains no photographic textures or people.

Facing the stage means looking along +X; stage-right is +Z. Elliott's annotated screenshot places the wide circle-face backdrop in the foreground corner at (−4.85, 4.55), parallel to the low wall at X=−5.5 with a 0.65-unit gap. It stands on its own feet. Artwork appears on both faces for orbiting views. Two narrow OpenAI roll-ups flank the screen. A black AV desk sits next to the stage at (3.60, −1.80).

The right wing contains the black help desk at (6.65, 5.80). Following Elliott's second annotated screenshot, the cream HELP DESK banner now spans the upper wing corner at (7.10, 1.95), angled 45° across the corner above the equipment area. These positions follow the marked screenshots within the traced floor plan; the photographs do not provide surveyed coordinates. The banner artwork is a stylised reconstruction of the photographed designs.

Two requested additional worktables occupy the rear-left corner at (−6.35, −6.90) and (−6.35, −4.65). Both have a 2.15 × 0.80 footprint. They are stored separately from the six scan-traced tables. Navigation includes the new tables, desks and sign stands and preserves access to the help desk and rear work area.

## Uncertainty and style additions

- The northwest boundary is incomplete. Its missing portions are closed approximately between observed edges. Large foreground floor holes are filled; they are scan gaps, not asserted openings in the actual floor.
- Individual chair positions and counts are approximate where the scan is incomplete or people obscure furniture. The audience area and chair orientation follow the observed rows.
- Curtain height is a deliberate cutaway. Wall finishes, lamps, brick detail, plants, shelf details, laptops and notebook details are a stylised treatment, not measured inventory.
- The small water cooler is an added PetsTown interaction prop. Meeting locations sit on clear floor beside it.
- This is an editable reconstructed environment, not a cleaned copy of the original fused mesh.
