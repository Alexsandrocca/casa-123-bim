// Turns the building model into simple 3D parts (boxes, ground polygons, lines), in house coordinates.
// Pure: no three.js here, so it can be tested and reused (walk mode, checks, exports).
import { eq, openingSeg, pointInRect, wallSeg, type Seg } from '../model/geometry';
import { profile } from '../model/profiles';
import type { Carport, Column, Deck, Element, Opening, Project, Rect, Slab, Space, Stair, Wall } from '../model/schema';
import { groundAt, groundZones, inPoly, siteFrame, zoneZ, type GroundZone } from '../model/site';
import { slabRect, slabVoids } from '../model/structure';

export type V3 = [number, number, number];
export type Mat =
  | 'wallExt' | 'wallInt' | 'wallWet' | 'retaining' | 'plinth' | 'parapet'
  | 'slab' | 'roof' | 'steel' | 'concrete' | 'footing'
  | 'glass' | 'frame' | 'door' | 'garageDoor' | 'tread' | 'guardGlass' | 'rail' | 'deck'
  | 'grass' | 'paving' | 'soil' | 'ramp' | 'asphalt' | 'sidewalk' | 'boundary' | 'setback'
  | 'marking' | 'solarGhost' | 'device' | 'planter';

/** A box: centre c, size s (along x, y, z), optional rotation about x (pitch) then z (yaw), in radians. */
export interface BoxPart { kind: 'box'; id: string; mat: Mat; c: V3; s: V3; rx?: number; rz?: number; solid?: boolean }
/** A flat convex polygon (ground). */
export interface PolyPart { kind: 'poly'; id: string; mat: Mat; pts: V3[] }
export interface LinePart { kind: 'line'; id: string; mat: Mat; pts: V3[] }
export type Part = BoxPart | PolyPart | LinePart;

export interface BuildOptions { doorsOpen: boolean }

/** A walkable surface: a rectangle or convex polygon whose height is z0 + dzdy·(y − y0). */
export interface Surface { id: string; rect?: Rect; poly?: [number, number][]; holes?: Rect[]; z0: number; y0: number; dzdy: number }

export interface Scene3D { parts: Part[]; surfaces: Surface[] }

const elevOf = (p: Project, level: string) => p.levels.find((l) => l.id === level)?.elevation ?? 0;

const box = (id: string, mat: Mat, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, solid = true): BoxPart => ({
  kind: 'box', id, mat, solid,
  c: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
  s: [Math.max(Math.abs(x1 - x0), 0.001), Math.max(Math.abs(y1 - y0), 0.001), Math.max(Math.abs(z1 - z0), 0.001)],
});

/** Box along a wall line: from a to b along the line, thickness t across, z0–z1 up. */
const along = (id: string, mat: Mat, s: { o: 'v' | 'h'; c: number }, a: number, b: number, t: number, z0: number, z1: number, solid = true) =>
  s.o === 'v' ? box(id, mat, s.c - t / 2, a, z0, s.c + t / 2, b, z1, solid) : box(id, mat, a, s.c - t / 2, z0, b, s.c + t / 2, z1, solid);

/** Split a rectangle into rectangles that avoid the holes. */
export function rectMinus(r: Rect, holes: Rect[]): Rect[] {
  const hs = holes.filter((h) => h.x1 > r.x0 && h.x0 < r.x1 && h.y1 > r.y0 && h.y0 < r.y1);
  if (!hs.length) return [r];
  const xs = [...new Set([r.x0, r.x1, ...hs.flatMap((h) => [h.x0, h.x1]).filter((x) => x > r.x0 && x < r.x1)])].sort((a, b) => a - b);
  const ys = [...new Set([r.y0, r.y1, ...hs.flatMap((h) => [h.y0, h.y1]).filter((y) => y > r.y0 && y < r.y1)])].sort((a, b) => a - b);
  const out: Rect[] = [];
  for (let j = 0; j + 1 < ys.length; j++) {
    let run: Rect | null = null;
    for (let i = 0; i + 1 < xs.length; i++) {
      const c = { x0: xs[i]!, y0: ys[j]!, x1: xs[i + 1]!, y1: ys[j + 1]! };
      const mx = (c.x0 + c.x1) / 2, my = (c.y0 + c.y1) / 2;
      const inHole = hs.some((h) => mx > h.x0 && mx < h.x1 && my > h.y0 && my < h.y1);
      if (inHole) { if (run) out.push(run); run = null; continue; }
      if (run) run.x1 = c.x1; else run = { ...c };
    }
    if (run) out.push(run);
  }
  return out;
}

/* ---------------- walls ---------------- */

export interface WallSpan { base: number; top: number }

/** Bottom and top of a wall. The garage floor is lower; street-level outer walls go down to a plinth. */
export function wallSpan(p: Project, w: Wall): WallSpan {
  const e = elevOf(p, w.level);
  const top = e + w.props.height;
  if (w.props.wallType === 'retaining') {
    const f = p.elements.find((x) => x.type === 'Footing' && x.props.carries === w.id);
    return { base: f?.type === 'Footing' ? f.props.topElevation : e, top };
  }
  const garageFloor = p.levels.find((l) => l.id === 'garage')?.elevation;
  if (garageFloor !== undefined && garageFloor < e) {
    const s = wallSeg(w);
    const touchesGarage = p.elements.some((x) => x.type === 'Space' && x.level === w.level && x.props.zone === 'garage'
      && x.props.cells.some((c) => (s.o === 'v' ? (eq(c.x0, s.c) || eq(c.x1, s.c)) && c.y1 > s.a + 0.01 && c.y0 < s.b - 0.01 : (eq(c.y0, s.c) || eq(c.y1, s.c)) && c.x1 > s.a + 0.01 && c.x0 < s.b - 0.01)));
    if (touchesGarage) return { base: garageFloor, top };
  }
  return { base: e, top };
}

function openingZ(p: Project, op: Opening, span: WallSpan): [number, number] {
  const floor = op.props.kind === 'garage' ? (p.levels.find((l) => l.id === 'garage')?.elevation ?? span.base) : elevOf(p, op.level);
  const z0 = floor + op.props.sill;
  return [z0, Math.min(z0 + op.props.height, span.top - 0.05)];
}

function wallParts(p: Project, w: Wall, openings: Opening[], opt: BuildOptions, out: Part[]) {
  const s = wallSeg(w);
  const t = w.props.thickness;
  const span = wallSpan(p, w);
  const exterior = w.props.wallType === 'exterior' || w.props.wallType === 'retaining';
  const ext = exterior ? t / 2 : 0;
  const mat: Mat = w.props.wallType === 'exterior' ? 'wallExt' : w.props.wallType === 'retaining' ? 'retaining' : w.props.wallType === 'wet' ? 'wallWet' : 'wallInt';
  const holes: { op?: Opening; s: Seg; z: [number, number] }[] = [
    ...openings.map((op) => ({ op, s: openingSeg(op, w), z: openingZ(p, op, span) })),
    ...stairNotches(p, s, span),
  ].sort((u, v) => u.s.a - v.s.a);
  let cursor = s.a - ext;
  for (const h of holes) {
    const a = Math.max(h.s.a, cursor), b = h.s.b;
    if (a > cursor + 0.001) out.push(along(w.id, mat, s, cursor, a, t, span.base, span.top));
    if (h.z[0] > span.base + 0.005) out.push(along(w.id, mat, s, a, b, t, span.base, h.z[0]));
    if (h.z[1] < span.top - 0.005) out.push(along(w.id, mat, s, a, b, t, h.z[1], span.top));
    if (h.op) fittings(h.op, h.s, t, h.z, opt, out);
    cursor = Math.max(cursor, b);
  }
  if (s.b + ext > cursor + 0.001) out.push(along(w.id, mat, s, cursor, s.b + ext, t, span.base, span.top));
}

/** Where a stair flight passes over a wall, the wall stops under the flight. */
function stairNotches(p: Project, s: Seg, span: WallSpan): { s: Seg; z: [number, number] }[] {
  const out: { s: Seg; z: [number, number] }[] = [];
  if (s.o !== 'h') return out;
  for (const st of p.elements) {
    if (st.type !== 'Stair') continue;
    let z = elevOf(p, st.props.fromLevel);
    for (const f of st.props.flights) {
      const dir = Math.sign(f.yTop - f.yBottom) || 1;
      const lo = Math.min(f.yBottom, f.yTop), hi = Math.max(f.yBottom, f.yTop);
      if (s.c > lo + 1e-6 && s.c < hi - 1e-6 && f.x1 > s.a && f.x0 < s.b) {
        const i = Math.floor(((s.c - f.yBottom) * dir) / st.props.tread) + 1;
        const zTread = z + i * st.props.riser;
        const bottom = zTread - 0.45;
        if (bottom < span.top) out.push({ s: { ...s, a: Math.max(f.x0, s.a), b: Math.min(f.x1, s.b) }, z: [Math.max(bottom, span.base), span.top] });
      }
      z += f.risers * st.props.riser;
    }
  }
  return out;
}

/** Frames, glass, door leaves. */
function fittings(op: Opening, s: Seg, t: number, [z0, z1]: [number, number], opt: BuildOptions, out: Part[]) {
  const id = op.id, f = 0.05, fd = Math.min(t, 0.1);
  const w = s.b - s.a;
  // frame
  out.push(along(id, 'frame', s, s.a, s.a + f, fd, z0, z1, false), along(id, 'frame', s, s.b - f, s.b, fd, z0, z1, false));
  out.push(along(id, 'frame', s, s.a, s.b, fd, z1 - f, z1, false));
  if (op.props.role === 'window') out.push(along(id, 'frame', s, s.a, s.b, fd, z0, z0 + f, false));
  const { kind, role, swing } = op.props;
  if (role === 'window') {
    out.push(along(id, 'glass', s, s.a + f, s.b - f, 0.02, z0 + f, z1 - f, false));
    if (kind === 'slider') out.push(along(id, 'frame', s, (s.a + s.b) / 2 - 0.03, (s.a + s.b) / 2 + 0.03, fd, z0, z1, false));
    return;
  }
  if (kind === 'garage') {
    if (opt.doorsOpen) out.push(along(id, 'garageDoor', s, s.a + f, s.b - f, 0.05, z1 - 0.12, z1 - f, false));
    else out.push(along(id, 'garageDoor', s, s.a + f, s.b - f, 0.05, z0, z1 - f, false));
    return;
  }
  if (kind === 'slider') {
    const half = (w - 2 * f) / 2;
    const off = 0.04;
    const shift = opt.doorsOpen ? half * 0.95 : 0;
    const c1 = { ...s, c: s.c - off }, c2 = { ...s, c: s.c + off };
    out.push(along(id, 'glass', c1, s.a + f, s.a + f + half, 0.02, z0, z1 - f, false));
    out.push(along(id, 'glass', c2, s.a + f + half - shift, s.b - f - shift, 0.02, z0, z1 - f, false));
    return;
  }
  // hinged door: leaf from the hinge at s.a
  const leafW = w - 2 * f, h = z1 - z0 - f;
  const leaf: Mat = op.tags.includes('glazed') ? 'glass' : 'door';
  if (!opt.doorsOpen) {
    out.push(along(id, leaf, s, s.a + f, s.b - f, 0.04, z0, z0 + h, false));
  } else if (s.o === 'h') {
    const y0 = s.c, y1 = s.c + swing * leafW;
    out.push(box(id, leaf, s.a + f, Math.min(y0, y1), z0, s.a + f + 0.04, Math.max(y0, y1), z0 + h, false));
  } else {
    const x0 = s.c, x1 = s.c + swing * leafW;
    out.push(box(id, leaf, Math.min(x0, x1), s.a + f, z0, Math.max(x0, x1), s.a + f + 0.04, z0 + h, false));
  }
}

/* ---------------- slabs, structure ---------------- */

const isRoof = (s: Slab) => s.level === 'roof' || s.tags.includes('garage-roof') || s.props.parapet !== undefined;

function slabParts(p: Project, s: Slab, out: Part[], surfaces: Surface[]) {
  const top = s.props.topElevation, bot = top - s.props.thickness;
  const mat: Mat = isRoof(s) ? 'roof' : 'slab';
  const e = s.props.eaves ?? 0;
  let rects: Rect[];
  if (s.props.spaces) {
    const voids = slabVoids(p, s);
    rects = p.elements.flatMap((x) => (x.type === 'Space' && s.props.spaces!.includes(x.id) ? x.props.cells : [])).flatMap((c) => rectMinus(c, voids));
  } else if (s.tags.includes('patio')) {
    // steps cut into the patio
    const steps = p.elements.flatMap((d) => (d.type === 'Deck' && d.props.steps ? [d.props.steps] : []));
    rects = rectMinus(slabRect(p, s), steps);
  } else {
    const r = slabRect(p, s);
    rects = rectMinus({ x0: r.x0 - e, y0: r.y0 - e, x1: r.x1 + e, y1: r.y1 + e }, slabVoids(p, s));
  }
  for (const r of rects) {
    out.push(box(s.id, mat, r.x0, r.y0, bot, r.x1, r.y1, top));
    surfaces.push({ id: s.id, rect: r, z0: top, y0: 0, dzdy: 0 });
  }
  if (s.props.parapet && !s.props.spaces) {
    const r0 = slabRect(p, s);
    const r = { x0: r0.x0 - e, y0: r0.y0 - e, x1: r0.x1 + e, y1: r0.y1 + e };
    const t = 0.15, h = s.props.parapet;
    const above = p.elements.filter((w): w is Wall => w.type === 'Wall' && (w.props.wallType === 'exterior') && Math.abs(elevOf(p, w.level) - top) < 0.05);
    const walled = (o: 'v' | 'h', c: number) => above.some((w) => { const ws = wallSeg(w); return ws.o === o && Math.abs(ws.c - c) < 0.05 + e; });
    const edges: [ 'v' | 'h', number, number, number][] = [['h', r.y0, r.x0, r.x1], ['h', r.y1, r.x0, r.x1], ['v', r.x0, r.y0, r.y1], ['v', r.x1, r.y0, r.y1]];
    for (const [o, c, a, b] of edges) {
      if (walled(o, c)) continue;
      const inset = o === 'h' ? (c === r.y0 ? t / 2 : -t / 2) : (c === r.x0 ? t / 2 : -t / 2);
      out.push(along(s.id, 'parapet', { o, c: c + inset }, a, b, t, top, top + h));
    }
  }
}

function columnParts(c: Column, out: Part[]) {
  const pr = profile(c.props.profile);
  const [x, y] = c.props.at;
  out.push(box(c.id, c.props.kind === 'pier' ? 'concrete' : 'steel', x - pr.b / 2, y - pr.d / 2, c.props.baseElevation, x + pr.b / 2, y + pr.d / 2, c.props.topElevation));
}

/* ---------------- stairs ---------------- */

function stairParts(p: Project, st: Stair, out: Part[], surfaces: Surface[]) {
  const { riser: R, tread: T } = st.props;
  let z = elevOf(p, st.props.fromLevel);
  st.props.flights.forEach((f, fi) => {
    const dir = Math.sign(f.yTop - f.yBottom) || 1;
    const zBottom = z;
    for (let i = 1; i < f.risers; i++) {
      const zt = zBottom + i * R;
      const ya = f.yBottom + dir * (i - 1) * T, yb = f.yBottom + dir * i * T;
      const r = { x0: f.x0, x1: f.x1, y0: Math.min(ya, yb) - 0.02, y1: Math.max(ya, yb) + 0.02 };
      out.push(box(st.id, 'tread', r.x0, r.y0, zt - 0.05, r.x1, r.y1, zt, false));
      surfaces.push({ id: `${st.id}:f${fi}:t${i}`, rect: { x0: f.x0, x1: f.x1, y0: Math.min(ya, yb), y1: Math.max(ya, yb) }, z0: zt, y0: 0, dzdy: 0 });
    }
    // steel stringers along both sides
    const zTop = zBottom + f.risers * R;
    const run = Math.abs(f.yTop - f.yBottom), rise = zTop - zBottom - R;
    const len = Math.hypot(run + T, rise + R);
    const pitch = dir * Math.atan2(rise, run);
    const cy = (f.yBottom + f.yTop) / 2, cz = (zBottom + zTop) / 2 - 0.2;
    for (const x of [f.x0 + 0.02, f.x1 - 0.02]) {
      out.push({ kind: 'box', id: st.id, mat: 'steel', c: [x, cy, cz], s: [0.02, len, 0.25], rx: pitch });
    }
    z = zBottom + f.risers * R;
    const landing = st.props.landings[fi];
    if (landing && fi < st.props.flights.length - 1) {
      out.push(box(st.id, 'tread', landing.x0, landing.y0, z - 0.15, landing.x1, landing.y1, z, false));
      surfaces.push({ id: `${st.id}:landing${fi}`, rect: landing, z0: z, y0: 0, dzdy: 0 });
    }
  });
}

/* ---------------- guards: 1.10 m wherever a floor edge drops more than 0.50 m ---------------- */

export function surfaceZ(s: Surface, x: number, y: number): number | null {
  if (s.rect ? !pointInRect(x, y, s.rect) : !inPoly(x, y, s.poly!)) return null;
  if (s.holes?.some((h) => x > h.x0 && x < h.x1 && y > h.y0 && y < h.y1)) return null;
  return s.z0 + s.dzdy * (y - s.y0);
}

/** Highest surface at (x, y) not higher than zMax. */
export function floorAt(surfaces: Surface[], x: number, y: number, zMax: number): number | null {
  let best: number | null = null;
  for (const s of surfaces) {
    const z = surfaceZ(s, x, y);
    if (z !== null && z <= zMax + 1e-6 && (best === null || z > best)) best = z;
  }
  return best;
}

function guardParts(p: Project, surfaces: Surface[], wallBoxes: BoxPart[], out: Part[]) {
  const candidates: { id: string; r: Rect; z: number }[] = [];
  for (const e of p.elements) {
    if (e.type === 'Slab' && (!e.props.onGrade || e.tags.includes('patio')) && !isRoof(e)) {
      for (const s of surfaces) if (s.id === e.id && s.rect) candidates.push({ id: e.id, r: s.rect, z: s.z0 });
    }
    if (e.type === 'Stair') {
      for (const s of surfaces) if (s.id.startsWith(e.id + ':') && s.rect) candidates.push({ id: e.id, r: s.rect, z: s.z0 });
    }
  }
  // A wall (or several stacked walls) close to the edge, from the floor up to at least 0.90 m.
  const hits = (x: number, y: number, zz: number) => wallBoxes.some((b) => {
    const [cx, cy, cz] = b.c, [sx, sy, sz] = b.s;
    return Math.abs(x - cx) <= sx / 2 + 0.12 && Math.abs(y - cy) <= sy / 2 + 0.12 && cz - sz / 2 <= zz && cz + sz / 2 >= zz;
  });
  const covered = (x: number, y: number, z: number) => hits(x, y, z + 0.15) && hits(x, y, z + 0.9);
  const step = 0.1, H = 1.1;
  for (const c of candidates) {
    const edges: { o: 'v' | 'h'; at: number; a: number; b: number; out: number }[] = [
      { o: 'h', at: c.r.y0, a: c.r.x0, b: c.r.x1, out: -1 }, { o: 'h', at: c.r.y1, a: c.r.x0, b: c.r.x1, out: 1 },
      { o: 'v', at: c.r.x0, a: c.r.y0, b: c.r.y1, out: -1 }, { o: 'v', at: c.r.x1, a: c.r.y0, b: c.r.y1, out: 1 },
    ];
    for (const e of edges) {
      let run: [number, number] | null = null;
      const flush = () => {
        if (run && run[1] - run[0] > 0.15) {
          const s = { o: e.o, c: e.at - e.out * 0.03 };
          out.push(along(c.id, 'guardGlass', s, run[0], run[1], 0.02, c.z + 0.1, c.z + H - 0.05));
          out.push(along(c.id, 'rail', s, run[0], run[1], 0.05, c.z + H - 0.05, c.z + H));
        }
        run = null;
      };
      for (let t = e.a + step / 2; t < e.b; t += step) {
        const [x, y] = e.o === 'h' ? [t, e.at] : [e.at, t];
        const [ox, oy] = e.o === 'h' ? [x, y + e.out * 0.08] : [x + e.out * 0.08, y];
        const below = floorAt(surfaces, ox, oy, c.z + 0.25);
        const drop = below === null ? Infinity : c.z - below;
        const need = drop > 0.5 && !covered(x, y, c.z);
        if (need) run = run ? [run[0], t + step / 2] : [t - step / 2, t + step / 2];
        else flush();
      }
      flush();
    }
  }
}

/* ---------------- site ---------------- */

function sitePartsAndSurfaces(p: Project, out: Part[], surfaces: Surface[]) {
  const f = siteFrame(p);
  const zones = groundZones(p);
  const matOf: Record<GroundZone['surface'], Mat> = { grass: 'grass', paving: 'paving', soil: 'soil', ramp: 'ramp' };
  for (const z of zones) {
    out.push({ kind: 'poly', id: `site:${z.id}`, mat: matOf[z.surface], pts: z.poly.map(([x, y]) => [x, y, zoneZ(z, y)] as V3) });
    surfaces.push({ id: `site:${z.id}`, poly: z.poly, z0: z.z0, y0: z.y0, dzdy: z.dzdy });
  }
  const g = (x: number, y: number) => groundAt(p, x, y, zones);
  // The neighbours' land around the lot, at the natural slope.
  const far = f.yRear + 25, nz = (y: number) => f.natural(Math.min(y, f.yRear + 10));
  const nb = (pts: [number, number][]) => out.push({ kind: 'poly', id: 'site:neighbours', mat: 'grass', pts: pts.map(([x, y]) => [x, y, nz(y) - 0.02] as V3) });
  nb([[f.xSouth - 25, f.yStreet], [f.xSouth, f.yStreet], [f.xSouth, far], [f.xSouth - 25, far]]);
  nb([[f.xNorth(f.yStreet), f.yStreet], [f.xNorth(f.yStreet) + 25, f.yStreet], [f.xNorth(f.yStreet) + 25, far], [f.xNorth(f.yRear), far], [f.xNorth(f.yRear), f.yRear]]);
  nb([[f.xSouth, f.yRear], [f.xNorth(f.yRear), f.yRear], [f.xNorth(f.yRear), far], [f.xSouth, far]]);
  // Street and sidewalk in front.
  const xs0 = f.xSouth - 12, xs1 = f.xNorth(f.yStreet) + 12;
  const carport = p.elements.find((e): e is Carport => e.type === 'Carport');
  if (carport) {
    // curb cut in front of the carport
    const cx0 = carport.props.rect.x0, cx1 = carport.props.rect.x1;
    out.push(box('site:sidewalk', 'sidewalk', xs0, f.yStreet - 2.5, -0.12, cx0, f.yStreet, 0), box('site:sidewalk', 'sidewalk', cx1, f.yStreet - 2.5, -0.12, xs1, f.yStreet, 0));
    out.push(box('site:sidewalk', 'paving', cx0, f.yStreet - 2.5, -0.14, cx1, f.yStreet, -0.04));
  } else out.push(box('site:sidewalk', 'sidewalk', xs0, f.yStreet - 2.5, -0.12, xs1, f.yStreet, 0));
  out.push(box('site:street', 'asphalt', xs0, f.yStreet - 10.5, -0.3, xs1, f.yStreet - 2.5, -0.15));
  surfaces.push({ id: 'site:sidewalk', rect: { x0: xs0, y0: f.yStreet - 2.5, x1: xs1, y1: f.yStreet }, z0: 0, y0: 0, dzdy: 0 });
  surfaces.push({ id: 'site:street', rect: { x0: xs0, y0: f.yStreet - 10.5, x1: xs1, y1: f.yStreet - 2.5 }, z0: -0.15, y0: 0, dzdy: 0 });

  // Small retaining walls where two ground zones meet at different heights.
  const h = f.house;
  const llY1 = p.levels.find((l) => l.id === 'LL')?.outline?.y1 ?? h.y1;
  const seams: [number, number, number][] = [[h.x1, f.yStreet, h.y0], [h.x0, f.yStreet, h.y0], [h.x1, llY1, f.rampEndY]];
  for (const [x, ya, yb] of seams) {
    for (let y = ya; y < yb - 1e-6; y += 0.5) {
      const y2 = Math.min(y + 0.5, yb), ym = (y + y2) / 2;
      const zl = g(x - 0.05, ym), zr = g(x + 0.05, ym);
      if (Math.abs(zl - zr) < 0.05) continue;
      out.push(box('site:retaining', 'retaining', x - 0.1, y, Math.min(zl, zr) - 0.3, x + 0.1, y2, Math.max(zl, zr) + 0.1));
    }
  }
  // Plinth closing the crawlspace under the street-level outer walls, down to the ground.
  const sl = p.levels.find((l) => l.id === 'SL');
  const garageFloor = p.levels.find((l) => l.id === 'garage')?.elevation ?? (sl?.elevation ?? 0);
  if (sl?.outline) {
    const o = sl.outline, cut = p.site.cut.lineY;
    const runs: ['v' | 'h', number, number, number][] = [['h', o.y0, o.x0, o.x1], ['v', o.x0, o.y0, Math.min(cut, o.y1)], ['v', o.x1, o.y0, Math.min(cut, o.y1)]];
    for (const [o2, c, a, b] of runs) {
      for (let t = a; t < b - 1e-6; t += 0.5) {
        const t2 = Math.min(t + 0.5, b), m = (t + t2) / 2;
        const [x, y] = o2 === 'h' ? [m, c] : [c, m];
        const low = Math.min(g(x - 0.3, y - 0.3), g(x + 0.3, y + 0.3), g(x - 0.3, y + 0.3), g(x + 0.3, y - 0.3));
        if (low >= garageFloor - 0.02) continue;
        out.push(along('site:plinth', 'plinth', { o: o2, c }, t, t2, 0.2, low - 0.3, garageFloor));
      }
    }
  }
  // Neighbour boundaries as low walls (0.40 m above the higher side).
  const lot = f.lot;
  const sides: [number, number, number, number][] = [
    [lot[0]![0], lot[0]![1], lot[3]![0], lot[3]![1]], [lot[3]![0], lot[3]![1], lot[2]![0], lot[2]![1]], [lot[1]![0], lot[1]![1], lot[2]![0], lot[2]![1]],
  ];
  for (const [ax, ay, bx, by] of sides) {
    const L = Math.hypot(bx - ax, by - ay), n = Math.ceil(L / 1);
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n, tm = (t0 + t1) / 2;
      const x0 = ax + (bx - ax) * t0, y0 = ay + (by - ay) * t0, x1 = ax + (bx - ax) * t1, y1 = ay + (by - ay) * t1;
      const xm = ax + (bx - ax) * tm, ym = ay + (by - ay) * tm;
      const ours = g(xm + (Math.abs(bx - ax) < 2 ? (xm < 5 ? 0.2 : -0.2) : 0), ym - (Math.abs(by - ay) < 2 ? 0.2 : 0));
      const theirs = f.natural(ym);
      const zt = Math.max(ours, theirs) + 0.4, zb = Math.min(ours, theirs) - 0.2;
      const vertical = Math.abs(bx - ax) < Math.abs(by - ay);
      const part = vertical
        ? box('site:boundary', 'boundary', xm - 0.075, Math.min(y0, y1), zb, xm + 0.075, Math.max(y0, y1), zt)
        : box('site:boundary', 'boundary', Math.min(x0, x1), ym - 0.075, zb, Math.max(x0, x1), ym + 0.075, zt);
      out.push(part);
    }
  }
  // Setback lines on the ground.
  const sb = p.site.setbacks;
  const line = (pts: [number, number][]) => out.push({ kind: 'line', id: 'site:setback', mat: 'setback', pts: pts.map(([x, y]) => [x, y, g(x, y) + 0.03] as V3) });
  const sample = (fn: (t: number) => [number, number]) => Array.from({ length: 41 }, (_, i) => fn(i / 40));
  const yF = f.yStreet + sb.front, yR = f.yRear - sb.rear, xS = f.xSouth + sb.sides;
  line(sample((t) => [xS + (f.xNorth(yF) - sb.sides - xS) * t, yF]));
  line(sample((t) => [xS + (f.xNorth(yR) - sb.sides - xS) * t, yR]));
  line(sample((t) => [xS, yF + (yR - yF) * t]));
  line(sample((t) => { const y = yF + (yR - yF) * t; return [f.xNorth(y) - sb.sides, y]; }));

  // Entry steps and landing in front of each street-level door on the front wall.
  if (sl?.outline) {
    for (const op of p.elements) {
      if (op.type !== 'Opening' || op.level !== 'SL' || op.props.role !== 'door' || op.props.kind === 'garage') continue;
      const host = p.elements.find((w) => w.id === op.props.host);
      if (host?.type !== 'Wall') continue;
      const s = openingSeg(op, host);
      if (s.o !== 'h' || !eq(s.c, sl.outline.y0)) continue;
      const top = sl.elevation, x0 = s.a - 0.3, x1 = s.b + 0.3, yl = s.c - 1.0;
      const gz = g((x0 + x1) / 2, yl - 1.2);
      const n = Math.max(1, Math.ceil((top - gz) / 0.18)), r = (top - gz) / n;
      out.push(box('site:entry', 'paving', x0, yl, gz - 0.2, x1, s.c - 0.1, top));
      surfaces.push({ id: 'site:entry', rect: { x0, y0: yl, x1, y1: s.c + 0.1 }, z0: top, y0: 0, dzdy: 0 });
      for (let i = 1; i < n; i++) {
        const zt = top - i * r, ya = yl - i * 0.3;
        out.push(box('site:entry', 'paving', x0, ya, gz - 0.2, x1, ya + 0.3, zt));
        surfaces.push({ id: `site:entry${i}`, rect: { x0, y0: ya, x1, y1: ya + 0.3 }, z0: zt, y0: 0, dzdy: 0 });
      }
    }
  }
}

/* ---------------- decks, carport ---------------- */

function deckParts(p: Project, d: Deck, out: Part[], surfaces: Surface[]) {
  const r = d.props.rect, z = d.props.elevation;
  const holes = d.props.steps ? [d.props.steps] : [];
  for (const piece of rectMinus(r, holes)) {
    out.push(box(d.id, 'deck', piece.x0, piece.y0, z - 0.04, piece.x1, piece.y1, z + 0.005, false));
    surfaces.push({ id: d.id, rect: piece, z0: z, y0: 0, dzdy: 0 });
  }
  if (d.props.planter) {
    const pl = d.props.planter, h = 0.45, t = 0.1;
    out.push(box(d.id, 'planter', pl.x0, pl.y0, z, pl.x1, pl.y1, z + h - 0.08, false));
    out.push(box(d.id, 'plinth', pl.x0, pl.y0, z, pl.x0 + t, pl.y1, z + h));
    out.push(box(d.id, 'plinth', pl.x0, pl.y0, z, pl.x1, pl.y0 + t, z + h), box(d.id, 'plinth', pl.x0, pl.y1 - t, z, pl.x1, pl.y1, z + h));
  }
  if (d.props.steps) {
    const st = d.props.steps;
    const gz = groundAt(p, (st.x0 + st.x1) / 2, st.y0 - 0.1);
    const n = Math.max(2, Math.ceil((z - gz) / 0.18)), rise = (z - gz) / n, depth = (st.y1 - st.y0) / (n - 1);
    for (let i = 1; i < n; i++) {
      const top = gz + i * rise, ya = st.y0 + (i - 1) * depth;
      out.push(box(d.id, 'paving', st.x0, ya, gz - 0.2, st.x1, ya + depth, top));
      surfaces.push({ id: `${d.id}:step${i}`, rect: { x0: st.x0, y0: ya, x1: st.x1, y1: ya + depth }, z0: top, y0: 0, dzdy: 0 });
    }
  }
}

function carportParts(p: Project, c: Carport, out: Part[]) {
  const r = c.props.rect, over = 0.15;
  const roofAt = (y: number) => c.props.roofFront + c.props.slope * (y - r.y0);
  const pitch = Math.atan(c.props.slope);
  const len = (r.y1 - r.y0 + 2 * over) / Math.cos(pitch);
  const cy = (r.y0 + r.y1) / 2;
  out.push({ kind: 'box', id: c.id, mat: 'roof', c: [(r.x0 + r.x1) / 2, cy, roofAt(cy) - 0.05], s: [r.x1 - r.x0 + 2 * over, len, 0.1], rx: pitch });
  // gutter at the street edge
  out.push(box(c.id, 'steel', r.x0 - over, r.y0 - over - 0.15, roofAt(r.y0 - over) - 0.25, r.x1 + over, r.y0 - over, roofAt(r.y0 - over) - 0.05));
  // solar modules reserved on the roof (ghost array), 3 across and 2 up the slope
  const mw = 1.13, ml = 2.28, gap = 0.05, cols = 3, rows = Math.ceil(c.props.solarModules / cols);
  const x0 = (r.x0 + r.x1) / 2 - (cols * mw + (cols - 1) * gap) / 2, y0 = cy - (rows * ml + (rows - 1) * gap) / 2;
  for (let k = 0; k < c.props.solarModules; k++) {
    const i = k % cols, j = Math.floor(k / cols);
    const mx = x0 + i * (mw + gap) + mw / 2, my = y0 + j * (ml + gap) + ml / 2;
    out.push({ kind: 'box', id: c.id, mat: 'solarGhost', c: [mx, my, roofAt(my) + 0.08], s: [mw, ml, 0.04], rx: pitch });
  }
  // bay markings on the paving
  for (const b of c.props.parking) {
    const g = (x: number, y: number) => groundAt(p, x, y) + 0.004;
    const w = 0.1, zb = g((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    out.push(box(c.id, 'marking', b.x0, b.y0, zb, b.x0 + w, b.y1, zb + 0.008, false), box(c.id, 'marking', b.x1 - w, b.y0, zb, b.x1, b.y1, zb + 0.008, false));
    out.push(box(c.id, 'marking', b.x0, b.y1 - w, zb, b.x1, b.y1, zb + 0.008, false));
  }
}

/* ---------------- everything ---------------- */

export function buildScene(p: Project, opt: BuildOptions = { doorsOpen: false }): Scene3D {
  const parts: Part[] = [];
  const surfaces: Surface[] = [];
  const openingsByHost = new Map<string, Opening[]>();
  for (const e of p.elements) if (e.type === 'Opening') openingsByHost.set(e.props.host, [...(openingsByHost.get(e.props.host) ?? []), e]);
  const byType = <T extends Element['type']>(t: T) => p.elements.filter((e): e is Extract<Element, { type: T }> => e.type === t);

  for (const w of byType('Wall')) wallParts(p, w, openingsByHost.get(w.id) ?? [], opt, parts);
  for (const s of byType('Slab')) slabParts(p, s, parts, surfaces);
  for (const b of byType('Beam')) {
    const pr = profile(b.props.profile);
    const [sx, sy] = b.props.start, [ex, ey] = b.props.end;
    const z1 = b.props.elevation, z0 = z1 - pr.d;
    parts.push(eq(sx, ex)
      ? box(b.id, 'steel', sx - pr.b / 2, Math.min(sy, ey), z0, sx + pr.b / 2, Math.max(sy, ey), z1)
      : box(b.id, 'steel', Math.min(sx, ex), sy - pr.b / 2, z0, Math.max(sx, ex), sy + pr.b / 2, z1));
  }
  for (const c of byType('Column')) columnParts(c, parts);
  for (const f of byType('Footing')) {
    const r = f.props.rect;
    parts.push(box(f.id, 'footing', r.x0, r.y0, f.props.topElevation - f.props.depth, r.x1, r.y1, f.props.topElevation));
  }
  for (const st of byType('Stair')) stairParts(p, st, parts, surfaces);
  for (const d of byType('Deck')) deckParts(p, d, parts, surfaces);
  for (const c of byType('Carport')) carportParts(p, c, parts);
  for (const d of byType('Device')) {
    const at = d.props.at as V3 | undefined, sz = d.props.size as V3 | undefined;
    if (at && sz) parts.push({ kind: 'box', id: d.id, mat: 'device', c: at, s: sz });
  }
  sitePartsAndSurfaces(p, parts, surfaces);
  const wallBoxes = parts.filter((x): x is BoxPart => x.kind === 'box' && ['wallExt', 'wallInt', 'wallWet', 'retaining', 'parapet'].includes(x.mat));
  guardParts(p, surfaces, wallBoxes, parts);
  return { parts, surfaces };
}

/** Space ids never get 3D parts; this helps the UI map a picked part back to a model element. */
export const isModelId = (id: string) => !id.startsWith('site:');
export type { Space };
