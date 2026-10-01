# Questions for the manager / owner

_Claude Code adds questions here instead of stopping. The manager answers below each one._

## Q1 (2026-09-29, spec 01) — Which side boundary takes the extra metre at the rear?
The lot is 14 m at the street and 15 m at the rear. I assumed the south boundary is square to the street and the north boundary is the slanted one. This only moves the north distances by up to 1 m (the north-side checks pass either way). **Please confirm with the lot survey.**

**Manager (2026-09-29):** Keep the south boundary square to the street and the extra metre on the north, until the topographic survey says otherwise.

## Q2 (2026-09-29, spec 01) — How much of the lower-level side walls is buried?
The brief says the retaining walls include "the buried part of the north and south LL walls" but gives no length. I used y 8.5–10.5 on the south and y 8.5–8.9 on the north, because windows start at 10.8 (laundry) and 9.0 (studio). The real length depends on the side ground levels (south passage and north ramp), which we do not have yet. **Please give the side ground levels, or confirm these lengths.**

**Manager (2026-09-29):** Keep your lengths for now. They get replaced when the survey gives the side ground levels. Keep them as parameters in `site.cut`.

## Q3 (2026-09-29, spec 01) — South passage 1.50 m or 1.92 m?
The brief says the south side passage is 1.50 m and the north ramp 4.0 m. `plan-v2.json` puts the house 1.92 m from the south boundary, which leaves about 3.5–4.5 m on the north. I used plan-v2.json (1.92 m). **Which one is right?**

**Manager (2026-09-29):** Use **1.50 m** on the south, not 1.92. Civil Code art. 1.301 forbids windows closer than 1.50 m to the boundary, and Version 2 has south windows: WC, pantry, laundry, bedroom 2 and the stair. Move the house to x = 1.50 on the lot. That leaves the north ramp about 3.90 m wide at the street and 4.90 m at the rear; the owner asked for 4 m, so flag the missing 10 cm in STATUS. Done as item 0.1 of spec 03.

## Q4 (2026-09-29, spec 02) — The down flight crosses the retaining wall at the cut
In Version 2 the down flight starts at y 8.2 on the street level and goes over the cut line (y 8.5), where the lower level's front retaining wall stands. The app notches the wall under the flight, so the model is consistent, but the engineer must detail how the retaining wall steps down under the stair (or the flight must start behind the cut line). **Please flag this for the architect/engineer.**

**Manager (2026-09-29):** Accepted. Keep the notch, and add a note on the element: the ground there is at about −1.0, so the retained soil stays well below the flight (tread about +0.38 at y 8.5). Under the stair opening, the lower-level front wall stops under the flight soffit, with a lintel beam over it. The engineer will detail this. List it in the future `docs/HANDOFF.md`.

## Q5 (2026-09-29, spec 02) — North ramp: from the street or from the house front?
A 12.5 % ramp from −0.32 at the house front would only reach the garden at y ≈ 17.8, and would pass above the studio window. I started it at the street (0.00 at the sidewalk), so it reaches the garden at y ≈ 16.4 and stays below the studio window sill. It is also only 3.5–4.5 m wide there (see Q3). **Is that the intended ramp?**

**Manager (2026-09-29):** Yes. The ramp starts at the street at 0.00, as you did.

## Q6 (2026-09-29, spec 02) — Garage roof and lower-level roof
The front of the street level (garage and entry, y 0–5) has no floor above, so I gave it a flat roof at +3.70 with a 0.30 m parapet (reserved for 6 more solar modules). In Version 1 the lower-level roof behind the street level has no veranda, so it got a parapet too. **Confirm, or say if these should be terraces with guards instead.**

**Manager (2026-09-29):** Confirmed. The garage roof is flat at +3.70 with a 0.30 m parapet, reserved for 6 solar modules. Version 1's lower-level roof with a parapet is fine.


## Q7 (2026-09-29, spec 02b) — North ramp is 3.90 m at the street, not 4.00 m
With the house 1.50 m from the south boundary, the north strip is 3.90 m wide at the street and 4.90 m at the rear (4.66 m at the back of the house). The owner asked for 4 m. **Accept 3.90 m at the street, or narrow the house / widen the ramp only behind the carport?**

## Q8 (2026-09-29, spec 02b) — Patio steps land in front of car 1
The patio steps (x 3.5–4.7) come down at the house end of parking bay 1. When a car is parked nose-in, the steps are blocked; the grocery route then goes around the car. Options: move the steps to the 0.60 m gap between the bays (x 5.25–5.85, narrow), or park tail-in. **Which do you prefer?**

## Q9 (2026-09-29, spec 02b) — Carport columns at the street line
The front carport columns stand 0.15 m inside the street boundary, and the gutter overhangs to the boundary. If the Prefeitura requires the carport to stay back from the boundary, the bays get shorter than 5.00 m unless the house moves further back. Linked to the "to confirm" check.

## Q10 (2026-10-01, spec 03) — Rain overflow to the street is too shallow to bury
The front yard is 0.1–0.4 m lower than the street, so for the cistern overflow to reach the street gutter by gravity, the rain collector between the house and the cistern runs only 0–0.1 m below the surface (the "Underground pipes are buried" check warns). Options: (a) raise the entry path about 0.3 m over the pipes, (b) pump the overflow, (c) overflow into an infiltration well on the lot instead of the street. **Which one?**

## Q11 (2026-10-01, spec 03) — Fixtures added that were not in the overlay
The prototype overlay has no basins in the three upper bathrooms and no dishwasher. I added them (basins at the wall next to the stack, dishwasher next to the sink). **Confirm, or say where they go.**

## Q12 (2026-10-01, spec 03) — Heat-pump heater on the entry roof
I put the 300 L heat-pump water heater on the entry roof (+3.70), outdoors and close to the bathrooms, fed by gravity from the roof tanks. The brief does not say where it goes. **Confirm the place.**
