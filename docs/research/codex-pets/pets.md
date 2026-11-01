# Genuine pet assets and animation formats

PetsTown requires genuine existing ChatGPT/Codex pet assets. This reference helps retrieve, identify and render those assets; generating replacement characters is outside the current design.

The native code below was independently inspected at OpenAI commit `67f0994b532b8740f14b5b738af7b7b2a915b1d6`. The bundled Work Pets 0.1.6 contract and exposed upload/validation tool metadata were also inspected. No asset was downloaded or rendered on the demo Mac during this audit.

## Format compatibility

| Format | Image | Standard grid | Standard cell |
| --- | --- | --- | --- |
| Native CLI default / library v1 | 1536 by 1872 | 8 columns, 9 rows | 192 by 208 |
| Work Pets library v2 | 1536 by 2288 | 8 columns, 11 rows | 192 by 208 |

Rows 0–8 share the standard layout. V2 adds sixteen fixed look poses in rows 9–10. The inspected library validation/upload tools accept both versions; the pinned native CLI loader requires the nine-row full-image dimensions.

Evidence: [catalog.rs](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/tui/src/pets/catalog.rs#L10), [model.rs image validation](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/tui/src/pets/model.rs#L314), [asset_pack.rs validation](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/tui/src/pets/asset_pack.rs#L165).

192 by 208 is the native standard, not an absolute rule for every custom manifest. Native custom FrameSpec values can change the grid/cell layout if they cover the still-fixed native full-image dimensions exactly. Inspect the actual manifest and asset; do not infer compatibility from the filename.

A browser loader can explicitly support both standard image sizes. Never stretch an eleven-row sheet into nine rows, or assume that successful library upload proves native CLI import compatibility.

## Standard rows

Indices are zero-based. These are native primary-frame timings from [model.rs](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/tui/src/pets/model.rs#L484).

| Row | Animation | Frames | Native frame durations |
| --- | --- | --- | --- |
| 0 | idle | 6 | 1680, 660, 660, 840, 840, 1920 ms |
| 1 | running-right | 8 | 120 ms; final frame 220 |
| 2 | running-left | 8 | 120 ms; final frame 220 |
| 3 | waving | 4 | 140 ms; final frame 280 |
| 4 | jumping | 5 | 140 ms; final frame 280 |
| 5 | failed | 8 | 140 ms; final frame 240 |
| 6 | waiting | 6 | 150 ms; final frame 260 |
| 7 | running | 6 | 120 ms; final frame 220 |
| 8 | review | 6 | 150 ms; final frame 280 |

Native non-idle primary sequences play three times, then loop idle; custom animation specs may override defaults. [Playback source](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/tui/src/pets/model.rs#L584).

The bundled QA preview idle is six times faster than native idle. Preview playback is not evidence of exact native runtime timing.

For a standard atlas, crop each frame at `(column * 192, row * 208, 192, 208)`. Never animate unused cells. [Frame extraction](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/tui/src/pets/frames.rs#L24).

V2 row 9 contains 0 through 157.5 degrees in 22.5-degree steps; row 10 contains 180 through 337.5. Up is 0, screen-right 90, down 180, screen-left 270. These are fixed look poses, not extra walking frames.

## State and movement stay separate

Native labels map Running to row 7, Needs input to row 6, Ready to row 8, and Blocked to row 5. Ready does not mean a code-review task. [ambient.rs](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/tui/src/pets/ambient.rs#L47).

Use rows 1–2 for walking. Keep observed runtime state, selected animation, world position, attention and text bubbles separate. A visual animation ending cannot clear a pending request or claim completion.

Kitty/Sixel output is terminal-specific. The office needs browser rendering, not the terminal display backend. [Terminal integration](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/tui/src/pets/mod.rs#L128).

## Genuine asset retrieval gate

1. Identify an existing genuine pet on the intended account/machine. The repo's [integration notes](../../integration-notes.md) describe local custom packages as a candidate.
2. Verify the supported retrieval path and record origin, stable asset/pet ID, dimensions, manifest and file hash.
3. Preserve the original artwork. Serve the validated local asset through the bridge using an approved asset key.
4. Render several real frames at demo size. Check alpha, clipping, frame count, direction and unused cells.
5. Verify which runtime state maps to each row in the actual supplied format.

Public [asset_pack.rs](https://github.com/openai/codex/blob/67f0994b532b8740f14b5b738af7b7b2a915b1d6/codex-rs/tui/src/pets/asset_pack.rs#L27) supplies CDN/cache implementation evidence, not a completed export/redistribution or visual test.

The inspected Pets tools offer library listing, download links, validation, upload and selection. They expose no office placement, movement or agent-event subscription. Work-library access does not establish desktop-library access or a native per-agent pet assignment. Stable IDs are durable; download URLs may expire.

Keep the pet mapping an explicit office mapping unless a native mapping is actually observed. Do not claim Codex assigned a particular character when the office chose it.
