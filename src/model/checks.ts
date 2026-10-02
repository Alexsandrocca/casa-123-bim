// Code checks. Each result says pass/fail, the rule and where the rule comes from.
import {
  distSegSeg, getEl, glassArea, openingSegIn, pointInRect, spaceArea, spacesOn, toLot,
} from './geometry';
import { planLevels, type NumFact, type Project, type Rect, type Space, type Stair } from './schema';
import { ccwLot, edgeRoles, lotFigures, polyArea, type EdgeRole } from './lot';
import { groundZones } from './site';
import { compassOf } from './orientation';
import { cityCode, sanitary } from './region';
import { checkSupport } from './support';
import { plumbingChecks } from './plumbing/checks';
import { electricalChecks } from './electrical/checks';
import { mepChecks } from './mep/checks';
import { engineeringChecks } from './eng/checks';

/** confirm = cannot be decided by the app; an authority must confirm it. Never counts as a pass. */
export type CheckStatus = 'pass' | 'warn' | 'fail' | 'confirm';
export interface CheckResult {
  id: string;
  group: 'Rooms' | 'Windows' | 'Circulation' | 'Stairs' | 'Site' | 'Structure' | 'Plumbing' | 'Electrical' | 'Solar' | 'Cameras' | 'MEP physics' | 'Thermal' | 'Environment';
  title: string;
  status: CheckStatus;
  value: string;
  rule: string;
  source: string;
  level?: string;
  elementIds: string[];
  /** Where the problem is (MEP rows): a click zooms the 3D view to it. */
  at?: [number, number, number];
}

const SIDE = { N: 'North', E: 'East', S: 'South', W: 'West' } as const;
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
  for (const L of planLevels(p)) {
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
          source: sanitary(p),
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
          source: sanitary(p),
        });
      }
    }
  }
  return out;
}

function circulationChecks(p: Project): CheckResult[] {
  const out: CheckResult[] = [];
  for (const L of planLevels(p)) {
    for (const s of spacesOn(p, L)) {
      if (s.props.zone !== 'circ') continue;
      const w = Math.min(...s.props.cells.map((c) => Math.min(c.x1 - c.x0, c.y1 - c.y0)));
      out.push({
        id: `corridor:${s.id}`, group: 'Circulation', level: L, elementIds: [s.id],
        title: `${s.props.name} width`, status: w >= 0.9 - TOL ? 'pass' : 'fail',
        value: `narrowest part ${m(w)}`,
        rule: 'Corridors and halls at least 0.90 m wide', source: sanitary(p),
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
      value: m(narrow), rule: 'Stairs at least 0.90 m wide', source: sanitary(p),
    });
  }
  return out;
}

type P2 = [number, number];
/** The lot's boundaries with their role, in lot coordinates (P1: from site.lot; the left side, the rear, the right side, then the streets). */
function boundaries(p: Project): { role: EdgeRole; name: string; a: P2; b: P2 }[] {
  const lot = ccwLot(p.site.lot), roles = edgeRoles(lot), n = lot.polygon.length;
  const order: Record<EdgeRole, number> = { left: 0, rear: 1, right: 2, street: 3 };
  return lot.polygon.map((a, i) => {
    const b = lot.polygon[(i + 1) % n]!, role = roles[i]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const name = role === 'rear' ? 'rear boundary' : role === 'street' ? 'street' : `${SIDE[compassOf(p, (b[1] - a[1]) / len, -(b[0] - a[0]) / len)].toLowerCase()} boundary`;
    return { role, name, a, b };
  }).sort((u, v) => order[u.role] - order[v.role]);
}
/** Neighbour boundaries (not the street). */
const neighbourBoundaries = (p: Project) => boundaries(p).filter((b) => b.role !== 'street');

function siteChecks(p: Project): CheckResult[] {
  const out: CheckResult[] = [];
  const bounds = neighbourBoundaries(p);

  // Civil Code 1.301: no window within 1.50 m of a neighbour boundary.
  for (const L of planLevels(p)) {
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

  // Footprint inside the setbacks (P1: every boundary of the lot, with its own setback; a corner lot has two fronts).
  const sb = p.site.lot.rules.setbacks;
  const corners = footprintCorners(p);
  const bs = boundaries(p);
  const dist = (pick: (b: (typeof bs)[number]) => boolean) => {
    let d = Infinity;
    // signed: a corner on the outer side of a boundary counts as negative
    for (const b of bs.filter(pick)) for (const c of corners) {
      const out = (b.b[0] - b.a[0]) * (c[1] - b.a[1]) - (b.b[1] - b.a[1]) * (c[0] - b.a[0]) < 0;
      d = Math.min(d, (out ? -1 : 1) * distSegSeg(c, c, b.a, b.b));
    }
    return d;
  };
  const setback = (key: string, label: string, value: number, need: NumFact) => out.push(need.value === null ? {
    id: `setback:${key}`, group: 'Site', elementIds: [], title: `${label} setback`, status: 'confirm',
    value: `${m(value)} (setback TO CONFIRM)`, rule: `Building footprint inside the ${label.toLowerCase()} setback`, source: cityCode(p),
  } : {
    id: `setback:${key}`, group: 'Site', elementIds: [],
    title: `${label} setback`, status: value >= need.value - TOL ? 'pass' : 'fail',
    value: `${m(value)} (min ${need.value.toFixed(2)} m)`,
    rule: `Building footprint at least ${need.value.toFixed(2)} m from the ${label.toLowerCase()} boundary`,
    source: need.status === 'given' ? `Setbacks given by the owner (${cityCode(p)})` : need.status === 'confirmed' ? `Setbacks confirmed (${cityCode(p)})` : `Setbacks TO CONFIRM (${cityCode(p)})`,
  });
  const streets = bs.filter((b) => b.role === 'street');
  streets.forEach((st, k) => {
    setback(k ? `front-${k + 1}` : 'front', k ? `Front (street ${k + 1})` : 'Front', dist((b) => b === st), sb.front);
    if (k) return;
    const carports = p.elements.filter((e) => e.type === 'Carport');
    if (carports.length) {
      const r = out[out.length - 1]!;
      r.value += ` · house building line; not counting the carport (${carports.map((c) => c.id).join(', ')}), see its own check`;
      r.elementIds = carports.map((c) => c.id);
    }
  });
  if (bs.some((b) => b.role === 'rear')) setback('rear', 'Rear', dist((b) => b.role === 'rear'), sb.rear);
  // the two side boundaries, named by the compass point they face
  const s0 = SIDE[compassOf(p, -1, 0)], s1 = SIDE[compassOf(p, 1, 0)];
  if (bs.some((b) => b.role === 'left')) setback(s0.toLowerCase(), `${s0} side`, dist((b) => b.role === 'left'), sb.left);
  if (bs.some((b) => b.role === 'right')) setback(s1.toLowerCase(), `${s1} side`, dist((b) => b.role === 'right'), sb.right);
  out.push(...areaChecks(p));
  if (!p.site.region.rules.code) {
    out.push({
      id: 'site:city-rules', group: 'Site', elementIds: [], title: `City rules for ${p.site.region.city || 'this lot'}`, status: 'confirm',
      value: 'TO CONFIRM: setbacks, site coverage, eaves and height limits are not known for this city yet',
      rule: 'The lot must follow the city zoning and building code', source: cityCode(p),
    });
  }
  return out;
}

function structureChecks(p: Project): CheckResult[] {
  const out: CheckResult[] = [];
  const s = checkSupport(p);
  const n = p.elements.filter((e) => ['Footing', 'Column', 'Beam', 'Slab', 'Wall', 'Stair', 'Deck', 'Carport'].includes(e.type)).length;
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
  const limit = p.site.lot.rules.eaves.value ?? undefined;
  for (const e of p.elements) {
    if (e.type !== 'Slab' || e.props.eaves === undefined) continue;
    out.push(limit === undefined ? {
      id: `eaves:${e.id}`, group: 'Site', elementIds: [e.id], title: `${e.props.name} eaves`, status: 'confirm',
      value: `${e.props.eaves.toFixed(2)} m (limit TO CONFIRM)`, rule: 'Eaves up to the city limit are not counted in site coverage', source: cityCode(p),
    } : {
      id: `eaves:${e.id}`, group: 'Site', elementIds: [e.id], title: `${e.props.name} eaves`,
      status: e.props.eaves <= limit + 1e-9 ? 'pass' : 'fail',
      value: `${e.props.eaves.toFixed(2)} m (limit ${limit.toFixed(2)} m)`,
      rule: `Eaves up to ${limit.toFixed(2)} m are not counted in site coverage`, source: cityCode(p),
    });
  }
  return out;
}

/** Parking bays: at least 2.50 × 5.00 m, not overlapping, inside the carport, with 0.60 m free on at least one side to open the doors. */
function parkingChecks(p: Project): CheckResult[] {
  const out: CheckResult[] = [];
  for (const c of p.elements) {
    if (c.type !== 'Carport') continue;
    const bays = c.props.parking, r = c.props.rect;
    const cols = p.elements.filter((e) => e.type === 'Column' && e.tags.includes('carport') && pointInRect(e.props.at[0], e.props.at[1], r));
    const problems: string[] = [];
    bays.forEach((b, i) => {
      const w = Math.min(b.x1 - b.x0, b.y1 - b.y0), d = Math.max(b.x1 - b.x0, b.y1 - b.y0);
      if (w < 2.5 - TOL || d < 5.0 - TOL) problems.push(`bay ${i + 1} is ${w.toFixed(2)} × ${d.toFixed(2)} m`);
      if (b.x0 < r.x0 - TOL || b.x1 > r.x1 + TOL || b.y0 < r.y0 - TOL || b.y1 > r.y1 + TOL) problems.push(`bay ${i + 1} sticks out of the carport`);
      // free strip beside the bay (x direction), not taken by another bay or a column
      const free = (x0: number, x1: number) => x0 >= r.x0 - TOL && x1 <= r.x1 + TOL
        && !bays.some((o, j) => j !== i && o.x1 > x0 + TOL && o.x0 < x1 - TOL)
        && !cols.some((e) => e.type === 'Column' && e.props.at[0] > x0 && e.props.at[0] < x1 && e.props.at[1] > b.y0 + 0.5 && e.props.at[1] < b.y1 - 0.5);
      // a strip between two bays may serve both
      if (!free(b.x0 - 0.6, b.x0) && !free(b.x1, b.x1 + 0.6)) problems.push(`bay ${i + 1} has no 0.60 m to open a door`);
    });
    for (let i = 0; i < bays.length; i++) for (let j = i + 1; j < bays.length; j++) {
      const a = bays[i]!, b = bays[j]!;
      if (a.x1 > b.x0 + TOL && b.x1 > a.x0 + TOL && a.y1 > b.y0 + TOL && b.y1 > a.y0 + TOL) problems.push(`bays ${i + 1} and ${j + 1} overlap`);
    }
    out.push({
      id: `parking:${c.id}`, group: 'Site', elementIds: [c.id], title: 'Parking',
      status: bays.length >= 2 && !problems.length ? 'pass' : 'fail',
      value: problems.length ? problems.join('; ') : `${bays.length} bays of 2.50 × 5.00 m with room to open the doors`,
      rule: '2 parking bays of at least 2.50 × 5.00 m, with 0.60 m beside each to open the doors', source: 'Owner requirement (spec 02b)',
    });
    out.push({
      id: `carport-setback:${c.id}`, group: 'Site', elementIds: [c.id], title: 'Carport in the front setback',
      status: 'confirm',
      value: 'TO CONFIRM with the city hall (Prefeitura)',
      rule: `A covered carport in the ${p.site.lot.rules.setbacks.front.value === null ? '' : `${p.site.lot.rules.setbacks.front.value.toFixed(0)} m `}front setback, and how much of it counts in site coverage`,
      source: `${cityCode(p)} (to confirm)`,
    });
  }
  return out;
}

/** Plan corners of every floor outline, in lot coordinates. */
function footprintCorners(p: Project): P2[] {
  const out: P2[] = [];
  for (const lv of p.levels) {
    if (!lv.plan || !lv.outline) continue;
    const o = lv.outline;
    out.push(toLot(p, o.x0, o.y0), toLot(p, o.x1, o.y0), toLot(p, o.x1, o.y1), toLot(p, o.x0, o.y1));
  }
  return out;
}

/** Area covered by a set of rectangles (overlaps counted once). */
export function unionArea(rs: Rect[]): number {
  const xs = [...new Set(rs.flatMap((r) => [r.x0, r.x1]))].sort((a, b) => a - b);
  let a = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const xm = (xs[i]! + xs[i + 1]!) / 2;
    const iv = rs.filter((r) => r.x0 < xm && r.x1 > xm).map((r) => [r.y0, r.y1] as [number, number]).sort((u, v) => u[0] - v[0]);
    let len = 0, cur: [number, number] | null = null;
    for (const [y0, y1] of iv) {
      if (!cur || y0 > cur[1]) { if (cur) len += cur[1] - cur[0]; cur = [y0, y1]; } else cur[1] = Math.max(cur[1], y1);
    }
    if (cur) len += cur[1] - cur[0];
    a += len * (xs[i + 1]! - xs[i]!);
  }
  return a;
}

/** P1: site coverage (TO), floor-area ratio (CA), permeable area (TP) and height, when the lot has those rules. */
function areaChecks(p: Project): CheckResult[] {
  const out: CheckResult[] = [];
  const r = p.site.lot.rules;
  const lotA = lotFigures(p.site.lot).area;
  const src = (f: NumFact) => `${cityCode(p)}${f.status === 'to-confirm' ? ' (TO CONFIRM)' : ''}`;
  const outlines = p.levels.filter((l) => l.plan && l.outline).map((l) => l.outline!);
  const footprint = unionArea(outlines);
  if (r.coverage.value !== null) {
    const max = (r.coverage.value / 100) * lotA;
    out.push({
      id: 'site:coverage', group: 'Site', elementIds: [], title: 'Site coverage (TO)', status: footprint <= max + TOL ? 'pass' : 'fail',
      value: `${m2(footprint)} = ${((footprint / lotA) * 100).toFixed(1)} % of the lot (max ${r.coverage.value} % = ${m2(max)})`,
      rule: `Building footprint at most ${r.coverage.value} % of the lot (eaves within the limit and the carport as the city decides)`, source: src(r.coverage),
    });
  }
  if (r.far.value !== null) {
    const built = planLevels(p).reduce((a, L) => a + spacesOn(p, L).reduce((b, s) => b + spaceArea(s), 0), 0);
    const max = r.far.value * lotA;
    out.push({
      id: 'site:far', group: 'Site', elementIds: [], title: 'Floor-area ratio (CA)', status: built <= max + TOL ? 'pass' : 'fail',
      value: `${m2(built)} built = ${(built / lotA).toFixed(2)} × the lot (max ${r.far.value} = ${m2(max)})`,
      rule: `Total built area at most ${r.far.value} × the lot area`, source: src(r.far),
    });
  }
  if (r.permeability.value !== null) {
    const paved = groundZones(p).filter((z) => z.surface === 'paving' || z.surface === 'ramp').reduce((a, z) => a + polyArea(z.poly), 0);
    const free = Math.max(0, lotA - footprint - paved), min = (r.permeability.value / 100) * lotA;
    out.push({
      id: 'site:permeable', group: 'Site', elementIds: [], title: 'Permeable area (TP)', status: free >= min - TOL ? 'pass' : 'fail',
      value: `about ${m2(free)} = ${((free / lotA) * 100).toFixed(1)} % of the lot (min ${r.permeability.value} % = ${m2(min)})`,
      rule: `At least ${r.permeability.value} % of the lot left permeable (garden, not paved or built)`, source: src(r.permeability),
    });
  }
  if (r.height.value !== null) {
    const top = Math.max(...p.elements.flatMap((e) => (e.type === 'Slab' ? [e.props.topElevation + (e.props.parapet ?? 0)] : [])), ...p.levels.map((l) => l.elevation));
    out.push({
      id: 'site:height', group: 'Site', elementIds: [], title: 'Height limit', status: top <= r.height.value + TOL ? 'pass' : 'fail',
      value: `top at +${top.toFixed(2)} m above the street (max ${r.height.value.toFixed(2)} m)`,
      rule: `Building at most ${r.height.value.toFixed(2)} m high`, source: src(r.height),
    });
  }
  if (r.floors.value !== null) {
    const n = planLevels(p).length;
    out.push({
      id: 'site:floors', group: 'Site', elementIds: [], title: 'Number of floors', status: n <= r.floors.value ? 'pass' : 'fail',
      value: `${n} floors (max ${r.floors.value})`, rule: `At most ${r.floors.value} floors`, source: src(r.floors),
    });
  }
  return out;
}

export function runChecks(p: Project): CheckResult[] {
  return [...roomChecks(p), ...circulationChecks(p), ...stairChecks(p), ...siteChecks(p), ...parkingChecks(p), ...structureChecks(p), ...plumbingChecks(p), ...electricalChecks(p), ...mepChecks(p), ...engineeringChecks(p)];
}

export function summarize(results: CheckResult[]) {
  return {
    pass: results.filter((r) => r.status === 'pass').length,
    warn: results.filter((r) => r.status === 'warn').length,
    fail: results.filter((r) => r.status === 'fail').length,
    confirm: results.filter((r) => r.status === 'confirm').length,
  };
}
