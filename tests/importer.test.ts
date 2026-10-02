import { describe, expect, it } from 'vitest';
import { eq, openingSeg, spaceArea, spacesOn, wallSeg, wallsOn } from '../src/model/geometry';
import { extractBase1, type SourcePlan } from '../scripts/casa-123/importer';
import type { Project } from '../src/model/schema';
import { load, ref, space } from './helpers';

const v2 = load('casa-123.json');
const v1 = load('casa-123-v1.json');
const plan2 = (JSON.parse(ref('plan-v2.json')) as { plan: SourcePlan }).plan;
const plan1 = extractBase1(ref('prototype-studio.html'));

/** Room areas exactly as the prototype computes them: the sum of each room's cells. */
function prototypeAreas(plan: SourcePlan, L: 'LL' | 'SL' | 'UF') {
  const m = new Map<string, number>();
  for (const c of plan[L].cells) m.set(c.room, (m.get(c.room) ?? 0) + (c.x1 - c.x0) * (c.y1 - c.y0));
  return m;
}

describe.each([
  ['Version 2', v2, plan2],
  ['Version 1', v1, plan1],
] as [string, Project, SourcePlan][])('importer: %s', (_name, p, plan) => {
  it.each(['LL', 'SL', 'UF'] as const)('room areas on %s match the prototype within 0.05 m²', (L) => {
    const expected = prototypeAreas(plan, L);
    const spaces = spacesOn(p, L);
    expect(spaces.map((s) => s.props.name).sort()).toEqual([...expected.keys()].sort());
    for (const s of spaces) expect(Math.abs(spaceArea(s) - expected.get(s.props.name)!)).toBeLessThan(0.05);
  });

  it('hosts every door and window on a wall of the same level, at the prototype position', () => {
    for (const L of ['LL', 'SL', 'UF'] as const) {
      const src = plan[L];
      const ops = p.elements.filter((e) => e.type === 'Opening' && e.level === L);
      expect(ops).toHaveLength(src.doors.length + src.windows.length);
      for (const op of ops) {
        if (op.type !== 'Opening') continue;
        const host = p.elements.find((e) => e.id === op.props.host);
        expect(host?.type, op.id).toBe('Wall');
        if (host?.type !== 'Wall') continue;
        expect(host.level).toBe(L);
        const s = openingSeg(op, host);
        const hs = wallSeg(host);
        expect(s.a).toBeGreaterThanOrEqual(hs.a - 1e-6);
        expect(s.b).toBeLessThanOrEqual(hs.b + 1e-6);
        const i = Number(op.id.split('-').pop()) - 1;
        if (op.props.role === 'door') {
          const d = src.doors[i]!;
          expect([s.o, s.c, s.a, s.b].map((v) => (typeof v === 'number' ? +v.toFixed(3) : v))).toEqual([d.o, d.c, d.p, +(d.p + d.w).toFixed(3)]);
        } else {
          const w = src.windows[i]!;
          expect([s.o, s.c, +s.a.toFixed(3), +s.b.toFixed(3)]).toEqual([w.o, w.c, w.a, w.b]);
        }
      }
    }
  });

  it('puts exterior walls on the outline and retaining walls along the cut', () => {
    const ll = wallsOn(p, 'LL');
    const retaining = ll.filter((w) => w.props.wallType === 'retaining').map(wallSeg);
    expect(retaining).toContainEqual({ o: 'h', c: 8.5, a: 0, b: 8.6 });
    expect(retaining.filter((s) => s.o === 'v')).toHaveLength(2); // buried parts of the south and north walls
    for (const L of ['SL', 'UF'] as const) {
      expect(wallsOn(p, L).filter((w) => w.props.wallType === 'retaining')).toHaveLength(0);
      expect(wallsOn(p, L).filter((w) => w.props.wallType === 'exterior')).toHaveLength(4);
    }
    for (const w of wallsOn(p, 'SL')) expect(w.props.thickness).toBeGreaterThan(0);
  });
});

describe('importer: Version 2 details', () => {
  it('has the prototype room areas on the street level', () => {
    expect(spaceArea(space(v2, 'SL', 'Kitchen'))).toBeCloseTo(14.04, 2);
    expect(spaceArea(space(v2, 'SL', 'Dining'))).toBeCloseTo(10.8, 2);
    expect(spaceArea(space(v2, 'SL', 'Living'))).toBeCloseTo(16.2, 2);
    expect(spaceArea(space(v2, 'SL', 'Entry · hall'))).toBeCloseTo(16.24, 2);
    expect(spaceArea(space(v2, 'UF', 'Master bedroom'))).toBeCloseTo(18.36, 2);
  });

  it('has the expected wall counts', () => {
    const count = (p: Project, L: string) => wallsOn(p, L).length;
    expect([count(v2, 'LL'), count(v2, 'SL'), count(v2, 'UF')]).toEqual([13, 12, 17]);
    expect([count(v1, 'LL'), count(v1, 'SL'), count(v1, 'UF')]).toEqual([13, 10, 17]);
  });

  it('draws no wall between rooms that are open to each other (same rule as OPEN())', () => {
    // Kitchen, dining and living share one open space; the entry hall is open to the kitchen.
    const sl = wallsOn(v2, 'SL').map(wallSeg);
    expect(sl.some((s) => s.o === 'h' && eq(s.c, 7.6))).toBe(false);
    expect(sl.some((s) => s.o === 'h' && eq(s.c, 9.6))).toBe(false);
    // WC walls are wet walls (0.15 m)
    const wc = wallsOn(v2, 'SL').filter((w) => w.props.wallType === 'wet');
    expect(wc.length).toBeGreaterThan(0);
    for (const w of wc) expect(w.props.thickness).toBe(0.15);
  });

  it('reads levels from the reference, and has stairs, slabs and decks', () => {
    expect(v2.levels.find((l) => l.id === 'SL')?.elevation).toBe(0.6);
    expect(v2.levels.find((l) => l.id === 'LL')?.elevation).toBe(-2.5);
    expect(v2.elements.filter((e) => e.type === 'Stair')).toHaveLength(2);
    expect(v2.elements.filter((e) => e.type === 'Deck').map((e) => e.type === 'Deck' && e.props.name)).toEqual(['Garden', 'Veranda']);
    for (const e of v2.elements) {
      expect(e.id).toBeTruthy();
      expect(e.level).toBeTruthy();
      expect(Array.isArray(e.tags)).toBe(true);
    }
    expect(new Set(v2.elements.map((e) => e.id)).size).toBe(v2.elements.length);
  });
});
