import { describe, expect, it } from 'vitest';
import { runChecks } from '../src/model/checks';
import type { Element, Project } from '../src/model/schema';
import { groundAt, siteFrame } from '../src/model/site';
import { checkSupport } from '../src/model/support';
import { load } from './helpers';

const v2 = load('casa-123.json');
const v1 = load('casa-123-v1.json');
const without = (p: Project, keep: (e: Element) => boolean): Project => ({ ...p, elements: p.elements.filter(keep) });
const unsupported = (p: Project) => checkSupport(p).unsupported.map((e) => e.id);

describe('generated structure', () => {
  it('has columns on the grid, piers under the raised floor, beams and footings', () => {
    const cols = v2.elements.filter((e) => e.type === 'Column');
    expect(cols.filter((c) => c.type === 'Column' && c.props.kind === 'column')).toHaveLength(15);
    expect(cols.filter((c) => c.type === 'Column' && c.props.kind === 'pier').length).toBeGreaterThan(0);
    for (const c of cols) {
      if (c.type !== 'Column') continue;
      expect(v2.grid.x.some((g) => Math.abs(g - c.props.at[0]) < 1e-6)).toBe(true);
      expect(c.props.topElevation).toBeGreaterThan(c.props.baseElevation);
      expect(v2.elements.some((f) => f.type === 'Footing' && f.props.carries === c.id)).toBe(true);
    }
    // retaining walls stand on strip footings
    for (const w of v2.elements) if (w.type === 'Wall' && w.props.wallType === 'retaining') {
      expect(v2.elements.some((f) => f.type === 'Footing' && f.props.kind === 'strip' && f.props.carries === w.id)).toBe(true);
    }
    // no beam runs across the garage door (street-level floor beams stop at the garage)
    const across = v2.elements.filter((b) => b.type === 'Beam' && b.props.elevation < 1 && b.props.start[1] === 0 && b.props.end[1] === 0 && b.props.end[0] > 3.3);
    expect(across).toHaveLength(0);
  });

  it('models the ground: street 0.00, garden −2.55 behind the cut, a 12.5 % ramp on the north side', () => {
    const f = siteFrame(v2);
    expect(groundAt(v2, 4, f.yStreet + 0.01)).toBeCloseTo(0, 1);
    expect(groundAt(v2, 4, 18)).toBeCloseTo(-2.55, 5);
    const r1 = groundAt(v2, 10, 0), r2 = groundAt(v2, 10, 4);
    expect((r1 - r2) / 4).toBeCloseTo(0.125, 3);
  });
});

describe('support check (nothing floats)', () => {
  it('passes on Version 2 and Version 1', () => {
    expect(unsupported(v2)).toEqual([]);
    expect(unsupported(v1)).toEqual([]);
    expect(runChecks(v2).find((c) => c.id === 'support:all')!.status).toBe('pass');
  });

  it('flags a column whose footing is removed, and what it alone carried', () => {
    const p = without(v2, (e) => !(e.type === 'Footing' && e.props.carries === 'col-13'));
    expect(unsupported(p)).toContain('col-13');
    expect(runChecks(p).find((c) => c.id === 'support:all')!.status).toBe('fail');
  });

  it('flags a floor slab when its beams are removed, and the walls standing on it', () => {
    const p = without(v2, (e) => !(e.type === 'Beam' && e.level === 'UF'));
    const u = unsupported(p);
    expect(u).toContain('UF-slab-01');
    expect(u.some((id) => id.startsWith('UF-wall'))).toBe(true);
  });

  it('flags a slab lifted off its beams and a deck with nothing under it', () => {
    const p: Project = {
      ...v2,
      elements: v2.elements.map((e) => (e.id === 'roof-slab-01' && e.type === 'Slab' ? { ...e, props: { ...e.props, topElevation: 7.8 } }
        : e.type === 'Deck' && e.props.name === 'Veranda' ? { ...e, props: { ...e.props, elevation: 1.5 } } : e)),
    };
    const u = unsupported(p);
    expect(u).toContain('roof-slab-01');
    expect(u.some((id) => id.startsWith('SL-deck'))).toBe(true);
  });

  it('flags a stair that does not reach its upper floor', () => {
    const p: Project = { ...v2, elements: v2.elements.map((e) => (e.type === 'Stair' && e.id === 'stair-01' ? { ...e, props: { ...e.props, toLevel: 'roof' } } : e)) };
    expect(unsupported(p)).toContain('stair-01');
  });

  it('checks the eaves against the 0.70 m city limit', () => {
    const p: Project = { ...v2, elements: v2.elements.map((e) => (e.id === 'roof-slab-01' && e.type === 'Slab' ? { ...e, props: { ...e.props, eaves: 0.9 } } : e)) };
    expect(runChecks(v2).find((c) => c.id === 'eaves:roof-slab-01')!.status).toBe('pass');
    expect(runChecks(p).find((c) => c.id === 'eaves:roof-slab-01')!.status).toBe('fail');
  });
});

describe('migration', () => {
  it('adds the structure to a model saved before spec 02, keeping room edits', async () => {
    const { migrate } = await import('../src/model/migrate');
    const { moveWall } = await import('../src/model/commands');
    const edited = moveWall('SL', 'h', 7.6, 6, 7.1).apply(v2);
    const old: Project = { ...edited, elements: edited.elements.filter((e) => !['Column', 'Beam', 'Footing'].includes(e.type)) };
    const m = migrate(old, v2);
    expect(m.elements.filter((e) => e.type === 'Column').length).toBeGreaterThan(0);
    const k = m.elements.find((e) => e.type === 'Space' && e.props.name === 'Kitchen');
    expect(k?.type === 'Space' && k.props.cells[0]!.y1).toBeCloseTo(7.1, 5);
    expect(migrate(v2, v1)).toBe(v2);
  });
});
