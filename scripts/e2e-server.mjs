// End-to-end tests run the real server on a copy of the projects folder, so they never change the committed projects.
import { cpSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
const dir = 'test-results/e2e-projects';
rmSync(dir, { recursive: true, force: true });
cpSync('projects', dir, { recursive: true });
// no key in tests: the AI calls are mocked in unit tests and the e2e checks the "no key" path
const child = spawn('npx', ['tsx', 'server/index.ts', '--port=5174'], { stdio: 'inherit', env: { ...process.env, PROJECTS_DIR: dir, CASABIM_NO_AI: '1' } });
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
