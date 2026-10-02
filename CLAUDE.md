# Casa 123 BIM

A BIM-style web app for designing Alexsandro's family house at Rua Alceu Maynardi Araújo, 123, Nova Piracicaba, Piracicaba/SP. It has a 2D plan and a 3D model that edit ONE shared building model: architecture, structure, plumbing, electrical, finishes, furniture and garden.

## Roles
- **Alexsandro (owner):** not a developer. Explain results in plain language, never as developer instructions.
- **Manager:** a Claude session in the "CASA 123" project. It writes and approves specs and reads `docs/STATUS.md` and `docs/QUESTIONS.md`.
- **You (Claude Code):** the coder. Implement specs marked `Status: ready`, one at a time, using `/next-spec`.

## Product direction (from 2026-10-01)
Read `docs/product/ROADMAP-v2.md`. The app becomes a two-tab product: DESIGN (simple, prompt-driven) → Approve → BIM (technical, per discipline) → Outputs. Phases are P0–P8 in `docs/specs/P*.md`. Family first, commercial later: no hard-coded project facts, all UI text in en + pt-BR, secrets only in `.env.local` on the local server, never in the browser.

## Source of truth
- Specs: `docs/specs/`. Never change a spec's requirements. If something is wrong or unclear, write it in `docs/QUESTIONS.md` and pick the most reasonable option so you are not blocked.
- Design facts: `docs/reference/` (brief, rules, systems, `plan-v2.json`). The prototype `docs/reference/prototype-studio.html` shows the 2D editing behaviour the family already knows.
- Building data: `projects/<id>/` (project.json + one model per version, in metres). Casa 123 is `projects/casa-123/`; its generators are in `scripts/casa-123/` (never imported by the app). Test fixture: `tests/fixtures/flat-lot/`.

## Rules
- Units are metres. House axes: y from the street to the rear, x to the right seen from the street, z up; north, latitude, supply and city rules come from `site.region` (`model/orientation.ts`). Level ids, elevations and every place fact come from the model, never from the code.
- The 2D plan, the 3D model, schedules and checks are all views of the model. No view keeps its own copy of the geometry.
- Every change goes through undoable commands.
- Stack: Vite + React + TypeScript (strict) + three.js through @react-three/fiber and drei; zustand for state; Vitest for unit tests and Playwright for end-to-end tests. The local server is `server/` (projects API and the Claude proxy); secrets only in `.env.local`.
- UI text goes through `useT()` (English key, pt-BR in `src/i18n/pt-BR.ts`); metric units. Clean, calm and readable on a laptop and a tablet.
- Before marking a spec done: `npm run build`, `npm test` and `npm run e2e` must all pass. Also save a screenshot of the main view to `docs/screens/<spec-id>.png`.
- After each spec, update `docs/STATUS.md` with what was built, how to see it, known gaps and the next spec. Then commit with a message starting with the spec id.
- Keep this file short. Put long explanations in `docs/`.

## Commands
- `npm install` · `npm run dev` (server + app at http://localhost:5173) · `npm test` · `npm run e2e` · `npm run build`
- Owner launchers: `Open Casa BIM.command` (old name kept), `Add AI key.command`.
