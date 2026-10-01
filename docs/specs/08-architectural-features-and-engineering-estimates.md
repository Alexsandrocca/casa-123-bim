# 08 — Architectural features and engineering estimates
Status: ready

## Goal
Every element shows a reasonable **estimate** of what it really is and needs: wall build-up, column and beam sizes, footing size, loads, thermal and acoustic values, weight and cost. These are not engineering calculations. They are the "rules of thumb" an experienced architect or engineer uses before the real design, so the family can compare options with realistic numbers.

The owner can also place common architectural features (brise-soleil, pergola, cobogó, skylight, etc.) as real elements with their own estimates.

## Principles (show them in the UI)
- Every estimated number carries:
  - **method** (the rule used);
  - **assumptions** (with values the user can edit);
  - **source** (standard or reference);
  - **confidence** (low / medium).
- A small "Estimate" badge sits next to the number. Clicking it opens the explanation.
- Assumptions live in one editable **Engineering assumptions** panel (`model.assumptions`). Changing one updates every estimate at once.
- Anything still unknown is marked **TO CONFIRM** (soil, sewer depth, CUB value).
- About panel and every exported sheet: "Preliminary estimates for design decisions. Structural, thermal and cost values must be confirmed by licensed professionals (ART/RRT)."

## Requirements

### 0. Carry-overs from the 04b review
- Q16 (a): move the Bath 3 shower to the far corner, so its outlet gets a legal place.
- Q8: move the patio steps to the north end of the patio.
- Q12: check the roof load of the heat pump and tanks with the new load model.

### A. Assemblies library (walls, slabs, roofs)
1. An `Assembly` type: an ordered list of layers. Each layer has material, thickness, density, conductivity λ, specific heat and cost/m².
   Computed per assembly:
   - total thickness and weight (kg/m²);
   - **U-value** (W/m²K, with surface resistances);
   - thermal capacity CT (kJ/m²K);
   - estimated acoustic Rw (mass law, plus a table value for drywall and LSF);
   - fire note;
   - cost/m².
2. **Preset assemblies.** Values are typical; put each source in the data file.
   - **Exterior walls:**
     - ceramic block 14 cm + render;
     - concrete block 14 cm + render;
     - light steel frame (cement board + OSB + membrane + 90 mm stud with rock wool + drywall);
     - LSF with external insulation (EIFS-like).
   - **Interior walls:** drywall 95 mm with and without wool; RU (moisture-resistant) drywall for wet areas; ceramic block 9 cm.
   - **Retaining:** reinforced concrete 25 cm + waterproofing + drainage membrane.
   - **Slabs:** steel deck (MF-75 type) with 14 cm concrete, plus finishes.
   - **Roofs:** insulated sandwich metal panel 50 mm; steel deck + waterproofing + XPS + gravel; green roof (extensive).
3. Each wall, slab and roof in the model gets an `assemblyId`; the default comes from its type. Changing the assembly updates its thickness in 2D and 3D, its weight in the loads, and the schedules.
4. **Thermal check (NBR 15575-4/-5, simplified method):** U and CT limits for exterior walls and roofs by bioclimatic zone. The zone is an assumption, default zone 2 (TO CONFIRM against NBR 15220-3:2024). Look up the current limits in the standard summary; if not sure, show the values used with "verify". Absorptance α comes from the colour (spec 05; default 0.5).

### B. Loads and structural pre-sizing (estimates)
1. **Loads (NBR 6120:2019):** editable defaults in kN/m², each with the table reference to verify.
   - **Dead:** computed from the assemblies, plus finishes 1.0 and partitions 1.0 where there are no walls.
   - **Live:** dwelling rooms 1.5, service areas and stairs per the table, veranda/terrace per the table, inaccessible roof per the table, water tanks by volume (2 × 1,000 L, plus 10% for the structure).
   - **Wind:** NBR 6123, basic speed V0 for Piracicaba as an assumption (TO CONFIRM from the isopleth map), used only for a lateral bracing note.
2. **Load path:** slab → beams → columns → footings, by tributary area on the grid. Show it as an overlay: arrows plus the kN at each column base.
3. **Pre-sizing rules** (combination factor 1.4 for all loads, as an estimate):
   - **Steel deck:** maximum unpropped span from a manufacturer-type table (assumption). Flag spans above it, which need props or a thicker deck.
   - **Beams:** depth ≈ span/20 (primary) and span/25 (secondary). Pick the lightest W section from an internal table of Brazilian W profiles (Gerdau W150–W410) that meets the bending stress with fy 345 MPa and deflection ≤ span/350 (NBR 8800 Annex C reference).
   - **Columns:** factored axial load from the tributary areas of all floors above; capacity = χ·A·fy/1.10 with χ from slenderness (story height, K = 1). Pick the lightest W or square HSS that passes.
   - **Footings:** area = service load / allowable soil pressure. Default 150 kPa, marked **TO CONFIRM by SPT**. Square pad size rounded up to 5 cm; depth ≥ 0.40 m.
   - **Retaining walls:** stem thickness ≈ H/10 (min 0.20), base width ≈ 0.6 H, plus drainage. Show the height retained.
   - **Lintels** over openings wider than 1.2 m.
   - **Bracing:** note where diagonal bracing or moment frames are needed (each grid direction needs at least one braced bay), and propose bays that don't block windows.
4. **Utilisation colours** in 3D (green < 0.7, amber 0.7–1.0, red > 1.0) with the governing rule. Changing a span, or moving a wall that carries a slab, updates them live.
5. **Quantities:** steel weight total (kg) and per m² of floor (cross-check against the typical 25–45 kg/m², warning outside), concrete m³, rebar estimate (kg/m³ rule) and formwork m².

### C. Architectural features (placeable parametric elements)
Each feature has its own properties, a 3D model, a 2D symbol, a cost and its effect on the checks:
- **Brise-soleil** (horizontal or vertical slats: depth, spacing, angle, material) on any facade or window. It feeds the solar check.
- **Pergola** (beams, spacing, optional glass or polycarbonate cover or vegetation).
- **Cobogó / hollow-block screen wall** (pattern, opening %). It counts as ventilation, not glazing.
- **Skylight** (fixed or opening). It counts for daylight and stack ventilation; used for bath 3 and the master bath.
- **Eave / roof overhang** (depth; the city limit 0.70 m is checked).
- **Green roof**; **planter** on a facade; **gutter and rain chain**; **louvred shutters (venezianas)** on bedroom windows; **awning over the front door**; **solar water-heater panel** (optional, vs the heat pump).

### D. Environmental principle checks (estimates)
- **Cross-ventilation:** for each long-stay room, openings on two different facades, or through a door to a room that has one. Pass, or tip.
- **Ventilation area:** ≥ half of the required window area is openable (code).
- **Sun on glass:** hours of direct sun on each window on 21 Dec and 21 Jun, using the sun model and all shading (eaves, brises, the UF overhang, trees from spec 06 if present). Warn on west glass without shading.
- **Daylight:** a simple daylight-factor estimate per room (glass area, depth, obstruction). Target ≥ 2% in long-stay rooms.
- **Water heating and solar** already exist in 03/04: show their energy effect in one summary card (estimate).

### E. Cost estimate
- **Method 1, by area:** CUB/m² (Sinduscon-SP, standard R1-N or R8-N as an assumption) × equivalent area (NBR 12721 weights for the veranda, carport, etc.).
  - CUB value: look up the latest published value. If you cannot find it, leave it **TO CONFIRM** with an empty field. Never invent a value.
- **Method 2, by quantities:** assemblies, structure and features × unit costs (editable, with the source and date, e.g. SINAPI-SP). Show both methods side by side with a ±25% range.
- A cost card shows the total, the cost per m², the biggest items, and the difference against the previous snapshot or version.

### F. UI
- New left-toolbar entry **Engineering**: assumptions, loads, structure, assemblies, thermal, cost.
- The properties panel of each element shows its assembly or section, its estimates and the badges.
- **Features** palette for placing features (2D and 3D).
- CSV export: assemblies schedule, structure schedule (members, sections, kg), cost estimate.

## Acceptance
- Switching the exterior walls from ceramic block to LSF changes the wall thickness, weight, U-value, column loads, the footing sizes and the cost, all at once.
- Increasing a slab span past the deck limit turns that bay amber or red, with the reason.
- Adding a brise on the west living window reduces its December sun-hours in the solar check.
- The utilisation overlay, the load path and the cost card each have a screenshot: `docs/screens/08-structure.png`, `08-assemblies.png`, `08-cost.png`.
- Unit tests for U-value, load takedown, section selection and footing sizing, against hand-calculated examples written into the tests.
