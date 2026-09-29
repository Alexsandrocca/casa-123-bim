# Casa 123 BIM: how to run the coder (Claude Code)

## One-time setup
1. Open **Terminal** (Applications → Utilities → Terminal).
2. Install Claude Code by pasting this line and pressing Enter:
   `curl -fsSL https://claude.ai/install.sh | bash`
3. Close Terminal and open it again.

## Each work session
1. In Terminal, type `cd ` (with a space after it), drag the **casa-123-bim** folder into the Terminal window, and press Enter.
2. Type `claude` and press Enter. (Alternative: in the Claude desktop app, open the **Code** tab, choose the casa-123-bim folder, and type there.)
3. The first time only, paste this message:
   > You are the coder for this project. First copy setup/next-spec-SKILL.md to .claude/skills/next-spec/SKILL.md. Then read CLAUDE.md and docs/specs/00-roadmap.md, and implement the next ready spec by following that skill.
4. After that, just type: `/next-spec`
5. When it finishes, it tells you how to see the result. Usually you type `npm run dev` in a second Terminal window in the same folder, then open http://localhost:5173 in your browser.
6. If it asks permission for something, it is safe to allow edits inside this folder and `npm` / `git` commands. Say no to anything outside the folder.

## Talking to the manager
Go back to the Claude "CASA 123" project and say something like "check the status of casa-123-bim". The manager then:
- reads docs/STATUS.md and docs/QUESTIONS.md;
- reviews the screenshots in docs/screens;
- answers the questions;
- marks the next spec as ready.
