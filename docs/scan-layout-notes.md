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

## Uncertainty and style additions

- The northwest boundary is incomplete. Its missing portions are closed approximately between observed edges. Large foreground floor holes are filled; they are scan gaps, not asserted openings in the actual floor.
- Individual chair positions and counts are approximate where the scan is incomplete or people obscure furniture. The audience area and chair orientation follow the observed rows.
- Curtain height is a deliberate cutaway. Wall finishes, lamps, brick detail, plants, shelf details, laptops and notebook details are a stylised treatment, not measured inventory.
- The small water cooler is an added PetsTown interaction prop. Meeting locations sit on clear floor beside it.
- This is an editable reconstructed environment, not a cleaned copy of the original fused mesh.
