# Hand-off to the architect and engineers

_Items the app cannot decide. Each one is also a note on the element in the model (properties panel, "Notes for the architect and engineers")._

## Structure
1. **Down flight over the cut line (LL-wall-01, stair-02).** In Versions 2 and 3 the down flight passes over the cut line (y 8.50), x 1.70–3.20. The ground there is at about −1.00, so the retained soil stays well below the flight (tread about +0.23 at y 8.50). Under the stair opening the lower-level front wall stops under the flight soffit, with a lintel beam over it. To be detailed by the structural engineer. (QUESTIONS Q4)
2. Column, beam and footing sizes in the model are placeholders (W200 columns, W250 beams, 1.0 m pads). Real sizes come from the structural design (NBR 8800) and the SPT soil borings (NBR 6122).

## Plumbing (spec 03)
3. **Lower level needs the lift station** unless SEMAE confirms the street sewer is at least about 3.4 m deep. The app recomputes when the depth is entered (Plumbing → Street services).
4. **Cistern overflow (spec 04b, Q10 option c for now).** The cistern is buried at the front of the south passage (lid on a riser) and overflows by gravity along the passage to the garden infiltration trench, not to the street gutter.
5. Routing, DN, slopes and pressures in the app are a design check, not the executive project. The plumbing engineer signs the project (ART/RRT).

## Site
6. Carport in the front setback — to confirm with the Prefeitura (LC 474/2025). (Q9)
7. Design rainfall 150 mm/h — to confirm from the local rainfall curve.

## Electrical (spec 04)
8. Circuit grouping, cable sections, breakers and RCDs in the app are a design pre-check (NBR 5410), not the executive project. The electrical engineer signs the project and confirms the CPFL supply (127/220 V assumed).
9. Roof layout (spec 04b): the roof has a south equipment band (tanks, pressure pump, two AC condensers, roof drains, rear stack vent; roof hatch from the upper hall) and a north solar zone with the 12 modules (Q14).
10. Solar energy is a PVGIS-like estimate; the installer confirms production and the inverter/battery choice.

## Services that obey the building (spec 04b)
11. **Beam web holes, 19 in all.** Each is ≤ 0.4 × the beam depth and in the middle third of the span; they are listed in Checks → MEP physics → "Beam web holes".
    - beam-23: water from the hall to the kitchen and baths;
    - beam-13 (y 8.50): the dining ceiling;
    - beam-11 (y 5.00);
    - beam-19 (x 3.20, lower level): the lift-station line;
    - beam-26 (roof): the rear stack vent.

    The structural engineer confirms or relocates each one.
12. **Sleeves through the retaining wall at the cut line (y 8.50)**, above the retained ground (about −1.0): the sewage collector, the lower-level water and the sub-panel feeder. Detail with the structure.
13. **Roof tanks** stand in the south band over beam-17 and the stair. Spec 08 checks the load.
14. **Pipes on facades:** downpipes from the entry roof and the carport, and the lift-station vent on the south facade, on brackets.
15. **Rules to verify:**
    - conduits 0.20 m clear of hot water (project rule);
    - hanger spacing (PVC ≈ 10 × DN);
    - shower volumes with fixed glass screens (Q17).
16. **Bath 3 basin outlet:** no legal place (Q16).
