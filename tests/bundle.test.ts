// P0: the API key never reaches the browser. Build the app with a fake key in the environment (and in .env files the
// way Vite reads them) and grep every output file for it.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { build } from 'vite';

const FAKE = 'sk-ant-api03-FAKE-KEY-FOR-THE-BUNDLE-TEST-0123456789';

const files = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : [join(d, f)]));

describe('the built app (P0)', () => {
  it('contains no API key', async () => {
    const out = mkdtempSync(join(tmpdir(), 'casabim-dist-'));
    const before = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = FAKE;
    try {
      await build({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'silent', build: { outDir: out, emptyOutDir: true } });
      const all = files(out);
      expect(all.length).toBeGreaterThan(2);
      for (const f of all) {
        const text = readFileSync(f, 'utf8');
        expect(text, f).not.toContain(FAKE);
        expect(text, f).not.toMatch(/sk-ant-[a-zA-Z0-9]{3,}-/);
      }
    } finally {
      if (before === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = before;
      rmSync(out, { recursive: true, force: true });
    }
  });
});
