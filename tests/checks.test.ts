import { describe, expect, it } from 'vitest';
import { headroom, runChecks, summarize } from '../src/model/checks';
import { moveWall } from '../src/model/commands';
import type { Project, Stair } from '../src/model/schema';
import { load, space } from './helpers';

const v2 = load('casa-123.json');
const v1 = load('casa-123-v1.json');
const find = (p: Project, id: string) => runChecks(p).find((r) => r.id === id)!;
const withStair = (p: Project, patch: Partial<Stair['props']>): Project => ({
  ...p, elements: p.elements.map((e) => (e.type === 'Stair' ? { ...e, props: { ...e.props, ...patch } } : e)),
});

describe('checks', () => {
  it('Version 1 and Version 2 pass every check, and every result names its rule and source', () => {
    for (const p of [v1, v2]) {
      const r = runChecks(p);
      // spec 08 pre-sizing rows judge the placeholder sections (estimates, not code rules): tested in engineering.test.ts
      expect(summarize(r.filter((c) => !c.id.startsWith('eng:'))).fail).toBe(0);
      for (const c of r) { expect(c.rule).toBeTruthy(); expect(c.source).toBeTruthy(); }
      for (const g of ['Rooms', 'Windows', 'Circulation', 'Stairs', 'Site']) expect(r.some((c) => c.group === g)).toBe(true);
    }
  });

  it('fails a room below its minimum area', () => {
    // Bath 2 (1.8 × 1.6) squeezed to 1.8 × 0.8 = 1.44 m² < 2.5 m²
    const p = moveWall('UF', 'h', 6.6, 4, 5.8).apply(v2);
    expect(find(p, `area:${space(p, 'UF', 'Bath 2').id}`).status).toBe('fail');
    expect(find(v2, `area:${space(v2, 'UF', 'Bath 2').id}`).status).toBe('pass');
  });

  it('fails a room whose window glass is below 1/8 of the floor', () => {
    const noWin: Project = { ...v2, elements: v2.elements.filter((e) => !(e.type === 'Opening' && e.level === 'UF' && e.props.role === 'window' && e.props.host === 'UF-wall-04')) };
    const r = find(noWin, `light:${space(v2, 'UF', 'Bedroom 2').id}`);
    expect(find(v2, `light:${space(v2, 'UF', 'Bedroom 2').id}`).status).toBe('pass');
    // Bedroom 2 keeps its front window (3.12 m² glass for 10.24 m²), so it still passes; removing both fails it.
    expect(r.status).toBe('pass');
    const none: Project = { ...noWin, elements: noWin.elements.filter((e) => !(e.type === 'Opening' && e.id === 'UF-win-01')) };
    expect(find(none, `light:${space(v2, 'UF', 'Bedroom 2').id}`).status).toBe('fail');
  });

  it('fails a corridor narrower than 0.90 m', () => {
    // Entry hall strip x 2.0–3.2 (1.2 m) squeezed by moving the x=2 line to 2.4 → 0.8 m
    const p = moveWall('SL', 'v', 2, 4, 2.4).apply(v2);
    expect(find(p, `corridor:${space(p, 'SL', 'Entry · hall').id}`).status).toBe('fail');
  });

  it('applies the Blondel rule, stair width and headroom', () => {
    const steep = withStair(v2, { riser: 0.2 });
    expect(find(steep, 'blondel:stair-01').status).toBe('fail');
    const narrow = withStair(v2, { width: 0.8 });
    expect(find(narrow, 'stairwidth:stair-01').status).toBe('fail');
    const st = v2.elements.find((e) => e.id === 'stair-02') as Stair;
    expect(headroom(v2, st)).toBeCloseTo(2.706, 2);
    // Without the stair well on the street level, the down flight hits the street-level slab.
    const noWell: Project = { ...v2, elements: v2.elements.filter((e) => !(e.type === 'Space' && e.level === 'SL' && e.props.zone === 'stair')) };
    expect(find(noWell, 'headroom:stair-02').status).toBe('fail');
  });

  it('fails windows within 1.50 m of a neighbour boundary (Civil Code 1.301)', () => {
    const close: Project = { ...v2, site: { ...v2.site, houseOrigin: { x: 1.3, y: 4 } } };
    const r = runChecks(close).filter((c) => c.id.startsWith('1301:'));
    expect(r.some((c) => c.status === 'fail')).toBe(true);
    expect(runChecks(v2).filter((c) => c.id.startsWith('1301:')).every((c) => c.status === 'pass')).toBe(true);
  });

  it('fails a footprint outside the setbacks', () => {
    const p: Project = { ...v2, site: { ...v2.site, houseOrigin: { x: 1.0, y: 3.5 } } };
    expect(find(p, 'setback:front').status).toBe('fail');
    expect(find(p, 'setback:south').status).toBe('fail');
    expect(find(p, 'setback:rear').status).toBe('pass');
    const deep: Project = { ...v2, site: { ...v2.site, houseOrigin: { x: 1.92, y: 4.5 } } };
    expect(find(deep, 'setback:rear').status).toBe('fail');
  });
});
