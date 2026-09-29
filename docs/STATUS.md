# Status

_Updated by Claude Code after every spec. The manager reads this file._

## 2026-09-29 — Spec 02 done: 3D model of site, cut, structure and shell

### What was built
- **Three views:** 2D, 3D and Split (2D left, 3D right), from buttons above the plan. All of them draw the same model, so moving a wall in 2D changes the 3D at once.
- **3D camera:** orbit, pan and zoom with the mouse or trackpad. Presets: Street, Garden, North ramp, Top. **Walk** mode puts you on the sidewalk at eye height 1.60 m. Arrow keys or W A S D move you (drag to look around, Shift to go faster), and there are on-screen arrows for the tablet. Walls block you; stairs and steps carry you up and down.
- **Site:** the lot (14 m front, 15 m rear, 25 m sides) falls from 0.00 at the street to −2.00 at the rear. The rear half is cut to −2.55 behind retaining walls. The north walking ramp (12.5 %) goes from the street down to the garden, and the south passage slopes down to the garden. There are setback lines on the ground (orange), low walls on the neighbour boundaries, the street and the sidewalk, and entry steps up to the front door.
- **Structure,** generated from the grid and the floors and stored in the model:
  - 15 steel columns (W200 by default), and concrete piers under the raised street floor over the crawlspace;
  - steel beams on the grid lines, along the slab edges and around the stair wells;
  - steel-deck slabs (0.14 m slab + 0.26 m beams = 0.40 m);
  - pad footings under every column and pier, and strip footings under the retaining walls.

  Click any part to see it. Column and beam sections, roof eaves and the parapet can be changed in the properties panel.
- **"Nothing floats" check:** every footing, column, beam, slab, wall, stair and deck must rest on something that is itself supported, down to the ground. It passes on Version 2 and Version 1. It fails when a footing, beam or floor is removed.
- **Walls** have their real thickness and join at the corners. Doors and windows are real holes with frames and glass. Door leaves have an open/closed switch (the garage door rolls up).
- **Stairs** are built from riser, tread and width, with stringers and the Version 1 landings. **Guards 1.10 m** are added automatically wherever a floor edge drops more than 0.50 m and no wall is there: the veranda, around the stair wells, and between the two flights.
- **Roof:** flat at +6.80 with a parapet to +7.10 and 0.40 m eaves (editable). The garage roof is at +3.70. The checks now include the eaves against the city's 0.70 m limit.
- **Section tool:** a floor cut (LL, SL or UF) and a vertical section (Across or Along). The vertical section can be moved by dragging the red bar on top of it, or with the slider, and the camera turns to face the cut.
- **Sun:** the correct position for Piracicaba for any date and hour, with shadows. Presets: 21 June and 21 December at 9:00 and 15:00.
- **Selection:** clicking something in 3D selects it in both views. The 2D plan switches to that element's floor.

### How to see it
- Double-click **`Open Casa 123.command`**, then click **3D** or **Split** above the plan.
- Screenshots: `docs/screens/02-street.png`, `02-garden.png`, `02-section.png` (a section through the stairs, looking from the north).

### Tests
- `npm test`: 49 unit tests, including the walk from the street through the entry, down the stair and out of the garden door; the support check passing and failing; guards; holes in walls; the sun position.
- `npm run e2e`: 13 browser tests, including switching views, clicking a wall in 3D, walk mode, dragging the section plane, and the three screenshots.
- `npm run build` passes.

### Not done yet / known gaps
- Section cuts are hollow: you see inside the walls, but the cut faces are not filled in (poché).
- The frame rate was not measured on the family laptop. The scene has about 700 simple parts and rebuilds in about 20 ms after an edit, which should be comfortable.
- Footing sizes, column and beam sections are placeholders until the engineer's design and the SPT soil borings.
- Walk mode walks through door openings whether the doors are shown open or closed.
- The model gained footings, beams, columns and new slabs. Models saved in the browser before this spec are upgraded automatically, keeping the room edits.

### Open questions
See `docs/QUESTIONS.md` (Q4–Q6 are new).

### Next
Spec 03 — plumbing (still a draft; the manager marks it ready).

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

## 2026-09-29 — Manager review of specs 01–02
- Accepted. Q1–Q6 answered in QUESTIONS.md.
- Specs 03 (plumbing) and 04 (electrical) are now **ready**. Spec 03 starts with three carry-over fixes: south passage 1.50 m, filled section cuts, and a note on the stair/retaining-wall crossing.
- Specs 05–07 stay draft until the owner has reviewed plumbing and electrical.

## 2026-09-29 — Manager: specs 03–04 on hold
- The owner wants the garage out of the house and a covered carport in the front setback instead. That changes the street-level layout, so plumbing and electrical wait for the new layout (Version 3 spec coming).
- `/next-spec` has nothing to build until then.

## 2026-09-29 — Manager: Version 3 (carport) released
- New spec **02b**: the garage leaves the house, and a covered carport for 2 cars goes in a 5 m front zone. The house front moves back 1 m and the street level shrinks by about 27 m².
- Specs 03 and 04 are ready again and build on Version 3. `/next-spec` runs 02b first, then asks before 03.
