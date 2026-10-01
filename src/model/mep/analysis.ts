// Spec 04b: the physics of every pipe, conduit, fixture and device. Which service space holds each run, what it
// crosses, what it clashes with, whether it falls, what holds it up, and whether equipment can be serviced.
// Pure and cached per project; the checks, the "Physics" colour mode and the "Why here?" line all read it.
import { getEl, pointInRect, wallSeg } from '../geometry';
import type { Conduit, Device, Element, Fixture, PipeSegment, Project, Rect, ServiceSpace, Space } from '../schema';
import { deviceType } from '../electrical/library';
import { kindOf, minSewageSlope } from '../plumbing/library';
import { CLEARANCE, CLEAR_HEIGHT, CRAWL_GAP, ELEC_HOT_GAP, EQUIPMENT_ROOMS, SCREED, WALL_RUN_MAX, WEB_HOLE, hangerSpacing, outerD } from './library';
import { ceilingHost, facesFor, mountOf, roomOf } from './hosting';
import { spanAt } from './layers';
import { boxHolds, mepContext, volumeHolds, type Box3, type Carry, type HostKind, type MepContext, type P3, type Volume } from './spaces';

export interface SegInfo {
  id: string;
  kind: 'pipe' | 'conduit';
  carry: Carry;
  network: string;
  a: P3; b: P3; r: number; dn: number;
  /** The space holding most of it ('exposed' if none). */
  host: HostKind | 'exposed';
  hostName: string;
  hostId?: string;
  exposed: number;
  issues: string[];
  /** Web holes through beams (for the engineer). */
  holes: { beam: string; at: P3 }[];
  forbidden: { id: string; name: string; elementId: string }[];
}
export interface ItemInfo { id: string; name: string; mount: string; hostName: string; ok: boolean; problem?: string; clearance?: Box3; notes: string[] }
export interface Clash { a: string; b: string; kind: string; at: P3; text: string }
export interface MepReport {
  segs: Map<string, SegInfo>;
  items: Map<string, ItemInfo>;
  clashes: Clash[];
  hangers: { seg: string; pts: P3[]; tops: number[]; missing: number }[];
  heights: { id: string; name: string; clear: number; need: number; ok: boolean; level: string; room: string }[];
  slopes: { id: string; slope: number; need: number; bad: 'reversed' | 'flat' | null }[];
  capacity: { id: string; text: string }[];
  access: { id: string; ok: boolean; text: string }[];
}

const CACHE = new WeakMap<Project, MepReport>();
const STEP = 0.05;

export function mepReport(p: Project): MepReport {
  const hit = CACHE.get(p);
  if (hit) return hit;
  const r = analyse(p);
  CACHE.set(p, r);
  return r;
}

const isGravity = (s: PipeSegment) => (s.props.system === 'sewage' || s.props.system === 'rain') && !s.props.pressure;
const horiz = (a: P3, b: P3) => Math.hypot(b[0] - a[0], b[1] - a[1]);

function analyse(p: Project): MepReport {
  const ctx = mepContext(p);
  const pipes = p.elements.filter((e): e is PipeSegment => e.type === 'PipeSegment');
  const conduits = p.elements.filter((e): e is Conduit => e.type === 'Conduit');
  const rep: MepReport = { segs: new Map(), items: new Map(), clashes: [], hangers: [], heights: [], slopes: [], capacity: [], access: [] };
  // spatial index of volumes (the ground is checked separately)
  const ground = ctx.volumes.find((v) => v.kind === 'underground')!;
  const index = new Map<string, Volume[]>();
  const key = (i: number, j: number) => `${i},${j}`;
  for (const v of ctx.volumes) {
    if (v === ground) continue;
    for (let i = Math.floor(v.rect.x0 - 0.3); i <= Math.floor(v.rect.x1 + 0.3); i++) for (let j = Math.floor(v.rect.y0 - 0.3); j <= Math.floor(v.rect.y1 + 0.3); j++) {
      const k = key(i, j);
      index.set(k, [...(index.get(k) ?? []), v]);
    }
  }
  const near = (x: number, y: number) => [...(index.get(key(Math.floor(x), Math.floor(y))) ?? []), ground];

  /* ---- 1. what holds each run ---- */
  const classify = (id: string, kind: 'pipe' | 'conduit', carry: Carry, network: string, a: P3, b: P3, dn: number): SegInfo => {
    const r = outerD(dn) / 2;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const n = Math.max(2, Math.min(400, Math.ceil(len / STEP) + 1));
    const count = new Map<Volume, number>();
    let exposed = 0;
    const forb = new Map<string, { id: string; name: string; elementId: string }>();
    const vertical = horiz(a, b) < 0.01;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      // stay off the very ends: they sit inside the fitting or the fixture
      const tt = Math.min(0.995, Math.max(0.005, t));
      const x = a[0] + (b[0] - a[0]) * tt, y = a[1] + (b[1] - a[1]) * tt, z = a[2] + (b[2] - a[2]) * tt;
      const holders = near(x, y).filter((v) => v.allows.has(carry) && volumeHolds(v, x, y, z, v.kind === 'wall' ? r : 0)
        && (v.kind !== 'sleeve' || vertical) && (v.kind !== 'facade' || vertical));
      if (!holders.length) exposed += len / n;
      for (const v of holders) count.set(v, (count.get(v) ?? 0) + 1);
      const inWall = holders.some((v) => v.kind === 'wall' || v.kind === 'shaft');
      for (const f of ctx.forbidden) {
        if (f.kind === 'stair' && inWall) continue;
        if (boxHolds(f.box, x, y, z, r * 0.7)) forb.set(f.id, { id: f.id, name: f.name, elementId: f.elementId });
      }
    }
    let host: Volume | undefined;
    for (const [v, c] of count) if (!host || c > count.get(host)! || (c === count.get(host)! && rank(v) < rank(host))) host = v;
    const issues: string[] = [];
    if (exposed > 0.03) issues.push(`${exposed.toFixed(2)} m outside any service space (exposed / floating)`);
    if (host?.kind === 'wall' && host.wall) {
      const dh = horiz(a, b);
      if (dh > 0.01) {
        if (dh > WALL_RUN_MAX + 1e-6) issues.push(`horizontal run of ${dh.toFixed(2)} m inside a wall (max ${WALL_RUN_MAX} m)`);
        if ((host.wall.type === 'exterior' || host.wall.type === 'retaining') && kind === 'pipe' && dh > 0.3) issues.push(`horizontal pipe inside an ${host.wall.type} wall`);
      }
      if (kind === 'pipe' && dn > host.maxDn) rep.capacity.push({ id, text: `DN ${dn} in a ${(host.wall.t * 100).toFixed(0)} cm wall (max DN ${host.maxDn})` });
    }
    if (host?.kind === 'screed' && kind === 'conduit' && dn > SCREED.maxConduit) rep.capacity.push({ id, text: `${dn} mm conduit in the floor screed (max ${SCREED.maxConduit} mm)` });
    if (host?.kind === 'crawlspace' && !vertical) {
      const lo = Math.min(a[2], b[2]) - r;
      const xs = a[2] <= b[2] ? a : b;
      const g = ctx.volumes.find((v) => v.kind === 'crawlspace' && pointInRect(xs[0], xs[1], v.rect));
      const gz = g ? g.zLo(xs[0], xs[1]) : -Infinity;
      if (lo >= gz - 1e-3 && lo < gz + CRAWL_GAP - 1e-3) issues.push(`only ${(lo - gz).toFixed(2)} m above the crawlspace ground (min ${CRAWL_GAP})`);
    }
    const forbidden = [...forb.values()];
    for (const f of forbidden) issues.push(`crosses ${f.name}`);
    return { id, kind, carry, network, a, b, r, dn, host: host ? host.kind : 'exposed', hostName: host ? host.name : 'nothing (exposed)', hostId: host?.id, exposed, issues, holes: [], forbidden };
  };
  for (const s of pipes) rep.segs.set(s.id, classify(s.id, 'pipe', s.props.system, s.props.network, s.props.start, s.props.end, s.props.dn));
  for (const c of conduits) rep.segs.set(c.id, classify(c.id, 'conduit', 'conduit', c.props.circuit, c.props.start, c.props.end, c.props.dn));

  /* ---- 2. structure: beams (web holes or clashes), columns ---- */
  const all = [...rep.segs.values()];
  for (const s of all) {
    for (const bm of ctx.beams) {
      const zb = bm.zTop - bm.depth;
      const z0 = Math.min(s.a[2], s.b[2]) - s.r, z1 = Math.max(s.a[2], s.b[2]) + s.r;
      if (z1 <= zb + 1e-3 || z0 >= bm.zTop - 1e-3) continue;
      // where does the run cross the beam's line?
      const ax = bm.o === 'v' ? 0 : 1;
      const ca = s.a[ax]!, cb = s.b[ax]!;
      const half = bm.width / 2 + s.r;
      if (Math.max(ca, cb) < bm.c - half || Math.min(ca, cb) > bm.c + half) continue;
      const t = Math.abs(cb - ca) < 1e-9 ? 0.5 : Math.min(1, Math.max(0, (bm.c - ca) / (cb - ca)));
      const at: P3 = [s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t, s.a[2] + (s.b[2] - s.a[2]) * t];
      const along = bm.o === 'v' ? at[1] : at[0];
      if (along < bm.a - 0.01 || along > bm.b + 0.01) continue;
      if (at[2] + s.r <= zb + 1e-3 || at[2] - s.r >= bm.zTop - 1e-3) continue;
      const vertical = horiz(s.a, s.b) < 0.01;
      const span = spanAt(bm.supports, along);
      const mid = !!span && along > span[0] + (span[1] - span[0]) / 3 && along < span[1] - (span[1] - span[0]) / 3;
      const holeOk = 2 * s.r <= WEB_HOLE * bm.depth && at[2] - s.r > zb + 0.02 && at[2] + s.r < bm.zTop - 0.02;
      if (!vertical && holeOk && mid) s.holes.push({ beam: bm.id, at });
      else {
        const why = vertical ? 'runs through the beam' : !holeOk ? `hole Ø ${(2 * s.r * 1000).toFixed(0)} mm > 0.4 × ${(bm.depth * 1000).toFixed(0)} mm` : 'hole outside the middle third of the span';
        rep.clashes.push({ a: s.id, b: bm.id, kind: 'MEP–structure', at, text: `${label(s)} × ${bm.name}: ${why}` });
      }
    }
  }
  for (const s of all) {
    for (const f of s.forbidden) {
      const kind = /Column|Pier|Footing|Retaining/.test(f.name) ? 'MEP–structure' : /Door|Window/.test(f.name) ? 'MEP–door/window' : 'MEP–stair';
      rep.clashes.push({ a: s.id, b: f.elementId, kind, at: s.a, text: `${label(s)} × ${f.name}` });
    }
  }

  /* ---- 3. clashes between runs ---- */
  const bb = all.map((s) => ({ s, x0: Math.min(s.a[0], s.b[0]) - s.r - 0.21, x1: Math.max(s.a[0], s.b[0]) + s.r + 0.21, y0: Math.min(s.a[1], s.b[1]) - s.r - 0.21, y1: Math.max(s.a[1], s.b[1]) + s.r + 0.21, z0: Math.min(s.a[2], s.b[2]) - s.r - 0.21, z1: Math.max(s.a[2], s.b[2]) + s.r + 0.21 }));
  bb.sort((u, v) => u.x0 - v.x0);
  const touch = (u: SegInfo, v: SegInfo) => [u.a, u.b].some((x) => [v.a, v.b].some((y) => Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 0.03));
  // drains and vents join each other: a run that ends on another (a tee or a wye) is a joint, not a clash
  const joins = (u: SegInfo, v: SegInfo) => {
    const drain = (s: SegInfo) => s.carry === 'sewage' || s.carry === 'vent' || s.carry === 'rain';
    const same = u.carry === v.carry || (drain(u) && drain(v));
    if (!same) return false;
    return [u.a, u.b].some((x) => segDist(x, x, v.a, v.b).d < u.r + v.r + 0.02) || [v.a, v.b].some((x) => segDist(x, x, u.a, u.b).d < u.r + v.r + 0.02);
  };
  for (let i = 0; i < bb.length; i++) {
    const A = bb[i]!;
    for (let j = i + 1; j < bb.length; j++) {
      const B = bb[j]!;
      if (B.x0 > A.x1) break;
      if (B.y0 > A.y1 || B.y1 < A.y0 || B.z0 > A.z1 || B.z1 < A.z0) continue;
      const u = A.s, v = B.s;
      if (u.kind === 'conduit' && v.kind === 'conduit') continue;
      if (u.network === v.network) continue;
      if (touch(u, v) || joins(u, v)) continue;
      const { d, pt } = segDist(u.a, u.b, v.a, v.b);
      const hot = (u.kind === 'conduit' && v.carry === 'hot') || (v.kind === 'conduit' && u.carry === 'hot');
      if (d < u.r + v.r + 0.005) rep.clashes.push({ a: u.id, b: v.id, kind: u.kind === 'conduit' || v.kind === 'conduit' ? 'pipe–conduit' : 'pipe–pipe', at: pt, text: `${label(u)} × ${label(v)}` });
      else if (hot && d < u.r + v.r + ELEC_HOT_GAP - 1e-3) rep.clashes.push({ a: u.id, b: v.id, kind: 'pipe–conduit', at: pt, text: `${label(u)} is ${(d - u.r - v.r).toFixed(2)} m from ${label(v)} (keep ${ELEC_HOT_GAP} m from hot water)` });
      else if (u.host === 'underground' && v.host === 'underground' && ((u.carry === 'cold' && v.carry === 'sewage') || (v.carry === 'cold' && u.carry === 'sewage')) && d < u.r + v.r + 0.2) {
        rep.clashes.push({ a: u.id, b: v.id, kind: 'pipe–pipe', at: pt, text: `water and sewage closer than 0.20 m underground (${label(u)} × ${label(v)})` });
      }
    }
  }

  /* ---- 4. slopes of gravity runs ---- */
  for (const s of pipes) {
    if (!isGravity(s)) continue;
    const h = horiz(s.props.start, s.props.end);
    if (h < 0.25) continue;
    const dz = s.props.start[2] - s.props.end[2];
    if (Math.abs(dz) / h >= 1) continue;
    const need = s.props.system === 'rain' ? 0.005 : minSewageSlope(s.props.dn);
    const slope = dz / h;
    rep.slopes.push({ id: s.id, slope, need, bad: slope < -1e-4 ? 'reversed' : slope < need - 1e-3 ? 'flat' : null });
  }

  /* ---- 5. supports: hangers on horizontal runs that hang (plenums, crawlspace, shafts) ---- */
  for (const s of all) {
    if (!['plenum', 'crawlspace'].includes(s.host)) continue;
    const h = horiz(s.a, s.b);
    if (h < 0.3 || Math.abs(s.b[2] - s.a[2]) / h > 0.2) continue;
    const el = getEl(p, s.id);
    const mat = el?.type === 'PipeSegment' ? el.props.material : 'conduit';
    const sp = hangerSpacing(mat, s.dn, s.kind === 'conduit' ? 'conduit' : s.carry);
    const n = Math.max(1, Math.ceil(h / sp - 1e-6));
    const pts: P3[] = [], tops: number[] = [];
    let missing = 0;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const pt: P3 = [s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t, s.a[2] + (s.b[2] - s.a[2]) * t];
      const level = s.host === 'crawlspace' ? 'LL' : ctx.volumes.find((v) => v.id === s.hostId)?.level ?? 'SL';
      const top = s.host === 'crawlspace' ? ctx.soffit('LL', pt[0], pt[1]) ?? slabUnder(ctx, 'SL', pt) : ctx.soffit(level, pt[0], pt[1]);
      if (top === null || top < pt[2]) missing++;
      pts.push(pt); tops.push(top ?? pt[2] + 0.1);
    }
    rep.hangers.push({ seg: s.id, pts, tops, missing });
  }

  /* ---- 6. hosts of fixtures and devices ---- */
  const items = p.elements.filter((e): e is Fixture | Device => (e.type === 'Fixture' || e.type === 'Device') && !e.tags.includes('auto'));
  for (const e of items) rep.items.set(e.id, hostInfo(p, ctx, e, rep));

  /* ---- 7. ceiling heights under the plenums ---- */
  for (const pl of p.elements) {
    if (pl.type !== 'ServiceSpace' || pl.props.kind !== 'plenum') continue;
    const r = pl.props.rect;
    const c: [number, number] = [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2];
    const so = ctx.soffit(pl.level, c[0], c[1]);
    const fl = ctx.floorTop(pl.level, c[0], c[1]) ?? ctx.elev(pl.level);
    if (so === null) continue;
    const room = p.elements.find((s): s is Space => s.type === 'Space' && s.level === pl.level && s.props.cells.some((cc) => c[0] > cc.x0 && c[0] < cc.x1 && c[1] > cc.y0 && c[1] < cc.y1));
    const clear = so - (pl.props.depth ?? 0.25) - fl;
    const narrow = Math.min(r.x1 - r.x0, r.y1 - r.y0) <= CLEAR_HEIGHT.bulkheadWidth + 1e-6;
    const need = narrow ? CLEAR_HEIGHT.bulkhead : room && (room.props.zone === 'private' || room.props.zone === 'work' || (room.props.zone === 'social' && room.props.name !== 'Kitchen')) ? CLEAR_HEIGHT.living : CLEAR_HEIGHT.wet;
    rep.heights.push({ id: pl.id, name: pl.props.name, clear, need, ok: clear >= need - 1e-6, level: pl.level, room: room?.props.name ?? '' });
  }

  /* ---- 8. shaft capacity (from the router's notes) ---- */
  for (const nt of p.mep?.notes ?? []) if (/is full/.test(nt)) rep.capacity.push({ id: nt.split(' is full')[0]!, text: nt });
  return rep;
}

const rank = (v: Volume) => ['shaft', 'wall', 'plenum', 'crawlspace', 'screed', 'roof-zone', 'facade', 'underground', 'sleeve', 'equipment'].indexOf(v.kind);
const label = (s: SegInfo) => `${s.kind === 'conduit' ? 'conduit' : `${s.carry} DN ${s.dn}`} ${s.id}`;

function slabUnder(ctx: MepContext, level: string, pt: P3): number | null {
  const t = ctx.floorTop(level, pt[0], pt[1]);
  return t === null ? null : t - 0.14;
}

/** Closest distance between two 3D segments, and the closest point on the first. */
export function segDist(p1: P3, q1: P3, p2: P3, q2: P3): { d: number; pt: P3 } {
  const d1 = [q1[0] - p1[0], q1[1] - p1[1], q1[2] - p1[2]], d2 = [q2[0] - p2[0], q2[1] - p2[1], q2[2] - p2[2]], r = [p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]];
  const dot = (u: number[], v: number[]) => u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!;
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s = 0, t = 0;
  if (a <= 1e-12 && e <= 1e-12) { s = t = 0; }
  else if (a <= 1e-12) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = dot(d1, r);
    if (e <= 1e-12) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  const c1: P3 = [p1[0] + d1[0]! * s, p1[1] + d1[1]! * s, p1[2] + d1[2]! * s], c2: P3 = [p2[0] + d2[0]! * t, p2[1] + d2[1]! * t, p2[2] + d2[2]! * t];
  return { d: Math.hypot(c1[0] - c2[0], c1[1] - c2[1], c1[2] - c2[2]), pt: c1 };
}

const PLAN = ['LL', 'SL', 'UF'];

function hostInfo(p: Project, ctx: MepContext, e: Fixture | Device, rep: MepReport): ItemInfo {
  const m = mountOf(e);
  const notes: string[] = [];
  const base = { id: e.id, name: e.props.name, mount: m, notes };
  const isFx = e.type === 'Fixture';
  const kind = e.props.kind;
  if (m === 'wall') {
    // outdoor wall items with no wall nearby stand on a post; indoor outlets with no legal wall become floor boxes
    if (e.props.hostId === 'post') return { ...base, hostName: 'a post (pole)', ok: true };
    if (e.props.hostId?.startsWith('floor:')) return { ...base, hostName: `a floor box in ${e.props.hostId.slice(6)}`, ok: true };
    if (!e.props.hostWallId) return { ...base, hostName: 'nothing', ok: false, problem: 'unhosted: not attached to a wall face' };
    const w = getEl(p, e.props.hostWallId);
    if (w?.type !== 'Wall') return { ...base, hostName: `wall ${e.props.hostWallId} (deleted)`, ok: false, problem: `unhosted: its wall ${e.props.hostWallId} is gone` };
    const s = wallSeg(w);
    const along = s.a + (e.props.offset ?? 0);
    const face = facesFor(p, e).find((f) => f.wall.id === w.id && f.face === e.props.face);
    if (!face) return { ...base, hostName: `${w.id}`, ok: false, problem: `unhosted: the face of ${w.id} it hangs on is not in its room` };
    if (along < s.a - 0.01 || along > s.b + 0.01) return { ...base, hostName: w.id, ok: false, problem: `unhosted: beyond the end of ${w.id}` };
    const perp = s.o === 'v' ? e.props.at[0] : e.props.at[1];
    const gap = Math.abs(perp - (s.c + (e.props.face ?? 1) * w.props.thickness / 2));
    const allowed = isFx ? (e.props.standoff ?? Math.max(0.05, kindOf(kind).size[1] / 2)) + 0.12 : 0.08;
    if (gap > allowed) return { ...base, hostName: w.id, ok: false, problem: `unhosted: ${gap.toFixed(2)} m away from the face of ${w.id}` };
    // equipment that may only hang in some rooms
    if (!isFx && ['inverter', 'battery', 'rack'].includes(kind)) {
      const room = roomOf(p, e);
      if (room && !EQUIPMENT_ROOMS.has(room.props.zone)) return { ...base, hostName: w.id, ok: false, problem: `${deviceType(kind).label} not allowed in ${room.props.name} (ventilated rooms only, not bedrooms)` };
    }
    return { ...base, hostName: `${w.props.wallType} wall ${w.id}, ${face.room ? `${face.room.props.name} side` : 'outside face'}, ${(along - s.a).toFixed(2)} m from its start`, ok: true };
  }
  if (m === 'ceiling') {
    if (!PLAN.includes(e.level)) return { ...base, hostName: e.props.hostId ?? 'carport roof', ok: !!e.props.hostId || e.level === 'site', problem: e.props.hostId || e.level === 'site' ? undefined : 'unhosted' };
    const h = ceilingHost(p, e.level, e.props.at);
    if (!h) return { ...base, hostName: 'nothing', ok: false, problem: 'unhosted: no slab or plenum above (a stair void?)' };
    const name = h.plenum ? (getEl(p, h.id) as ServiceSpace | undefined)?.props.name ?? h.id : `the slab above (${h.id})`;
    if (Math.abs(e.props.z - h.z) > 0.25) return { ...base, hostName: name, ok: false, problem: `hangs ${(h.z - e.props.z).toFixed(2)} m below its ceiling` };
    return { ...base, hostName: name, ok: true };
  }
  if (m === 'floor') {
    if (!PLAN.includes(e.level)) return { ...base, hostName: e.level === 'roof' ? 'the roof slab' : 'the ground', ok: true };
    const top = ctx.floorTop(e.level, e.props.at[0], e.props.at[1]);
    if (top === null) return { ...base, hostName: 'nothing', ok: false, problem: 'unhosted: no floor under it' };
    if (isFx && kind === 'lift-station') {
      const vent = p.elements.some((x) => x.type === 'PipeSegment' && x.props.network === 'vent-lift');
      const cl = clearanceBox(ctx, e, top);
      const blocked = cl ? blockedBy(p, ctx, e, cl, roomRects(p, e)) : null;
      rep.access.push({ id: e.id, ok: vent && !blocked, text: `${kindOf(kind).label}: sealed lid, ${vent ? 'vent to the roof' : 'NO VENT'}${blocked ? `; access blocked by ${blocked}` : ', lid clear'}` });
      return { ...base, hostName: 'the lower-level slab (sunk)', ok: true, clearance: cl ?? undefined };
    }
    return { ...base, hostName: 'the floor slab', ok: true };
  }
  if (m === 'shaft') {
    const s = ctx.volumes.find((v) => v.kind === 'shaft' && pointInRect(e.props.at[0], e.props.at[1], v.rect));
    return s ? { ...base, hostName: s.name, ok: true } : { ...base, hostName: 'nothing', ok: false, problem: 'unhosted: a soil stack must run in a shaft' };
  }
  if (m === 'equipment') return equipmentInfo(p, ctx, e, rep, base);
  // site
  if (isFx && kind === 'rain-cistern') {
    const z = ctx.zones;
    const path = z.find((g) => g.id === 'front');
    const onPath = path && polyHit(path.poly, footprint(e));
    const carport = p.elements.find((x) => x.type === 'Carport');
    const onBay = carport?.type === 'Carport' && carport.props.parking.some((b) => overlap(b, footprint(e)));
    const front = e.props.at[1] < (p.levels.find((l) => l.id === 'SL')?.outline?.y0 ?? 0);
    const ok = !onPath && !onBay && front;
    rep.access.push({ id: e.id, ok, text: `Cistern ${front ? 'in the front setback' : 'NOT in the front setback'}${onPath ? ', under the entry path' : ''}${onBay ? ', under a car bay (needs a vehicle-load design)' : ''}; lid reachable from the side passage` });
    return { ...base, hostName: 'the ground (front setback)', ok: true };
  }
  if (!isFx && (kind === 'ev-charger' || e.level === 'carport')) return { ...base, hostName: 'a carport post', ok: true };
  return { ...base, hostName: e.props.hostId === 'post' || !isFx ? 'a post or the boundary wall' : 'the ground', ok: true };
}

function equipmentInfo(p: Project, ctx: MepContext, e: Fixture | Device, rep: MepReport, base: { id: string; name: string; mount: string; notes: string[] }): ItemInfo {
  const kind = e.props.kind;
  const zone = p.elements.find((s): s is ServiceSpace => s.type === 'ServiceSpace' && s.props.kind === 'roof-zone' && pointInRect(e.props.at[0], e.props.at[1], s.props.rect)
    && (e.type === 'Fixture' ? Math.abs((s.props.z0 ?? 0) - e.props.z) < 0.6 : e.props.z - (s.props.z0 ?? 0) > -0.05 && e.props.z - (s.props.z0 ?? 0) < 1.6));
  const room = roomOf(p, e);
  const label = e.type === 'Fixture' ? kindOf(kind).label : deviceType(kind).label;
  if (room?.props.zone === 'circ') return { ...base, hostName: room.props.name, ok: false, problem: `${label} in a corridor (${room.props.name}): never in a corridor` };
  if (e.props.hostId?.startsWith('bracket:')) {
    // a facade bracket needs safe access: a window ≤ 1.0 m away, or a balcony
    const w = e.props.hostId.slice(8);
    const win = p.elements.some((o) => o.type === 'Opening' && o.props.host === w && o.props.role === 'window');
    const ok = win;
    rep.access.push({ id: e.id, ok, text: `${label} on a facade bracket${ok ? ', reached from a window' : ' with no window or balcony to service it'}` });
    return { ...base, hostName: `a steel bracket on ${w}`, ok, problem: ok ? undefined : 'facade bracket without safe maintenance access' };
  }
  if (!zone) {
    const onGround = e.props.hostId === 'ground';
    if (onGround) return { ...base, hostName: 'a ground pad', ok: true };
    return { ...base, hostName: 'nothing', ok: false, problem: `unsupported: ${label} has no roof zone, ground pad or bracket under it` };
  }
  const cl = clearanceBox(ctx, e, zone.props.z0 ?? 0);
  const blocked = cl ? blockedBy(p, ctx, e, cl, [zone.props.rect]) : null;
  const notes = base.notes;
  if (kind === 'roof-tank') {
    const beams = ctx.beams.filter((b) => Math.abs(b.zTop - ((zone.props.z0 ?? 0) - 0.14)) < 0.05 && (b.o === 'v' ? Math.abs(b.c - e.props.at[0]) < 0.6 : Math.abs(b.c - e.props.at[1]) < 0.6)).map((b) => b.id);
    notes.push(beams.length ? `over beam${beams.length > 1 ? 's' : ''} ${beams.join(', ')} (spec 08 checks the load)` : 'not over a beam: spec 08 must check the slab');
  }
  if (kind === 'ac-outdoor') {
    // condensate runs on the roof to a roof drain of the same roof (a hose to a plumbing point)
    const drain = p.elements.some((d) => d.type === 'Fixture' && d.props.kind === 'roof-drain' && Math.abs(d.props.z - (zone.props.z0 ?? 0)) < 0.2 && Math.hypot(d.props.at[0] - e.props.at[0], d.props.at[1] - e.props.at[1]) < 8);
    notes.push(drain ? 'condensate to the roof drain' : 'NO plumbing point for the condensate');
    if (!drain) rep.access.push({ id: e.id, ok: false, text: `${label}: no drain for the condensate on ${zone.props.name}` });
  }
  const access = zone.props.access;
  rep.access.push({ id: e.id, ok: !blocked && !!access, text: `${label} on ${zone.props.name}: ${blocked ? `service space blocked by ${blocked}` : 'service space clear'}; access ${access ?? 'NONE'}` });
  return { ...base, hostName: zone.props.name, ok: true, clearance: cl ?? undefined };
}

function clearanceBox(_ctx: MepContext, e: Fixture | Device, floorZ: number): Box3 | null {
  const c = CLEARANCE[e.props.kind];
  if (!c) return null;
  const [x, y] = e.props.at;
  return { x0: x - c[0] / 2, x1: x + c[0] / 2, y0: y - c[1] / 2, y1: y + c[1] / 2, z0: floorZ + 0.02, z1: floorZ + c[2] };
}

const roomRects = (p: Project, e: Fixture | Device): Rect[] => roomOf(p, e)?.props.cells ?? [];

/** What stands in an equipment's service space: other equipment, walls, columns, or the edge of its zone. */
function blockedBy(p: Project, ctx: MepContext, e: Element, b: Box3, inside: Rect[]): string | null {
  const corners: [number, number][] = [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]];
  if (inside.length && !corners.every(([x, y]) => inside.some((r) => pointInRect(x, y, { x0: r.x0 - 0.12, x1: r.x1 + 0.12, y0: r.y0 - 0.12, y1: r.y1 + 0.12 })))) return 'the edge of its zone or room';
  for (const o of p.elements) {
    if (o.id === e.id) continue;
    if (o.type === 'Fixture' && !o.tags.includes('auto')) {
      const m = mountOf(o);
      if (m !== 'equipment' && o.props.kind !== 'lift-station') continue;
      const [sx, sy, sz] = kindOf(o.props.kind).size;
      const zb = o.props.z + (kindOf(o.props.kind).zOffset ?? 0);
      if (boxOverlap(b, { x0: o.props.at[0] - sx / 2, x1: o.props.at[0] + sx / 2, y0: o.props.at[1] - sy / 2, y1: o.props.at[1] + sy / 2, z0: zb, z1: zb + sz })) return o.props.name;
    }
    // an equipment's own power point is part of it, not an obstacle
    if (o.type === 'Device' && mountOf(o) === 'equipment' && !['pump-pressure', 'heat-pump'].includes(o.props.kind)) {
      const [sx, sy, sz] = deviceType(o.props.kind).size;
      if (boxOverlap(b, { x0: o.props.at[0] - sx / 2, x1: o.props.at[0] + sx / 2, y0: o.props.at[1] - sy / 2, y1: o.props.at[1] + sy / 2, z0: o.props.z - sz / 2, z1: o.props.z + sz / 2 })) return o.props.name;
    }
    if (o.type === 'ServiceSpace' && o.props.kind === 'shaft') {
      if (boxOverlap(b, { ...o.props.rect, z0: o.props.z0 ?? -5, z1: (o.props.z1 ?? 9) })) return o.props.name;
    }
  }
  for (const f of ctx.forbidden) if (f.kind === 'column' && boxOverlap(b, f.box)) return f.name;
  return null;
}

const boxOverlap = (a: Box3, b: Box3) => a.x0 < b.x1 - 1e-6 && a.x1 > b.x0 + 1e-6 && a.y0 < b.y1 - 1e-6 && a.y1 > b.y0 + 1e-6 && a.z0 < b.z1 - 1e-6 && a.z1 > b.z0 + 1e-6;
const footprint = (f: Fixture): Rect => { const [sx, sy] = kindOf(f.props.kind).size; return { x0: f.props.at[0] - sx / 2, x1: f.props.at[0] + sx / 2, y0: f.props.at[1] - sy / 2, y1: f.props.at[1] + sy / 2 }; };
const overlap = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
function polyHit(poly: [number, number][], r: Rect): boolean {
  const xs = poly.map((c) => c[0]), ys = poly.map((c) => c[1]);
  return overlap({ x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }, r);
}

/** A one-line "Why here?" for a pipe, conduit or item. */
export function whyHere(p: Project, id: string): string | null {
  const rep = mepReport(p);
  const s = rep.segs.get(id);
  if (s) {
    const where = s.host === 'exposed' ? 'Not inside any service space' : `In ${s.hostName}`;
    const how = s.kind === 'conduit' ? 'shortest legal path from its panel' : s.carry === 'sewage' || s.carry === 'rain' ? 'gravity, falling at least the NBR 8160 / 10844 slope' : 'shortest legal path from its riser';
    const rule = s.host === 'wall' ? 'walls take vertical drops and ≤ 1 m horizontal runs' : s.host === 'plenum' ? 'hangs above the lowered ceiling, under the steel deck' : s.host === 'screed' ? 'conduits ≤ 25 mm in the 50 mm floor screed' : s.host === 'crawlspace' ? 'on hangers under the street floor, ≥ 0.15 m above the ground' : s.host === 'underground' ? 'buried ≥ 0.40 m (0.60 m under the car bays)' : s.host === 'shaft' ? 'vertical in a shaft with an access panel' : s.host === 'sleeve' ? 'crosses the slab vertically through a sleeve' : s.host === 'facade' ? 'downpipe fixed to the facade' : '';
    const extra = s.issues.length ? ` — ${s.issues[0]}` : s.holes.length ? ` — web hole through ${s.holes.map((h) => h.beam).join(', ')} (engineer to confirm)` : '';
    return `${where} · ${how} · ${rule}${extra}`;
  }
  const it = rep.items.get(id);
  if (it) {
    const rule = it.mount === 'wall' ? 'wall items: own room side, ≥ 0.15 m from corners, clear of doors, windows and door swings' : it.mount === 'ceiling' ? 'hangs from the plenum or slab above' : it.mount === 'floor' ? 'stands on the floor slab' : it.mount === 'equipment' ? 'equipment: supported base with a maintenance clearance' : it.mount === 'shaft' ? 'runs in a shaft' : 'outdoors on the ground or a post';
    return `${it.ok ? 'Hosted by' : 'PROBLEM'} ${it.ok ? it.hostName : it.problem} · ${rule}${it.notes.length ? ` · ${it.notes.join('; ')}` : ''}`;
  }
  return null;
}
