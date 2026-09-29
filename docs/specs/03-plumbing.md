# 03 — Plumbing: water, hot water, sewage, rainwater
Status: draft

## Goal
Plumbing modelled as real networks in 3D and 2D, with diameters, slopes and elevations, and checks against the NBR standards. The owner can move a fixture and see the pipes re-route and the checks update.

## Requirements
1. **Fixtures (library):** toilet, basin, shower drain, kitchen sink, laundry tank, washer, dishwasher, floor drain, garden tap, grease trap, inspection box, lift station, backflow valve, water meter, roof tanks, pressure pump, heat-pump water heater, rain cistern, sump pump.
   - Each fixture has connection points and a DN.
   - Place fixtures from `docs/reference/plan-v2.json` overlays, then drag them.
2. **Networks** (a `PipeSegment` graph per system: cold, hot, sewage, vent, rain):
   - Each pipe has DN, material (PVC, PPR, CPVC), start and end xyz, slope and flow direction.
   - Stacks run through the floors at the stack positions.
   - Auto-routing: fixture → branch → stack → ground → property exit. Keep it inside walls, shafts or the crawlspace. The user can edit segments by hand.
3. **Sewage rules (NBR 8160):**
   - minimum slope DN ≤ 75 → 2%, DN 100 → 1%;
   - DN by fixture units, with a vent per stack;
   - inspection boxes at direction changes outside;
   - grease trap on the kitchen line.
   - Show the invert elevation at every node.
   - Show the LL problem live: gravity to the street sewer at −3.00 fails, so the lift station is required. Make the street sewer depth an editable site parameter; the app recomputes when SEMAE confirms the real depth.
4. **Water (NBR 5626/7198):**
   - meter at the front, feed pipe to the roof tanks, distribution by gravity, pressure pump on the UF showers;
   - hot water from the 300 L heat pump;
   - pressure check at the worst fixture (static head from the tanks).
5. **Rainwater (NBR 10844/15527):**
   - roof areas → gutters → DN100 downpipes → cistern 5,000 L → overflow to the street gutter;
   - garden → infiltration trench + sump pump;
   - flow check for a 5-minute rainfall intensity of about 150 mm/h (TO CONFIRM for Piracicaba).
6. **Views:**
   - a colour per system (cold blue, hot red, sewage brown, vent grey, rain cyan);
   - 3D "systems x-ray" mode with the building ghosted;
   - 2D overlay per level;
   - an isometric riser diagram;
   - longitudinal section of the sewage run to the street.
7. **Schedules:** metres per DN and material, fittings count and fixture list. Export CSV.

## Acceptance
- Moving the SL kitchen sink 1 m re-routes its branch; the slope and DN checks update.
- Setting the sewer depth to 3.5 m turns the LL gravity check to pass.
- Screenshots: `docs/screens/03-xray.png`, `03-sewer-section.png`.
