---
description: Implement the next spec marked "Status: ready" in docs/specs, test it, update STATUS.md and commit. Use when the owner says "next spec", "check new updates on specs" or "continue".
---

# /next-spec

1. Read `CLAUDE.md`, `docs/STATUS.md`, `docs/QUESTIONS.md` and `docs/DECISIONS.md`.
2. List `docs/specs/*.md`. Pick the lowest-numbered spec whose header says `Status: ready`. If none is ready, say so in one sentence, show the owner the list of specs and their statuses, and stop.
3. Change that spec's header to `Status: in progress`. Read every reference file the spec lists.
4. Plan the work as a checklist from the spec's acceptance criteria. Implement it in small steps and commit after each meaningful step.
5. Verify:
   - `npm run build`, `npm test` and `npm run e2e` all pass.
   - Every acceptance criterion is checked, with a test where possible.
   - A screenshot is saved to `docs/screens/<spec-id>.png`.
6. Change the spec header to `Status: done (YYYY-MM-DD)`. Update `docs/STATUS.md`:
   - what was built, in plain language;
   - how to see it;
   - what is not done yet;
   - open questions.
   Append any decisions you made to `docs/DECISIONS.md`, one line each with the reason.
7. Commit with the message `<spec-id>: <summary>`. Push only if a git remote exists.
8. Tell the owner, in at most 6 plain sentences:
   - what changed;
   - how to open it (`npm run dev`, then http://localhost:5173);
   - what the manager should review.
9. If another spec is `ready`, ask whether to continue with it. Do not start it automatically.

Never edit a spec's requirements. If a requirement is impossible or unclear, write the problem in `docs/QUESTIONS.md`, choose the safest reasonable option, record it in `DECISIONS.md`, and continue.
