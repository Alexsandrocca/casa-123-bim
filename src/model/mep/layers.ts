// Spec 04b: builds the routing layers (rasters of service spaces at one height band) for each system.
import type { Rect } from '../schema';
import { Layer, type P2 } from './grid';
import { ELEC_HOT_GAP, WEB_HOLE, outerD } from './library';
import type { Carry, MepContext, P3, Volume } from './spaces';

/** A pipe or conduit already placed, to keep clear of. */
export interface Occ { a: P3; b: P3; r: number; carry: Carry; net: string }

export interface LayerReq {
  key: string;
  carry: Carry;
  dn: number;
  diagonal?: boolean;
  /** Levels whose ceiling plenums take part (the plenum under the slab above that level). */
  plenums?: string[];
  crawl?: boolean;
  /** Underground outside the house. */
  ground?: boolean;
  /** Under the lower-level slab on grade. */
  underLL?: boolean;
  /** Floor screed of these levels ('roof' = the roof topping). */
  screeds?: string[];
  /** Roof zones (equipment areas on roofs). */
  roof?: boolean;
  /** Extra bounds (e.g. the street, for the sewer connection). */
  extra?: Rect[];
  occ?: Occ[];
  /** Points to keep clear (ceiling-light boxes, fixture drains), with a radius. */
  reserved?: { at: P2; r: number; why: string }[];
  /** Cost multiplier for the ground (digging) relative to inside spaces. */
  groundCost?: number;
}

/** Height of a run of this system inside a host, at a point. */
export function bandZ(_ctx: MepContext, v: Volume, carry: Carry, x: number, y: number, dn: number): number {
  const r = outerD(dn) / 2;
  const top = v.zHi(x, y);
  switch (v.kind) {
    case 'plenum': {
      // a deep bulkhead carries its runs along its bottom, under the beams; a normal plenum stacks them from the slab down:
      // cold and vents just under the deck, hot lower (0.20 m clear of the conduits in the topping above), drains below
      const lo = v.zLo(x, y);
      if (top - lo >= 0.4) return lo + r + 0.012;
      if (carry === 'sewage' || carry === 'rain') return top - 0.15 - r;
      // (each low enough to cross a beam through the middle of its web; vents below hot water)
      return top - ({ cold: 0.06, vent: 0.18, hot: 0.12, conduit: 0.2 } as const)[carry];
    }
    case 'crawlspace': return top - ({ conduit: 0.31, cold: 0.37, vent: 0.37, hot: 0.43, sewage: 0.5, rain: 0.5 } as const)[carry];
    case 'underground': {
      if (!Number.isFinite(top)) return NaN;
      // outside, the band follows the cover even under a wall's foundation
      const free = !_ctx.crawl.some((c) => x > c.x0 && x < c.x1 && y > c.y0 && y < c.y1) && !_ctx.underLL(x, y);
      const t = free ? Math.min(top, _ctx.surface(x, y) - _ctx.cover(x, y)) : top;
      return t - r - ({ conduit: 0.02, cold: 0.05, hot: 0.05, vent: 0.1, sewage: 0.12, rain: 0.12 } as const)[carry];
    }
    case 'screed': return top - 0.025;
    case 'roof-zone': return v.zLo(x, y) + 0.17 + ({ conduit: 0.12, cold: 0, hot: 0.06, vent: 0, sewage: 0, rain: 0 } as const)[carry];
    default: return top - 0.1;
  }
}

export function buildLayer(ctx: MepContext, q: LayerReq): Layer {
  const vols: Volume[] = [];
  const pick = (v: Volume) => {
    if (!v.allows.has(q.carry)) return false;
    if (v.kind === 'plenum') return !!q.plenums?.includes(v.level);
    if (v.kind === 'crawlspace') return !!q.crawl;
    if (v.kind === 'screed') return !!q.screeds?.includes(v.level);
    if (v.kind === 'roof-zone') return !!q.roof;
    return false;
  };
  for (const v of ctx.volumes) if (pick(v)) vols.push(v);
  const ground = ctx.volumes.find((v) => v.kind === 'underground')!;
  const rects = vols.map((v) => v.rect);
  if (q.ground) rects.push(ground.rect);
  if (q.underLL) for (const v of ctx.volumes) if (v.kind === 'screed' && v.level === 'LL') rects.push(v.rect);
  rects.push(...(q.extra ?? []));
  const shafts = ctx.volumes.filter((v) => v.kind === 'shaft');
  rects.push(...shafts.map((v) => v.rect));
  const b: Rect = rects.length
    ? { x0: Math.min(...rects.map((r) => r.x0)) - 0.3, x1: Math.max(...rects.map((r) => r.x1)) + 0.3, y0: Math.min(...rects.map((r) => r.y0)) - 0.3, y1: Math.max(...rects.map((r) => r.y1)) + 0.3 }
    : { x0: 0, x1: 1, y0: 0, y1: 1 };
  // the floor screed lies over the crawlspace and the ground: two sheets, so a conduit can drop through the slab
  const sheets = q.screeds?.length && (q.crawl || q.ground || q.plenums?.length) ? 2 : 1;
  const lower = sheets - 1;
  const L = new Layer(q.key, b, q.diagonal ?? false, undefined, sheets);
  const r = outerD(q.dn) / 2;

  // 1. hosts
  if (q.ground) {
    const gc = q.groundCost ?? (q.carry === 'conduit' ? 3 : 1.3);
    L.paint(ground.rect, { id: ground.id, kind: 'underground', name: ground.name }, gc, (x, y) => bandZ(ctx, ground, q.carry, x, y, q.dn), (_k, x, y) => Number.isFinite(ground.zHi(x, y)) && !ctx.crawl.some((c) => x > c.x0 && x < c.x1 && y > c.y0 && y < c.y1) && (!!q.underLL || !ctx.underLL(x, y)), lower);
    for (const e of q.extra ?? []) L.paint(e, { id: 'street', kind: 'underground', name: 'Under the street' }, gc, (x) => -1.2 + 0 * x, undefined, lower);
  }
  if (q.underLL) {
    for (const v of ctx.volumes.filter((x) => x.kind === 'screed' && x.level === 'LL')) {
      const slabTop = v.zHi(0, 0);
      // water 0.20 m under the slab (clear of the conduits in the screed), sewage ≥ 0.20 m lower still
      const below = q.carry === 'sewage' || q.carry === 'rain' ? 0.5 : 0.23;
      L.paint(v.rect, { id: 'under-LL', kind: 'underground', name: 'Under the lower-level slab' }, 1.2, slabTop - 0.15 - below - r, undefined, lower);
    }
  }
  for (const v of vols) {
    // conduits keep to the floor screed where they can; the crawlspace and the ground are for what the screed cannot take
    const cost = v.kind === 'crawlspace' ? (q.carry === 'conduit' ? 1.6 : 1.05) : 1;
    L.paint(v.rect, { id: v.id, kind: v.kind, name: v.name }, cost, (x, y) => bandZ(ctx, v, q.carry, x, y, q.dn), undefined, v.kind === 'screed' ? 0 : lower);
  }
  // shafts: where a shaft crosses the band of a host already painted, pipes may enter it
  for (const s of shafts) {
    L.forRect(s.rect, (k, x, y) => {
      if (!L.passable(k)) {
        // a shaft standing in a room without a plenum still lets the pipe in at the plenum height of its neighbours
        return;
      }
      const z = L.z[k]!;
      if (z >= s.zLo(x, y) && z <= s.zHi(x, y)) { L.host[k] = L.hostRef({ id: s.id, kind: 'shaft', name: s.name }); L.cost[k] = 1; }
    });
  }
  // wall footprints inside plenums: crossing is a sleeve, running along inside is discouraged
  for (const v of ctx.volumes) {
    if (v.kind !== 'wall' || !v.wall) continue;
    L.forRect(v.rect, (k) => { if (L.passable(k) && L.hosts[L.host[k]!]?.kind === 'plenum') L.cost[k] = L.cost[k]! * 2.5; });
  }

  // 2. structure: beams crossed only through a web hole (≤ 0.4 × depth, middle third of a span); columns and footings blocked
  for (const bm of ctx.beams) {
    const rect: Rect = bm.o === 'v' ? { x0: bm.c - bm.width / 2, x1: bm.c + bm.width / 2, y0: bm.a, y1: bm.b } : { x0: bm.a, x1: bm.b, y0: bm.c - bm.width / 2, y1: bm.c + bm.width / 2 };
    const zb = bm.zTop - bm.depth;
    const holeOk = 2 * r <= WEB_HOLE * bm.depth;
    L.forRect(rect, (k, x, y) => {
      if (!L.passable(k)) return;
      const z = L.z[k]!;
      // no change of height through a beam (several beams on one line at different floors: keep them all)
      L.beamZ0[k] = Number.isNaN(L.beamZ0[k]!) ? zb - r : Math.min(L.beamZ0[k]!, zb - r);
      L.beamZ1[k] = Number.isNaN(L.beamZ1[k]!) ? bm.zTop + r : Math.max(L.beamZ1[k]!, bm.zTop + r);
      if (z + r < zb - 0.005 || z - r > bm.zTop) return; // passes under or over
      const t = bm.o === 'v' ? y : x;
      const span = spanAt(bm.supports, t);
      const mid = span && t > span[0] + (span[1] - span[0]) / 3 + 0.02 && t < span[1] - (span[1] - span[0]) / 3 - 0.02;
      if (holeOk && mid && z - r > zb + 0.03 && z + r < bm.zTop - 0.03) { L.cost[k] = L.cost[k]! * 4; L.web[k] = bm.o === 'v' ? 1 : 2; }
      else L.blockCell(k, `${bm.name} (${holeOk ? 'outside the middle third of its span' : `a DN ${q.dn} hole is more than 0.4 × the beam depth`})`);
    }, r);
  }
  for (const f of ctx.forbidden) {
    const bx = f.box;
    // columns block at every height; footings also block gravity pipes running a little above them (they fall below the band)
    // gravity pipes in the crawlspace or the ground can fall below their band: footings up to 1 m under it block them
    const gravity = (q.carry === 'sewage' || q.carry === 'rain') && (!!q.crawl || !!q.ground || !!q.underLL);
    const top = f.kind === 'footing' && gravity ? bx.z1 + 1.0 : bx.z1;
    L.forRect({ x0: bx.x0, x1: bx.x1, y0: bx.y0, y1: bx.y1 }, (k) => {
      if (!L.passable(k)) return;
      const z = L.z[k]!;
      if (z + r < bx.z0 || z - r > top) return;
      L.blockCell(k, f.name);
    }, r + 0.01);
  }

  // 3. what is already there (skip what is far above or below every cell of this layer)
  let zmin = Infinity, zmax = -Infinity;
  for (let k = 0; k < L.z.length; k++) if (L.passable(k)) { const z = L.z[k]!; if (z < zmin) zmin = z; if (z > zmax) zmax = z; }
  for (const o of q.occ ?? []) {
    const reach = r + o.r + 0.25;
    if (Math.min(o.a[2], o.b[2]) - reach > zmax || Math.max(o.a[2], o.b[2]) + reach < zmin) continue;
    if (Math.max(o.a[0], o.b[0]) + reach < b.x0 || Math.min(o.a[0], o.b[0]) - reach > b.x1 || Math.max(o.a[1], o.b[1]) + reach < b.y0 || Math.min(o.a[1], o.b[1]) - reach > b.y1) continue;
    const water = (c: string) => c === 'cold' || c === 'hot';
    const buried = !!q.ground || !!q.underLL;
    const gap = r + o.r + 0.02 + (q.carry === 'conduit' && o.carry === 'hot' ? ELEC_HOT_GAP : 0) + (q.carry === 'hot' && o.carry === 'conduit' ? ELEC_HOT_GAP : 0)
      + (buried && ((water(q.carry) && o.carry === 'sewage') || (q.carry === 'sewage' && water(o.carry))) ? 0.18 : 0);
    const why = `a ${o.carry} run already there (${o.net})`;
    // every cell whose run (at the cell's height) would come closer than the gap to this one, in 3D
    const bx: Rect = { x0: Math.min(o.a[0], o.b[0]) - gap, x1: Math.max(o.a[0], o.b[0]) + gap, y0: Math.min(o.a[1], o.b[1]) - gap, y1: Math.max(o.a[1], o.b[1]) + gap };
    L.forRect(bx, (k, x, y) => {
      if (!L.passable(k)) return;
      if (dist3(x, y, L.z[k]!, o.a, o.b) < gap) L.blockCell(k, why);
    });
  }
  for (const s of q.reserved ?? []) L.blockDisc(s.at[0], s.at[1], s.r + r, s.why);
  return L;
}

function dist3(x: number, y: number, z: number, a: P3, b: P3): number {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l2 = d[0]! * d[0]! + d[1]! * d[1]! + d[2]! * d[2]!;
  const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * d[0]! + (y - a[1]) * d[1]! + (z - a[2]) * d[2]!) / l2)) : 0;
  return Math.hypot(x - a[0] - t * d[0]!, y - a[1] - t * d[1]!, z - a[2] - t * d[2]!);
}

/** Where a run changes height between two neighbouring nodes: on the side whose space holds both heights. */
export function stepAtStart(ctx: MepContext, L: Layer, a: { x: number; y: number; z: number; host?: number }, b: { z: number }): boolean {
  const h = a.host !== undefined && a.host >= 0 ? L.hosts[a.host] : undefined;
  const v = h ? ctx.volumes.find((x) => x.id === h.id) : undefined;
  if (!v) return b.z < a.z;
  return b.z >= v.zLo(a.x, a.y) - 1e-3 && b.z <= v.zHi(a.x, a.y) + 1e-3;
}

export function spanAt(supports: number[], t: number): [number, number] | null {
  for (let i = 0; i + 1 < supports.length; i++) if (t >= supports[i]! - 1e-6 && t <= supports[i + 1]! + 1e-6) return [supports[i]!, supports[i + 1]!];
  return null;
}
