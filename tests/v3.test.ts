import { describe, expect, it } from 'vitest';
import { runChecks, summarize } from '../src/model/checks';
import { spaceArea, spacesOn, wallSeg, wallsOn } from '../src/model/geometry';
import type { Project } from '../src/model/schema';
import { siteFrame } from '../src/model/site';
import { checkSupport } from '../src/model/support';
import { buildScene, type BoxPart } from '../src/scene/build3d';
import { startAt, walkRoute, walkWorld } from '../src/scene/walk';
import { load, space } from './helpers';

const v3 = load('casa-123-v3.json');
const v2 = load('casa-123.json');

describe('Version 3 (spec 02b)', () => {
  it('has no garage; the street level starts at y 1.0 and is about 78 m² gross', () => {
    expect(v3.elements.some((e) => e.type === 'Space' && e.props.zone === 'garage')).toBe(false);
    expect(v3.elements.some((e) => e.type === 'Opening' && e.props.kind === 'garage')).toBe(false);
    expect(v3.levels.find((l) => l.id === 'SL')!.outline!.y0).toBe(1);
    const gross = spacesOn(v3, 'SL').reduce((a, s) => a + spaceArea(s), 0);
    expect(gross).toBeCloseTo(78.16, 1);
    expect(spaceArea(space(v3, 'SL', 'WC'))).toBeCloseTo(3.2, 3);
    expect(spaceArea(space(v3, 'SL', 'Kitchen'))).toBeCloseTo(spaceArea(space(v2, 'SL', 'Kitchen')), 5);
  });

  it('keeps everything behind the street-level front where Version 2 has it', () => {
    for (const L of ['LL', 'UF'] as const) {
      expect(spacesOn(v3, L).map((s) => s.props.cells)).toEqual(spacesOn(v2, L).map((s) => s.props.cells));
    }
    expect(v3.elements.filter((e) => e.type === 'Stair')).toEqual(v2.elements.filter((e) => e.type === 'Stair'));
  });

  it('makes the kitchen front wall and the passage wall onto the patio exterior, with the new openings', () => {
    const ext = wallsOn(v3, 'SL').filter((w) => w.props.wallType === 'exterior').map(wallSeg);
    expect(ext).toContainEqual({ o: 'h', c: 5, a: 3.2, b: 8.6 });
    expect(ext).toContainEqual({ o: 'v', c: 3.2, a: 1, b: 5 });
    const ops = v3.elements.filter((e) => e.type === 'Opening' && e.level === 'SL');
    expect(ops.some((o) => o.type === 'Opening' && o.tags.includes('glazed'))).toBe(true);
    expect(ops).toHaveLength(16);
  });

  it('puts the house 1.50 m from the south boundary; the north ramp is 3.90 m wide at the street and 4.90 m at the rear', () => {
    expect(v3.site.houseOrigin).toEqual({ x: 1.5, y: 4 });
    const f = siteFrame(v3);
    expect(f.xNorth(f.yStreet) - 8.6).toBeCloseTo(3.9, 5);
    expect(f.xNorth(f.yRear) - 8.6).toBeCloseTo(4.9, 5);
  });

  it('passes every check except the carport in the front setback, which stays TO CONFIRM', () => {
    const r = runChecks(v3);
    const s = summarize(r);
    expect(s.fail).toBe(0);
    expect(s.confirm).toBe(1);
    expect(r.find((c) => c.title === 'Carport in the front setback')!.status).toBe('confirm');
    expect(r.find((c) => c.title === 'Parking')!.status).toBe('pass');
    expect(r.find((c) => c.id === 'setback:front')!.value).toContain('5.00 m');
    expect(checkSupport(v3).unsupported.map((e) => e.id)).toEqual([]);
  });

  it('fails parking when a bay is too narrow or has no room to open the doors', () => {
    const narrow: Project = { ...v3, elements: v3.elements.map((e) => (e.type === 'Carport' ? { ...e, props: { ...e.props, parking: [{ ...e.props.parking[0]!, x1: 5.0 }, e.props.parking[1]!] } } : e)) };
    expect(runChecks(narrow).find((c) => c.title === 'Parking')!.status).toBe('fail');
    const tight: Project = { ...v3, elements: v3.elements.map((e) => (e.type === 'Carport' ? { ...e, props: { ...e.props, parking: [{ ...e.props.parking[0]!, x0: 2.6, x1: 5.1 }, { ...e.props.parking[1]!, x0: 5.3, x1: 7.8 }] } } : e)) };
    // bay 1: 0 m on the left, 0.2 m to bay 2 → no room for a door
    expect(runChecks(tight).find((c) => c.title === 'Parking')!.value).toContain('0.60');
  });

  it('flags the carport when its beams are removed', () => {
    const p: Project = { ...v3, elements: v3.elements.filter((e) => !(e.type === 'Beam' && e.tags.includes('carport'))) };
    expect(checkSupport(p).unsupported.map((e) => e.id)).toContain('carport-01');
  });

  it('builds the carport in 3D: 4 columns, sloping roof about +2.80, 6 ghost solar modules, clear height ≥ 2.30', () => {
    const parts = buildScene(v3).parts.filter((x): x is BoxPart => x.kind === 'box');
    expect(parts.filter((x) => x.id.startsWith('carport-col'))).toHaveLength(4);
    expect(parts.filter((x) => x.id === 'carport-01' && x.mat === 'solarGhost')).toHaveLength(6);
    const roof = parts.find((x) => x.id === 'carport-01' && x.mat === 'roof')!;
    expect(roof.c[2]).toBeGreaterThan(2.6);
    expect(roof.c[2]).toBeLessThan(3.0);
    const beams = parts.filter((x) => x.id.startsWith('carport-beam'));
    const lowest = Math.min(...beams.map((b) => b.c[2] - b.s[2] / 2));
    expect(lowest).toBeGreaterThanOrEqual(2.3);
    expect(parts.some((x) => x.id === 'dev-ev-01')).toBe(true);
  });

  it('can be walked from the sidewalk past the carport, into the entry, down to the garden', () => {
    const world = walkWorld(buildScene(v3, { doorsOpen: true }));
    const r = walkRoute(world, startAt(world, 1.4, -6), [
      [1.4, -1.5], [1.4, 0.4], [1.4, 1.8], [2.6, 3.0], [2.6, 7.7], [2.45, 8.0], [2.45, 12.9], [1.6, 14.2], [1.6, 16.0],
    ]);
    expect(r.stuckAt, JSON.stringify(r.stuckAt)).toBeUndefined();
    expect(r.path[r.path.length - 1]!.foot).toBeCloseTo(-2.55, 2);
  });
});
