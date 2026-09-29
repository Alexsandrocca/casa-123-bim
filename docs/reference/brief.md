# Casa 123 — brief, rules and systems (reference)

## Family and intent
- A couple, 2 kids and a newborn. Practical people who want to enjoy outdoor space and don't want a big house: "a home for my family, not an award design".
- The owner wants to explore changes himself. He needs furniture, garden, colours and styles, and above all the plumbing and electrical, with BIM-style precision.

## Lot
- Rua Alceu Maynardi Araújo, 123, Nova Piracicaba, Piracicaba/SP.
- Size: 14 m front (east, street), 15 m rear (west), 25 m sides.
- It falls about 2 m from the street to the rear. There is no topographic survey yet; model a plane from 0.00 at the street to −2.00 at the rear.
- Orientation: the street faces east (sunrise) and the rear faces west. Seen from the street, the right side is north.
- Setbacks (given by the owner):
  - front 4.00 m, rear 6.00 m, sides at least 1.20 m;
  - design choice: 1.50 m south side passage and a 4.0 m north side that is a walking ramp (about 12.5%) down to the garden.
- Only the rear half is cut. The garden sits at −2.55 behind the cut line, which is lot depth 12.5 m (house y = 8.5). Retaining walls along the cut.

## Building (Version 2 — see plan-v2.json)
- Footprint 8.6 m wide.
  - LL: y 8.5–15.0.
  - SL: y 0–12.6, plus a veranda y 12.6–15.0 on the LL roof.
  - UF: y 5.0–13.6.
- Levels: LL −2.50 · garage +0.10 · SL +0.60 · UF +3.70 · roof +6.80 · parapet +7.10. Floor-to-floor 3.10 m, clear height 2.70 m, structure depth 0.40 m.
- Structure: steel W-beam frame on a grid at x = 0 / 3.2 / 8.6, with column rows at the main y lines. Steel-deck composite slabs. The SL is a raised floor (+0.60) with an inspectable crawlspace over the uncut half. Footings, piers and retaining walls must look physically plausible; nothing floats.
- Stairs: two straight flights side by side in the south band. Riser 0.182 m, tread 0.27 m, 17 risers per floor, 1.5 m wide.
  - The down flight lands on the LL facing the garden door.
  - The up flight lands at the rear of the UF.
- Walls: exterior 0.20 m (light steel frame or block, insulated), interior 0.12 m, wet-room walls 0.15 m. Cells in plan-v2.json are room areas. Build the walls on the cell edges.

## Front arrangement (Version 3, spec 02b — current design)
- No garage in the house. Two cars park under a light steel carport (6.0 × 5.0 m, roof about +2.80, 5 % to the street, 6 solar modules, EV charger 7 kW) in the front setback.
- The street level starts 5.0 m from the street (y = 1.0); the lower level, stairs, veranda and upper floor do not move. Street level about 78 m² (was 108.4).
- The old garage area is an open front patio at +0.60 in front of the kitchen, with a planter and steps down to the carport.
- House 1.50 m from the south boundary (south passage 1.50 m). The north ramp is about 3.90 m wide at the street and 4.90 m at the rear.
- Main electrical panel in the street-level storage room.
- To confirm with the Prefeitura: whether a covered carport may sit in the front setback and how it counts in site coverage.

## Code rules used by the checks (from the project's rulebook)
- SP sanitary code (Dec. 12.342/78):
  - ceilings 2.70 m in living rooms and bedrooms, 2.50 m elsewhere;
  - bedrooms 10 m² for the first, 8 m² for the others; bathroom 2.5 m²; kitchen 4 m²; living 8 m²;
  - window glass at least 1/8 of the floor area (we design to 1/6); stairs and corridors at least 0.90 m wide.
- Civil Code art. 1.301: no windows within 1.50 m of a neighbour boundary.
- Stair comfort (Blondel): 0.63 ≤ 2h + b ≤ 0.65; headroom at least 2.10 m.
- Piracicaba LC 474/2025: eaves up to 0.70 m are not counted in site coverage. The zone and height limit are still to be confirmed.
- NBR standards to cite in the checks:
  - 8160 (sewage), 5626 (cold water), 7198 (hot water), 10844 (rainwater), 15527 (rain reuse);
  - 5410 (low-voltage electrical), 5419 (lightning protection);
  - 8800 (steel), 6120/6122 (loads and foundations), 15575 (performance), 9050 (accessibility, reference only).

## Systems (given by the owner; engineering assumptions marked)
- Sewer and water in the street: the public sewer is about 3.0 m deep; the water main is about 1.5 m deep.
- Sewage:
  - SL and UF drain by gravity at 2% (DN100 toilets, DN50 sinks and showers, DN40 basins), through a grease trap on the kitchen line and an inspection box before the property exit.
  - The LL cannot drain by gravity. Its outlet is at −2.80 and leaves the house at −2.85; after about 19 m at 1% it would reach the sewer at −3.04, below the sewer. So the LL uses a sealed lift station (pump, alarm, check valve) plus a backflow valve.
- Rainwater: separate DN100 system. Roofs of about 150 m² feed a 5,000 L reuse cistern under the front setback (garden, WC flushing, laundry), overflowing to the street gutter. The garden at −2.55 drains to an infiltration trench plus a sump pump.
- Water supply: meter at the front wall, then 2 × 1,000 L roof tanks over the stair, gravity distribution, and a pressure pump for the UF showers. 300 L heat-pump water heater.
- Electrical:
  - Three-phase supply from CPFL (to confirm) with a bidirectional meter.
  - Main panel in the garage by the entry: surge protection, 30 mA RCDs, per-circuit energy metering, app-controlled relays. LL sub-panel for the studio, pumps and rack.
  - Circuits: lighting per floor, general outlets per room, induction hob, oven, washer/dryer, heat pump, 4 air conditioners, EV charger 7 kW, pumps.
  - Smart home: Matter/Zigbee switches, app control.
- Solar: 12 × 550 W = 6.6 kWp on the UF roof, tilted 20° facing north, about 750–800 kWh/month. 6 kW hybrid inverter; optional 10 kWh LFP battery on an essential-loads panel. Garage roof reserved for 6 more modules.
- Cameras: 16 × 4 MP PoE IP cameras at the street (2), doorbell, garage, ramp (3), south passage (2), garden (3), veranda, LL garden door, rear corners (2) and LL hall. 16-channel NVR with 8 TB, 24-port PoE switch, 1.5 kVA UPS, rack in the LL.

## Style options (no choice yet)
Contemporary tropical · Exposed steel · Brazilian modern · Simple house with a low-pitch insulated metal roof.

## Open items (the app should show these as "to confirm")
Topographic survey, SPT soil borings, SEMAE sewer depth, lot zone and height limit, climate zone (NBR 15220-3), whether decks are allowed in the setbacks, CPFL supply type.
