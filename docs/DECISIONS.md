# Decisions log

- 2026-09-29 — Web app (Vite + React + TypeScript + three.js) instead of Blender or Revit, so the family can edit it in a browser. Professionals get the model through the IFC export (spec 07).
- 2026-09-29 — Version 2 is the starting design. Version 1 is kept for comparison.
- 2026-09-29 — Rooms are stored as rectangles ("cells"), exactly like the prototype, so the areas match it to the cent and wall dragging behaves the same. Walls are real model elements that are rebuilt from the rooms after every room edit; wall ids, thickness and doors survive the rebuild.
- 2026-09-29 — Wall centrelines sit on the room edges, so room areas are the prototype's areas (centreline areas). Net areas inside finishes can come later if the manager wants them.
- 2026-09-29 — Retaining wall thickness 0.25 m (the brief gives none).
- 2026-09-29 — Buried part of the lower-level side walls: south wall y 8.5–10.5, north wall y 8.5–8.9. Reason: the laundry window starts at 10.8 on the south side and the studio window at 9.0 on the north side, and a window cannot sit in a retaining wall. Stored in the model (`site.cut`) so it can change. See QUESTIONS.
- 2026-09-29 — Lot shape: the south boundary is square to the street and the rear is 1 m wider on the north side (14 m front, 15 m rear). Used by the Civil Code 1.301 and setback checks. See QUESTIONS.
- 2026-09-29 — Only glass that the prototype counts as windows counts for the 1/8 window ratio; glass sliding doors do not. Same result as the prototype.
- 2026-09-29 — Civil Code 1.301 check covers windows and glass sliders against the side and rear boundaries, not the street.
- 2026-09-29 — Minimum areas follow the prototype's table: master bedroom 10 m², other bedrooms 8 m², bath/WC 2.5 m², kitchen 4 m², living and work rooms 8 m², closet none.
- 2026-09-29 — Version 1 stairs are modelled as U-stairs (two flights of 9 + 8 risers, 1.15 m wide, landing at the front), from the prototype drawing. Version 2 stairs come from plan-v2.json (17 risers of 0.182, treads 0.27, 1.5 m wide).
- 2026-09-29 — Every edit is a pure command; each version keeps its own undo history (100 steps). A drag is one undo step.
- 2026-09-29 — Added "Add door" and "Add window" tools to the toolbar, because double-click does not work well on a tablet.
- 2026-09-29 — Renaming a room to the name of another room on the same floor is refused: the two would merge and their wall would disappear.
- 2026-09-29 — Each floor fills the plan view (as in the prototype). A fixed frame for all floors was tried and made the lower level too small on a tablet.
