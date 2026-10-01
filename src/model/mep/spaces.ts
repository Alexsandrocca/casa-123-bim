// Spec 04b: where pipes and conduits may physically be (service spaces) and where they may never be (forbidden zones).
// Shafts, plenums and roof zones are stored elements; wall cavities, floor screed, the crawlspace and the ground are
// derived here from the walls, slabs and site, so they always follow the model. Pure and cached per project.
import { pointInRect, wallSeg } from '../geometry';
import { profile } from '../profiles';
import type { Fixture, Opening, Project, Rect, ServiceSpace, Slab, Space, Wall } from '../schema';
import { groundAt, groundZones, inPoly, type GroundZone } from '../site';
import { slabCovers, slabRect, slabVoids } from '../structure';
import { wallSpan } from '../../scene/build3d';
import { kindOf } from '../plumbing/library';
import { deviceType } from '../electrical/library';
import { COVER, SCREED, fixtureMount, wallMaxDn } from './library';

export type P2 = [number, number];
export type P3 = [number, number, number];
export interface Box3 { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }

export type HostKind = 'wall' | 'shaft' | 'plenum' | 'screed' | 'crawlspace' | 'underground' | 'roof-zone' | 'sleeve' | 'equipment' | 'facade';
/** What a service space lets through. 'conduit' = electrical. */
export type Carry = 'sewage' | 'rain' | 'vent' | 'cold' | 'hot' | 'conduit';

export interface Volume {
  id: string;
  kind: HostKind;
  name: string;
  level: string;
  /** Plan extent and height range. Plan-only tests use rect; the height may vary (ground), see zLo/zHi. */
  rect: Rect;
  zLo: (x: number, y: number) => number;
  zHi: (x: number, y: number) => number;
  allows: Set<Carry>;
  /** Largest pipe DN it holds (conduits: largest conduit). */
  maxDn: number;
  /** Walls: only vertical runs, plus horizontal ≤ 1 m (exterior and retaining walls: conduits only). */
  wall?: { id: string; o: 'v' | 'h'; c: number; t: number; type: Wall['props']['wallType'] };
  elementId?: string;
}

export interface Forbidden { id: string; kind: 'stair' | 'door' | 'window' | 'column' | 'footing' | 'retaining'; name: string; box: Box3; elementId: string }

export interface BeamInfo {
  id: string; name: string; o: 'v' | 'h'; c: number; a: number; b: number;
  zTop: number; depth: number; width: number;
  /** Support positions along the beam (columns, crossing beams, ends). */
  supports: number[];
}

export interface MepContext {
  volumes: Volume[];
  forbidden: Forbidden[];
  beams: BeamInfo[];
  zones: GroundZone[];
  /** Finished surface (ground, paving, patio fill). */
  surface: (x: number, y: number) => number;
  /** Required cover over buried pipes at a point. */
  cover: (x: number, y: number) => number;
  /** Underside of the structural slab above a level at a point (null where there is none, e.g. a stair void). */
  soffit: (level: string, x: number, y: number) => number | null;
  /** Top of the floor slab of a level at a point (null where there is none). */
  floorTop: (level: string, x: number, y: number) => number | null;
  /** Inside a room of a plan level (house footprint)? */
  inRoom: (level: string, x: number, y: number) => Space | undefined;
  crawl: Rect[];
  /** Under the lower-level slab on grade? */
  underLL: (x: number, y: number) => boolean;
  elev: (level: string) => number;
  levelAbove: (level: string) => string | undefined;
}

const CACHE = new WeakMap<Project, MepContext>();
const ALL: Carry[] = ['sewage', 'rain', 'vent', 'cold', 'hot', 'conduit'];
const PIPES: Carry[] = ['sewage', 'rain', 'vent', 'cold', 'hot'];
const strictly = (x: number, y: number, r: Rect, m = 1e-6) => x > r.x0 + m && x < r.x1 - m && y > r.y0 + m && y < r.y1 - m;
const flat = (z: number) => () => z;

export function mepContext(p: Project): MepContext {
  const hit = CACHE.get(p);
  if (hit) return hit;
  const ctx = build(p);
  CACHE.set(p, ctx);
  return ctx;
}

function build(p: Project): MepContext {
  const levels = [...p.levels].sort((a, b) => a.elevation - b.elevation);
  const elev = (l: string) => p.levels.find((x) => x.id === l)?.elevation ?? 0;
  const levelAbove = (l: string) => { const i = levels.findIndex((x) => x.id === l); return i >= 0 ? levels[i + 1]?.id : undefined; };
  const slabs = p.elements.filter((e): e is Slab => e.type === 'Slab');
  const spaces = p.elements.filter((e): e is Space => e.type === 'Space');
  const walls = p.elements.filter((e): e is Wall => e.type === 'Wall');
  const zones = groundZones(p);
  const patio = slabs.filter((s) => s.props.onGrade && s.tags.includes('patio')).map((s) => slabRect(p, s));
  const surface = (x: number, y: number) => {
    let z = groundAt(p, x, y, zones);
    for (const r of patio) if (pointInRect(x, y, r)) z = Math.max(z, elev('SL'));
    return z;
  };
  const carport = p.elements.find((e) => e.type === 'Carport');
  const cover = (x: number, y: number) => {
    if (carport?.type === 'Carport' && carport.props.parking.some((r) => pointInRect(x, y, r))) return COVER.drive;
    return COVER.garden;
  };
  const voidsOf = new Map(slabs.map((s) => [s.id, slabVoids(p, s)]));
  const structural = (s: Slab) => !s.props.onGrade;
  const slabAt = (level: string, x: number, y: number, pred: (s: Slab) => boolean = () => true) =>
    slabs.find((s) => s.level === level && pred(s) && slabCovers(p, s, x, y, voidsOf.get(s.id)));
  const soffit = (level: string, x: number, y: number) => {
    const up = levelAbove(level);
    if (!up) return null;
    const s = slabAt(up, x, y, structural);
    return s ? s.props.topElevation - s.props.thickness : null;
  };
  const floorTop = (level: string, x: number, y: number) => slabAt(level, x, y)?.props.topElevation ?? null;
  const inRoom = (level: string, x: number, y: number) => spaces.find((s) => s.level === level && s.props.cells.some((c) => strictly(x, y, c)));

  const volumes: Volume[] = [];
  /* wall cavities: inside each wall, its thickness minus 15 mm cover on each side */
  for (const w of walls) {
    const s = wallSeg(w), span = wallSpan(p, w), t = w.props.thickness;
    const half = t / 2;
    const rect: Rect = s.o === 'v' ? { x0: s.c - half, x1: s.c + half, y0: s.a, y1: s.b } : { x0: s.a, x1: s.b, y0: s.c - half, y1: s.c + half };
    // a retaining wall's core below the retained ground is not a service space; a wall ends under the slab above it
    const lo = w.props.wallType === 'retaining' ? Math.max(span.base, retainedGround(p, w, surface)) : span.base;
    const mid: P2 = s.o === 'v' ? [s.c, (s.a + s.b) / 2] : [(s.a + s.b) / 2, s.c];
    const so = soffit(w.level, mid[0], mid[1]);
    const hi = Math.min(span.top, so ?? span.top - 0.14);
    volumes.push({
      id: `wall:${w.id}`, kind: 'wall', name: `${w.props.wallType} wall ${w.id} (${(t * 100).toFixed(0)} cm)`, level: w.level, rect,
      zLo: flat(lo), zHi: flat(hi), allows: new Set(ALL), maxDn: wallMaxDn(t), elementId: w.id,
      wall: { id: w.id, o: s.o, c: s.c, t, type: w.props.wallType },
    });
  }
  /* stored service spaces */
  for (const e of p.elements) {
    if (e.type !== 'ServiceSpace') continue;
    volumes.push(storedVolume(p, e, soffit));
  }
  /* floor screed: 50 mm topping on every floor slab, conduits only */
  for (const s of slabs) {
    if (s.level === 'roof' || s.tags.includes('patio')) continue;
    const r = slabRect(p, s), top = s.props.topElevation;
    const voids = voidsOf.get(s.id) ?? [];
    const cells = s.props.spaces ? spaces.filter((x) => s.props.spaces!.includes(x.id) && !s.props.voidSpaces.includes(x.id)).flatMap((x) => x.props.cells) : [r];
    cells.forEach((c, i) => {
      if (voids.some((v) => v.x0 <= c.x0 && v.x1 >= c.x1 && v.y0 <= c.y0 && v.y1 >= c.y1)) return;
      volumes.push({
        id: `screed:${s.id}:${i}`, kind: 'screed', name: `Floor screed on ${s.props.name}`, level: s.level, rect: c,
        zLo: flat(top - SCREED.depth), zHi: flat(top), allows: new Set(['conduit']), maxDn: SCREED.maxConduit, elementId: s.id,
      });
    });
  }
  /* roof screed: conduits for the upper-floor ceiling lights run in the roof slab's topping, under the waterproofing */
  for (const s of slabs.filter((x) => x.level === 'roof' || (x.level === 'UF' && x.props.parapet !== undefined))) {
    const r = slabRect(p, s), top = s.props.topElevation;
    volumes.push({ id: `screed:${s.id}`, kind: 'screed', name: `Roof topping on ${s.props.name}`, level: s.level, rect: r, zLo: flat(top - SCREED.depth), zHi: flat(top), allows: new Set(['conduit']), maxDn: SCREED.maxConduit, elementId: s.id });
  }
  /* crawlspace under the raised street floor, in front of the cut line */
  const sl = slabs.find((s) => s.level === 'SL' && s.props.spaces);
  const crawl: Rect[] = [];
  if (sl) {
    const cut = p.site.cut.lineY;
    const voids = voidsOf.get(sl.id) ?? [];
    for (const sp of spaces.filter((x) => sl.props.spaces!.includes(x.id))) {
      for (const c of sp.props.cells) {
        if (voids.some((v) => v.x0 <= c.x0 && v.x1 >= c.x1 && v.y0 <= c.y0 && v.y1 >= c.y1)) continue;
        if (c.y0 >= cut) continue;
        crawl.push({ ...c, y1: Math.min(c.y1, cut) });
      }
    }
    const top = sl.props.topElevation - sl.props.thickness;
    crawl.forEach((c, i) => volumes.push({
      id: `crawl:${i}`, kind: 'crawlspace', name: 'Crawlspace under the street floor', level: 'SL', rect: c,
      zLo: (x, y) => groundAt(p, x, y, zones), zHi: flat(top), allows: new Set(ALL), maxDn: 150,
    }));
  }
  /* underground: outside the house, and under the lower-level slab on grade */
  const lot = p.site.lotPolygon.map(([x, y]) => [x - p.site.houseOrigin.x, y - p.site.houseOrigin.y] as P2);
  const lx = lot.map((c) => c[0]), ly = lot.map((c) => c[1]);
  const lotRect: Rect = { x0: Math.min(...lx) - 0.5, x1: Math.max(...lx) + 0.5, y0: Math.min(...ly) - 8, y1: Math.max(...ly) };
  const house = (x: number, y: number) => crawl.some((c) => strictly(x, y, c)) || ['LL', 'SL'].some((l) => !!inRoom(l, x, y) && !(l === 'SL' && patio.some((r) => pointInRect(x, y, r))));
  const llSlab = slabs.find((s) => s.level === 'LL' && s.props.onGrade);
  const outerWalls = walls.filter((w) => (w.level === 'LL' || w.level === 'SL') && w.props.wallType !== 'interior' && w.props.wallType !== 'wet').map((w) => {
    const sg = wallSeg(w), h = w.props.thickness / 2;
    return { rect: sg.o === 'v' ? { x0: sg.c - h, x1: sg.c + h, y0: sg.a, y1: sg.b } : { x0: sg.a, x1: sg.b, y0: sg.c - h, y1: sg.c + h }, base: wallSpan(p, w).base };
  });
  volumes.push({
    id: 'ground', kind: 'underground', name: 'Underground', level: 'site', rect: lotRect,
    zLo: flat(-10),
    zHi: (x, y) => {
      if (llSlab && pointInRect(x, y, slabRect(p, llSlab))) return llSlab.props.topElevation - llSlab.props.thickness;
      if (crawl.some((c) => pointInRect(x, y, c))) return groundAt(p, x, y, zones);
      // under the foundation of an outer wall
      const w = outerWalls.find((v) => pointInRect(x, y, v.rect));
      if (w) return w.base - 0.01;
      if (house(x, y)) return -Infinity;
      return surface(x, y) - cover(x, y);
    },
    allows: new Set(ALL), maxDn: 150,
  });
  // slab bodies: pipes and conduits only cross them vertically, through sleeves
  for (const s of slabs) {
    const r = slabRect(p, s);
    volumes.push({ id: `sleeve:${s.id}`, kind: 'sleeve', name: `Sleeve through ${s.props.name}`, level: s.level, rect: r, zLo: flat(s.props.topElevation - s.props.thickness - 0.01), zHi: flat(s.props.topElevation + 0.01), allows: new Set(ALL), maxDn: 150, elementId: s.id });
  }
  // rain downpipes fixed to the outside face of outer walls
  for (const w of walls.filter((x) => x.props.wallType === 'exterior')) {
    const s = wallSeg(w), span = wallSpan(p, w), t = w.props.thickness;
    for (const side of [1, -1]) {
      const probe: P2 = s.o === 'v' ? [s.c + side * (t / 2 + 0.1), (s.a + s.b) / 2] : [(s.a + s.b) / 2, s.c + side * (t / 2 + 0.1)];
      if (inRoom(w.level, probe[0], probe[1])) continue;
      const lo = s.c + side * (t / 2), hi = s.c + side * (t / 2 + 0.2);
      const rect: Rect = s.o === 'v' ? { x0: Math.min(lo, hi), x1: Math.max(lo, hi), y0: s.a, y1: s.b } : { x0: s.a, x1: s.b, y0: Math.min(lo, hi), y1: Math.max(lo, hi) };
      volumes.push({ id: `facade:${w.id}:${side}`, kind: 'facade', name: `Pipe fixed to the facade (${w.id})`, level: w.level, rect, zLo: (x, y) => surface(x, y) - 1.2, zHi: flat(span.top + 1.1), allows: new Set(['rain', 'vent']), maxDn: 150, elementId: w.id });
    }
  }
  // carport: conduits and the downpipe run along its posts and under its roof
  for (const c of p.elements) {
    if (c.type === 'Carport') volumes.push({ id: `carport:${c.id}`, kind: 'equipment', name: 'Carport roof structure', level: 'site', rect: c.props.rect, zLo: flat(c.props.roofFront - 0.5), zHi: flat(c.props.roofFront + 0.35), allows: new Set(['conduit', 'rain']), maxDn: 150, elementId: c.id });
    if (c.type === 'Column' && c.tags.includes('carport')) volumes.push({ id: `post:${c.id}`, kind: 'equipment', name: `Carport post ${c.id}`, level: 'site', rect: { x0: c.props.at[0] - 0.2, x1: c.props.at[0] + 0.2, y0: c.props.at[1] - 0.5, y1: c.props.at[1] + 0.5 }, zLo: flat(-1.5), zHi: flat(c.props.topElevation + 0.2), allows: new Set(['conduit', 'rain']), maxDn: 150, elementId: c.id });
  }
  // devices: the last centimetres of a conduit are inside the device's box; outdoor devices on poles carry theirs
  for (const d of p.elements) {
    if (d.type !== 'Device') continue;
    const [sx, sy, sz] = d.props.size ?? deviceType(d.props.kind).size;
    const m = Math.max(sx, sy) / 2 + 0.04;
    volumes.push({ id: `dev:${d.id}`, kind: 'equipment', name: d.props.name, level: d.level, rect: { x0: d.props.at[0] - m, x1: d.props.at[0] + m, y0: d.props.at[1] - m, y1: d.props.at[1] + m }, zLo: flat(d.props.z - sz / 2 - 0.04), zHi: flat(d.props.z + sz / 2 + 0.04), allows: new Set(['conduit']), maxDn: 50, elementId: d.id });
    const underCarport = p.elements.some((c) => c.type === 'Carport' && pointInRect(d.props.at[0], d.props.at[1], c.props.rect));
    if ((d.level === 'site' || d.level === 'carport' || d.props.hostId === 'post') && !d.props.hostWallId && !underCarport) {
      volumes.push({ id: `pole:${d.id}`, kind: 'equipment', name: `Post of ${d.props.name}`, level: 'site', rect: { x0: d.props.at[0] - 0.1, x1: d.props.at[0] + 0.1, y0: d.props.at[1] - 0.1, y1: d.props.at[1] + 0.1 }, zLo: (x, y) => surface(x, y) - 1.2, zHi: flat(d.props.z + 0.1), allows: new Set(['conduit']), maxDn: 50, elementId: d.id });
    }
  }
  // equipment and site fixtures hold their own short pipe stubs
  for (const f of p.elements) {
    if (f.type !== 'Fixture') continue;
    const m = fixtureMount(f.props.kind);
    const t = kindOf(f.props.kind);
    if (m === 'wall' || m === 'shaft') {
      // a fixture's own footprint: its hoses and a supply fed through the floor stay inside it
      const [sx, sy, sz] = t.size;
      const fl = f.props.z;
      volumes.push({ id: `fix:${f.id}`, kind: 'equipment', name: t.label, level: f.level, rect: { x0: f.props.at[0] - sx / 2, x1: f.props.at[0] + sx / 2, y0: f.props.at[1] - sy / 2, y1: f.props.at[1] + sy / 2 }, zLo: flat(fl - 0.02), zHi: flat(fl + Math.max(sz, (t.supplyZ ?? 0.6)) + 0.05), allows: new Set(['cold', 'hot', 'sewage']), maxDn: 100, elementId: f.id });
      continue;
    }
    if (m !== 'equipment' && m !== 'site' && m !== 'floor') continue;
    const [sx, sy, sz] = t.size, base = f.props.z + (t.zOffset ?? 0);
    // a roof drain includes its outlet and the scupper to its downpipe; site boxes reach down into the ground
    const m2 = f.props.kind === 'roof-drain' ? 0.55 : 0.05;
    volumes.push({
      id: `equip:${f.id}`, kind: 'equipment', name: t.label, level: f.level,
      rect: { x0: f.props.at[0] - sx / 2 - m2, x1: f.props.at[0] + sx / 2 + m2, y0: f.props.at[1] - sy / 2 - m2, y1: f.props.at[1] + sy / 2 + m2 },
      zLo: m === 'site' ? (x: number, y: number) => Math.min(base, surface(x, y)) - 1.2 : flat(base - (f.props.kind === 'roof-drain' ? 0.25 : 0.05)), zHi: flat(base + sz + 0.35), allows: new Set(PIPES), maxDn: 150, elementId: f.id,
    });
  }

  /* forbidden zones */
  const forbidden: Forbidden[] = [];
  for (const st of p.elements) {
    if (st.type !== 'Stair') continue;
    // above the floor it stands on (the screed under it is free), up to the headroom over the top flight
    const z0 = elev(st.props.fromLevel) + 0.02, z1 = elev(st.props.toLevel) + 2.1;
    st.props.flights.forEach((f, i) => forbidden.push({
      id: `stair:${st.id}:${i}`, kind: 'stair', name: `${st.props.name} (flight and headroom)`, elementId: st.id,
      box: { x0: Math.min(f.x0, f.x1), x1: Math.max(f.x0, f.x1), y0: Math.min(f.yBottom, f.yTop), y1: Math.max(f.yBottom, f.yTop), z0, z1 },
    }));
  }
  for (const s of spaces.filter((x) => x.props.zone === 'stair')) {
    const up = levelAbove(s.level);
    // from the floor (or, for the well of an upper floor, from where the slab would be) to under the slab above
    const z0 = s.props.stairKind === 'void' ? elev(s.level) - 0.4 : elev(s.level) + 0.01;
    // up to just under the slab above (a light on the soffit over a stair is fine)
    const z1 = (up ? elev(up) : elev(s.level) + p.structure.floorToFloor) - 0.25;
    s.props.cells.forEach((c, i) => forbidden.push({ id: `stairwell:${s.id}:${i}`, kind: 'stair', name: `Stair well (${s.level})`, elementId: s.id, box: { ...c, z0, z1 } }));
  }
  for (const op of p.elements) {
    if (op.type !== 'Opening') continue;
    const w = walls.find((x) => x.id === op.props.host);
    if (!w) continue;
    forbidden.push(openingBox(p, op, w));
  }
  for (const c of p.elements) {
    if (c.type !== 'Column') continue;
    const pr = profile(c.props.profile), m = 0.02;
    forbidden.push({ id: `col:${c.id}`, kind: 'column', name: `${c.props.kind === 'pier' ? 'Pier' : 'Column'} ${c.id}`, elementId: c.id, box: { x0: c.props.at[0] - pr.b / 2 - m, x1: c.props.at[0] + pr.b / 2 + m, y0: c.props.at[1] - pr.d / 2 - m, y1: c.props.at[1] + pr.d / 2 + m, z0: c.props.baseElevation, z1: c.props.topElevation } });
  }
  for (const f of p.elements) {
    if (f.type !== 'Footing') continue;
    const r = f.props.rect;
    forbidden.push({ id: `foot:${f.id}`, kind: 'footing', name: `Footing ${f.id}`, elementId: f.id, box: { ...r, z0: f.props.topElevation - f.props.depth, z1: f.props.topElevation } });
  }
  for (const w of walls.filter((x) => x.props.wallType === 'retaining')) {
    const s = wallSeg(w), span = wallSpan(p, w), half = w.props.thickness / 2;
    const top = retainedGround(p, w, surface);
    if (top <= span.base) continue;
    forbidden.push({
      id: `ret:${w.id}`, kind: 'retaining', name: `Retaining wall ${w.id} below the retained ground`, elementId: w.id,
      box: s.o === 'v' ? { x0: s.c - half, x1: s.c + half, y0: s.a, y1: s.b, z0: span.base, z1: top } : { x0: s.a, x1: s.b, y0: s.c - half, y1: s.c + half, z0: span.base, z1: top },
    });
  }

  /* beams with their spans */
  const beamEls = p.elements.filter((e) => e.type === 'Beam');
  const cols = p.elements.filter((e) => e.type === 'Column');
  const beams: BeamInfo[] = beamEls.map((b) => {
    const pr = profile(b.props.profile);
    const [sx, sy] = b.props.start, [ex, ey] = b.props.end;
    const o: 'v' | 'h' = Math.abs(sx - ex) < 1e-6 ? 'v' : 'h';
    const c = o === 'v' ? sx : sy, a = o === 'v' ? Math.min(sy, ey) : Math.min(sx, ex), bb = o === 'v' ? Math.max(sy, ey) : Math.max(sx, ex);
    const sup = new Set<number>([a, bb]);
    for (const col of cols) {
      const [x, y] = col.props.at;
      const on = o === 'v' ? Math.abs(x - c) < 0.05 : Math.abs(y - c) < 0.05;
      const t = o === 'v' ? y : x;
      if (on && t > a - 0.05 && t < bb + 0.05 && col.props.topElevation >= b.props.elevation - 0.3) sup.add(t);
    }
    return { id: b.id, name: `${b.props.profile} beam ${b.id}`, o, c, a, b: bb, zTop: b.props.elevation, depth: pr.d, width: pr.b, supports: [...sup].sort((u, v) => u - v) };
  });

  const llRect = llSlab ? slabRect(p, llSlab) : null;
  const underLL = (x: number, y: number) => !!llRect && x > llRect.x0 + 1e-6 && x < llRect.x1 - 1e-6 && y > llRect.y0 + 1e-6 && y < llRect.y1 - 1e-6;
  return { volumes, forbidden, beams, zones, surface, cover, soffit, floorTop, inRoom, crawl, underLL, elev, levelAbove };
}

/** Height of the ground a retaining wall holds back (the higher of the two sides, outside the house). */
function retainedGround(_p: Project, w: Wall, surface: (x: number, y: number) => number): number {
  const s = wallSeg(w), mid = (s.a + s.b) / 2, d = w.props.thickness / 2 + 0.3;
  const pts: P2[] = s.o === 'v' ? [[s.c - d, mid], [s.c + d, mid]] : [[mid, s.c - d], [mid, s.c + d]];
  return Math.max(...pts.map(([x, y]) => surface(x, y)));
}

function openingBox(p: Project, op: Opening, w: Wall): Forbidden {
  const s = wallSeg(w), span = wallSpan(p, w);
  const floor = p.levels.find((l) => l.id === op.level)?.elevation ?? span.base;
  const door = op.props.role === 'door';
  const m = door ? 0.1 : 0.03, half = w.props.thickness / 2 + 0.01;
  const a = s.a + op.props.offset - m, b = s.a + op.props.offset + op.props.width + m;
  // a door starts at the floor: the screed under its threshold stays usable
  const z0 = door ? floor : Math.max(floor, floor + op.props.sill - m), z1 = floor + op.props.sill + op.props.height + m;
  return {
    id: `open:${op.id}`, kind: door ? 'door' : 'window', name: `${door ? 'Door' : 'Window'} ${op.id}${door ? ' (+0.10 m frame)' : ''}`, elementId: op.id,
    box: s.o === 'v' ? { x0: s.c - half, x1: s.c + half, y0: a, y1: b, z0, z1 } : { x0: a, x1: b, y0: s.c - half, y1: s.c + half, z0, z1 },
  };
}

function storedVolume(p: Project, e: ServiceSpace, soffit: MepContext['soffit']): Volume {
  const r = e.props.rect;
  const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
  if (e.props.kind === 'plenum') {
    const depth = e.props.depth ?? 0.25;
    const top = soffit(e.level, cx, cy) ?? (p.levels.find((l) => l.id === e.level)?.elevation ?? 0) + p.structure.clearHeight;
    return { id: e.id, kind: 'plenum', name: e.props.name, level: e.level, rect: r, zLo: flat(top - depth), zHi: flat(top), allows: new Set(ALL), maxDn: 150, elementId: e.id };
  }
  if (e.props.kind === 'roof-zone') {
    const z = e.props.z0 ?? 0;
    return { id: e.id, kind: 'roof-zone', name: e.props.name, level: e.level, rect: r, zLo: flat(z - 0.02), zHi: flat(z + 2.6), allows: new Set(ALL), maxDn: 150, elementId: e.id };
  }
  return { id: e.id, kind: 'shaft', name: e.props.name, level: e.level, rect: r, zLo: flat(e.props.z0 ?? -3), zHi: flat(e.props.z1 ?? 8), allows: new Set(ALL), maxDn: 150, elementId: e.id };
}

/** Is a point (with a pipe radius) inside a volume? Walls must hold the pipe inside their cavity (15 mm cover). */
export function volumeHolds(v: Volume, x: number, y: number, z: number, r = 0, tol = 0.006): boolean {
  if (v.wall) {
    const w = v.wall;
    const along = w.o === 'v' ? y : x, perp = w.o === 'v' ? x : y;
    const a0 = w.o === 'v' ? v.rect.y0 : v.rect.x0, a1 = w.o === 'v' ? v.rect.y1 : v.rect.x1;
    if (along < a0 - w.t / 2 - tol || along > a1 + w.t / 2 + tol) return false;
    if (Math.abs(perp - w.c) > Math.max(0, w.t / 2 - 0.015 - r) + tol) return false;
  } else if (!(x >= v.rect.x0 - tol && x <= v.rect.x1 + tol && y >= v.rect.y0 - tol && y <= v.rect.y1 + tol)) return false;
  return z >= v.zLo(x, y) - tol && z <= v.zHi(x, y) + tol;
}

export const boxHolds = (b: Box3, x: number, y: number, z: number, r = 0) =>
  x > b.x0 - r + 1e-4 && x < b.x1 + r - 1e-4 && y > b.y0 - r + 1e-4 && y < b.y1 + r - 1e-4 && z > b.z0 - r + 1e-4 && z < b.z1 + r - 1e-4;

/** Is this plan point inside a fixture's footprint (used to let a drain pass through its own fixture)? */
export const inFootprint = (f: Fixture, x: number, y: number, m = 0.05) => {
  const [sx, sy] = kindOf(f.props.kind).size;
  return Math.abs(x - f.props.at[0]) <= sx / 2 + m && Math.abs(y - f.props.at[1]) <= sy / 2 + m;
};

export { inPoly };
