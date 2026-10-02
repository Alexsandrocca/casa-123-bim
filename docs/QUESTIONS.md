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

**Manager (2026-10-01):** Accept 3.90 m at the street. The ramp widens to 4.90 m at the rear, and the owner has been told about the 10 cm.

## Q8 (2026-09-29, spec 02b) — Patio steps land in front of car 1
The patio steps (x 3.5–4.7) come down at the house end of parking bay 1. When a car is parked nose-in, the steps are blocked; the grocery route then goes around the car. Options: move the steps to the 0.60 m gap between the bays (x 5.25–5.85, narrow), or park tail-in. **Which do you prefer?**

**Manager (2026-10-01):** Move the patio steps to the north end of the patio, landing on the walkway beside bay 2 (minimum 0.90 m wide). If that clashes with the ramp, use the bay gap and widen it to 0.80 m by shifting the bays. Do not rely on tail-in parking.

## Q9 (2026-09-29, spec 02b) — Carport columns at the street line
The front carport columns stand 0.15 m inside the street boundary, and the gutter overhangs to the boundary. If the Prefeitura requires the carport to stay back from the boundary, the bays get shorter than 5.00 m unless the house moves further back. Linked to the "to confirm" check.

**Manager (2026-10-01):** Keep it as it is. It is part of the Prefeitura TO CONFIRM item; add a note there that the bays shorten if a front setback for the carport is required.

## Q10 (2026-10-01, spec 03) — Rain overflow to the street is too shallow to bury
The front yard is 0.1–0.4 m lower than the street, so for the cistern overflow to reach the street gutter by gravity, the rain collector between the house and the cistern runs only 0–0.1 m below the surface (the "Underground pipes are buried" check warns). Options: (a) raise the entry path about 0.3 m over the pipes, (b) pump the overflow, (c) overflow into an infiltration well on the lot instead of the street. **Which one?**

**Manager (2026-10-01):** Confirmed: option (c). The overflow goes to the garden infiltration trench, not the street. Keep the cistern at the front of the south passage with the lid on a riser.

## Q11 (2026-10-01, spec 03) — Fixtures added that were not in the overlay
The prototype overlay has no basins in the three upper bathrooms and no dishwasher. I added them (basins at the wall next to the stack, dishwasher next to the sink). **Confirm, or say where they go.**

**Manager (2026-10-01):** Confirmed: a basin in each upper bathroom, and the dishwasher beside the sink.

## Q12 (2026-10-01, spec 03) — Heat-pump heater on the entry roof
I put the 300 L heat-pump water heater on the entry roof (+3.70), outdoors and close to the bathrooms, fed by gravity from the roof tanks. The brief does not say where it goes. **Confirm the place.**

**Manager (2026-10-01):** Confirmed: the heat-pump heater stays on the entry roof. Spec 08 must check the roof load (300 L full plus the unit), and the access must be shown as a hatch or a ladder.

## Q13 (2026-10-01, spec 04) — Four or five air conditioners?
The brief says 4 air conditioners; the prototype overlay places 5 (living, studio and the three bedrooms). I followed the overlay. **Is the studio getting one?** (Delete its two units in the Electrical overlay if not.)

**Manager (2026-10-01):** Keep 5. The studio is a working room in Piracicaba heat. The owner can delete it later.

## Q14 (2026-10-01, spec 04) — Roof equipment moved for the solar array
To fit all 12 modules facing north with no winter shade, I moved the two water tanks and the pressure pump to the south edge of the roof (still over the stair) and offset the two sewage vents to come out beside the south parapet. **Fine with the plumbing engineer?**

**Manager (2026-10-01):** Confirmed: tanks and pump on the south band of the roof, vents beside the south parapet. Keep the vents ≥ 0.30 m above the roof and ≥ 1.0 m from any opening (NBR 8160 practice).

## Q15 (2026-10-01, spec 04) — CPFL supply
I assumed CPFL three-phase 127/220 V. If the supply is 220/380 V, the general circuits change to 220 V. **Please confirm with CPFL** (it is already in the "to confirm" list).

**Manager (2026-10-01):** Keep the assumption (127/220 V three-phase) until the owner confirms with CPFL. It stays in the TO CONFIRM list.

## Q16 (2026-10-01, spec 04b) — Bath 3 has no legal place for its basin outlet
Bath 3 is 1.80 × 1.60 m with the shower in the middle. Every wall spot falls in at least one of:
- the shower zone (even with a glass screen);
- the door swing;
- 0.35 m of a water drop;
- next to the stack shaft.

The outlet is flagged "unhosted", and no conduit is drawn to it. Options:
- (a) move the shower to the far corner (x 4.2–5.0);
- (b) use a shaver socket inside the mirror cabinet;
- (c) turn the door swing the other way;
- (d) accept no outlet in Bath 3.

**Which one?**

**Manager (2026-10-01):** Option (a): move the shower to the far corner (x 4.2–5.0) and place the outlet beside the basin. If (a) still fails, use (b), a shaver socket in the mirror cabinet.

## Q17 (2026-10-01, spec 04b) — Shower zone 2 and glass screens
NBR 5410 §9.1 keeps outlets out of volumes 1 and 2 (0.60 m beyond the shower). The bathrooms are too small for that, so where 0.60 m is impossible I assumed a fixed glass screen that bounds volume 2, and kept outlets 0.30 m from it. **Confirm the showers get fixed glass screens.**

**Manager (2026-10-01):** Confirmed: fixed glass screens on all showers.

## Q18 (2026-10-01, spec 04b) — Height rule for the kitchen and the studio
Spec 04b asks for 2.70 m in living rooms and bedrooms and 2.50 m in wet rooms and halls.
- I counted the **kitchen as a wet room (2.50 m)**: it has a 0.32 m lowered ceiling and 2.64 m clear.
- I counted the **studio as a long-stay room (2.70 m)**. Its 0.46 m bulkhead along one wall, only 0.56 m wide, is checked as a bulkhead: 2.20 m, with 2.50 m clear.

**Confirm.**

**Manager (2026-10-01):** Confirmed: kitchen at 2.50 m with its lowered ceiling, studio at 2.70 m with the bulkhead checked as a bulkhead.

## Q10 — answer used for now (spec 04b)
The cistern is now buried at the front of the south passage, with its lid on a riser. Its overflow runs by gravity along the passage to the garden infiltration trench (option c). Nothing goes to the street gutter. **The manager confirms or changes it.**

## Q19 (2026-10-01, spec 08) — Bath 3: the outlet is placed, the shower was not moved
The answer to Q16 was option (a), moving the shower. While doing it I found the real cause: a bug. A bedroom door's swing was being tested *through* the wall into Bath 3. With the bug fixed, the basin outlet has a legal place beside the basin (x 3.29, y 7.80), with the shower where it was.
I did **not** move the shower to x 4.2–5.0: at y 6.6–7.4 it would sit in the swing of the Bath 3 door (y 7.2–7.9 on the same wall). **Keep the shower where it is?**

**Manager (2026-10-02):** Keep the shower where it is. Good catch on the bug.

## Q20 (2026-10-01, spec 08) — The placeholder frame is too small, and the proposed one does not fit the 0.40 m structure depth
The pre-sizing estimates find **10 beams and 5 footings over capacity** in Version 3. The beams were all W250×32.7 and the footings all 1.0 × 1.0 m (spec 02 placeholders). The worst cases:
- the 5.40 m beams that carry walls;
- the 8.60 m edge beam under the 1 m rear overhang of the upper floor (it needs about a W410).

"Use the proposed sizes" (Engineering → Structure) fixes the frame, but the deeper beams and bigger footings leave no room for 7 pipe routes in the crawlspace and the lower-level ceiling (3 clashes with footings). So the committed model keeps the placeholders, and the checks show the two pre-sizing rows as fails. Options:
- (a) deepen the structure zone (floor-to-floor 3.10 → about 3.25 m);
- (b) add columns or secondary beams to shorten the 5.40 m spans and the overhang edge;
- (c) let the structural engineer decide, and keep the estimate rows as they are.

**Which one?**

**Manager (2026-10-02):** (b) Add columns or secondary beams to shorten the 5.40 m spans, and support the 8.60 m rear edge (e.g. a column at x 3.2 under the overhang, landing on the lower-level wall line). Keep the floor-to-floor at 3.10. Re-run the pre-sizing and then apply the proposed sizes if they fit. If (b) still cannot fit, report it and leave the rows red for the engineer (c). Do it as P1 item 0.2.

## Q21 (2026-10-01, spec 08) — CUB: R8-N used, R1-N not found
Sinduscon-SP publishes R8-N for September 2026: **R$ 2,238.58/m²** (read 2026-10-01). I could not find the R1-N value (single house), which is usually higher. The cost uses R8-N, marked TO CONFIRM; the field can be emptied, and the area method then shows "CUB TO CONFIRM". **Confirm R8-N, or give the R1-N value.**

**Manager (2026-10-02):** Use R8-N for now, marked TO CONFIRM. If the R1-N value is found later, switch to it (single-family houses are usually priced with R1).

## Q22 (2026-10-01, spec 08) — Thermal limits and zone
- Zone 2 is the spec's default (TO CONFIRM against NBR 15220-3:2024).
- The exterior-wall limits for zones 3–8 match published summaries of NBR 15575-4:2021 (U ≤ 3.7 or 2.5, CT ≥ 130).
- The zone 1–2 wall limit (U ≤ 2.7) and all the roof limits (NBR 15575-5) are marked "verify".
- Light steel frame passes on U (0.51) but fails CT (≈ 47 < 130): the standard then needs the simulation method.

**Please confirm the zone and the limits.**

**Manager (2026-10-02):** Keep zone 2 and the limits marked 'verify' until the zone is confirmed. LSF failing CT is the correct result: show it as a trade-off in P6 (compare), not as a blocker.

## Q23 (2026-10-01, spec 08) — Every floor bay needs props during the pour
With a 0.95 mm MF-75 deck (2.70 m without props, an assumption), every bay longer than 2.70 m is amber: "needs props". That covers the 3.20–4.10 m spans of all floors and both roofs. That is normal for steel deck, but it is a building cost and a schedule item. **Plan for props, or ask for a 1.25 mm deck (about 3.1 m without props)?**

**Manager (2026-10-02):** Plan for props in the estimate (cost and schedule line). The 1.25 mm deck becomes one of the alternatives in P6 compare.

## Q24 (2026-10-02, P0) — Walls moved in the BIM tab do not go back to the design
The BIM tab still has today's plan editor, so walls, doors and windows can be dragged there too. Those edits change the BIM copy only; the DESIGN tab does not see them, and the next re-approval replaces the rooms, walls and openings with the design's. **Should the BIM tab lock walls, doors and windows (edit them only in DESIGN), or should a wall moved in BIM also move in the design?** For now: BIM edits stay in BIM.

**Manager (2026-10-02):** Lock walls, doors and windows in the BIM tab. Architecture is edited only in DESIGN; BIM shows an 'Edit in DESIGN' button on those elements. One source of geometry. Do it as P1 item 0.1.

## Q25 (2026-10-02, P0) — Engine texts in Portuguese
The buttons, menus, headings and hints switch to Portuguese. The texts the engines write (check rules, sources and values, estimate explanations, device and fixture names, assembly and feature names) stay in English for now: translating them means rewriting several hundred sentences in the engines. **Translate them in P5 (when the BIM tab gets its technical drawings and element cards), or earlier?**

**Manager (2026-10-02):** Translate the engine texts in P5, when the element cards are built.

## Q26 (2026-10-02, P0) — A first project without a lot wizard
"New project" asks for name, address, city, latitude, longitude, lot width and depth and which side the street is on, and draws a simple single-storey house (living and kitchen, bedroom, bathroom). Plumbing for it says "no soil stack yet" until P5. Good enough until P1/P2, or should "New project" wait for the lot wizard?

**Manager (2026-10-02):** Good enough until P1. The P1 wizard replaces this form.

## Q27 (2026-10-02, P0) — AI exchange rate and budget
The AI settings start at US$ 1 = R$ 5,40 and a budget of US$ 20 a month (warning at 80 %, blocked at 100 %, with an "allow going over" switch). **Which budget do you want?**

**Manager (2026-10-02):** Keep US$ 20/month with the 80% warning. The owner can change it in the AI settings.

