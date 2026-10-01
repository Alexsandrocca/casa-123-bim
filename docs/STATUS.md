# Status

_Updated by Claude Code after every spec. The manager reads this file._

## 2026-10-01 — Spec 04 done: electrical, solar and cameras (Version 3)

### What was built
- **Devices:** 144 electrical points, placed automatically to the NBR 5410 minimums for every room, plus the brief's dedicated points:
  - outlets (10 A and 20 A), smart switches, ceiling and wall lights, a LED strip;
  - hob 7 kW, oven, dishwasher, washer/dryer, heat pump, 5 air conditioners (indoor and outdoor units), EV charger 7 kW, pressure, lift and sump pumps, rack;
  - network outlets, smoke detectors, 16 cameras and the doorbell;
  - main panel (street-level storage), lower-level sub-panel, hybrid inverter.

  Each point has its height (Brazilian defaults: outlet 0.30, bench 1.10, switch 1.10), its power and its phase.
- **Circuits (32):** grouped automatically and assigned to the main panel or the lower-level sub-panel. Each has:
  - its length from routed conduits (floor screed, crawlspace, ceiling lining, underground outside);
  - a cable section from load, length and voltage drop (all ≤ 4 %; highest 3.8 %);
  - a breaker, and a 30 mA RCD where needed.

  Three-phase balance: imbalance 2 % on the main panel and 9 % on the sub-panel.
- **Panels:** board layout (main breaker, surge protection, RCD groups, breakers with an energy meter and app relay each) and a generated single-line diagram, including the PV, inverter and the optional battery with its essential-loads panel.
- **Solar:**
  - 12 × 550 W modules on the upper roof, 20° facing north, rows spaced for no winter shade;
  - shading checked with the spec 02 sun model (0.5 % loss);
  - about **805 kWh/month** (9,650 kWh/year, an estimate);
  - 6 kW hybrid inverter, optional 10 kWh battery;
  - the 6-module reserve stays as a ghost array on the carport.
- **Cameras:**
  - each has a direction, tilt and lens (properties), a view wedge in 2D and a cone in 3D;
  - coverage map of the lot with blind spots: **98 % covered**;
  - PoE budget 17 of 24 ports, 111 of 250 W;
  - NVR about 23 days on 8 TB.
- **Checks:** minimum points per room, breakers vs cables, voltage drop, minimum sections, RCDs, phase balance, every point on a circuit, solar fit / shade / inverter / energy, camera coverage, PoE and NVR. **All pass.**
- **Views:**
  - "Electrical" overlay on the plan (drag any point; an "Add outlet" tool in the toolbar);
  - 3D devices, conduits in the x-ray, "Camera views" cones and the modules on the roof;
  - an **Electrical** window with Circuits, Panels, Solar (roof layout + monthly chart), Cameras (coverage map) and Materials (cable metres by section, conduit, boxes, breakers, RCDs, devices) with **CSV export**.

### How to see it
- Double-click **`Open Casa 123.command`**. Tick **Electrical** above the plan; click **Electrical** in the left toolbar; in 3D try **Camera views** and **Top**.
- Screenshots: `docs/screens/04.png` (upper floor with the electrical overlay), `04-circuits.png`, `04-solar.png`, `04-cameras.png`, `04-cameras-3d.png`.

### Tests
- `npm test`: 80 unit tests (10 new, including both acceptance cases: adding a bedroom outlet, and removing a kitchen outlet).
- `npm run e2e`: 24 browser tests (4 new).
- `npm run build` passes.

### Checks on Version 3 now
All electrical, solar and camera checks pass. Still, from earlier specs:
- 1 fail on purpose: the lower level cannot drain by gravity at 3.00 m;
- 1 warning: shallow rain pipes near the street (Q10);
- 2 to confirm: the carport and the design rainfall.

### Not done yet / known gaps
- Conduits are routed automatically and cannot be redrawn by hand. A device can be moved, re-powered or put on another circuit by hand.
- The essential-loads panel is shown and listed, but circuits are not yet moved onto it one by one.
- Camera coverage is in plan (2D); camera height and tilt are shown in 3D but not used in the coverage map.
- Versions 1 and 2 have no electrical design.

### Open questions
Q13 (4 or 5 air conditioners), Q14 (roof tanks and vents moved for the solar array), Q15 (CPFL supply 127/220 V). Q7–Q12 are still open.

### Next
Spec 08 — architectural features and engineering estimates (ready). Then 09 and 10.

## 2026-10-01 — Spec 03 done: plumbing (Version 3)

### What was built
- **Carry-overs:** section cuts are now filled in dark (walls and slabs read clearly). The note on the stair / retaining-wall crossing is on both elements and in the new `docs/HANDOFF.md`. (South passage 1.50 m was done in 02b.)
- **Fixtures:** 41 fixtures and pieces of equipment from the overlays and the brief: toilets, basins, showers, kitchen sink, dishwasher, laundry tank, washer, floor drain, garden tap, grease trap, inspection boxes, lift station, backflow valve, water meter, 2 roof tanks, pressure pump, heat-pump water heater, roof drains, rain cistern, infiltration trench and sump pump. Each has its DN, fixture units and water weight.
- **Networks,** about 180 pipes, each with DN, material (PVC, CPVC for hot), start and end, slope, flow and load:
  - **Sewage:** branches → 2 soil stacks (with vents through the roof) → collector in the crawlspace → inspection boxes → street sewer. The kitchen goes through the grease trap. The lower level drains to the lift station, which pumps up through a backflow valve.
  - **Water:** meter → roof tanks → riser → each floor; hot from the heat pump.
  - **Rain:** roofs (154 m²) → cistern → overflow to the street gutter. The veranda drains to the garden trench, and the garden sump pump discharges to the street.
- **Moving a fixture re-routes its pipes at once**, by dragging it on the plan (tick "Plumbing" above the plan) or typing x / y in its properties. A pipe's DN or material can be changed by hand and is kept.
- **Checks (NBR 8160 / 5626 / 7198 / 10844):** slopes, DN by fixture units, vents, inspection boxes, grease trap, the street connection, water pressure at the worst fixture, water and rain pipe sizes, the overflow, and the design rainfall (TO CONFIRM).
- **The lower-level problem, live:** at 3.00 m the lower level's gravity check **fails** (it would arrive at −3.04, the sewer needs ≥ −2.70), so the lift station is required and its check passes. Enter the sewer depth SEMAE gives (Plumbing → Sewer section or Street services). At 3.50 m it turns to pass.
- **Views:**
  - pipes in system colours (cold blue, hot red, sewage brown, vent grey, rain cyan);
  - 3D **Systems x-ray** (building ghosted, camera moves to an overview);
  - **2D overlay** per floor;
  - a **Plumbing** window (toolbar) with an isometric **riser diagram**, the **sewer section** to the street with every invert, the **schedule** (metres per DN and material, elbows and tees, fixtures) with **CSV download**, and the **street services** (sewer depth, rainfall).

### How to see it
- Double-click **`Open Casa 123.command`**. On the plan, tick **Plumbing**; in 3D, click **Systems x-ray**; open **Plumbing** in the left toolbar.
- Screenshots: `docs/screens/03.png` (plan with plumbing), `03-xray.png`, `03-sewer-section.png`.

### Tests
- `npm test`: 70 unit tests (12 new for plumbing, including both acceptance cases: moving the kitchen sink 1 m, and sewer depth 3.5 m).
- `npm run e2e`: 20 browser tests (4 new: move the sink by typing and by dragging, sewer section and depth, CSV, x-ray).
- `npm run build` passes.

### Checks on Version 3 now
- 1 fail, on purpose: the lower level cannot drain by gravity at 3.00 m. That is why the lift station is there, and that check passes.
- 1 warning: rain pipes near the street are shallow (Q10).
- 2 to confirm: the carport in the setback, and the design rainfall.

### Not done yet / known gaps
- Pipes can be re-sized and re-materialled by hand, but not re-drawn point by point. Geometry always comes from the router.
- The pressure pump boosts the upper-floor showers in the pressure check, but it is not drawn as a separate pressurised branch.
- Moving a wall does not re-route the pipes; moving any fixture does.
- Versions 1 and 2 have no plumbing.

### Open questions
Q10 (shallow rain pipes near the street), Q11 (basins and dishwasher added), Q12 (heater on the entry roof). Q7–Q9 from 02b are still open.

### Next
Spec 04 — electrical (ready).

## 2026-09-29 — Spec 02b done: Version 3, garage out, carport in front

### What was built
- **Version 3** is a new model (`model/casa-123-v3.json`), made from Version 2. The switch at the top shows Version 1 / 2 / 3, and **Version 3 opens by default**. Versions 1 and 2 are unchanged.
- **Street level:** the garage and its doors are gone, and the building line is at y 1.0 (5.0 m from the street). The south band (entry, WC, storage, pantry, passage, stair hall) follows the spec. The kitchen front wall is now an outer wall with a window and a glazed service door onto the patio, and the passage has a window onto the patio. A flat entry roof at +3.70 with a 0.30 m parapet covers the south band. Kitchen, dining, living, stairs and veranda are unchanged. **Gross area 78.2 m²** (was 108.4).
- **Front patio** at +0.60 in front of the kitchen: open, not a room, with a planter strip and steps down to the carport. It has a guard on the ramp side.
- **Carport** (new element type) in the front setback, 6.0 × 5.0 m. It has 2 marked bays of 2.50 × 5.00 m, 4 slim steel columns on their own footings, 2 beams, and an insulated roof at +2.70 → +2.95 falling 5 % to the street with a gutter. There are 6 solar modules shown as a ghost array, and the 7 kW EV charger is on a column. The sidewalk has a curb cut, the entry path runs south of the carport, and the north ramp still starts at the street.
- **Main electrical panel** is recorded in the street-level storage room (`dev-panel-01`) for spec 04.
- **South passage 1.50 m** (spec 03 item 0.1, done here for Version 3). North ramp: **3.90 m at the street, 4.90 m at the rear**. The owner asked for 4 m, so it is **10 cm short at the street** (see Q7).
- **Checks:** new "Parking" (passes) and "Carport in the front setback" (always **TO CONFIRM** with the Prefeitura). The front setback shows 5.00 m for the house and notes that the carport is not counted. Version 3: **60 pass, 0 fail, 1 to confirm**. "Nothing floats" passes, including the carport.

### How to see it
- Double-click **`Open Casa 123.command`**. The app opens on Version 3; click 3D → Street to see the carport.
- Screenshots: `docs/screens/02b-street.png`, `docs/screens/02b-plan-SL.png`.

### Tests
- `npm test`: 58 unit tests (9 new for Version 3, including walking from the sidewalk past the carport to the garden).
- `npm run e2e`: 16 browser tests (3 new: Version 3 opens by default with 78 m² and one "to confirm", clicking the carport in 2D and 3D, street screenshot).
- `npm run build` passes.

### Not done yet / known gaps
- The carport sits right at the street line; whether that is allowed is the open "to confirm" item (Q9).
- The patio steps land in front of car bay 1 (Q8).
- Spec 03 carry-over items 0.2 (filled section cuts) and 0.3 (stair/retaining note) are still open; they belong to spec 03.

### Next
Spec 03 — plumbing (ready). Spec 04 — electrical (ready).

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

## 2026-10-01 — Manager: specs 08 and 09 released
- **08:** architectural features + engineering estimates (assemblies, loads, pre-sizing, environmental checks, cost).
- **09:** reference images board with AI analysis and model proposals.
- Order of work: 04 → 08 → 09. Specs 05–07 stay draft. When 05 is written, it builds on the colour/material hooks from 08 and 09.

## 2026-10-01 — Manager: spec 10 released
- **10:** generate a complete new design version from reference photos and prompts, with self-repair against the checks and options compared side by side. It runs after 09. Order: 04 → 08 → 09 → 10.

## 2026-10-01 — Manager request: GitHub (do this right after the current spec is committed)
- Create a **private** GitHub repository `casa-123-bim` under the owner's account (`Alexsandrocca`), add it as `origin`, commit any uncommitted docs/specs (08, 09, 10, roadmap), and push all branches.
- If the `gh` CLI or GitHub login is missing on this Mac, guide the owner step by step (`gh auth login` in the browser) and wait for them.
- Keep `.env.local` out of git. From now on, push after every finished spec (the next-spec skill already says so).

## 2026-10-01 — Manager review of 03 and 04: accepted, with spec 04b added
- The owner likes plumbing and electrical, but they float and pass through the wrong places: L-shaped routing without obstacles, items without hosts, the pump in the hall, condensers hanging on the facade.
- New spec **04b** (ready) fixes this before anything else. Order: **04b → 08 → 09 → 10**.
- GitHub setup (request above) is still to do. Do it first, before 04b.
