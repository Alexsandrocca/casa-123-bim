// Plumbing checks: NBR 8160 (sewage), 5626/7198 (water), 10844/15527 (rain).
import type { CheckResult } from '../checks';
import { pointInRect } from '../geometry';
import type { Fixture, PipeSegment, Project } from '../schema';
import { groundAt, groundZones, siteFrame } from '../site';
import { kindOf, minSewageSlope, rainCapacity, rainFlow, sewageDnFor, waterDnFor } from './library';
import { insideHouse, utilities } from './route';

const horiz = (s: PipeSegment) => Math.abs(s.props.start[0] - s.props.end[0]) + Math.abs(s.props.start[1] - s.props.end[1]);
const slopeOf = (s: PipeSegment) => (s.props.start[2] - s.props.end[2]) / Math.max(horiz(s), 1e-9);
/** Short pieces are fittings, not runs: their slope is not checked. */
const RUN = 0.25;

export function networkLabel(n: string): string {
  if (n === 'sew-collector') return 'Sewage collector to the street';
  if (n === 'sew-kitchen') return 'Kitchen line (through the grease trap)';
  if (n === 'sew-LL') return 'Lower-level drains to the lift station';
  if (n === 'sew-LL-pumped') return 'Lower-level pumped line';
  if (n.startsWith('sew-')) return `${n.split('-')[1] === 'UF' ? 'Upper' : 'Street'}-level drains to stack ${n.split('-').slice(-2).join('-')}`;
  if (n.startsWith('stack-')) return `Soil stack ${n.slice(6)}`;
  if (n.startsWith('vent-')) return `Vent ${n.slice(5)}`;
  if (n.startsWith('cold-')) return `Cold water ${n.slice(5)}`;
  if (n.startsWith('hot-')) return `Hot water ${n.slice(4)}`;
  if (n === 'rain-cistern') return 'Roof rain to the cistern';
  if (n === 'rain-overflow') return 'Cistern overflow to the street gutter';
  if (n === 'rain-garden') return 'Veranda rain to the garden trench';
  if (n === 'rain-sump') return 'Garden sump pump line';
  return n;
}

/** What the lower level would need to drain to the street by gravity. */
export function llGravity(p: Project) {
  const u = utilities(p);
  const f = siteFrame(p);
  const ll = p.levels.find((l) => l.id === 'LL');
  const front = ll?.outline?.y0 ?? 0;
  const outlet = (ll?.elevation ?? 0) - 0.3;
  const leaves = outlet - 0.05;
  const sewerY = f.yStreet - u.sewerOffset;
  const run = front - sewerY;
  const arrives = leaves - 0.01 * run;
  const needs = -u.sewerDepth + 0.3;
  return { outlet, leaves, run, arrives, needs, ok: arrives >= needs - 1e-9, depth: u.sewerDepth };
}

export function plumbingChecks(p: Project): CheckResult[] {
  const pipes = p.elements.filter((e): e is PipeSegment => e.type === 'PipeSegment');
  const fixtures = p.elements.filter((e): e is Fixture => e.type === 'Fixture');
  if (!pipes.length && !fixtures.length) return [];
  const out: CheckResult[] = [];
  const nets = [...new Set(pipes.map((x) => x.props.network))];
  const byNet = (n: string) => pipes.filter((x) => x.props.network === n);
  const S8160 = 'NBR 8160 (sewage)', S5626 = 'NBR 5626 / 7198 (cold and hot water)', S10844 = 'NBR 10844 / 15527 (rainwater)';

  /* sewage: slopes and DN by fixture units */
  for (const n of nets) {
    const segs = byNet(n).filter((x) => x.props.system === 'sewage' && !x.props.pressure);
    const runs = segs.filter((x) => horiz(x) >= RUN && Math.abs(slopeOf(x)) < 1);
    if (runs.length) {
      const bad = runs.filter((x) => slopeOf(x) < minSewageSlope(x.props.dn) - 1e-3);
      const worst = runs.reduce((a, b) => (slopeOf(b) / minSewageSlope(b.props.dn) < slopeOf(a) / minSewageSlope(a.props.dn) ? b : a));
      out.push({
        id: `slope:${n}`, group: 'Plumbing', elementIds: bad.length ? bad.map((x) => x.id) : [worst.id], level: worst.level,
        title: `Slope · ${networkLabel(n)}`, status: bad.length ? 'fail' : 'pass',
        value: bad.length ? `${bad.length} pipe${bad.length > 1 ? 's' : ''} too flat (e.g. ${bad[0]!.id}: ${(slopeOf(bad[0]!) * 100).toFixed(1)} %)` : `lowest ${(slopeOf(worst) * 100).toFixed(1)} % on DN ${worst.props.dn}`,
        rule: 'Gravity sewage at least 2 % for DN ≤ 75 and 1 % for DN ≥ 100', source: S8160,
      });
    }
    if (segs.length) {
      const fx = new Map(fixtures.map((f) => [f.id, f]));
      const need = (x: PipeSegment) => sewageDnFor(x.props.load, x.props.serves.some((id) => fx.get(id)?.props.kind === 'toilet'));
      const bad = segs.filter((x) => x.props.dn < need(x));
      out.push({
        id: `dn:${n}`, group: 'Plumbing', elementIds: bad.map((x) => x.id), level: segs[0]!.level,
        title: `Pipe size · ${networkLabel(n)}`, status: bad.length ? 'fail' : 'pass',
        value: bad.length ? `${bad[0]!.id} is DN ${bad[0]!.props.dn}, needs DN ${need(bad[0]!)} (${bad[0]!.props.load} fixture units)` : `largest load ${Math.max(...segs.map((x) => x.props.load))} fixture units`,
        rule: 'DN by fixture units (UHC); any pipe carrying a toilet at least DN 100', source: S8160,
      });
    }
  }

  /* vents */
  for (const st of fixtures.filter((f) => f.props.kind === 'stack')) {
    const vents = pipes.filter((x) => x.props.network === `vent-${st.id}`);
    const vent = vents[0];
    const roof = p.levels.find((l) => l.id === 'roof')?.elevation ?? 0;
    const top = vents.length ? Math.max(...vents.flatMap((x) => [x.props.start[2], x.props.end[2]])) : -Infinity;
    out.push({
      id: `vent:${st.id}`, group: 'Plumbing', elementIds: [st.id], level: st.level, title: `Vent on stack ${st.id}`,
      status: top >= roof + 0.3 ? 'pass' : 'fail', value: vent ? `DN ${vent.props.dn} to ${top.toFixed(2)} (roof ${roof.toFixed(2)})` : 'no vent',
      rule: 'Each soil stack continues as a vent through the roof', source: S8160,
    });
  }

  /* inspection boxes where an outside run turns or joins */
  const outside = pipes.filter((x) => x.props.system === 'sewage' && !x.props.pressure && !insideHouse(p, [x.props.end[0], x.props.end[1]]) && x.level === 'site');
  const nodes = new Map<string, { at: [number, number]; dirs: Set<string>; n: number }>();
  const key = (pt: number[]) => `${pt[0]!.toFixed(2)},${pt[1]!.toFixed(2)}`;
  for (const x of outside) {
    if (horiz(x) < 0.01) continue;
    const dir = Math.abs(x.props.start[0] - x.props.end[0]) > 1e-6 ? 'x' : 'y';
    for (const pt of [x.props.start, x.props.end]) {
      const k = key(pt);
      const v = nodes.get(k) ?? { at: [pt[0], pt[1]], dirs: new Set<string>(), n: 0 };
      v.dirs.add(dir); v.n++;
      nodes.set(k, v);
    }
  }
  const boxes = fixtures.filter((f) => ['inspection-box', 'grease-trap', 'lift-station'].includes(f.props.kind));
  const needBox = [...nodes.values()].filter((v) => v.dirs.size > 1 || v.n > 2);
  const missing = needBox.filter((v) => !boxes.some((b) => Math.hypot(b.props.at[0] - v.at[0], b.props.at[1] - v.at[1]) <= 0.3));
  if (outside.length) {
    out.push({
      id: 'sewage:boxes', group: 'Plumbing', elementIds: [], title: 'Inspection boxes outside',
      status: missing.length ? 'fail' : 'pass',
      value: missing.length ? `missing at ${missing.map((v) => `(${v.at[0].toFixed(1)}, ${v.at[1].toFixed(1)})`).join(', ')}` : `${boxes.filter((b) => b.props.kind === 'inspection-box').length} boxes; every turn and junction outside has one`,
      rule: 'An inspection box at every change of direction or junction outside the house, and before the property exit', source: S8160,
    });
  }

  /* grease trap on the kitchen line */
  const sinks = fixtures.filter((f) => f.props.kind === 'kitchen-sink');
  if (sinks.length) {
    const trap = fixtures.find((f) => f.props.kind === 'grease-trap');
    const through = sinks.every((s) => pipes.some((x) => x.props.network === 'sew-kitchen' && x.props.serves.includes(s.id)));
    out.push({
      id: 'sewage:grease', group: 'Plumbing', elementIds: trap ? [trap.id] : sinks.map((s) => s.id), title: 'Grease trap on the kitchen line',
      status: trap && through ? 'pass' : 'fail', value: trap && through ? `${trap.id} at (${trap.props.at[0].toFixed(1)}, ${trap.props.at[1].toFixed(1)})` : 'kitchen sink drains without a grease trap',
      rule: 'Kitchen sinks drain through a grease trap', source: S8160,
    });
  }

  /* lower level: gravity to the street, or a lift station */
  if (fixtures.some((f) => f.level === 'LL' && kindOf(f.props.kind).drainDn)) {
    const g = llGravity(p);
    const ls = fixtures.find((f) => f.props.kind === 'lift-station');
    out.push({
      id: 'sewage:ll-gravity', group: 'Plumbing', elementIds: ls ? [ls.id] : [], level: 'LL', title: 'Lower level drains to the street by gravity',
      status: g.ok ? 'pass' : 'fail',
      value: `leaves the house at ${g.leaves.toFixed(2)}, ${g.run.toFixed(1)} m at 1 % → arrives ${g.arrives.toFixed(2)}; the sewer (${g.depth.toFixed(2)} m deep) needs ≥ ${g.needs.toFixed(2)}`
        + (g.ok ? ' — gravity works' : ' — no: the lift station is needed'),
      rule: 'A side connection must come in at least 0.30 m above the bottom of the public sewer', source: `${S8160}; sewer depth from SEMAE (to confirm)`,
    });
    out.push({
      id: 'sewage:lift', group: 'Plumbing', elementIds: ls ? [ls.id] : [], level: 'LL', title: 'Lower-level lift station',
      status: g.ok || ls ? 'pass' : 'fail',
      value: ls ? (g.ok ? 'present (gravity would also work)' : 'present: sealed, pump, alarm, check valve, plus backflow valve') : g.ok ? 'not needed' : 'missing',
      rule: 'If the lower level cannot drain by gravity, a sealed lift station pumps it up', source: S8160,
    });
  }

  /* connection of the house sewage to the street sewer */
  const coll = byNet('sew-collector');
  if (coll.length) {
    const last = coll[coll.length - 1]!;
    const g = llGravity(p);
    out.push({
      id: 'sewage:street', group: 'Plumbing', elementIds: [last.id], title: 'Sewage reaches the street sewer',
      status: last.props.end[2] >= g.needs - 1e-9 ? 'pass' : 'fail',
      value: `arrives at ${last.props.end[2].toFixed(2)}; needs ≥ ${g.needs.toFixed(2)}`,
      rule: 'The house connection comes in above the public sewer', source: S8160,
    });
  }

  /* water */
  const tanks = fixtures.filter((f) => f.props.kind === 'roof-tank');
  const users = fixtures.filter((f) => (kindOf(f.props.kind).weight ?? 0) > 0);
  if (tanks.length && users.length) {
    const water = Math.min(...tanks.map((t) => t.props.z)) + 0.15;
    const pump = fixtures.some((f) => f.props.kind === 'pressure-pump');
    const elev = (l: string) => p.levels.find((x) => x.id === l)?.elevation ?? 0;
    const head = (f: Fixture) => water - (elev(f.level) + (kindOf(f.props.kind).supplyZ ?? 0.6)) + (pump && f.level === 'UF' && f.props.kind === 'shower' ? 15 : 0);
    const worst = users.reduce((a, b) => (head(b) < head(a) ? b : a));
    const most = users.reduce((a, b) => (head(b) > head(a) ? b : a));
    out.push({
      id: 'water:pressure', group: 'Plumbing', elementIds: [worst.id], level: worst.level, title: 'Water pressure at the worst fixture',
      status: head(worst) >= 1.0 && head(most) <= 40 ? 'pass' : 'fail',
      value: `${kindOf(worst.props.kind).label} on ${worst.level}: ${(head(worst) * 10).toFixed(0)} kPa static (${head(worst).toFixed(2)} m)${pump ? '; upper-floor showers boosted by the pressure pump' : ''}; highest ${(head(most) * 10).toFixed(0)} kPa`,
      rule: 'At least 10 kPa (1 m of water) at every outlet and at most 400 kPa static', source: S5626,
    });
    for (const n of nets.filter((x) => x.startsWith('cold') || x.startsWith('hot'))) {
      const segs = byNet(n);
      const bad = segs.filter((x) => x.props.load > 0 && x.props.dn < waterDnFor(x.props.load));
      out.push({
        id: `wdn:${n}`, group: 'Plumbing', elementIds: bad.map((x) => x.id), level: segs[0]!.level,
        title: `Pipe size · ${networkLabel(n)}`, status: bad.length ? 'fail' : 'pass',
        value: bad.length ? `${bad[0]!.id} DN ${bad[0]!.props.dn} for ΣP ${bad[0]!.props.load}` : `largest ΣP ${Math.max(...segs.map((x) => x.props.load)).toFixed(1)} on DN ${Math.max(...segs.map((x) => x.props.dn))}`,
        rule: 'Q = 0.3 √ΣP, speed at most 3 m/s', source: S5626,
      });
    }
  }

  /* rain */
  const u = utilities(p);
  const rain = pipes.filter((x) => x.props.system === 'rain' && !x.props.pressure && x.props.load > 0);
  if (rain.length) {
    const bad = rain.filter((x) => {
      const q = rainFlow(x.props.load, u.rainIntensity);
      const vertical = horiz(x) < 0.01;
      return q > rainCapacity(x.props.dn, vertical ? 0.04 : Math.max(slopeOf(x), 0.005));
    });
    const big = rain.reduce((a, b) => (b.props.load > a.props.load ? b : a));
    out.push({
      id: 'rain:flow', group: 'Plumbing', elementIds: bad.map((x) => x.id), title: 'Rainwater pipes carry the design storm',
      status: bad.length ? 'fail' : 'pass',
      value: bad.length ? `${bad[0]!.id} is too small` : `largest: ${big.props.load.toFixed(0)} m² → ${rainFlow(big.props.load, u.rainIntensity).toFixed(0)} L/min on DN ${big.props.dn}`,
      rule: `Flow Q = I·A/60 at ${u.rainIntensity} mm/h within the pipe capacity`, source: S10844,
    });
    out.push({
      id: 'rain:intensity', group: 'Plumbing', elementIds: [], title: 'Design rainfall for Piracicaba',
      status: 'confirm', value: `${u.rainIntensity} mm/h, 5-minute storm — TO CONFIRM`,
      rule: 'Rainfall intensity from the local rainfall curve (return period 5 years)', source: S10844,
    });
    // underground pipes need cover
    const zones = groundZones(p);
    const surf = (x: number, y: number) => {
      let z = groundAt(p, x, y, zones);
      for (const e of p.elements) if (e.type === 'Slab' && e.props.onGrade && e.tags.includes('patio') && e.props.rect && pointInRect(x, y, e.props.rect)) z = Math.max(z, e.props.topElevation);
      return z;
    };
    const shallow = pipes.filter((x) => x.level === 'site' && !insideHouse(p, [(x.props.start[0] + x.props.end[0]) / 2, (x.props.start[1] + x.props.end[1]) / 2]) && horiz(x) >= RUN
      && [x.props.start, x.props.end].some((pt) => surf(pt[0], pt[1]) - pt[2] < 0.3));
    out.push({
      id: 'site:cover', group: 'Plumbing', elementIds: shallow.map((x) => x.id), title: 'Underground pipes are buried',
      status: shallow.length ? 'warn' : 'pass',
      value: shallow.length ? `${shallow.length} run${shallow.length > 1 ? 's' : ''} with less than 0.30 m of cover (e.g. ${shallow[0]!.id}, ${networkLabel(shallow[0]!.props.network)})` : 'all underground runs have at least 0.30 m of cover',
      rule: 'At least 0.30 m of soil or paving over underground pipes', source: 'NBR 8160 / NBR 10844 (good practice)',
    });
    const ov = byNet('rain-overflow')[0];
    if (ov) {
      out.push({
        id: 'rain:overflow', group: 'Plumbing', elementIds: [ov.id], title: 'Cistern overflow to the street gutter',
        status: slopeOf(ov) >= 0.005 && ov.props.end[2] >= -0.15 - 1e-9 ? 'pass' : 'fail',
        value: `leaves the cistern at ${ov.props.start[2].toFixed(2)}, reaches the curb at ${ov.props.end[2].toFixed(2)} (${(slopeOf(ov) * 100).toFixed(1)} %)`,
        rule: 'The overflow runs by gravity to the street gutter, above the road surface', source: S10844,
      });
    }
  }
  return out;
}
