# 02b — Version 3: garage out of the house, covered carport in the front
Status: done (2026-09-29)

## Owner decisions (2026-09-29)
- The garage leaves the house. Cars park under a covered carport in the front setback.
- The carport needs 5.0 m of depth, so the house front moves back 1.0 m: it now starts 5.0 m from the street boundary (it was 4.0). The rear stays where it is, 6 m from the rear boundary. The house can be at most 14 m deep.
- The garage's 27 m² is **not** rebuilt. The street level gets smaller and cheaper. The former garage area becomes an open front patio in front of the kitchen.

## Requirements
1. **New Version 3** (`model/casa-123-v3.json`), derived from Version 2. The top switch shows Version 1 / 2 / 3, with Version 3 as the default. Versions 1 and 2 stay untouched for comparison.
2. **Coordinates:** keep Version 2's house-local axes (y origin = 4.0 m from the street boundary), so everything behind the street level's front stays at exactly the same position on the lot.
   - The street-level building line moves to **y = 1.0**.
   - The cut line (y 8.5), lower level, stairs, veranda and upper floor keep their positions.
3. **South side passage 1.50 m** (spec 03 item 0.1): the house origin on the lot is x = 1.50. Do it here, for Version 3 only, and mark item 0.1 in spec 03 as done. Report the north ramp width at the street and at the rear.
4. **Street level (Version 3):**
   - Remove the garage `[3.2,0,8.6,5.0]`, its roller door and the garage-to-kitchen door. The kitchen's front wall at y 5.0 becomes an exterior wall with:
     - a window x 5.6–8.2;
     - a glazed service door x 3.5–4.4 onto the front patio (the grocery route from the carport).
   - South band from y 1.0:
     - Entry `[0,1.0,3.2,2.6]`, front door on y 1.0 at x 0.9–1.9;
     - WC `[0,2.6,2.0,4.2]`;
     - Storage `[0,4.2,2.0,5.2]`;
     - Pantry `[0,5.2,2.0,7.0]`;
     - passage `[2.0,2.6,3.2,7.0]` and stair hall `[0,7.0,3.2,8.2]` (same room as Entry, "Entry · hall").
     - Keep the V2 door and window logic (WC and pantry high windows on the south wall). The passage's north wall y 2.6–5.0 at x 3.2 becomes exterior and gets a window onto the patio.
   - The south band from y 1.0 to 5.0 has no upper floor above: flat roof at +3.70 with a 0.30 m parapet, like the old garage roof.
   - Kitchen, dining, living, stairs and veranda: unchanged from V2.
5. **Front patio** `[3.2,1.0,8.6,5.0]`: an open deck/paving at +0.60 with steps down to the carport level. It is not a room. Show it as a Deck with a planter strip.
6. **Carport** (new element type `Carport`, in the front setback: lot depth 0–5, house y −4.0 to 1.0):
   - Two parking spaces of 2.50 × 5.00 m each, drawn on the paving. Suggested footprint: x 2.6–8.6, 6.0 m wide.
   - A light steel structure (4 slim columns, beams, insulated metal-sheet roof sloping 5% to the street, gutter at the front), independent from the house. Clear height ≥ 2.30 m, roof top about +2.80.
   - Carport roof reserved for 6 solar modules (moved here from the old garage roof). Show them as a ghost array.
   - EV charger 7 kW on a carport column. The main electrical panel moves from the garage into the Storage room (spec 04 must use the new position).
   - Pedestrian path from the sidewalk to the front door along the south side of the carport; driveway and curb cut in front of the carport; the north ramp still starts at the street beside it.
7. **Checks:**
   - "Parking" check: 2 spaces of 2.50 × 5.00 with 0.60 m door clearance.
   - "Carport in the front setback" check: always shown as **TO CONFIRM with the Prefeitura** (LC 474/2025 and the Piracicaba building code decide whether a covered carport may sit in the front setback and how much of it counts in site coverage). Never mark it as pass.
   - Setback check: the house building line is ≥ 4.0 m (now 5.0) from the street; the carport is excluded but listed.
8. **Update docs/reference/brief.md** with the new front arrangement (short). Add a line to DECISIONS.md.

## Acceptance
- Version 3 opens by default. The street view shows the carport with two cars' spaces, the patio and the entry; the garden view is unchanged from V2.
- Street-level gross area is about 78 m², down from 108.4. The room table and all checks update; every check passes except "Carport in the front setback", which shows TO CONFIRM.
- The support check passes, including the carport.
- Screenshots: `docs/screens/02b-street.png`, `02b-plan-SL.png`.
