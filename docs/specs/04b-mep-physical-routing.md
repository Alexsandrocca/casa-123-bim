# 04b — Plumbing and electrical that obey the building (physical placement and routing)
Status: in progress

## Why (manager review of 03 and 04, 2026-10-01)
The owner likes the systems, but they look like they float and pass through the wrong places.

The reason: the routers (`plumbing/route.ts` `growTree`, and the conduit router in `electrical/design.ts`) draw shortest right-angled (L-shaped) paths in plan. They do not know where a pipe or cable is physically allowed to be. As a result:
- pipes and conduits cross rooms in mid-air, cross the stair void, go through doors and windows, and pass through columns;
- some equipment hangs in space: the pressure pump in the upper hall, the AC outdoor units outside the upper floor's front wall with no support, devices not attached to a specific wall face;
- the cistern is under the entry path.

This spec makes every MEP element follow the building's physics. It comes **before** spec 08.

## Principle
**Every pipe, conduit, fixture and device must be inside, or attached to, a real building element that can host it, and be reachable for maintenance.** Anything that is not gets flagged red. It is the same idea as the "nothing floats" check for the structure.

## Requirements

### 1. Service spaces (generated from the model, stored, editable)
A `ServiceSpace` type, with a capacity (max DN / number of conduits) and the systems it allows.

| Space | Where | Allows |
|---|---|---|
| **Wall cavity** | inside each wall | Capacity from the wall thickness minus 2 × 15 mm cover: a 0.12 m wall takes DN ≤ 50 and conduits; a 0.15 m wet wall takes DN ≤ 75; DN 100 needs a shaft or a 0.20 m+ wall. Only vertical drops and short horizontal runs (≤ 1.0 m, NBR practice) in walls; no horizontal pipes in exterior or retaining walls except conduits. |
| **Shaft** (new element) | Placed at the soil/vent stacks, the water riser and the electrical riser; it stacks through the floors. Default positions: next to the wet-room strip at x 3.2–3.5 and in the south service band. The user can move or resize it. | Size from the pipes inside, plus 50 mm clearance. An access panel on one face. |
| **Ceiling plenum** | Lowered ceiling (forro) zones under each slab, in baths, halls, kitchen and laundry. Default depth 0.25 m, editable, reducing clear height. The height check must still pass (2.50 m in wet rooms and halls, 2.70 m in living rooms and bedrooms). | Water and conduits; horizontal sewage branches of the floor above, which hang under the steel deck inside the plenum (no pipes through the steel-deck concrete except conduits in the screed). |
| **Floor screed** | 50 mm topping on the slabs | Conduits ≤ 25 mm only. |
| **Crawlspace** | Under the raised street floor (0.60 m) | Sewage collector with slope, water, conduits, on hangers. Must stay ≥ 0.15 m above ground at the low end. |
| **Underground** | Outside and under the slab on grade (lower level) | Minimum cover 0.40 m under the garden, 0.60 m under the driveway/carport, with separation between water and sewage (≥ 0.20 m vertical, water above). |
| **Roof / technical zones** | Roof slab (tanks, heat pump, AC condensers, PV), carport roof, ground pads | Equipment only, on a supported base with a maintenance path. |

### 2. Forbidden zones (hard)
Stair voids and flights, door openings (plus a 0.10 m frame margin), window openings, columns, footings and retaining-wall cores. A beam may be crossed only through a web penetration: Ø ≤ 0.4 × beam depth, in the middle third of the span, and flagged for the engineer.

### 3. Real routing
Replace the L-shaped tree with a **graph search (A\*)** over the service spaces:
- Nodes are connections between spaces (wall to plenum, plenum to shaft, shaft to crawlspace, etc.).
- Costs penalise length, bends and changes of space.
- Hard constraints from section 2.
- Systems routed in order of difficulty: sewage first (gravity), then rain, vents, hot, cold, then electrical.
- Gravity systems (sewage, rain) must fall continuously at the minimum slope (NBR 8160), go only downward or horizontally, and change direction with 45° fittings where possible. If no valid path exists, report "no route" with the reason. Never draw an impossible pipe.
- Electrical conduits may share walls and ceilings but keep ≥ 0.20 m from hot-water and gas lines (a project rule; mark the reference to verify). There is no crossing rule for water inside the same cavity; cold water runs below electrical in walls.
- The capacity of each space is respected. When it is full, use the next space or make the shaft larger, and report that.

### 4. Attachment ("hosting") of every fixture and device
- **Every wall-mounted item** (outlets, switches, wall lights, basins, wall-hung WC, sinks, panels, network outlets, cameras on walls) stores `hostWallId`, `face` (which room side), `offset along the wall` and `height`.
  - Placement only on a wall face that belongs to the item's room.
  - Snap to it when dragged.
  - Keep items out of door swings and openings, and ≥ 0.15 m from corners.
  - Bathroom outlets must be outside zone 1/2 around showers (NBR 5410 §9.1).
- **Ceiling items** attach to the slab or plenum above.
- **Floor items** attach to the slab below.
- **Equipment** must have a host and a maintenance clearance box (shown when selected):
  - **Roof tanks:** on the roof slab over load-bearing beams (spec 08 will check the load). Access hatch or ladder.
  - **Pressure pump:** next to the tanks on the roof (or in a technical niche on the upper floor with drainage). **Never in a corridor.**
  - **Heat-pump water heater:** roof or service area, with air clearance.
  - **AC condensers:** on the roof, the carport roof or a ground pad. If on a facade, a steel bracket with safe access for maintenance (from a window ≤ 1.0 m away or a balcony). Condensate drain to a plumbing point. No condenser hanging over the neighbour or the street.
  - **Inverter, battery and rack:** on walls of rooms that allow them (ventilated, not bedrooms).
  - **Cistern:** underground in the front setback but not under the entry path or the carport bays unless designed for vehicle load (flag it). Maintenance lid reachable.
  - **Lift station:** in the lower level, with a sealed lid and vent.
- **Re-host on edit:** when a wall moves or a room changes, items keep their host and are re-snapped. If the host disappears, the item turns red ("unhosted") and is listed.

### 5. Checks (new group "MEP physics")
- **unhosted item;**
- **pipe/conduit outside a service space** ("exposed / floating");
- **crossing a forbidden zone;**
- **capacity exceeded;**
- **slope reversed or too flat;**
- **clashes:** pipe–pipe, pipe–conduit, MEP–structure, MEP–door/window, with a list and click to zoom;
- **missing supports:** horizontal pipes need hangers at spacing by material and DN (e.g. PVC ≤ 10 × DN for small DN; take a typical table and mark it to verify). Hangers are drawn in 3D.
- **maintenance access** blocked for equipment;
- **ceiling height** after plenums.

### 6. Views
- **"Physics" colour mode** in the x-ray and the 2D overlay: colour every segment by its host (wall, shaft, plenum, crawlspace, underground). Anything outside a host is **red**.
- Show shafts, plenums and the crawlspace as translucent volumes.
- In 2D, draw pipes inside the wall thickness when they are in walls (offset to the cavity), not along the room's middle.
- A short **"Why here?"** line on each selected pipe or device: host, path reason, rule.

### 7. Re-run on Version 3 and fix the data
- Re-place every device and fixture with hosts.
- Move the pressure pump to the roof next to the tanks, and the AC condensers to the roof or carport roof.
- Answer Q14 (roof tanks vs PV) using the roof zones: the tanks get their own zone above the stair/service band, and the PV keeps the north-facing area.
- Re-route everything. Target: **0 red items, 0 clashes** on Version 3. Any remaining failure must be explained in STATUS.

## Acceptance
- On Version 3, the "MEP physics" checks pass with 0 floating items, 0 forbidden crossings and 0 clashes, **or** each remaining one is listed with its reason in STATUS.
- Unit tests:
  - a pipe cannot cross a stair void or a door;
  - a DN 100 stack cannot be placed in a 0.12 m wall;
  - moving a wall re-snaps its outlets;
  - deleting a wall flags its devices "unhosted";
  - the sewage route keeps its slope from the upper bathroom to the street;
  - the AC condenser without a support is flagged.
- Screenshots (before/after style is welcome): `docs/screens/04b-physics-xray.png`, `04b-plan-SL.png`, `04b-plan-UF.png`.
