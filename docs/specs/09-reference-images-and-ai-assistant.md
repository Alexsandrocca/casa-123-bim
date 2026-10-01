# 09 — Reference images board with AI analysis
Status: ready

## Goal
The owner uploads photos of real houses and details (facades, paint colours, interiors, roofs, floors, gardens), adds a note or a prompt to each, and gets:
1. a tidy **reference board** organised by topic;
2. an **analysis** of each image: style, materials, colours, proportions and construction notes;
3. **proposed changes to the Casa 123 model**, which the owner accepts or rejects one by one.

The AI never changes the model by itself.

## Two ways to analyse (both required)
- **Mode A, built-in AI** (needs an Anthropic API key, billed separately from the Claude subscription):
  - The app sends the image and prompt to the Claude API through a small local server endpoint (never from the browser directly).
  - The key is read from `.env.local` (`ANTHROPIC_API_KEY`). It is git-ignored and never shown in the UI or sent to the browser.
  - The model id comes from `.env.local` (`ANTHROPIC_MODEL`). Check the Anthropic docs for a current vision-capable model, and put it in `.env.local.example`.
  - Show the estimated cost per analysis.
- **Mode B, ask the manager** (no key, uses the owner's Claude subscription):
  - Images and prompts are saved to disk in `references/`.
  - The owner tells the manager (Claude in Cowork) "analyse new references". The manager writes `references/<id>/analysis.json` in the same schema.
  - The app picks it up (file watcher in dev, or a Refresh button).
  - Status per image: "waiting for analysis", "analysed".

## Requirements
1. **Storage on disk** (the repo folder, so the manager and git can see it):
   - `references/<id>/` holds `image.<ext>` (resized copy, longest side 2,000 px, EXIF location stripped), `thumb.webp` and `meta.json`.
   - `meta.json` holds: title, category, tags, the owner's note/prompt, the date, and links to model elements.
   - Writing to disk goes through a local dev-server endpoint (a Vite middleware or a tiny Node server started by `Open Casa 123.command`). Only allow writes inside `references/`; validate type (jpg/png/webp/heic converted) and size (≤ 20 MB).
   - Add `references/` to git. Image files go through Git LFS if it is available; otherwise commit them normally and note the size in STATUS.
2. **Upload:** drag-and-drop or a button; several files at once; paste from the clipboard; from a phone on the same Wi-Fi if easy (otherwise skip and note it).
3. **Categories:** Facade / architecture, Roof, Paint & colour, Exterior materials, Interior design, Kitchen, Bathroom, Floors, Lighting, Garden & landscape, Details (railings, frames, stairs), Other. Free tags as well.
4. **Board UI:** a new **References** tab with a masonry grid, filter by category and tag, and a full view with the note, analysis and proposals. Compare two images side by side. Pin an image to a room, element or facade; pinned images show as small thumbnails in that element's properties.
5. **Local analysis (no AI, always available):**
   - **Colour palette:** the 5–8 dominant colours by k-means in Lab space, with hex, RGB and the closest colours from a small built-in list of common Brazilian paint references.
     - Store only names and hex in a JSON file, with the note "approximate match, check the physical colour chart".
     - Label the list as approximate. If unsure about brand codes, use generic names.
   - **Eyedropper:** click on the image to pick a colour.
   - **Light reflectance value (LRV)** estimate per colour, and solar absorptance α for the thermal check in spec 08. Dark facades are hotter.
6. **AI analysis (Mode A or B), structured JSON validated with zod.** Store it in `analysis.json`:
   - `style` (name, short description, key features);
   - `materials` (each: element, material, finish, confidence);
   - `colours` (each: element, hex, name);
   - `proportions` (window-to-wall ratio, roof type and pitch, eave depth estimate);
   - `construction_notes` (how it is likely built, maintenance and climate suitability for Piracicaba);
   - `cost_level` (low / medium / high);
   - `applicable_to_casa123` (what fits our house and what doesn't, and why);
   - `proposals`: a list of **model commands**.
7. **Proposals → model** (always through the existing undoable commands):
   - **Allowed command types:**
     - set a surface colour or material (the spec 05 library if present; otherwise a simple `finish.color` property per surface, which spec 05 will adopt);
     - set an assembly (spec 08);
     - add or modify an architectural feature (brise, pergola, cobogó, eave, skylight, railing type, roof type);
     - apply a style preset (spec 05, when present).
   - **Not allowed** on an existing version: moving walls, changing rooms, plumbing or electrical. (Whole new layouts come from spec 10, which creates a new version.) The AI may describe such ideas as text "suggestions for the manager" only.
   - Each proposal shows a before/after preview (3D snapshot) with **Accept** / **Reject**. Accept all is one undo step.
8. **Prompt context sent to the AI:**
   - the owner's note;
   - a compact summary of the current model: style, facade materials, colours, features, climate assumptions;
   - the allowed command schema;
   - the instruction to prefer low-maintenance solutions suited to a hot, humid, sunny climate, and to explain trade-offs in plain language.
   - Never send personal data. Strip EXIF before upload.
9. **Mood board export:** a PDF or PNG page per category with images, palettes and notes, to share with the architect.
10. **CLAUDE.md:** add one line saying the app now has a local server endpoint for references and AI, and that secrets live only in `.env.local`.

## Acceptance
- Uploading 3 photos (a facade, a paint colour, a kitchen) saves them under `references/`, shows them in the board, and extracts a palette for each without any key.
- With a key, "Analyse" returns a valid analysis and at least one proposal. Accepting it changes the 3D model, and Undo reverts it.
- Without a key, the image shows "waiting for analysis". A hand-written `analysis.json` (fixture in tests) is picked up and its proposals work.
- The key never appears in the browser bundle (test: grep the build output).
- Screenshots: `docs/screens/09-board.png`, `09-analysis.png`, `09-proposal.png`.
