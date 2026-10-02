# Product roadmap v2: from first principles (owner, 2026-10-01)
Status: approved by the owner 2026-10-01 (family first, commercial later; Anthropic API key available)

## The product in one paragraph
A person enters their lot, picks a starting design (a common Brazilian house model plus a style, or their own reference photos), and gets a simple, to-scale design they reshape by talking to it ("put the bedrooms upstairs", "make the garage 2 m² smaller"). They see it first as floor plans, then in 3D, where they add colour, plants, a garden, a pool. When they **approve** the design, it moves to the **BIM** tab, where the intelligence lives:
- engineering, materials, estimates;
- electrical (general, CCTV, solar, batteries, EV charging);
- plumbing (water, drainage, sewage, pumps, tanks).

There everything is still editable, but the drawings become **technical drawings** with instructions, and any part can be clicked to ask, change or compare ("steel deck vs. traditional slab"). The final outputs are:
1. realistic images of the finished house;
2. **professional export packages per discipline** (architecture, structure, electrical, plumbing), in the format each engineer expects, ready to be reviewed and signed by a licensed professional (ART/RRT).

## Two tabs, one model
| | **DESIGN** (simple) | **BIM** (technical) |
|---|---|---|
| Who it talks to | the family | the family and later the engineers |
| Shows | clean plans to scale, 3D, colours, garden | technical plans per discipline, symbols, dimensions, notes |
| Numbers | only room names and areas | everything: loads, sections, circuits, DN, slopes, costs |
| Edits | prompts + drag | prompts + click on a part + compare alternatives |
| Gate | **Approve design** → snapshot | **Export package** per discipline |

Both tabs read and write the **same building model**. Going back from BIM to DESIGN is allowed; it re-opens the approval.

## Stages (the user's journey)
1. **Lot.** Address, dimensions or polygon, slope (or survey upload later), orientation, setbacks, and the city rules where known. Street services: sewer and water depth, electricity supply. Unknowns are marked "to confirm" and never block.
2. **Starting point.** Either:
   - **(a)** a typology from a catalogue of common Brazilian houses (single-storey, sobrado, L-shaped, house with edícula, split-level for sloped lots, townhouse) × a style (contemporary, Brazilian modern, rustic/colonial, simple metal roof…) × the family program (bedrooms, suites, garage, office…); or
   - **(b)** reference photos with notes, the old specs 09 and 10, folded in here.
   The platform generates 2–3 options that fit the lot.
3. **Design: floor plans.** A simple, beautiful, to-scale view. A **prompt bar** turns sentences into model changes, previewed before they are applied. Clicking a room or wall puts it in the prompt context ("this room…"). Undo everything.
4. **Design: 3D.** The same, plus prompts for colours, materials, plants, garden, pool, pergola, furniture.
5. **Approve.** A named, frozen snapshot of the approved design.
6. **BIM.** One menu per discipline:
   - **Structure & engineering:** system choice (steel frame + steel deck, concrete + laje treliçada, laje maciça, light steel frame, masonry), pre-sizing, loads, foundations.
   - **Architecture & materials:** wall, floor and roof build-ups, finishes, thermal, acoustics.
   - **Electrical:** general power and lighting, CCTV, solar PV, batteries, EV charging, smart home.
   - **Plumbing:** cold and hot water, sewage, drainage and rain, pumps, tanks, reuse.
   - **Estimates:** quantities, cost, schedule.

   Each discipline shows **technical 2D drawings** with legends and notes in Brazilian (ABNT) conventions. Every element is **named and grouped** (e.g. "Circuit 7 — kitchen outlets", "Sewage branch — Bath 2"). Clicking one opens its card: properties, "why", alternatives, prompt.
   **Compare** takes any system and shows 2–3 alternatives side by side (cost, weight, thickness, time, thermal, maintenance) before switching.
7. **Outputs.**
   - **Images** of the finished house: an accurate render from the model, plus optional AI enhancement for photorealism (clearly labelled).
   - **Packages per discipline:** drawing sheets (PDF + DWG/DXF) with title blocks, IFC, descriptive specification (memorial descritivo), bill of quantities, preliminary calculation report, and an issues/assumptions list.
   - Every sheet is marked **"Preliminary design — for review and signature by a licensed professional (ART/RRT)"**. The engineer still runs their own calculation software; our package gives them everything to start from instead of redrawing.

## What we keep from the current app (no restart)
- **Becomes the engine of the BIM tab:**
  - the building model, commands/undo, versions;
  - the checks, 3D, site, structure, plumbing and electrical routing with physics;
  - the estimates (spec 08).
  - 134 tests.
- **New work:**
  - the DESIGN tab;
  - the lot wizard and the typology catalogue;
  - the prompt-to-change engine;
  - the technical drawing style;
  - per-element cards and compare;
  - the outputs.
- **Must be generalised:** today Casa 123 facts are partly hard-coded (lot, levels, cut, grid). Everything must come from the project's lot and program so any user's lot works. **Casa 123 becomes the first sample project** and our test case.
- Known limitation to address: rooms are rectangles on a grid. Fine for most Brazilian houses. Allow L-shapes via multiple rectangles (already possible). Angled walls are later, if ever.

## Hard truths (to design around, not to hide)
- **Prompting inside the page needs AI at runtime:** a Claude API key on a small server. Without it, only the manager-in-Cowork mode works, which is not real-time.
- **Generating photoreal images needs an image model.** Claude does not generate images. Default to an accurate render of the model (path tracing in the browser, free, faithful). Add an optional AI image step later, from a provider the owner chooses, labelled "illustrative".
- **"Exactly as an engineer would":** we can match the deliverable format (sheets, notes, memorial, quantities, IFC). We cannot replace the engineer's calculation and responsibility. The calculation report is "preliminary"; the signing engineer verifies in their own software (e.g. Eberick/TQS/CYPE for concrete, steel design tools for steel).
- **A platform for other people** (not just Casa 123) adds accounts, data privacy (LGPD), hosting, AI costs per user and legal wording (CAU/CREA: the platform must not present itself as exercising the profession). Decide when to open it to others. Build so it is possible from day one, but launch for one family first.

## New phase list (replaces 05–10)
| Phase | What | Notes |
|---|---|---|
| **P0** | Restructure into two tabs (DESIGN / BIM) + projects list + generalise Casa 123 hard-coding + small AI server (key in `.env.local`) | foundation for all below |
| **P1** | Lot wizard | address, shape, slope, orientation, setbacks, rules, services |
| **P2** | Starting point: typology × style × program → options; or reference photos | folds old 09/10 |
| **P3** | DESIGN plans: simple to-scale plans, click-to-select, prompt bar → previewed changes | the heart of the product |
| **P4** | DESIGN 3D: prompts for colour, materials, garden, pool, furniture; approve gate | folds old 05/06 |
| **P5** | BIM shell: discipline menus, named/grouped elements, element cards, technical drawing style | reuses 03/04/04b/08 |
| **P6** | Compare alternatives (structure systems first: steel deck vs laje treliçada vs maciça) | |
| **P7** | Outputs: renders + discipline packages (PDF/DXF/IFC/memorial/quantities) | folds old 07 |
| **P8** | Platform: hosting, accounts, costs, legal | when the owner decides |

## Workflow (unchanged in principle)
Owner ↔ manager (Cowork) for ideas and decisions → specs → coder (Claude Code, `/next-spec`) → report + screenshots → manager review → Control Room page updated.
One change: from P0 on, every phase ends with a **2-minute demo script** in STATUS (what to click, what to type), so the owner can judge the experience, not only the features.
