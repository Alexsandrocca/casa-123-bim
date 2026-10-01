import { describe, expect, it } from 'vitest';
import { runChecks } from '../src/model/checks';
import { moveFixture, setPipe, setUtilities } from '../src/model/commands';
import { migrate } from '../src/model/migrate';
import { kindOf, sewageDnFor } from '../src/model/plumbing/library';
import { routePlumbing } from '../src/model/plumbing/route';
import { Layer, growTree } from '../src/model/mep/grid';
import type { Fixture, PipeSegment, Project } from '../src/model/schema';
import { load } from './helpers';

const v3 = load('casa-123-v3.json');
const pipes = (p: Project) => p.elements.filter((e): e is PipeSegment => e.type === 'PipeSegment');
const fixtures = (p: Project) => p.elements.filter((e): e is Fixture => e.type === 'Fixture');
const check = (p: Project, id: string) => runChecks(p).find((c) => c.id === id)!;
const sink = fixtures(v3).find((f) => f.props.kind === 'kitchen-sink')!;

describe('plumbing model (Version 3)', () => {
  it('has the fixture library placed from the overlays, plus the equipment', () => {
    const kinds = new Set(fixtures(v3).map((f) => f.props.kind));
    for (const k of ['toilet', 'basin', 'shower', 'kitchen-sink', 'laundry-tank', 'washer', 'dishwasher', 'floor-drain', 'garden-tap', 'grease-trap', 'inspection-box',
      'lift-station', 'backflow-valve', 'water-meter', 'roof-tank', 'pressure-pump', 'water-heater', 'rain-cistern', 'sump-pump']) expect(kinds.has(k), k).toBe(true);
    // V2 position along the wall kept; spec 04b snaps it to the wall face (centre 0.275 m off the face)
    expect(sink.props.at).toEqual([8.225, 6.3]);
    expect(sink.props.hostWallId).toBe('SL-wall-06');
    expect(fixtures(v3).filter((f) => f.props.kind === 'roof-tank')).toHaveLength(2);
  });

  it('has five systems, each pipe with DN, material, start/end and flow direction; gravity sewage always runs downhill', () => {
    const sys = new Set(pipes(v3).map((x) => x.props.system));
    expect([...sys].sort()).toEqual(['cold', 'hot', 'rain', 'sewage', 'vent']);
    for (const x of pipes(v3)) {
      expect(x.props.dn).toBeGreaterThan(0);
      if (x.props.system === 'sewage' && !x.props.pressure) expect(x.props.start[2]).toBeGreaterThanOrEqual(x.props.end[2] - 1e-9);
    }
    // every draining fixture has its own drop pipe
    for (const f of fixtures(v3).filter((f) => kindOf(f.props.kind).drainDn)) {
      expect(pipes(v3).some((x) => x.props.system === 'sewage' && x.props.serves.length === 1 && x.props.serves[0] === f.id), f.id).toBe(true);
    }
  });

  it('passes the plumbing checks, except gravity from the lower level (the reason for the lift station)', () => {
    const r = runChecks(v3).filter((c) => c.group === 'Plumbing');
    expect(r.filter((c) => c.status === 'fail').map((c) => c.id)).toEqual(['sewage:ll-gravity']);
    expect(check(v3, 'sewage:lift').status).toBe('pass');
    expect(check(v3, 'sewage:ll-gravity').value).toContain('-3.04');
    expect(check(v3, 'rain:intensity').status).toBe('confirm');
  });

  it('acceptance: moving the kitchen sink 1 m re-routes its branch, and the slope and DN checks update', () => {
    const before = pipes(v3).filter((x) => x.props.network === 'sew-kitchen').map((x) => JSON.stringify(x.props.start));
    // (the kitchen ends at y 7.6: a 0.9 m sink moved 1 m stops 0.15 m from the corner)
    const p = moveFixture(sink.id, sink.props.at[0], sink.props.at[1] + 1).apply(v3);
    const moved = fixtures(p).find((f) => f.id === sink.id)!;
    expect(moved.props.at).toEqual([8.225, 7.0]);
    const drop = pipes(p).find((x) => x.props.network === 'sew-kitchen' && x.props.serves.length === 1 && x.props.serves[0] === sink.id && x.props.start[0] === x.props.end[0] && x.props.start[1] === x.props.end[1])!;
    expect([drop.props.start[0], drop.props.start[1]]).toEqual([8.225, 7.0]);
    expect(pipes(p).filter((x) => x.props.network === 'sew-kitchen').map((x) => JSON.stringify(x.props.start))).not.toEqual(before);
    expect(check(p, 'slope:sew-kitchen').status).toBe('pass');
    expect(check(p, 'dn:sew-kitchen').status).toBe('pass');
    expect(check(p, 'slope:sew-kitchen').value).not.toBe(check(v3, 'slope:sew-kitchen').value);
    // and the slope check catches a branch made too flat by hand
    const flat = pipes(p).find((x) => x.props.network === 'sew-kitchen' && Math.hypot(x.props.start[0] - x.props.end[0], x.props.start[1] - x.props.end[1]) > 0.5)!;
    const broken: Project = { ...p, elements: p.elements.map((e) => (e.id === flat.id && e.type === 'PipeSegment' ? { ...e, props: { ...e.props, end: [e.props.end[0], e.props.end[1], e.props.start[2]] as [number, number, number] } } : e)) };
    expect(check(broken, 'slope:sew-kitchen').status).toBe('fail');
  });

  it('acceptance: setting the sewer depth to 3.5 m turns the lower-level gravity check to pass', () => {
    expect(check(v3, 'sewage:ll-gravity').status).toBe('fail');
    const p = setUtilities({ sewerDepth: 3.5 }).apply(v3);
    expect(check(p, 'sewage:ll-gravity').status).toBe('pass');
    expect(check(p, 'sewage:lift').value).toContain('gravity would also work');
  });

  it('keeps a DN chosen by hand when the pipes re-route; refuses a fixture outside the rooms', () => {
    const coll = pipes(v3).find((x) => x.props.network === 'sew-collector')!;
    let p = setPipe(coll.id, { dn: 150 }).apply(v3);
    p = moveFixture(sink.id, 8.0, 6.3).apply(p);
    expect(pipes(p).find((x) => x.id === coll.id)!.props.dn).toBe(150);
    expect(pipes(p).find((x) => x.id === coll.id)!.props.manual).toBe(true);
    expect(() => moveFixture(sink.id, 20, 6.3).apply(v3)).toThrow();
  });

  it('flags a toilet branch made smaller than DN 100', () => {
    const wcPipe = pipes(v3).find((x) => x.props.system === 'sewage' && x.props.serves.some((id) => id.startsWith('fx-toilet')) && x.props.serves.length === 1)!;
    const p = setPipe(wcPipe.id, { dn: 75 }).apply(v3);
    expect(runChecks(p).some((c) => c.id.startsWith('dn:') && c.status === 'fail')).toBe(true);
    expect(sewageDnFor(3, false)).toBe(40);
    expect(sewageDnFor(3, true)).toBe(100);
  });

  it('grows trees through a layer: every target reached, edges straight (0°, 45° or 90°)', () => {
    const L = new Layer('test', { x0: -1, y0: -1, x1: 4, y1: 4 }, true);
    L.paint({ x0: -1, y0: -1, x1: 4, y1: 4 }, { id: 'p', kind: 'plenum', name: 'test' }, 1, 0);
    L.block({ x0: 0.5, y0: -1, x1: 0.8, y1: 2 }, 'a wall');
    const t = growTree(L, [0, 0], [{ id: 'a', at: [2, 0] }, { id: 'b', at: [2, 3] }, { id: 'c', at: [-0.5, 1] }]);
    expect(t.failed).toEqual([]);
    for (const n of t.nodes) if (n.parent >= 0) {
      const pa = t.nodes[n.parent]!;
      const dx = Math.abs(n.x - pa.x), dy = Math.abs(n.y - pa.y);
      expect(dx < 1e-6 || dy < 1e-6 || Math.abs(dx - dy) < 1e-6).toBe(true);
      // nothing crosses the blocked strip
      expect(Math.min(n.x, pa.x) < 0.5 && Math.max(n.x, pa.x) > 0.8 && Math.max(n.y, pa.y) < 2).toBe(false);
    }
    expect(t.nodes.filter((n) => n.target).map((n) => n.target).sort()).toEqual(['a', 'b', 'c']);
  });

  it('adds the plumbing to a Version 3 model saved before spec 03', () => {
    const old: Project = { ...v3, site: { ...v3.site, utilities: undefined }, elements: v3.elements.filter((e) => e.type !== 'Fixture' && e.type !== 'PipeSegment') };
    const m = migrate(old, v3);
    expect(fixtures(m).length).toBe(fixtures(v3).length);
    expect(m.site.utilities?.sewerDepth).toBe(3);
    expect(routePlumbing(load('casa-123.json')).pipes).toHaveLength(0); // Version 2 has no plumbing
  });
});

describe('plumbing schedules', () => {
  it('lists metres per DN and material, fittings and fixtures, and exports CSV', async () => {
    const { schedule, scheduleCsv } = await import('../src/model/plumbing/schedule');
    const s = schedule(v3);
    expect(s.pipeRows.some((r) => r.system === 'sewage' && r.dn === 100 && r.material === 'PVC' && r.metres > 20)).toBe(true);
    expect(s.pipeRows.some((r) => r.system === 'hot' && r.material === 'CPVC')).toBe(true);
    expect(s.fittingRows.reduce((a, r) => a + r.elbows + r.tees, 0)).toBeGreaterThan(20);
    expect(s.fixtureRows.find((r) => r.kind === 'toilet' && r.level === 'UF')!.count).toBe(3);
    const csv = scheduleCsv(v3);
    expect(csv.split('\n')[0]).toBe('Pipes');
    expect(csv).toContain('System,DN,Material,Metres');
    expect(csv).toContain('Toilet (WC),UF,3');
  });
});

describe('spec 03 carry-overs', () => {
  it('fills the cut faces of walls and slabs in a section (poché)', async () => {
    const { buildScene, pocheCaps } = await import('../src/scene/build3d');
    const parts = buildScene(v3).parts;
    const caps = pocheCaps(parts, [{ axis: 'x', at: 2.45, keep: -1 }]);
    expect(caps.length).toBeGreaterThan(5);
    for (const c of caps) expect(Math.abs(c.c[0] - 2.45)).toBeLessThan(0.01);
    expect(caps.some((c) => c.id === 'SL-slab-01')).toBe(true);
    const both = pocheCaps(parts, [{ axis: 'x', at: 2.45, keep: -1 }, { axis: 'z', at: 1.8, keep: -1 }]);
    for (const c of both) expect(c.c[2] - c.s[2] / 2).toBeLessThanOrEqual(1.8 + 1e-6);
  });

  it('notes the stair / retaining-wall crossing on both elements', () => {
    for (const id of ['LL-wall-01', 'stair-02']) {
      const e = v3.elements.find((x) => x.id === id)!;
      expect(e.notes?.[0]).toContain('lintel beam');
    }
    expect(v3.elements.find((x) => x.id === 'stair-01')!.notes).toBeUndefined();
  });
});
