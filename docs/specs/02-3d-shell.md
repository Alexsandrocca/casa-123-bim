# 02 — 3D model: site, cut, structure and building shell
Status: done (2026-09-29)

## Goal
A 3D view of the same model, next to or switchable with the 2D plan. Editing in either view updates both at once. It must be physically believable and measured, not a sketch.

## Requirements
1. **Views:** 2D, 3D, and split (2D left, 3D right). The 3D camera has:
   - orbit, pan and zoom;
   - presets: street view, garden view, north ramp, top;
   - a walk mode at 1.60 m eye height, blocked by walls.
2. **Site:**
   - The lot polygon (14 front, 15 rear, 25 sides), sloping from 0.00 at the street to −2.00 at the rear.
   - The cut: rear half excavated to −2.55, with retaining walls.
   - The north ramp (4 m wide) and the south passage.
   - Setback lines on the ground. Neighbour boundaries shown as low walls.
   - The street and sidewalk in front.
3. **Structure** (generated from the grid and levels, and editable in the properties panel):
   - steel columns (W or HSS, size as a property);
   - beams under each slab edge and on the grid lines;
   - steel-deck slabs with 0.40 m total depth;
   - footings, and piers for the raised street-level floor (+0.60) over the crawlspace;
   - retaining walls on footings along the cut. Nothing may float: a check flags any element without support below.
4. **Walls:** extruded from the model with real thickness. They join cleanly at corners. Openings are cut as real holes, with frames, glass panes and door leaves (open or closed toggle).
5. **Stairs:** both flights built from riser, tread and width, with landings, guards 1.10 m high where there is a drop, and the voids in the slabs.
6. **Roof:** flat roof at +6.80 with parapet +7.10 over the UF. Garage roof. Eaves as a property, with 0.70 m as the city limit shown in the checks.
7. **Section tool:** a horizontal cut per level (shows that floor's plan in 3D) and a vertical section plane you can drag.
8. **Sun:** a correct sun position for Piracicaba (lat −22.72, lon −47.65) by date and time, with shadows. Street = east. Presets: 21 June 9:00/15:00 and 21 December 9:00/15:00.
9. **Selection:** clicking any element in 3D selects it in both views and shows its properties. Moving a wall in 2D updates 3D live.
10. **Performance:** 60 fps on a normal laptop. Build meshes per element and dispose them properly.

## Acceptance
- The garden view shows the veranda, the LL garden door and the stair landing facing it.
- The walk mode can go from the street, through the entry, down the stair, to the garden door.
- The support check passes on Version 2. The e2e test covers switching views and selecting a wall in 3D.
- Screenshots: `docs/screens/02-street.png`, `02-garden.png`, `02-section.png`.
