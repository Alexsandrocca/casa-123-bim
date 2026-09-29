# 05 — Finishes, colours and style presets
Status: draft

## Goal
The family can try looks quickly: pick a style preset, then adjust any material. Everything stays measurable (m² of each finish).

## Requirements
1. **Materials library** (PBR, lightweight textures made in code or small files; no external CDNs at runtime):
   - exposed concrete, white render, coloured render, brick, wood cladding, corten, dark steel, white steel;
   - glass (clear, low-e);
   - porcelain floors, wood floor, burnt cement, deck wood, stone paving;
   - metal roof, green roof, gravel.
2. **Assign materials** per element and per face (wall inside/outside, floor, ceiling). There is a paint tool, plus "apply to all similar".
3. **Style presets** that set facade materials, window frame colour, railing type, eave depth and roof type:
   - Contemporary tropical;
   - Exposed steel;
   - Brazilian modern;
   - Simple house with a low-pitch insulated metal roof.
   Each preset shows a short explanation and a relative cost (low/medium/high).
4. **Brise-soleil and pergola generator** on the west and north facades (slat spacing, depth, angle), with a sun check from spec 02.
5. **Finish schedule:** m² per material per room and per facade. Export CSV.
6. **Render view:** better lighting (environment light, soft shadows, ambient occlusion) and a "take picture" button that saves a PNG.

## Acceptance
- Switching presets changes the facade in under 1 s. The finish schedule updates.
- Screenshots: one per preset, `docs/screens/05-<preset>.png`.
