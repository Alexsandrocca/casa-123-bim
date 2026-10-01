import { describe, expect, it } from 'vitest';
import { runChecks } from '../src/model/checks';
import { moveFixture, setPipe, setUtilities } from '../src/model/commands';
import { migrate } from '../src/model/migrate';
import { kindOf, sewageDnFor } from '../src/model/plumbing/library';
import { growTree, routePlumbing } from '../src/model/plumbing/route';
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
    expect(sink.props.at).toEqual([8.33, 6.3]); // V2 position kept
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
    const p = moveFixture(sink.id, sink.props.at[0], sink.props.at[1] + 1).apply(v3);
    const moved = fixtures(p).find((f) => f.id === sink.id)!;
    expect(moved.props.at).toEqual([8.33, 7.3]);
    const drop = pipes(p).find((x) => x.props.network === 'sew-kitchen' && x.props.serves.length === 1 && x.props.serves[0] === sink.id && x.props.start[0] === x.props.end[0] && x.props.start[1] === x.props.end[1])!;
    expect([drop.props.start[0], drop.props.start[1]]).toEqual([8.33, 7.3]);
    expect(pipes(p).filter((x) => x.props.network === 'sew-kitchen').map((x) => JSON.stringify(x.props.start))).not.toEqual(before);
    expect(check(p, 'slope:sew-kitchen').status).toBe('pass');
    expect(check(p, 'dn:sew-kitchen').status).toBe('pass');
    expect(check(p, 'slope:sew-kitchen').value).not.toBe(check(v3, 'slope:sew-kitchen').value);
    // and the slope check catches a branch made too flat by hand
    const flat = pipes(p).find((x) => x.props.network === 'sew-kitchen' && Math.abs(x.props.start[1] - x.props.end[1]) > 0.5)!;
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

  it('grows right-angled trees', () => {
    const t = growTree([0, 0], [{ id: 'a', at: [2, 0] }, { id: 'b', at: [2, 3] }, { id: 'c', at: [-1, 1] }]);
    for (const n of t) if (n.parent >= 0) {
      const pa = t[n.parent]!;
      expect(n.x === pa.x || n.y === pa.y).toBe(true);
    }
    expect(t.filter((n) => n.target).map((n) => n.target).sort()).toEqual(['a', 'b', 'c']);
  });

  it('adds the plumbing to a Version 3 model saved before spec 03', () => {
    const old: Project = { ...v3, site: { ...v3.site, utilities: undefined }, elements: v3.elements.filter((e) => e.type !== 'Fixture' && e.type !== 'PipeSegment') };
    const m = migrate(old, v3);
    expect(fixtures(m).length).toBe(fixtures(v3).length);
    expect(m.site.utilities?.sewerDepth).toBe(3);
    expect(routePlumbing(load('casa-123.json')).pipes).toHaveLength(0); // Version 2 has no plumbing
  });
});
