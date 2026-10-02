// P0: the local server — project files only inside projects/, AI calls mocked (never a real call in tests),
// usage logged with costs, the monthly budget, and the key never leaving the server.
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleApi, type ApiContext } from '../server/api';
import type { CallClaude } from '../server/ai';
import { Storage } from '../server/storage';

const KEY = 'sk-ant-test-0123456789-SECRET';
let dir: string;
let calls: number;
const fake: CallClaude = async (_cfg, req) => {
  calls++;
  return { text: req.purpose === 'test connection' ? 'ok' : 'hello', usage: { inputTokens: 1000, outputTokens: 500 }, model: 'claude-opus-5-5', stop: 'end_turn' };
};
const ctx = (apiKey: string | null = KEY): ApiContext => ({ storage: new Storage(dir), ai: { apiKey: apiKey ?? undefined, model: 'claude-opus-5-5' }, call: fake });
const api = (c: ApiContext, method: string, url: string, body?: unknown) => handleApi(c, method, url, body);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'casabim-'));
  cpSync(new URL('./fixtures/flat-lot', import.meta.url), join(dir, 'flat-lot'), { recursive: true });
  calls = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('projects API', () => {
  it('lists, reads, duplicates, exports, imports and deletes projects', async () => {
    const c = ctx();
    const list = await api(c, 'GET', '/api/projects');
    expect((list.body as { id: string }[]).map((p) => p.id)).toEqual(['flat-lot']);
    const v1 = await api(c, 'GET', '/api/projects/flat-lot/versions/v1');
    expect((v1.body as { meta: { project: string } }).meta.project).toBe('Flat lot test');
    const dup = await api(c, 'POST', '/api/projects/flat-lot/duplicate', { name: 'Copy of the flat lot' });
    expect(dup.status).toBe(201);
    const id = (dup.body as { id: string }).id;
    expect(id).toBe('copy-of-the-flat-lot');
    const ex = await api(c, 'GET', `/api/projects/${id}/export`);
    const imp = await api(c, 'POST', '/api/projects/import', ex.body);
    expect((imp.body as { id: string }).id).toBe('copy-of-the-flat-lot-2'); // never overwrites
    expect((await api(c, 'DELETE', `/api/projects/${id}`)).status).toBe(200);
    expect((await api(c, 'GET', `/api/projects/${id}`)).status).toBe(404);
  });

  it('refuses paths outside the projects folder and bad ids', async () => {
    const c = ctx();
    expect((await api(c, 'GET', '/api/projects/..%2F..%2Fetc')).status).toBe(400);
    expect((await api(c, 'GET', '/api/projects/../package.json')).status).toBeGreaterThanOrEqual(400);
    expect(() => c.storage.path('..', 'package.json')).toThrow();
    expect((await api(c, 'PUT', '/api/projects/flat-lot/files', { file: '../../evil.json', data: {} })).status).toBe(400);
    expect((await api(c, 'POST', '/api/projects/import', { schema: 'casabim-export/1', project: (await api(c, 'GET', '/api/projects/flat-lot')).body, files: { '../x.json': {} } })).status).toBe(400);
  });

  it('approved snapshots are frozen', async () => {
    const c = ctx();
    const p = (await api(c, 'GET', '/api/projects/flat-lot')).body as { versions: unknown[] };
    await api(c, 'PUT', '/api/projects/flat-lot/files', { file: 'versions/a1.json', data: { x: 1 } });
    await api(c, 'PUT', '/api/projects/flat-lot', { ...p, versions: [...p.versions, { id: 'a1', name: 'Approved 1', kind: 'approved', file: 'versions/a1.json', from: 'v1' }], approvedVersionId: 'a1' });
    expect((await api(c, 'PUT', '/api/projects/flat-lot/versions/a1', { x: 2 })).status).toBe(409);
  });

  it('family projects stay out of git unless asked; the sample project is always in', async () => {
    const c = ctx();
    c.storage.syncGitignore();
    const gi = () => readFileSync(join(dir, '.gitignore'), 'utf8');
    expect(gi()).toContain('!casa-123/');
    expect(gi()).not.toContain('!flat-lot/');
    const p = (await api(c, 'GET', '/api/projects/flat-lot')).body as object;
    await api(c, 'PUT', '/api/projects/flat-lot', { ...p, includeInGit: true });
    expect(gi()).toContain('!flat-lot/');
  });
});

describe('AI proxy (mocked)', () => {
  it('without a key the app answers with how to add it, and never calls the API', async () => {
    const r = await api(ctx(null), 'POST', '/api/ai/test', { project: 'flat-lot' });
    expect(r.status).toBe(503);
    expect((r.body as { code: string }).code).toBe('no-key');
    expect(calls).toBe(0);
    expect(((await api(ctx(null), 'GET', '/api/ai/status')).body as { connected: boolean }).connected).toBe(false);
  });

  it('Test AI connection makes one call and logs date, purpose, tokens and cost', async () => {
    const c = ctx();
    const r = await api(c, 'POST', '/api/ai/test', { project: 'flat-lot' });
    expect(r.status).toBe(200);
    expect((r.body as { reply: string }).reply).toBe('ok');
    expect(calls).toBe(1);
    const lines = readFileSync(join(dir, 'flat-lot', 'ai-usage.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    // 1,000 tokens in at US$ 4/M + 500 out at US$ 20/M = US$ 0.014
    expect(lines[0]).toMatchObject({ purpose: 'test connection', tokensIn: 1000, tokensOut: 500, usd: 0.014 });
    expect(lines[0].brl).toBeCloseTo(0.014 * 5.4, 4);
    expect(lines[0].date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const st = (await api(c, 'GET', '/api/ai/status')).body as { monthUsd: number };
    expect(st.monthUsd).toBeCloseTo(0.014, 6);
  });

  it('the monthly budget warns at 80 % and blocks at 100 % (overridable)', async () => {
    const c = ctx();
    const s = (await api(c, 'GET', '/api/settings')).body as { ai: Record<string, unknown> };
    await api(c, 'PUT', '/api/settings', { ai: { ...s.ai, monthlyBudgetUsd: 0.034 } });
    const chat = () => api(c, 'POST', '/api/ai/chat', { project: 'flat-lot', purpose: 'prompt', messages: [{ role: 'user', content: 'hi' }] });
    await chat(); await chat(); // 0.028 of 0.034 = 82 %
    let st = (await api(c, 'GET', '/api/ai/status')).body as { warn: boolean; blocked: boolean };
    expect(st).toMatchObject({ warn: true, blocked: false });
    await chat(); // 0.042: over
    st = (await api(c, 'GET', '/api/ai/status')).body as { warn: boolean; blocked: boolean };
    expect(st.blocked).toBe(true);
    const blocked = await chat();
    expect(blocked.status).toBe(402);
    expect(calls).toBe(3);
    await api(c, 'PUT', '/api/settings', { ai: { ...s.ai, monthlyBudgetUsd: 0.034, allowOverBudget: true } });
    expect((await chat()).status).toBe(200);
  });

  it('the key never appears in any answer or in the usage log', async () => {
    const c = ctx();
    const answers = [
      await api(c, 'GET', '/api/ai/status'), await api(c, 'POST', '/api/ai/test', { project: 'flat-lot' }),
      await api(c, 'GET', '/api/settings'), await api(c, 'GET', '/api/projects/flat-lot/export'),
    ];
    const text = JSON.stringify(answers) + readFileSync(join(dir, 'flat-lot', 'ai-usage.jsonl'), 'utf8');
    expect(text).not.toContain(KEY);
    expect(existsSync(join(dir, 'settings.json'))).toBe(false); // reading settings writes nothing
  });
});
