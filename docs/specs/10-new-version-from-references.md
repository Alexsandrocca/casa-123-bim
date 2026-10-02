# 10 — Generate a new design version from reference images
Status: superseded by docs/product/ROADMAP-v2.md (manager, 2026-10-01)

## Goal
The owner selects reference photos (spec 09), gives each a role and a prompt, adds an overall prompt, and gets a **complete new design version of Casa 123** inspired by them:
- walls, room layout and levels;
- facade, roof, windows, materials and colours;
- features;
- plumbing and electrical generated automatically.

It sits on the same lot and obeys the same rules. It is created as a new version next to the existing ones and never overwrites them.

## Be honest in the UI
- A photo of a facade does not show the floor plan behind it. From exterior photos the AI takes **massing, style, roof, window rhythm, materials and colours**.
- The **room layout** always comes from the family brief and the lot, *inspired by* the references.
- Only a **floor-plan image** (role "Layout") is followed for room arrangement, and even then it is adapted to our lot, levels and code.
- Show this as one sentence on the generate screen.

## Requirements
1. **Reference roles:** each selected image gets one or more roles:
   - Facade / massing; Roof; Window & openings; Materials & colours; Interior;
   - Layout (floor-plan image or sketch);
   - Garden; Detail.
   Each image keeps its own prompt (spec 09 note). There is also an overall prompt, e.g. "single-storey feel from the street, more garden, kitchen facing the backyard".
2. **Fixed constraints** sent with every generation (from the model; the user never retypes them):
   - **Lot and site:** lot polygon, slope, north, setbacks (front 4 m, with the house ≥ 5 m behind the carport zone if a carport is kept; rear 6; sides ≥ 1.20 and 1.50 where there are windows); rear-half cut and garden level; north ramp; street services.
   - **Program:** brief.md (family of 5; LL laundry, studio, storage, 1 WC; SL living, kitchen, storage, WC; UF 3 bedrooms with bathrooms; carport for 2 cars; outdoor living).
   - **Structure and rules:** levels and floor-to-floor; steel frame on a regular grid (spans ≤ 6.5 m); code minimums; stair rules.
   - **Locked items:** a checkbox list, e.g. "keep the stair core", "keep the carport", "keep the lower level as is", "keep the north ramp". This lets the owner change only part of the house.
3. **Output format:** the AI returns a **design program** in the same cell format the importer already reads (`docs/reference/plan-v2.json` style), validated by zod:
   - levels with outlines and room cells; doors; windows (with type); stairs (type, position, run direction);
   - roof (type, pitch, eaves); carport and decks;
   - facade materials and colours per side (spec 08 assemblies and spec 09 colours); features;
   - a `design_notes` text explaining the concept and what each reference contributed;
   - a `deviations` list (anything in the prompts it could not satisfy, and why).

   The app then runs the **existing pipeline**: importer → walls → structure generator → stairs → site → default fixtures per wet room and kitchen → plumbing router → electrical defaults (spec 04) → checks.
4. **Self-repair loop:** after generation, run all checks.
   - If there are failures (setbacks, areas, windows, Civil Code 1.301, stair, supports, parking), send the failures back to the AI with the program and ask for a corrected program.
   - At most 3 rounds. Then stop and show the remaining failures clearly. Never hide a failure.
5. **Options:** generate 1–3 alternatives in one go (the user chooses the number; show the cost estimate first in Mode A). Each option becomes a version named "Version N — from references: <short title>".
6. **Compare screen:** the options and any existing version side by side, with:
   - a 3D thumbnail and plans;
   - gross area per level, room table, checks summary, cost estimate (spec 08 if present), and how many references were used.
   Buttons: **Keep** (becomes a normal editable version), **Discard**, **Regenerate with a new prompt**.
7. **Mode A / Mode B** as in spec 09:
   - **Mode A:** the Claude API through the local endpoint. Several images per request, resized. Low temperature for the repair rounds.
   - **Mode B:** the app writes a request folder `generations/<id>/` containing `request.json` (constraints, roles, prompts, selected image ids) and links to the images. The owner tells the manager "generate from references". The manager writes `generations/<id>/option-1.json` … in the same schema. The app imports it and runs the pipeline and the repair check. Repair failures are written to `generations/<id>/failures.json` for the manager's next round.
8. **Traceability:** each generated version stores its source:
   - reference ids with roles and prompts;
   - the overall prompt;
   - the locked items;
   - model or "manager";
   - date and repair rounds.

   Shown in the version's About/Info panel, and exported with the mood board (spec 09).
9. **Safety and sanity:**
   - Reject programs that place rooms outside the buildable area, rooms smaller than 0.8 m, or more than 3 floors.
   - Clamp to 5 cm.
   - Never touch other versions.
   - Generated versions are normal versions (undo, save/open, edit).

## Acceptance
- A test fixture (a hand-written option JSON in `generations/fixture/`) imports into a full version with walls, structure, stairs, plumbing and checks, and shows in the compare screen.
- A fixture with a deliberate setback error produces a `failures.json` and shows the failure in the UI.
- With a key: selecting 2 photos (a facade and a kitchen) plus a prompt produces at least 1 option that passes all checks or lists its failures after ≤ 3 rounds.
- Existing versions are unchanged after generating (test compares the files).
- Screenshots: `docs/screens/10-generate.png`, `10-compare.png`.
