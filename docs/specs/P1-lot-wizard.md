# P1 — Lot wizard
Status: done (2026-10-02)

## Goal
The first step of every project. A friendly, step-by-step wizard (pt-BR first) where anyone describes their lot, even without a survey, and gets a to-scale lot with its **buildable envelope**, its sun, and a clear list of what is still to confirm and with whom.

It replaces the "New project" form from P0. It also opens on existing projects (Casa 123, prefilled) to review or edit the lot.

## Requirements

### 0. Carry-overs (do first)
1. **Q24: lock architecture in BIM.** Walls, doors and windows cannot be dragged in the BIM tab. Clicking one shows its properties read-only, with an **Edit in DESIGN** button that switches tab and selects it.
2. **Q20 (b):** add columns or secondary beams to shorten the 5.40 m spans, and support the 8.60 m rear edge. Re-run the pre-sizing, apply the proposed sizes if they fit the 0.40 m zone, and report the result. If it still doesn't fit, leave the rows red and explain.

### 1. Wizard steps
A left rail shows the steps, a big to-scale canvas sits on the right, and **Back/Next** buttons move between steps. Every field accepts "Não sei / I don't know", which marks it **TO CONFIRM** and fills a sensible default. Nothing blocks moving on.

1. **Address and location**
   - address, city/state, latitude/longitude;
   - a map (Leaflet + OpenStreetMap tiles, with attribution as the OSM policy requires; low request volume) to click the lot's position;
   - the city sets the defaults for rules, utilities, climate zone and sun.
2. **Lot shape**
   - **Presets:** rectangle (front × depth), trapezoid (front, rear, sides; e.g. Casa 123: 14 / 15 / 25 / 25), corner lot (two streets), irregular (side lengths + angles, or a list of corner coordinates).
   - Drag corners on the canvas (5 cm snap).
   - Live area, perimeter and side lengths.
   - Choose which side(s) face the street.
3. **Orientation**
   - North set by a dial ("the street faces…") or taken from the map.
   - Live sun preview: sunrise/sunset directions, the 21 Jun and 21 Dec sun paths drawn over the lot, and the hours of sun per side.
4. **Terrain**
   - Flat / slopes down from the street / slopes up / slopes sideways, with the fall in metres; or the 4 corner heights (bilinear surface).
   - A simple 3D preview of the ground.
   - An "upload a survey later" note: the data model must accept spot heights in the future.
5. **Rules**
   - setbacks (front, rear, each side);
   - max coverage TO, permeability TP, floor-area ratio CA, height limit / number of floors, special notes (e.g. the subdivision's own rules).
   - Defaults come from a small **city rules table**, per city and zone, with source, date and status. For Piracicaba, use the existing values marked TO CONFIRM; unknown cities get empty values marked TO CONFIRM.
   - **Output, live:**
     - the **buildable envelope** drawn on the lot;
     - the maximum footprint (TO), the maximum total built area (CA), the minimum permeable area (TP);
     - the Civil Code 1.50 m window line along the sides.
6. **Street services**
   - sewer (exists? depth), water main (depth), electricity (127/220 or 220/380 V; single- or three-phase), storm drain or gutter, gas (yes/no);
   - each one with **who to ask**, from a utilities table per city (Piracicaba: SEMAE, CPFL Paulista; unknown: "local water/sewer company", "electric utility").
7. **Summary — the lot card**
   - area, envelope, maximum areas, sun summary;
   - **a "to confirm" list grouped by who to ask** (Prefeitura, water/sewer company, electric utility, surveyor, soil test);
   - **Save lot** → stage moves to "Start" (P2, greyed until built).

### 2. Describe your lot in words (AI, optional)
A text box on step 1: *"14 de frente, 15 de fundo, 25 de laterais, cai uns 2 metros para o fundo, a rua fica a leste, Piracicaba"*.
- The AI (local server) returns the **lot fields as typed JSON** (zod).
- The wizard shows them filled in as a preview: **Use these values** / **Edit**. Never apply silently.
- Usage is logged as in P0. Test with a mocked API.

### 3. Data model
`lot` = {
- `polygon` (local metres, origin at the front-left corner, x along the street), `streetEdges[]`;
- `geo` (lat, lon, bearing of x-axis from north);
- `terrain` (type, fall, corner heights; later spot heights);
- `rules` (each value with status GIVEN / CONFIRMED / TO CONFIRM, source, date);
- `services` (each with status and who to ask);
- `notes`
}

- Existing engines (site, sun, setback checks, ground, routing to the street) read only from this.
- For Casa 123, migrate the current site data into it with **no change in results** (the regression test compares checks before and after).

### 4. Editing the lot after a design exists
- Changing the lot re-runs the checks.
- If the house now falls outside the envelope, show it in red on the plan, with a clear message.
- Never move the house automatically.

### 5. Look and language
- Calm, friendly, large inputs, pt-BR default, Brazilian number format.
- Use units in every label (m, m², %).
- Short help text under each step explaining *why* it matters, e.g. "O recuo define onde a casa pode ficar."

## Acceptance
- **Casa 123:** opens in the wizard prefilled. Every engine result is identical to before (regression test). The summary lists the open items: Prefeitura (carport, zone, height), SEMAE (sewer depth), CPFL (voltage), surveyor, soil test.
- **A new lot in under 2 minutes:** typing the Casa 123 sentence in the AI box fills the trapezoid, the slope and the street side correctly (mocked in tests; one manual real call for the screenshot).
- **Corner lot test:** two street sides, setbacks applied to both, envelope correct.
- **Irregular 5-corner lot test:** area matches the shoelace formula.
- **Q24:** BIM cannot drag walls; Edit in DESIGN works.
- **Q20:** result reported in STATUS.
- **Screenshots:** `docs/screens/P1-shape.png`, `P1-rules-envelope.png`, `P1-summary.png`, `P1-ai.png`.
- Demo script in STATUS.
