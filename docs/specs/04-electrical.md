# 04 — Electrical: panels, circuits, devices, solar, cameras
Status: draft

## Goal
Electrical design as data: devices placed in 3D and 2D, grouped into circuits, with loads, cable sizes, breakers, RCDs, conduit routes and a single-line diagram, all checked against NBR 5410.

## Requirements
1. **Devices (library):**
   - outlets 10 A/20 A, switches, smart switches, ceiling and wall lights, LED strips;
   - dedicated points: hob 7 kW, oven, washer/dryer, heat pump, AC indoor and outdoor units, EV charger 7 kW, pumps (pressure, lift, sump), rack;
   - network outlets, cameras, doorbell, smoke detector.
   - Each device has height, power and phase. Heights use Brazilian defaults (outlet 0.30, bench 1.10, switch 1.10).
2. **Minimum points per room (NBR 5410 §9.5.2):** checked automatically. Examples: kitchen, 1 outlet per 3.5 m of perimeter; bedroom, 1 per 5 m; bathroom, 1 near the basin; lighting, 100 VA for the first 6 m² then 60 VA per 4 m².
3. **Circuits:**
   - assign devices to circuits in the main panel (garage) or the LL sub-panel;
   - circuit length from conduit routes (in slabs, walls and the crawlspace);
   - cable section from load, length and voltage drop (≤4%);
   - breaker and RCD (30 mA on wet areas and outlets);
   - phase balancing across three phases, with the imbalance shown.
4. **Panels:** a board layout with breakers, surge protection, RCDs, per-circuit meters and app relays. Generated single-line diagram.
5. **Solar:**
   - 12 × 550 W modules on the UF roof at 20° facing north, placed in 3D with spacing and setbacks from the parapet;
   - shading check with the sun model from spec 02;
   - monthly energy estimate (use PVGIS-like values for Piracicaba, marked as an estimate);
   - hybrid inverter 6 kW; optional 10 kWh battery with an essential-loads panel.
   - The garage-roof reserve is shown as a ghost array.
6. **Cameras:**
   - 16 cameras placed at the positions in `brief.md`;
   - each shows a field-of-view cone in 3D (lens and angle as properties);
   - coverage map of the lot with blind spots highlighted;
   - PoE switch budget and NVR storage estimate (days at 4 MP H.265).
7. **Views and schedules:** electrical overlay per level; 3D conduit x-ray; circuit schedule; bill of materials (cable metres by section, conduit, boxes, breakers). Export CSV.

## Acceptance
- Adding an outlet to a bedroom updates the circuit load, the cable check and the schedule.
- The kitchen minimum-points check fails if outlets are removed.
- Screenshots: `docs/screens/04-circuits.png`, `04-solar.png`, `04-cameras.png`.
