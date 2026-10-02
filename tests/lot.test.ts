// P1: the lot (site.lot) — the move with no change in results, the envelope, areas, terrain and the to-confirm list.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runChecks } from '../src/model/checks';
import { defaultLot, regionFor, rulesFor } from '../src/model/cities';
import { edgeRoles, envelope, lotFigures, naturalAt, polyArea, toConfirm, windowLines, type P2 } from '../src/model/lot';
import { upgradeRaw } from '../src/model/migrate';
import { parseProject, type Lot, type NumFact } from '../src/model/schema';
import { starterModel } from '../src/model/starter';
import { digest } from './regression-digest';

const json = (f: string) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));
const BEFORE = json('./fixtures/p1-regression/before.json') as Record<string, Record<string, unknown>>;
const OLD_SITES = json('./fixtures/p1-regression/sites-before.json') as Record<string, unknown>;
const CASA = { 'casa-v1': 'v1', 'casa-v2': 'v2', 'casa-v3': 'v3' } as const;

const fact = (value: number | null, status: NumFact['status'] = 'given'): NumFact => ({ value, status, source: 'test', date: '2026-10-02' });
const lotWith = (polygon: P2[], streetEdges: number[], sb: { front: number; rear: number; left: number; right: number }): Lot => {
  const l = defaultLot('Testópolis', 'XX');
  return { ...l, polygon, streetEdges, rules: { ...l.rules, setbacks: { front: fact(sb.front), rear: fact(sb.rear), left: fact(sb.left), right: fact(sb.right) } } };
};
const close = (a: P2[], b: P2[]) => {
  expect(a).toHaveLength(b.length);
  for (const p of b) expect(a.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-6), JSON.stringify(p)).toBe(true);
};

describe('P1 regression: Casa 123 gives the same results with the lot in site.lot', () => {
  for (const [key, v] of Object.entries(CASA)) {
    it(`${key}: the migrated model gives every engine result as before (checks, ground, sun, 3D, systems, estimates)`, () => {
      const p = parseProject(json(`../projects/casa-123/originals/${v}.json`));
      expect(digest(p)).toEqual(BEFORE[key]);
    });
    it(`${key}: a model saved before P1 is moved into site.lot on opening, with the same results`, () => {
      const now = json(`../projects/casa-123/originals/${v}.json`);
      const old = { ...now, site: OLD_SITES[key] };
      const p = parseProject(upgradeRaw(old));
      expect(digest(p)).toEqual(BEFORE[key]);
      expect(p.site.lot.polygon).toEqual([[0, 0], [14, 0], [15, 25], [0, 25]]);
    });
  }
});

describe('P1 lot geometry', () => {
  it('a rectangle: area, sides, roles and the envelope inside the setbacks', () => {
    const lot = lotWith([[0, 0], [12, 0], [12, 30], [0, 30]], [0], { front: 4, rear: 3, left: 1.5, right: 1.5 });
    const f = lotFigures(lot);
    expect(f.area).toBeCloseTo(360, 9);
    expect(f.sides).toEqual([12, 30, 12, 30]);
    expect(f.roles).toEqual(['street', 'right', 'rear', 'left']);
    close(f.envelope, [[1.5, 4], [10.5, 4], [10.5, 27], [1.5, 27]]);
    expect(f.envelopeArea).toBeCloseTo(9 * 23, 9);
  });

  it('Casa 123 (trapezoid 14 / 15 / 25 / 25): 362.5 m², envelope 4 m front, 6 m rear, 1.20 m sides square to each boundary', () => {
    const p = parseProject(json('../projects/casa-123/versions/v3.json'));
    const f = lotFigures(p.site.lot);
    expect(f.area).toBeCloseTo(362.5, 9);
    expect(f.sides[1]).toBeCloseTo(Math.hypot(1, 25), 9);
    const env = f.envelope;
    // left side 1.20 m from x = 0; the right side 1.20 m square to the slanted boundary (a bit more than 1.20 along x)
    expect(Math.min(...env.map((c) => c[0]))).toBeCloseTo(1.2, 9);
    expect(Math.min(...env.map((c) => c[1]))).toBeCloseTo(4, 9);
    expect(Math.max(...env.map((c) => c[1]))).toBeCloseTo(19, 9);
    const right = env.filter((c) => c[0] > 7);
    for (const [x, y] of right) expect(14 + y / 25 - x).toBeCloseTo(1.2 * Math.hypot(1, 25) / 25, 9);
    // the Civil Code window line runs 1.50 m inside the three neighbour boundaries
    expect(windowLines(p.site.lot)).toHaveLength(3);
  });

  it('a corner lot: two street sides, the front setback applied to both, the envelope correct', () => {
    // 15 m on the main street, 25 m along the side street on the right
    const lot = lotWith([[0, 0], [15, 0], [15, 25], [0, 25]], [0, 1], { front: 4, rear: 3, left: 1.5, right: 1.5 });
    expect(edgeRoles(lot)).toEqual(['street', 'street', 'rear', 'left']);
    const f = lotFigures(lot);
    close(f.envelope, [[1.5, 4], [11, 4], [11, 22], [1.5, 22]]);
    expect(f.envelopeArea).toBeCloseTo(9.5 * 18, 9);
    // a starter house on it gets two front rows; moving the lot so the house pokes into the side-street setback fails it
    const p = starterModel({ project: 'Corner', address: '', region: regionFor('Testópolis', 'XX'), lot });
    const rows = runChecks(p).filter((c) => c.id.startsWith('setback:front'));
    expect(rows.map((c) => c.id)).toEqual(['setback:front', 'setback:front-2']);
    expect(rows.every((c) => c.status === 'pass')).toBe(true);
    const moved = { ...p, site: { ...p.site, houseOrigin: { x: p.site.houseOrigin.x + 3, y: p.site.houseOrigin.y } } };
    expect(runChecks(moved).find((c) => c.id === 'setback:front-2')!.status).toBe('fail');
  });

  it('an irregular 5-corner lot: the area is the shoelace formula, the envelope stays inside', () => {
    const poly: P2[] = [[0, 0], [16, 0], [18, 14], [9, 24], [-2, 18]];
    const shoelace = Math.abs(poly.reduce((a, [x, y], i) => { const [u, v] = poly[(i + 1) % 5]!; return a + x * v - u * y; }, 0)) / 2;
    expect(shoelace).toBeCloseTo(370, 9);
    const lot = lotWith(poly, [0], { front: 5, rear: 3, left: 2, right: 2 });
    const f = lotFigures(lot);
    expect(f.area).toBeCloseTo(shoelace, 9);
    expect(f.convex).toBe(true);
    expect(f.envelope.length).toBeGreaterThanOrEqual(4);
    expect(f.envelopeArea).toBeLessThan(f.area);
    expect(Math.min(...f.envelope.map((c) => c[1]))).toBeCloseTo(5, 9);
    // entered clockwise, it is the same lot
    const cw = lotWith([...poly].reverse(), [3], { front: 5, rear: 3, left: 2, right: 2 });
    expect(lotFigures(cw).envelopeArea).toBeCloseTo(f.envelopeArea, 9);
    expect(polyArea(envelope(cw))).toBeCloseTo(polyArea(f.envelope), 9);
  });

  it('maximum areas from TO, CA and TP; empty rules stay empty (TO CONFIRM)', () => {
    const lot = lotWith([[0, 0], [12, 0], [12, 30], [0, 30]], [0], { front: 4, rear: 3, left: 1.5, right: 1.5 });
    expect(lotFigures(lot).maxFootprint).toBeNull();
    const rules = { ...lot.rules, coverage: fact(60), far: fact(1.2), permeability: fact(20) };
    const f = lotFigures({ ...lot, rules });
    expect(f.maxFootprint).toBeCloseTo(216, 9);
    expect(f.maxBuilt).toBeCloseTo(432, 9);
    expect(f.minPermeable).toBeCloseTo(72, 9);
  });

  it('terrain: slopes and four corner heights as a bilinear surface', () => {
    const lot = lotWith([[0, 0], [10, 0], [10, 20], [0, 20]], [0], { front: 4, rear: 3, left: 1.5, right: 1.5 });
    expect(naturalAt({ ...lot, terrain: { ...lot.terrain, kind: 'down', fall: 2 } }, 5, 10)).toBeCloseTo(-1, 9);
    expect(naturalAt({ ...lot, terrain: { ...lot.terrain, kind: 'up', fall: 1 } }, 0, 20)).toBeCloseTo(1, 9);
    expect(naturalAt({ ...lot, terrain: { ...lot.terrain, kind: 'side', fall: 0.6 } }, 10, 3)).toBeCloseTo(-0.6, 9);
    const c = { ...lot, terrain: { ...lot.terrain, kind: 'corners' as const, corners: [0, -1, -3, -2] as [number, number, number, number] } };
    expect(naturalAt(c, 5, 10)).toBeCloseTo(-1.5, 9);
    expect(naturalAt(c, 10, 20)).toBeCloseTo(-3, 9);
  });
});

describe('P1 city table and the to-confirm list', () => {
  it('Piracicaba has its code and eaves limit; an unknown city gets empty values, all TO CONFIRM', () => {
    const pira = rulesFor('Piracicaba', 'SP');
    expect(pira.eaves.value).toBe(0.7);
    expect(pira.eaves.status).toBe('given');
    expect(pira.setbacks.front).toMatchObject({ value: 4, status: 'to-confirm' });
    const none = rulesFor('Cidade Nova', 'MG');
    for (const f of [none.setbacks.front, none.coverage, none.far, none.height, none.eaves]) expect(f).toMatchObject({ value: null, status: 'to-confirm' });
    expect(defaultLot('Cidade Nova', 'MG').services.sewer.ask).toBe('the water and sewer company');
    expect(defaultLot('Piracicaba', 'SP').services.power.ask).toBe('CPFL Paulista');
  });

  it('Casa 123 lists Prefeitura (carport, zone, height), SEMAE (sewer depth), CPFL (supply), the surveyor and the soil test', () => {
    const p = parseProject(json('../projects/casa-123/versions/v3.json'));
    const g = toConfirm(p.site.lot, p);
    const by = Object.fromEntries(g.map((x) => [x.who, x]));
    expect(g.map((x) => x.who)).toEqual(['prefeitura', 'water', 'power', 'surveyor', 'soil', 'engineer']);
    expect(by.prefeitura!.items.map((i) => i.code)).toEqual(expect.arrayContaining(['zone', 'height', 'carport']));
    expect(by.water!.ask).toBe('SEMAE');
    expect(by.water!.items.map((i) => i.code)).toContain('sewer-depth');
    expect(by.power!.ask).toBe('CPFL');
    expect(by.power!.items.map((i) => i.code)).toEqual(['supply']);
    expect(by.surveyor!.items.map((i) => i.code)).toContain('survey');
    expect(by.soil!.items[0]!.text).toMatch(/SPT/);
  });
});
