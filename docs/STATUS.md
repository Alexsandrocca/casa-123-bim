# Status

_Updated by Claude Code after every spec. The manager reads this file._

## 2026-09-29 — Spec 01 done: building model and 2D plan editor

### What was built
- **The app runs.** It opens Casa 123 Version 2 on the street level, drawn like the prototype, with the same room areas.
- **One building model** (`model/casa-123.json` for Version 2, `model/casa-123-v1.json` for Version 1). It holds rooms, walls, doors and windows, floor slabs, the two stairs, the veranda and the garden. Every item has an id, a type, a level, properties and tags. Walls have real types and thicknesses: exterior 0.20, interior 0.12, wet-room 0.15, retaining 0.25.
- **The importer** builds this model from `plan-v2.json` and from Version 1 inside the prototype. It creates walls on the room edges using the prototype's rule, retaining walls along the cut, and puts every door and window in its wall. Run it again with `npm run import-model`.
- **2D editing, as in the prototype:** drag inside walls (both rooms change, 5 cm steps, rooms stay at least 0.80 m wide, stair walls locked); drag doors and windows along their wall; double-click a wall to add a door (inside) or a window (outside); select one to resize it (±10 cm or type a width), flip it or delete it. The left toolbar also has "Add door" and "Add window" tools for tablets, where double-click is awkward.
- **Undo and redo** for every edit (Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z, or the toolbar). Edits save themselves in the browser. **Save model** downloads the JSON; **Open model** loads one back (and can be undone).
- **Version 1 / Version 2** switch at the top. Each keeps its own edits and its own undo history.
- **Properties panel** on the right: the selected room (rename it), wall (change thickness) or door/window (width, height, sill, flip, delete). With nothing selected it shows the floor's room table, like the prototype.
- **Checks bar** at the bottom: room areas, window ratio (1/8 minimum, 1/6 target), corridor and stair widths, stair comfort (Blondel) and headroom, windows near the neighbours (Civil Code 1.301) and setbacks. Each shows pass/fail, the rule and its source. Click a row to jump to the room. Version 1 and Version 2 both pass everything.
- **About panel:** explains that this is a design tool and that permits and executive designs come from licensed professionals (ART/RRT), and lists what is still to confirm.

### How to see it
- Double-click **`Open Casa 123.command`** in the casa-123-bim folder. The browser opens at http://localhost:5173. (Same as `npm run dev`.)
- Screenshot: `docs/screens/01.png`.

### Tests
- `npm test`: 29 unit tests (importer areas, wall counts, opening hosts, commands, undo/redo, every check passing and failing).
- `npm run e2e`: 8 browser tests (areas on open, dragging the kitchen/dining wall and undo, locked stair walls, versions kept apart, door edit/drag, adding a window, save/open, checks and About).
- `npm run build` passes.

### Not done yet (belongs to later specs)
- No 3D view (spec 02). Columns and beams exist as model types but are not generated yet (spec 02).
- The prototype's plumbing and electrical overlays and the Systems and Styles tabs are not carried over (specs 03–05).
- A door can slide only along its own wall. In the prototype it could slide past a change of wall type on the same line (for example from a WC wall onto the storage wall next to it). To move it there, delete it and add a new one.
- Wall thickness is shown and editable, but the 2D plan still draws walls as lines, like the prototype. Real thickness shows in 3D (spec 02).

### Open questions
See `docs/QUESTIONS.md` (lot shape, buried part of the lower-level side walls, south passage width).

### Next
Spec 02 — 3D model (it is marked ready).
