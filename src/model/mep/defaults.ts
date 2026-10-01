// Spec 04b: the service spaces of Version 3 — shafts at the stacks, the water riser and the electrical riser,
// lowered ceilings (plenums) in the wet rooms, halls, kitchen and service rooms plus the strips under the upper
// wet rooms, and the roof zones (tanks and equipment to the south, the solar array keeps the north).
import { q } from '../geometry';
import type { Project, Rect, ServiceSpace, Space } from '../schema';
import { ceilingHost, withHosts } from './hosting';
import { mepContext } from './spaces';

const R = (x0: number, y0: number, x1: number, y1: number): Rect => ({ x0, y0, x1, y1 });

/** Plenum depth by room: wet rooms, kitchen, halls and service rooms 0.32 m (lower floor 0.34 m); strips 0.25 m. */
const WET_DEPTH: Record<string, number> = { LL: 0.34, SL: 0.32, UF: 0.32 };

export function addServiceSpaces(p: Project): Project {
  const ctx = mepContext(p);
  const roofTop = ctx.elev('roof');
  const entry = p.elements.find((e) => e.id === 'UF-slab-02');
  const entryTop = entry?.type === 'Slab' ? entry.props.topElevation : ctx.elev('UF');
  const out: ServiceSpace[] = [];
  const add = (id: string, level: string, kind: ServiceSpace['props']['kind'], name: string, rect: Rect, extra: Partial<ServiceSpace['props']> = {}) =>
    out.push({ id, type: 'ServiceSpace', level, tags: [], props: { kind, name, rect, ...extra } });

  // shafts: stacked through the floors; the stacks run in the strip at x 3.28–3.52 beside the wet wall
  add('shaft-s1', 'SL', 'shaft', 'Shaft at soil stack 1 (baths 2 and 3)', R(3.28, 5.85, 3.52, 6.9), { z0: -0.6, z1: roofTop + 0.7, accessFace: 'E' });
  add('shaft-s2', 'SL', 'shaft', 'Shaft at soil stack 2 (master bath)', R(3.28, 10.7, 3.52, 11.4), { z0: -0.3, z1: roofTop + 0.7, accessFace: 'E' });
  add('shaft-w', 'SL', 'shaft', 'Water shaft (feed, risers, roof downpipes)', R(0.1, 5.85, 0.5, 6.75), { z0: -0.6, z1: roofTop + 0.5, accessFace: 'E' });
  add('shaft-e', 'SL', 'shaft', 'Electrical shaft (riser)', R(0.1, 5.3, 0.4, 5.6), { z0: -0.6, z1: roofTop + 0.5, accessFace: 'E' });

  // plenums: the wet rooms, kitchen, halls and service rooms, where a slab is above
  for (const s of p.elements) {
    if (s.type !== 'Space' || !['LL', 'SL', 'UF'].includes(s.level)) continue;
    if (!wantsPlenum(s)) continue;
    s.props.cells.forEach((c, i) => {
      const r = clipToSlab(ctx, s.level, c);
      if (!r) return;
      add(`plenum-${s.id}-${i}`, s.level, 'plenum', `Lowered ceiling · ${s.props.name}${s.props.cells.length > 1 ? ` (${i + 1})` : ''}`, r, { depth: WET_DEPTH[s.level] });
    });
  }
  // strips under the upper-floor wet rooms (dining and living) and the collector's bulkhead in the studio
  const sl = (name: string) => p.elements.find((e): e is Space => e.type === 'Space' && e.level === 'SL' && e.props.name === name);
  for (const name of ['Dining', 'Living']) {
    const s = sl(name);
    if (!s) continue;
    const c = s.props.cells[0]!;
    // the dining strip is wider, so pipes can cross the beam on grid line y 8.5 in the middle third of its span
    const x1 = name === 'Dining' ? 6.9 : 5.0;
    add(`plenum-strip-${s.id}`, 'SL', 'plenum', `Lowered ceiling · ${name} (${name === 'Dining' ? 'south two thirds' : 'strip under the upper bathrooms'})`, R(c.x0, c.y0, Math.min(c.x1, x1), c.y1), { depth: 0.25 });
  }
  const studio = p.elements.find((e): e is Space => e.type === 'Space' && e.level === 'LL' && e.props.name.startsWith('Studio'));
  if (studio) add('plenum-strip-studio', 'LL', 'plenum', 'Bulkhead · Studio (sewage collector)', R(3.26, 8.5, 3.82, 13.3), { depth: 0.46 });

  // roof zones
  add('roof-tech', 'roof', 'roof-zone', 'Roof · tanks and equipment (south band)', R(0.1, 5.2, 2.1, 12.4), { z0: roofTop, purpose: 'tanks', access: 'roof hatch with a fixed ladder from the upper hall at (2.4, 11.9)' });
  add('roof-pv', 'roof', 'roof-zone', 'Roof · solar array (north)', R(2.3, 5.0, 8.6, 13.6), { z0: roofTop, purpose: 'pv', access: 'over the parapet from the tanks zone' });
  if (entry?.type === 'Slab' && entry.props.rect) {
    const r = entry.props.rect;
    add('roof-entry', 'roof', 'roof-zone', 'Entry roof · equipment', R(r.x0 + 0.1, r.y0 + 0.1, r.x1 - 0.1, r.y1 - 0.1), { z0: entryTop, purpose: 'equipment', access: 'from the window of bedroom 2 and a ladder from the patio' });
  }
  return { ...p, elements: [...p.elements.filter((e) => e.type !== 'ServiceSpace'), ...out] };
}

function wantsPlenum(s: Space): boolean {
  const { zone, name } = s.props;
  if (zone === 'stair') return false;
  return zone === 'wet' || zone === 'circ' || zone === 'service' || name === 'Kitchen';
}

/** The part of a room cell that has a structural slab above (stair voids are cut away). */
function clipToSlab(ctx: ReturnType<typeof mepContext>, level: string, c: Rect): Rect | null {
  const has = (x: number, y: number) => ctx.soffit(level, x, y) !== null;
  let { x0, y0, x1, y1 } = c;
  const step = 0.05;
  const rowOk = (y: number) => [x0 + 0.06, (x0 + x1) / 2, x1 - 0.06].every((x) => has(x, y));
  const colOk = (x: number) => [y0 + 0.06, (y0 + y1) / 2, y1 - 0.06].every((y) => has(x, y));
  for (let k = 0; k < 400 && y1 - y0 > 0.3 && !rowOk(y0 + 0.03); k++) y0 = q(y0 + step);
  for (let k = 0; k < 400 && y1 - y0 > 0.3 && !rowOk(y1 - 0.03); k++) y1 = q(y1 - step);
  for (let k = 0; k < 400 && x1 - x0 > 0.3 && !colOk(x0 + 0.03); k++) x0 = q(x0 + step);
  for (let k = 0; k < 400 && x1 - x0 > 0.3 && !colOk(x1 - 0.03); k++) x1 = q(x1 - step);
  if (x1 - x0 < 0.3 || y1 - y0 < 0.3 || !has((x0 + x1) / 2, (y0 + y1) / 2)) return null;
  return { x0, y0, x1, y1 };
}

/** First hosting of Version 3: lights with no slab above them (rooms under the stair) become wall lights; then every item is hosted. */
/** Spec 08 corrected the door-swing rule (a leaf no longer reaches through a wall into the next room). These points aim
 *  at the places accepted in the 04b review, so the plumbing around them does not shift with the correction. */
const ACCEPTED_04B: Record<string, [number, number]> = { 'dev-switch-07': [1.14, 4.115], 'dev-inverter-01': [1.28, 5.13] };

export function hostV3(p: Project): Project {
  const elements = p.elements.map((e) => {
    if (e.type === 'Device' && ACCEPTED_04B[e.id]) return { ...e, props: { ...e.props, at: ACCEPTED_04B[e.id]! } };
    if (e.type !== 'Device' || e.props.kind !== 'ceiling-light' || !['LL', 'SL', 'UF'].includes(e.level)) return e;
    if (ceilingHost(p, e.level, e.props.at)) return e;
    return { ...e, props: { ...e.props, kind: 'wall-light', name: e.props.name.replace('Ceiling light', 'Wall light'), z: q(mepContext(p).elev(e.level) + 2.2) } };
  });
  return withHosts({ ...p, elements }, { fresh: true });
}
