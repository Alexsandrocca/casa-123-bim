# P0 — Two tabs (DESIGN / BIM), projects, generalisation, AI server
Status: ready

## Context
The owner approved `docs/product/ROADMAP-v2.md` on 2026-10-01: **family first, commercial later**, and **an Anthropic API key is available**. P0 is the foundation for P1–P8. It adds no new design features. It restructures the app so that:
- any lot or project works;
- the journey has its two tabs;
- AI can be called safely.

Everything built in 01–04b and 08 keeps working. It moves into the BIM tab.

## Requirements

### 1. App shell and journey
- **Home = Projects:** list (name, address, stage, last edit, thumbnail), New project, Open, Duplicate, and Delete (with an in-page confirmation step).
  - **Casa 123** is imported as the first project, with all its versions (1, 2, 3) and their edits.
  - Opening the app goes to the last project opened.
- **Inside a project:** a top stepper showing the journey **Lot → Start → Plans → 3D → Approve → BIM → Outputs**. Steps not built yet are shown but disabled, with "coming in P1/P2/…".
- **Tabs:** **DESIGN** and **BIM**.
  - **BIM** = today's app, unchanged in features: plan editor, 3D, plumbing, electrical, engineering, checks.
  - **DESIGN, first version** (P3/P4 will enrich it):
    - **simple plan view:** room fills, names and areas only, walls as clean solid lines, doors and windows; no pipes, devices, dimensions chains or checks bar;
    - **simple 3D view:** shell, roof, site, sun; no structure colours or x-ray;
    - drag walls, doors and windows as today.
    - Same model, different style. Add a **"Design" render style** to both renderers rather than separate code.

### 2. Project data and storage
- `Project` = { id, name, address, `lot`, `program` (empty for now), `style` (empty), `versions[]`, `approvedVersionId`, `stage`, created/updated }.
- **Storage:**
  - on disk under `projects/<id>/` through the local server: `project.json` plus one file per version;
  - the browser cache is only for speed and crash recovery;
  - `projects/casa-123/` is committed;
  - other user projects are git-ignored by default, with a setting to include them. This is family data, so it stays private.
- Save/Open model (JSON) keeps working per version; add **Export project** / **Import project** (a zip, or one JSON with all versions).

### 3. Generalise: no Casa 123 facts in code
- Audit the code for hard-coded Casa 123 values and move every one into project data: lot shape, street side, north, setbacks, levels, cut line and depth, garden level, grid, ramp, carport, utilities depths, CPFL voltage, city, climate zone, sun latitude/longitude.
- List what you moved in DECISIONS.md.
- **Test with a second fixture project** (`tests/fixtures/flat-lot`): flat lot 12 × 30 m, street to the **west**, north to the left, single storey, 3 rooms. Site, 3D, structure generator, plumbing/electrical routing and all checks must run without errors. Results can be simple; nothing may crash or silently assume Casa 123.
- Sun, climate and rules read latitude/longitude and city from the project. For an unknown city, rules show "to confirm".

### 4. Approval gate
- An **Approve design** button on the DESIGN tab (enabled once a version exists) creates a frozen, named snapshot ("Approved 1 — 2026-10-xx") and sets `approvedVersionId`.
- The BIM tab works on the approved version.
- If the design is edited after approval, both tabs show "Changes since approval: N" with options to **Re-approve** (BIM updates) or **Discard changes**.
- For Casa 123: mark Version 3 as approved, so the BIM tab opens exactly as today.

### 5. Local AI server
- A small Node server started by `Open Casa 123.command` (rename the launcher to `Open Casa BIM.command` and keep the old name as an alias). It serves the app in dev and exposes `/api/*`:
  - `/api/projects…`: read and write project files, only inside `projects/`;
  - `/api/ai/chat`: proxy to the Claude API.
- **Secrets:**
  - the key lives in `.env.local` (`ANTHROPIC_API_KEY`), already git-ignored;
  - the model comes from `ANTHROPIC_MODEL` (choose a current model from the Anthropic docs, and put it in `.env.local.example`);
  - the key is never sent to the browser; add a test that greps the build output for it.
- **First run:** if `.env.local` has no key, create the file from the example and ask the owner to paste the key into it **himself**, in a text editor (give exact steps). Never ask him to paste the key into a chat.
- **Usage log:** each call is logged to `projects/<id>/ai-usage.jsonl` with date, purpose, tokens in/out and an estimated cost in USD and BRL (rates as editable settings). A small "AI: connected · this month US$ x" indicator sits in the header. A monthly budget setting warns at 80% and blocks at 100% (overridable).
- **Tests:** mock the API (no real calls in tests). A manual "Test AI connection" button does one tiny real call.

### 6. The command catalogue (groundwork for P3 prompting)
- Expose the existing undoable commands as a **typed catalogue** (name, description, zod schema, human summary): move wall, resize room, rename room, move/resize/flip/add/delete opening, set assembly, add feature, move fixture/device, etc.
- **Dry-run:** apply a list of commands to a copy of the model and return a human-readable diff ("Garage: 27.0 → 25.0 m²; Kitchen wall moved 0.4 m north") plus the checks that change. This is what P3's AI will call.
- Add a hidden dev panel to paste a JSON command list and see the dry-run (tests use it too).

### 7. Ready for commercial later (cheap now, expensive later)
- **All UI text in a strings file with `en` and `pt-BR`.** Translate the visible UI to pt-BR now; English stays available as a toggle. Brazilian Portuguese is the default for new projects.
- **Units:** metric only, Brazilian number format in pt-BR (1.234,56).
- **Legal footer component** on every sheet and export, in both languages:
  - *Estudo preliminar — deve ser revisado e assinado por profissional habilitado (ART/RRT).*
  - *Preliminary design — must be reviewed and signed by a licensed professional (ART/RRT).*
- No personal data in code or tests. Casa 123 data lives only in `projects/casa-123/`.

### 8. Every phase from now on ends with a demo script
At the end of STATUS for each phase: a **2-minute demo script**, 5–8 numbered steps of what to click and type and what the owner should see, so he can judge the experience.

## Acceptance
- **Opening the app:** the Projects home shows Casa 123. Opening it lands on DESIGN with Version 3 in the simple style. The BIM tab shows exactly today's app on the approved Version 3, with all checks as before.
- **Flat-lot fixture:** opens without errors, the sun is correct for its city, and no Casa 123 value appears anywhere (test).
- **Approval:** editing a wall in DESIGN after approval shows "Changes since approval: 1"; Re-approve updates BIM; Discard restores.
- **AI:** with a key, "Test AI connection" works and logs usage. Without a key, the app runs and explains how to add it. The key never appears in the bundle.
- **Dry-run:** a pasted `[resize room Garage −2 m²]`-style command list shows a correct diff and does not change the model until applied.
- **Language:** the pt-BR toggle switches the whole visible UI.
- **Screenshots:** `docs/screens/P0-home.png`, `P0-design.png`, `P0-bim.png`, `P0-flat-lot.png`.
- The demo script is in STATUS.
