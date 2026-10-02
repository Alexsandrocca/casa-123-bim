// P0: every UI text has its Brazilian Portuguese translation, with the same placeholders.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fmtNum, translate } from '../src/i18n';
import { PT } from '../src/i18n/pt-BR';

const dir = new URL('../src/ui/', import.meta.url);
/** Literal keys passed to t(...) in the UI (the developer panel is English on purpose). */
function uiKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.tsx') && x !== 'DevPanel.tsx')) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    for (const m of src.matchAll(/\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)) keys.set(m[2]!.replace(/\\(['"\\])/g, '$1'), f);
    for (const m of src.matchAll(/\bt\(\s*`([^`$]*)`/g)) keys.set(m[1]!, f);
  }
  return keys;
}

describe('UI language (P0)', () => {
  it('every t() key in the UI has a pt-BR translation', () => {
    const keys = uiKeys();
    expect(keys.size).toBeGreaterThan(150);
    const missing = [...keys].filter(([k]) => PT[k] === undefined).map(([k, f]) => `${f}: ${k}`);
    expect(missing).toEqual([]);
  });

  it('translations keep their placeholders', () => {
    for (const [en, pt] of Object.entries(PT)) {
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(ph(pt), en).toEqual(ph(en));
    }
  });

  it('numbers follow the language', () => {
    expect(fmtNum('pt-BR', 1234.56)).toBe('1.234,56');
    expect(fmtNum('en', 1234.56)).toBe('1,234.56');
    expect(translate('en', 'Changes since approval: {n}', { n: 1 })).toBe('Changes since approval: 1');
    expect(translate('pt-BR', 'Changes since approval: {n}', { n: 1 })).not.toContain('Changes');
  });
});
