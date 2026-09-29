# Casa 123 BIM

A BIM-style web app for designing Alexsandro's family house at Rua Alceu Maynardi Araújo, 123, Nova Piracicaba, Piracicaba/SP. It has a 2D plan and a 3D model that edit ONE shared building model: architecture, structure, plumbing, electrical, finishes, furniture and garden.

## Roles
- **Alexsandro (owner):** not a developer. Explain results in plain language, never as developer instructions.
- **Manager:** a Claude session in the "CASA 123" project. It writes and approves specs and reads `docs/STATUS.md` and `docs/QUESTIONS.md`.
- **You (Claude Code):** the coder. Implement specs marked `Status: ready`, one at a time, using `/next-spec`.

## Source of truth
- Specs: `docs/specs/`. Never change a spec's requirements. If something is wrong or unclear, write it in `docs/QUESTIONS.md` and pick the most reasonable option so you are not blocked.
- Design facts: `docs/reference/` (brief, rules, systems, `plan-v2.json`). The prototype `docs/reference/prototype-studio.html` shows the 2D editing behaviour the family already knows.
- Building data: `model/casa-123.json`. All geometry lives here, in metres.

## Rules
- Units are metres. Use the house-local axes from `plan-v2.json`: x from south to north, y from street to rear, z up. Floor levels come from the model, never hard-coded.
- The 2D plan, the 3D model, schedules and checks are all views of the model. No view keeps its own copy of the geometry.
- Every change goes through undoable commands.
- Stack: Vite + React + TypeScript (strict) + three.js through @react-three/fiber and drei; zustand for state; Vitest for unit tests and Playwright for end-to-end tests. Do not add a backend unless a spec asks for one.
- The UI is in English with metric units. It must be clean, calm and readable on a laptop and on a tablet.
- Before marking a spec done: `npm run build`, `npm test` and `npm run e2e` must all pass. Also save a screenshot of the main view to `docs/screens/<spec-id>.png`.
- After each spec, update `docs/STATUS.md` with what was built, how to see it, known gaps and the next spec. Then commit with a message starting with the spec id.
- Keep this file short. Put long explanations in `docs/`.

## Commands
- `npm install` · `npm run dev` (opens the app at http://localhost:5173) · `npm test` · `npm run e2e` · `npm run build`
