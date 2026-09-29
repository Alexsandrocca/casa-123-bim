# 01 — Foundation: project setup, building model, 2D plan editor
Status: in progress

## Goal
A running web app, with tests, that loads Casa 123 Version 2 from `model/casa-123.json`. The family can edit the floor plans in 2D exactly as in the prototype, with the same checks.

## References
- `docs/reference/plan-v2.json`: rooms, doors, windows and overlays of Version 2, plus levels, grid and stairs.
- `docs/reference/brief.md`: rules, levels, walls, systems.
- `docs/reference/prototype-studio.html`: open it in a browser to see the expected 2D editing behaviour.

## Requirements
1. **Project setup:**
   - Use Vite + React + TypeScript (strict), @react-three/fiber, drei, zustand, Vitest and Playwright.
   - Run `git init` and add a `.gitignore`. Add npm scripts `dev`, `build`, `test` and `e2e`.
   - Create `docs/STATUS.md`, `docs/QUESTIONS.md`, `docs/DECISIONS.md` and `docs/screens/` if they are missing.
2. **Building model** (`src/model/`, TypeScript types plus a JSON schema checked with zod):
   - `Project` has meta, site, levels, grid and elements.
   - Elements: `Space` (room, zone, polygon made of cells), `Wall` (start/end, thickness, height, level, type exterior/interior/wet/retaining), `Opening` (door/window/slider/garage, host wall, offset, width, height, sill, swing), `Slab`, `Column`, `Beam`, `Stair`, `Deck`.
   - Leave room for later: `Fixture`, `PipeSegment`, `Device`, `Circuit`, `Furniture`, `Plant`, `Material`.
   - Every element has `id`, `type`, `level`, `props` and `tags`.
3. **Importer:** convert `plan-v2.json` into `model/casa-123.json`.
   - Build walls from the cell edges: an exterior wall on each outline edge; interior walls where the prototype draws them (same rule as `OPEN()` in the prototype); retaining walls along the cut (LL front wall at y 8.5 and the buried part of the north and south LL walls).
   - Openings are hosted by walls.
   - Commit the generated model.
   - Also import Version 1 from the prototype (the `BASE1` constant in `prototype-studio.html`) as `model/casa-123-v1.json`. The owner can switch between Version 1 and Version 2.
4. **Commands and undo:** every edit is a command (move wall, move/resize/flip opening, add/delete opening, rename room). Undo and redo with Ctrl/Cmd+Z and Shift+Z. Autosave to the browser, plus **Save model** (download JSON) and **Open model** (load JSON).
5. **2D plan view:** all the prototype's editing behaviour must work.
   - Drag interior walls, resizing both rooms (5 cm snap, minimum room width 0.8 m; stair walls locked).
   - Drag doors and windows along their wall. Double-click to add. Select, then resize, flip or delete.
   - Level tabs LL/SL/UF. Live dimension strings. Room names and areas. Veranda and garden shown as decks.
6. **Checks panel:**
   - room area minimums and window ratio (≥1/8, target 1/6);
   - corridor and stair widths (≥0.90 m);
   - stair Blondel rule and headroom;
   - windows within 1.50 m of a lot boundary (Civil Code 1.301);
   - footprint inside setbacks (front 4, rear 6, sides 1.20).
   Each check shows pass/fail, the rule and its source.
7. **Layout:** app shell with a left toolbar, the center view, a right properties panel (the selected element's properties, editable where safe) and a bottom checks bar. There is an About panel explaining that this is a design tool and that permits come from licensed professionals.

## Acceptance
- `npm run dev` shows Version 2, street level, looking like the prototype with the same room areas (±0.05 m²).
- Dragging the kitchen/dining wall on SL changes both room areas live. Undo restores them.
- Switching to Version 1 shows Version 1. Edits to each version are kept separately.
- The unit tests cover the importer (areas, wall counts, opening hosts) and the checks. The e2e test covers dragging a wall and undo.
- Screenshot: `docs/screens/01.png`.
