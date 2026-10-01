// Spec 04b: plumbing and electrical that obey the building.
import { describe, expect, it } from 'vitest';
import { runChecks } from '../src/model/checks';
import { deleteWall, moveDevice, moveWall } from '../src/model/commands';
import { mepReport } from '../src/model/mep/analysis';
import { routePath } from '../src/model/mep/grid';
import { buildLayer } from '../src/model/mep/layers';
import { wallMaxDn } from '../src/model/mep/library';
import { mepContext } from '../src/model/mep/spaces';
import { minSewageSlope } from '../src/model/plumbing/library';
import { routePlumbing, utilities } from '../src/model/plumbing/route';
import type { Device, Element, Fixture, PipeSegment, Project, Wall } from '../src/model/schema';
import { siteFrame } from '../src/model/site';
import { load } from './helpers';

const v3 = load('casa-123-v3.json');
const byId = <T extends Element>(p: Project, id: string) => p.elements.find((e) => e.id === id) as T;
const pipes = (p: Project) => p.elements.filter((e): e is PipeSegment => e.type === 'PipeSegment');
const fail = (p: Project) => runChecks(p).filter((c) => c.group === 'MEP physics' && c.status === 'fail');
/** A hand-made pipe added to the model (as if drawn wrongly), to see what the checks say. */
const withPipe = (p: Project, id: string, system: PipeSegment['props']['system'], dn: number, start: [number, number, number], end: [number, number, number]): Project => ({
  ...p,
  elements: [...p.elements, { id, type: 'PipeSegment', level: 'SL', tags: [], props: { system, dn, material: 'PVC', start, end, pressure: true, network: id, load: 0, serves: [] } }],
});

describe('spec 04b: MEP physics on Version 3', () => {
  it('passes the MEP physics checks except the one outlet that has no legal place (listed in STATUS)', () => {
    expect(fail(v3).map((c) => c.id).sort()).toEqual(['mep:unhosted:dev-outlet-26', 'noroute:ckt-out-UF-wet-1:dev-outlet-26']);
    const rep = mepReport(v3);
    expect([...rep.segs.values()].filter((s) => s.exposed > 0.03)).toEqual([]);
    expect(rep.clashes).toEqual([]);
    expect([...rep.segs.values()].filter((s) => s.forbidden.length)).toEqual([]);
    // every pipe and conduit has a host, and the hung runs have hangers
    expect(rep.hangers.length).toBeGreaterThan(20);
    expect(rep.hangers.every((h) => h.missing === 0)).toBe(true);
  });

  it('acceptance: a pipe cannot cross a stair void or a door', () => {
    // the router goes round the upper stair void instead of across it
    const ctx = mepContext(v3);
    const L = buildLayer(ctx, { key: 'test', carry: 'conduit', dn: 20, screeds: ['UF'] });
    const r = routePath(L, [0.8, 7.9], [0.8, 12.9]);
    expect(r.pts.length).toBeGreaterThan(2);
    const voidCell = { x0: 0, x1: 1.6, y0: 8.2, y1: 12.5 };
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1]!, b = r.pts[i]!;
      for (let t = 0; t <= 1; t += 0.05) {
        const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        expect(x > voidCell.x0 + 0.01 && x < voidCell.x1 - 0.01 && y > voidCell.y0 + 0.01 && y < voidCell.y1 - 0.01).toBe(false);
      }
    }
    // a pipe drawn through the front door, or across the stair well, is flagged
    let p = withPipe(v3, 'test-door', 'cold', 25, [1.4, 0.7, 1.2], [1.4, 1.3, 1.2]);
    p = withPipe(p, 'test-stair', 'cold', 25, [0.4, 9.0, 1.5], [1.2, 9.0, 1.5]);
    const rep = mepReport(p);
    expect(rep.segs.get('test-door')!.forbidden.some((f) => f.name.includes('Door SL-door-01'))).toBe(true);
    expect(rep.segs.get('test-stair')!.forbidden.some((f) => /stair|Stair/.test(f.name))).toBe(true);
    expect(fail(p).some((c) => c.id === 'mep:forbidden')).toBe(true);
  });

  it('acceptance: a DN 100 stack cannot be placed in a 0.12 m wall', () => {
    expect(wallMaxDn(0.12)).toBe(50);
    expect(wallMaxDn(0.15)).toBe(75);
    expect(wallMaxDn(0.2)).toBe(100);
    // a DN 100 drop inside the 0.12 m wall between the street-level storage and pantry is over capacity
    const w = byId<Wall>(v3, 'SL-wall-09');
    expect(w.props.thickness).toBe(0.12);
    const p = withPipe(v3, 'test-stack', 'sewage', 100, [1.0, 5.2, 3.0], [1.0, 5.2, 1.0]);
    expect(mepReport(p).capacity.some((c) => c.id === 'test-stack' && c.text.includes('DN 100'))).toBe(true);
    // and the router will not run a soil stack outside a shaft
    const moved: Project = { ...v3, elements: v3.elements.map((e) => (e.id === 'fx-stack-01' && e.type === 'Fixture' ? { ...e, props: { ...e.props, at: [1.0, 5.2] as [number, number] } } : e)) };
    expect(routePlumbing(moved).noRoute.some((n) => n.item === 'fx-stack-01' && n.reason.includes('shaft'))).toBe(true);
  });

  it('acceptance: moving a wall re-snaps its outlets and switches', () => {
    const hosted = v3.elements.filter((e): e is Device => e.type === 'Device' && e.props.hostWallId === 'SL-wall-08');
    expect(hosted.length).toBeGreaterThan(0);
    const p = moveWall('SL', 'h', 4.2, 1, 4.4).apply(v3);
    const w = byId<Wall>(p, 'SL-wall-08');
    expect(w.props.start[1]).toBeCloseTo(4.4, 6);
    for (const d of hosted) {
      const n = byId<Device>(p, d.id);
      expect(n.props.hostWallId).toBe('SL-wall-08');
      // still on the wall's face (0.01 m off the face), now 0.20 m further
      expect(Math.abs(Math.abs(n.props.at[1] - 4.4) - (w.props.thickness / 2 + 0.01))).toBeLessThan(0.002);
      expect(n.props.at[1] - d.props.at[1]).toBeCloseTo(0.2, 3);
    }
    expect(fail(p).filter((c) => c.id.startsWith('mep:unhosted') && !c.id.endsWith('dev-outlet-26'))).toEqual([]);
  });

  it('acceptance: deleting a wall flags its devices "unhosted"', () => {
    const hosted = v3.elements.filter((e) => (e.type === 'Device' || e.type === 'Fixture') && e.props.hostWallId === 'SL-wall-08').map((e) => e.id);
    const p = deleteWall('SL-wall-08').apply(v3);
    const flagged = fail(p).filter((c) => c.id.startsWith('mep:unhosted:')).map((c) => c.id.slice('mep:unhosted:'.length));
    for (const id of hosted) expect(flagged).toContain(id);
    expect(fail(p).find((c) => c.id === `mep:unhosted:${hosted[0]}`)!.value).toContain('is gone');
  });

  it('acceptance: the sewage keeps its slope from the upper bathroom to the street', () => {
    const wc = 'fx-toilet-03';
    const chain = pipes(v3).filter((x) => x.props.system === 'sewage' && !x.props.pressure && x.props.serves.includes(wc));
    // it falls all the way, every run at least at its minimum slope
    for (const x of chain) {
      expect(x.props.start[2]).toBeGreaterThanOrEqual(x.props.end[2] - 1e-6);
      const h = Math.hypot(x.props.end[0] - x.props.start[0], x.props.end[1] - x.props.start[1]);
      if (h >= 0.25 && h > Math.abs(x.props.end[2] - x.props.start[2])) expect((x.props.start[2] - x.props.end[2]) / h).toBeGreaterThanOrEqual(minSewageSlope(x.props.dn) - 1e-3);
    }
    // the runs join end to start, from the toilet's drop to the street sewer
    const f = siteFrame(v3), u = utilities(v3);
    // (an inspection box may drop the flow inside it: joined in plan, never higher than where it arrives)
    const near = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!) < 0.1 && a[2]! <= b[2]! + 0.01;
    let cur = chain.find((x) => x.props.serves.length === 1)!;
    expect(cur).toBeTruthy();
    const seen = new Set([cur.id]);
    for (let i = 0; i < 200; i++) {
      const next = chain.filter((x) => !seen.has(x.id) && near(x.props.start, cur.props.end)).sort((a, b) => b.props.load - a.props.load)[0];
      if (!next) break;
      seen.add(next.id);
      cur = next;
    }
    expect(cur.props.end[1]).toBeCloseTo(f.yStreet - u.sewerOffset, 1);
    // the plumbing slope checks agree
    expect(runChecks(v3).filter((c) => c.id.startsWith('slope:') && c.status === 'fail')).toEqual([]);
  });

  it('acceptance: an AC condenser without a support is flagged', () => {
    const ac = v3.elements.find((e): e is Device => e.type === 'Device' && e.props.kind === 'ac-outdoor')!;
    expect(fail(v3).some((c) => c.elementIds.includes(ac.id))).toBe(false);
    // hung off the south facade with nothing under it
    const p = moveDevice(ac.id, -0.6, 7.0).apply(v3);
    const row = fail(p).find((c) => c.id === `mep:unhosted:${ac.id}`)!;
    expect(row.value).toContain('unsupported');
  });

  it('shafts, plenums and roof zones: heights pass, tanks and pump on the roof, the pump not in a corridor', () => {
    const rows = runChecks(v3).filter((c) => c.group === 'MEP physics');
    expect(rows.find((c) => c.id === 'mep:height')!.status).toBe('pass');
    expect(rows.find((c) => c.id === 'mep:access')!.status).toBe('pass');
    const pump = byId<Fixture>(v3, 'fx-pressure-pump-01');
    expect(pump.level).toBe('roof');
    const tech = byId<Element>(v3, 'roof-tech');
    expect(tech.type === 'ServiceSpace' && pump.props.at[0] >= tech.props.rect.x0 && pump.props.at[0] <= tech.props.rect.x1).toBe(true);
    // condensers on roof zones, none on a facade
    for (const d of v3.elements) if (d.type === 'Device' && d.props.kind === 'ac-outdoor') expect(d.level).toBe('roof');
    // the cistern is in the front setback, off the entry path and the car bays
    expect(mepReport(v3).access.find((a) => a.id === 'fx-rain-cistern-01')!.ok).toBe(true);
  });
});
