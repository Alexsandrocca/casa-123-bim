// Code checks. Each result says pass/fail, the rule and where the rule comes from.
import {
  distSegSeg, getEl, glassArea, openingSegIn, pointInRect, spaceArea, spacesOn, toLot,
} from './geometry';
import { PLAN_LEVELS, type Project, type Space, type Stair } from './schema';
import { EAVES_LIMIT_DEFAULT } from './site';
import { checkSupport } from './support';

export type CheckStatus = 'pass' | 'warn' | 'fail';
export interface CheckResult {
  id: string;
  group: 'Rooms' | 'Windows' | 'Circulation' | 'Stairs' | 'Site' | 'Structure';
  title: string;
  status: CheckStatus;
  value: string;
  rule: string;
  source: string;
  level?: string;
  elementIds: string[];
}

const SANITARY = 'SP sanitary code, Decreto 12.342/78';
const TOL = 0.005;

/** Minimum floor area, same table as the prototype. */
export function minArea(space: Space): number {
  const { name, zone } = space.props;
  if (name === 'Closet') return 0;
  if (zone === 'private') return name === 'Master bedroom' ? 10 : 8;
  if (zone === 'wet') return 2.5;
  if (name === 'Kitchen') return 4;
  if (name === 'Living' || zone === 'work') return 8;
  return 0;
}

export const needsDaylight = (s: Space) =>
  ['private', 'social', 'work'].includes(s.props.zone) && s.props.name !== 'Closet';

const m2 = (v: number) => `${v.toFixed(2)} m²`;
const m = (v: number) => `${v.toFixed(2)} m`;

function roomChecks(p: Project): CheckResult[] {
  const out: CheckResult[] = [];
  for (const L of PLAN_LEVELS) {
    for (const s of spacesOn(p, L)) {
      if (s.props.zone === 'stair') continue;
      const a = spaceArea(s);
      const min = minArea(s);
      if (min > 0) {
        out.push({
          id: `area:${s.id}`, group: 'Rooms', level: L, elementIds: [s.id],
          title: `${s.props.name} floor area`,
          status: a >= min - TOL ? 'pass' : 'fail',
          value: `${m2(a)} (min ${min} m²)`,
          rule: s.props.zone === 'private'
            ? 'Bedrooms: 10 m² for the first (master), 8 m² for the others'
            : s.props.zone === 'wet' ? 'Bathrooms and WCs: at least 2.5 m²'
              : s.props.name === 'Kitchen' ? 'Kitchen: at least 4 m²' : 'Living rooms and work rooms: at least 8 m²',
          source: SANITARY,
        });
      }
      if (needsDaylight(s)) {
        const g = glassArea(p, s);
        const ratio = a > 0 ? g / a : 0;
        out.push({
          id: `light:${s.id}`, group: 'Windows', level: L, elementIds: [s.id],
          title: `${s.props.name} window ratio`,
          status: g >= a / 8 - TOL ? (g >= a / 6 - TOL ? 'pass' : 'warn') : 'fail',
          value: g > 0 ? `glass ${m2(g)} = 1/${Math.max(1, Math.round(a / g))} of the floor${ratio < 1 / 6 && g >= a / 8 - TOL ? ' (below the 1/6 target)' : ''}` : 'no window',
          rule: 'Window glass at least 1/8 of the floor area (design target 1/6)',
          source: SANITARY,
        });
      }
    }
  }
  return out;
}

function circulationChecks(p: Project): CheckResult[] {
  const out: CheckResult[] = [];
  for (const L of PLAN_LEVELS) {
    for (const s of spacesOn(p, L)) {
      if (s.props.zone !== 'circ') continue;
      const w = Math.min(...s.props.cells.map((c) => Math.min(c.x1 - c.x0, c.y1 - c.y0)));
      out.push({
        id: `corridor:${s.id}`, group: 'Circulation', level: L, elementIds: [s.id],
        title: `${s.props.name} width`, status: w >= 0.9 - TOL ? 'pass' : 'fail',
        value: `narrowest part ${m(w)}`,
        rule: 'Corridors and halls at least 0.90 m wide', source: SANITARY,
      });
    }
  }
  return out;
}

/** Elevation of every tread nosing along each flight, with its plan position. */
export function treadPoints(p: Project, st: Stair): { x: number; y: number; z: number }[] {
  const from = p.levels.find((l) => l.id === st.props.fromLevel);
  if (!from) return [];
  const pts: { x: number; y: number; z: number }[] = [];
  let z = from.elevation;
  for (const f of st.props.flights) {
    const dir = Math.sign(f.yTop - f.yBottom) || 1;
    const x = (f.x0 + f.x1) / 2;
    for (let i = 0; i < f.risers; i++) {
      z += st.props.riser;
      // tread i+1 starts one tread further along the flight
      const y = f.yBottom + dir * st.props.tread * Math.min(i, f.risers - 1);
      pts.push({ x, y, z });
    }
  }
  return pts;
}

/** Smallest vertical clearance above the treads: underside of any floor or roof slab above, except stair wells. */
export function headroom(p: Project, st: Stair): number {
  let min = Infinity;
  for (const t of treadPoints(p, st)) {
    for (const lv of p.levels) {
      if (!lv.outline || lv.elevation <= t.z + 0.01) continue;
      if (!pointInRect(t.x, t.y, lv.outline)) continue;
      const well = spacesOn(p, lv.id).some((s) => s.props.zone === 'stair' && s.props.cells.some((c) => pointInRect(t.x, t.y, c)));
      if (well) continue;
      min = Math.min(min, lv.elevation - p.structure.structureDepth - t.z);
    }
  }
  return min;
}

function stairChecks(p: Project): CheckResult[] {
  const out: CheckResult[] = [];
  for (const e of p.elements) {
    if (e.type !== 'Stair') continue;
    const { riser, tread, width, flights, name } = e.props;
    const blondel = 2 * riser + tread;
    out.push({
      id: `blondel:${e.id}`, group: 'Stairs', elementIds: [e.id], level: e.level,
      title: `${name}: comfort (Blondel)`,
      status: blondel >= 0.63 - 1e-9 && blondel <= 0.65 + 1e-9 ? 'pass' : 'fail',
      value: `2 × ${riser.toFixed(3)} + ${tread.toFixed(2)} = ${blondel.toFixed(3)} m`,
      rule: '0.63 ≤ 2h + b ≤ 0.65 (h riser, b tread)', source: 'Blondel rule, project rulebook',
    });
    const hr = headroom(p, e);
    out.push({
      id: `headroom:${e.id}`, group: 'Stairs', elementIds: [e.id], level: e.level,
      title: `${name}: headroom`,
      status: hr >= 2.1 - TOL ? 'pass' : 'fail',
      value: Number.isFinite(hr) ? `lowest ${m(hr)}` : 'open above',
      rule: 'Headroom above every tread at least 2.10 m', source: 'Project rulebook (stair comfort)',
    });
    const narrow = Math.min(width, ...flights.map((f) => f.x1 - f.x0));
    out.push({
      id: `stairwidth:${e.id}`, group: 'Stairs', elementIds: [e.id], level: e.level,
      title: `${name}: width`, status: narrow >= 0.9 - TOL ? 'pass' : 'fail',
      value: m(narrow), rule: 'Stairs at least 0.90 m wide', source: SANITARY,
    });
  }
  return out;
}

/** Neighbour boundaries (not the street): south side, rear, north side. Lot coordinates. */
function neighbourBoundaries(p: Project): { name: string; a: [number, number]; b: [number, number] }[] {
  const [s0, n0, n1, s1] = p.site.lotPolygon as [[number, number], [number, number], [number, number], [number, number]];
  return [
    { name: 'south boundary', a: s0, b: s1 },
    { name: 'rear boundary', a: s1, b: n1 },
    { name: 'north boundary', a: n0, b: n1 },
  ];
}

function siteChecks(p: Project): CheckResult[] {
  const out: CheckResult[] = [];
  const bounds = neighbourBoundaries(p);

  // Civil Code 1.301: no window within 1.50 m of a neighbour boundary.
  for (const L of PLAN_LEVELS) {
    for (const e of p.elements) {
      if (e.type !== 'Opening' || e.level !== L) continue;
      if (e.props.role !== 'window' && e.props.kind !== 'slider') continue;
      const s = openingSegIn(p, e);
      if (!s) continue;
      const A = s.o === 'v' ? toLot(p, s.c, s.a) : toLot(p, s.a, s.c);
      const B = s.o === 'v' ? toLot(p, s.c, s.b) : toLot(p, s.b, s.c);
      let best = { d: Infinity, name: '' };
      for (const bd of bounds) {
        const d = distSegSeg(A, B, bd.a, bd.b);
        if (d < best.d) best = { d, name: bd.name };
      }
      const host = getEl(p, e.props.host);
      out.push({
        id: `1301:${e.id}`, group: 'Site', level: L, elementIds: [e.id],
        title: `${e.props.kind === 'slider' ? 'Glass slider' : e.props.high ? 'High window' : 'Window'} ${e.id}${host ? '' : ''}`,
        status: best.d >= 1.5 - TOL ? 'pass' : 'fail',
        value: `${m(best.d)} from the ${best.name}`,
        rule: 'No window within 1.50 m of a neighbour boundary', source: 'Civil Code (Código Civil) art. 1.301',
      });
    }
  }

  // Footprint inside the setbacks.
  const sb = p.site.setbacks;
  const [, n0, n1] = p.site.lotPolygon as [[number, number], [number, number], [number, number]];
  const depth = Math.max(...p.site.lotPolygon.map((c) => c[1]));
  let front = Infinity, rear = Infinity, south = Infinity, north = Infinity;
  for (const lv of p.levels) {
    if (!lv.plan || !lv.outline) continue;
    const o = lv.outline;
    const corners: [number, number][] = [toLot(p, o.x0, o.y0), toLot(p, o.x1, o.y0), toLot(p, o.x1, o.y1), toLot(p, o.x0, o.y1)];
    for (const [x, y] of corners) {
      front = Math.min(front, y);
      rear = Math.min(rear, depth - y);
      south = Math.min(south, x);
      north = Math.min(north, distSegSeg([x, y], [x, y], n0, n1));
    }
  }
  const setback = (key: string, label: string, value: number, need: number) => out.push({
    id: `setback:${key}`, group: 'Site', elementIds: [],
    title: `${label} setback`, status: value >= need - TOL ? 'pass' : 'fail',
    value: `${m(value)} (min ${need.toFixed(2)} m)`,
    rule: `Building footprint at least ${need.toFixed(2)} m from the ${label.toLowerCase()} boundary`,
    source: 'Setbacks given by the owner (Piracicaba zoning to be confirmed)',
  });
  setback('front', 'Front', front, sb.front);
  setback('rear', 'Rear', rear, sb.rear);
  setback('south', 'South side', south, sb.sides);
  setback('north', 'North side', north, sb.sides);
  return out;
}

function structureChecks(p: Project): CheckResult[] {
  const out: CheckResult[] = [];
  const s = checkSupport(p);
  const n = p.elements.filter((e) => ['Footing', 'Column', 'Beam', 'Slab', 'Wall', 'Stair', 'Deck'].includes(e.type)).length;
  out.push({
    id: 'support:all', group: 'Structure', elementIds: s.unsupported.map((e) => e.id),
    title: 'Nothing floats', status: s.unsupported.length ? 'fail' : 'pass',
    value: s.unsupported.length ? `${s.unsupported.length} of ${n} elements have no support below` : `all ${n} elements rest on something`,
    rule: 'Every element rests on a supported element, down to footings in the ground', source: 'Project rule (spec 02); NBR 8800 / NBR 6122 for the real design',
  });
  for (const e of s.unsupported) {
    out.push({
      id: `support:${e.id}`, group: 'Structure', level: e.level, elementIds: [e.id],
      title: `${e.type} ${e.id} is not supported`, status: 'fail', value: s.reasons.get(e.id) ?? 'no support',
      rule: 'Nothing may float', source: 'Project rule (spec 02)',
    });
  }
  const limit = p.site.eavesLimit ?? EAVES_LIMIT_DEFAULT;
  for (const e of p.elements) {
    if (e.type !== 'Slab' || e.props.eaves === undefined) continue;
    out.push({
      id: `eaves:${e.id}`, group: 'Site', elementIds: [e.id], title: `${e.props.name} eaves`,
      status: e.props.eaves <= limit + 1e-9 ? 'pass' : 'fail',
      value: `${e.props.eaves.toFixed(2)} m (limit ${limit.toFixed(2)} m)`,
      rule: `Eaves up to ${limit.toFixed(2)} m are not counted in site coverage`, source: 'Piracicaba LC 474/2025',
    });
  }
  return out;
}

export function runChecks(p: Project): CheckResult[] {
  return [...roomChecks(p), ...circulationChecks(p), ...stairChecks(p), ...siteChecks(p), ...structureChecks(p)];
}

export function summarize(results: CheckResult[]) {
  return {
    pass: results.filter((r) => r.status === 'pass').length,
    warn: results.filter((r) => r.status === 'warn').length,
    fail: results.filter((r) => r.status === 'fail').length,
  };
}
