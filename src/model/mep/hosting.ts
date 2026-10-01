// Spec 04b: every fixture and device is hosted by the building. Wall items sit on a wall face of their own room
// (or the outside face of an outer wall), clear of openings, door swings and corners; ceiling items hang from the
// plenum or slab above; floor items stand on the slab; equipment stands in a zone with room for maintenance.
import { eq, getEl, openingSeg, q, wallSeg, type Seg } from '../geometry';
import type { Device, Fixture, Opening, Project, ServiceSpace, Space, Wall } from '../schema';
import { deviceType } from '../electrical/library';
import { kindOf } from '../plumbing/library';
import { CORNER_GAP, SHOWER_ZONE, deviceMount, fixtureMount, type Mount } from './library';
import { mepContext } from './spaces';

type P2 = [number, number];
type Item = Fixture | Device;

const PLAN = ['LL', 'SL', 'UF'];
const strictly = (x: number, y: number, c: { x0: number; y0: number; x1: number; y1: number }, m = 1e-6) => x > c.x0 + m && x < c.x1 - m && y > c.y0 + m && y < c.y1 - m;
export const mountOf = (e: Item): Mount => (e.type === 'Fixture' ? fixtureMount(e.props.kind) : deviceMount(e.props.kind));
const elevOf = (p: Project, l: string) => p.levels.find((x) => x.id === l)?.elevation ?? 0;

/** The room an item is in (plan levels only). */
export function roomOf(p: Project, e: Item): Space | undefined {
  if (!PLAN.includes(e.level)) return undefined;
  const [x, y] = e.props.at;
  const rooms = p.elements.filter((s): s is Space => s.type === 'Space' && s.level === e.level);
  // strictly inside first; an item standing on a wall face is a few centimetres off its room's cells
  return rooms.find((s) => s.props.cells.some((c) => strictly(x, y, c))) ?? rooms.find((s) => s.props.cells.some((c) => strictly(x, y, c, -0.07)));
}

/** Which plan level's walls an item can hang on. */
const wallLevels = (e: Item) => (PLAN.includes(e.level) ? [e.level] : e.level === 'site' || e.level === 'carport' ? ['SL', 'LL'] : []);

export interface Face { wall: Wall; seg: Seg; face: 1 | -1; room?: Space }

/** Wall faces an item may use: faces of its own room, or outside faces of outer walls for outdoor items. */
export function facesFor(p: Project, e: Item, room = roomOf(p, e)): Face[] {
  const out: Face[] = [];
  for (const L of wallLevels(e)) {
    const rooms = p.elements.filter((s): s is Space => s.type === 'Space' && s.level === L);
    for (const w of p.elements) {
      if (w.type !== 'Wall' || w.level !== L) continue;
      const s = wallSeg(w);
      for (const face of [1, -1] as const) {
        const d = w.props.thickness / 2 + 0.03;
        const mid = (s.a + s.b) / 2;
        // the side of the face, probed along the whole wall
        const probe = (t: number): P2 => (s.o === 'v' ? [s.c + face * d, t] : [t, s.c + face * d]);
        if (room) {
          if (room.level !== L) continue;
          // indoor items never go on a retaining wall: its core below the retained ground takes no conduit or pipe
          if (w.props.wallType === 'retaining') continue;
          const touches = room.props.cells.some((c) => {
            const [px, py] = probe(Math.min(Math.max(mid, s.o === 'v' ? c.y0 + 0.05 : c.x0 + 0.05), s.o === 'v' ? c.y1 - 0.05 : c.x1 - 0.05));
            const along = s.o === 'v' ? [c.y0, c.y1] : [c.x0, c.x1];
            return strictly(px, py, c) && along[1]! > s.a + 0.05 && along[0]! < s.b - 0.05;
          });
          if (touches) out.push({ wall: w, seg: s, face, room });
        } else {
          if (w.props.wallType !== 'exterior' && w.props.wallType !== 'retaining') continue;
          const [px, py] = probe(mid);
          if (!rooms.some((r) => r.props.cells.some((c) => strictly(px, py, c)))) out.push({ wall: w, seg: s, face });
        }
      }
    }
  }
  return out;
}

/** The part of a face that touches the room (or the whole wall outside). */
function faceSpan(f: Face): [number, number] {
  if (!f.room) return [f.seg.a, f.seg.b];
  const d = f.wall.props.thickness / 2 + 0.03;
  let lo = Infinity, hi = -Infinity;
  for (const c of f.room.props.cells) {
    const perp = f.seg.c + f.face * d;
    const inPerp = f.seg.o === 'v' ? perp > c.x0 && perp < c.x1 : perp > c.y0 && perp < c.y1;
    if (!inPerp) continue;
    const a = Math.max(f.seg.a, f.seg.o === 'v' ? c.y0 : c.x0), b = Math.min(f.seg.b, f.seg.o === 'v' ? c.y1 : c.x1);
    if (b > a) { lo = Math.min(lo, a); hi = Math.max(hi, b); }
  }
  return lo <= hi ? [lo, hi] : [f.seg.a, f.seg.b];
}

/** Is a door leaf sweeping this point (plan, below the door head)? */
export function inDoorSwing(p: Project, level: string, x: number, y: number): Opening | undefined {
  for (const op of p.elements) {
    if (op.type !== 'Opening' || op.level !== level || op.props.role !== 'door' || op.props.kind === 'garage' || op.props.kind === 'slider') continue;
    const host = getEl(p, op.props.host);
    if (host?.type !== 'Wall') continue;
    const s = openingSeg(op, host);
    const side = op.props.swing;
    // hinge at the near edge; the leaf sweeps a quarter circle of radius = width on the swing side
    const hx = s.o === 'v' ? s.c : s.a, hy = s.o === 'v' ? s.a : s.c;
    const perp = s.o === 'v' ? (x - s.c) * side : (y - s.c) * side;
    if (perp < 0.02) continue;
    if (Math.hypot(x - hx, y - hy) < op.props.width + 0.05) return op;
  }
  return undefined;
}

export interface Placement { hostWallId: string; face: 1 | -1; offset: number; at: P2; cavity: P2; o: 'v' | 'h' }

/**
 * Snap an item to the nearest allowed point on a wall face: on its own room's side, ≥ 0.15 m from corners,
 * out of doors (+0.10 m frame), windows at its height and door swings; bathroom outlets out of shower zones 1–2;
 * electrical points 0.25 m from water drops on the same wall.
 */
export function placeOnWall(p: Project, e: Item, want: P2 = e.props.at, only?: Face): Placement | null {
  // a bathroom outlet stays out of volume 2 (0.60 m beyond the shower); in a bathroom too small for that, the shower
  // has a fixed glass screen that bounds volume 2, and the outlet keeps 0.30 m from the screen (to confirm, Q16)
  return placeOnWallZ(p, e, want, only, SHOWER_ZONE) ?? (e.type === 'Device' && deviceType(e.props.kind).group === 'outlet' ? placeOnWallZ(p, e, want, only, 0.3) : null);
}

function placeOnWallZ(p: Project, e: Item, want: P2, only: Face | undefined, showerZone: number): Placement | null {
  const room = roomOf(p, e);
  const faces = only ? [only] : facesFor(p, e, room);
  const z = e.type === 'Device' ? e.props.z : e.props.z + (kindOf(e.props.kind).supplyZ ?? 0.6);
  const floor = elevOf(p, PLAN.includes(e.level) ? e.level : 'SL');
  const elec = e.type === 'Device';
  const showers = room ? p.elements.filter((f): f is Fixture => f.type === 'Fixture' && f.props.kind === 'shower' && f.level === room.level && room.props.cells.some((c) => strictly(f.props.at[0], f.props.at[1], c))) : [];
  const standoff = e.type === 'Fixture' ? (e.props.standoff ?? Math.max(0.05, kindOf(e.props.kind).size[1] / 2)) : 0.01;
  const halfWidth = e.type === 'Fixture' ? kindOf(e.props.kind).size[0] / 2 : (deviceType(e.props.kind).size[1] ?? 0.08) / 2;
  let best: Placement | null = null, bd = Infinity;
  for (const f of faces) {
    const s = f.seg, t = f.wall.props.thickness;
    const [lo0, hi0] = faceSpan(f);
    const lo = lo0 + CORNER_GAP + halfWidth, hi = hi0 - CORNER_GAP - halfWidth;
    if (hi < lo - 1e-6) continue;
    const openings = p.elements.filter((o): o is Opening => o.type === 'Opening' && o.props.host === f.wall.id);
    const wallFixtures = elec ? p.elements.filter((x): x is Fixture => x.type === 'Fixture' && x.props.hostWallId === f.wall.id && !!(kindOf(x.props.kind).weight)) : [];
    const shafts = p.elements.flatMap((x) => (x.type === 'ServiceSpace' && x.props.kind === 'shaft' && !/electric/i.test(x.props.name) ? [x.props.rect] : []));
    const neighbours = p.elements.filter((x): x is Device | Fixture => (x.type === 'Device' || x.type === 'Fixture') && x.id !== e.id && x.props.hostWallId === f.wall.id && x.props.face === f.face);
    // columns standing in this wall (not the piers under the floor)
    const wallBase = elevOf(p, f.wall.level);
    const cols = p.elements.filter((c) => c.type === 'Column' && c.props.topElevation > wallBase + 0.1 && (s.o === 'v' ? Math.abs(c.props.at[0] - s.c) < 0.2 : Math.abs(c.props.at[1] - s.c) < 0.2)).map((c) => (c.type === 'Column' ? (s.o === 'v' ? c.props.at[1] : c.props.at[0]) : 0));
    const ok = (tt: number) => {
      for (const op of openings) {
        const os = openingSeg(op, f.wall);
        const door = op.props.role === 'door';
        // a door's frame reaches 0.10 m above its head; anything higher (a light over the door) is clear of it
        const z0 = floor + (door ? 0 : op.props.sill) - 0.05, z1 = floor + op.props.sill + op.props.height + (door ? 0.15 : 0.05);
        if (z < z0 || z > z1) continue;
        const m = (door ? 0.1 : 0.05) + halfWidth;
        if (tt > os.a - m && tt < os.b + m) return false;
      }
      const pt: P2 = s.o === 'v' ? [s.c + f.face * (t / 2 + 0.05), tt] : [tt, s.c + f.face * (t / 2 + 0.05)];
      if (z - floor < 2.1 && PLAN.includes(f.wall.level) && inDoorSwing(p, f.wall.level, pt[0], pt[1])) return false;
      if (elec && room?.props.zone === 'wet' && deviceType(e.props.kind).group === 'outlet') {
        for (const sh of showers) {
          const [sx, sy] = kindOf('shower').size;
          const dx = Math.max(0, Math.abs(pt[0] - sh.props.at[0]) - sx / 2), dy = Math.max(0, Math.abs(pt[1] - sh.props.at[1]) - sy / 2);
          if (Math.hypot(dx, dy) < showerZone) return false;
        }
      }
      // electrical points 0.35 m from the water drops beside each fixture, and from shafts with hot risers
      for (const fx of wallFixtures) if (Math.abs((fx.props.offset ?? 0) + s.a - tt) < 0.35) return false;
      if (elec) {
        const cav: P2 = s.o === 'v' ? [s.c, tt] : [tt, s.c];
        for (const sh of shafts) {
          const dx = Math.max(0, sh.x0 - cav[0], cav[0] - sh.x1), dy = Math.max(0, sh.y0 - cav[1], cav[1] - sh.y1);
          if (Math.hypot(dx, dy) < 0.35) return false;
        }
      }
      // not on top of another item on the same face (a double outlet is one item), and clear of columns in the wall
      for (const nb of neighbours) {
        const nz = nb.type === 'Device' ? nb.props.z : nb.props.z + (kindOf(nb.props.kind).supplyZ ?? 0.6);
        // two switches side by side share one plate
        if (e.props.kind === 'switch' && nb.type === 'Device' && nb.props.kind === 'switch') continue;
        // fixtures need their own width along the wall; small points 0.15 m
        const nw = nb.type === 'Fixture' ? kindOf(nb.props.kind).size[0] / 2 : 0;
        const gapNeeded = e.type === 'Fixture' || nb.type === 'Fixture' ? halfWidth + nw + 0.05 : 0.15;
        if (Math.abs((nb.props.offset ?? 0) + s.a - tt) < gapNeeded && (e.type === 'Fixture' && nb.type === 'Fixture' ? true : Math.abs(nz - z) < 0.4)) return false;
      }
      for (const c of cols) if (Math.abs(c - tt) < 0.25 + halfWidth) return false;
      return true;
    };
    const target = s.o === 'v' ? want[1] : want[0];
    const perpD = Math.abs((s.o === 'v' ? want[0] : want[1]) - (s.c + f.face * (t / 2)));
    let found: number | null = null;
    for (let k = 0; k <= Math.ceil((hi - lo) / 0.05) + 1 && found === null; k++) {
      for (const sg of k === 0 ? [0] : [k, -k]) {
        const tt = Math.round((target + sg * 0.05) / 0.005) * 0.005;
        if (tt < lo - 1e-6 || tt > hi + 1e-6) continue;
        if (ok(tt)) { found = tt; break; }
      }
      if (found === null && k > 0 && target + k * 0.05 > hi && target - k * 0.05 < lo) break;
    }
    if (found === null) continue;
    const d = Math.hypot(perpD, found - target);
    // an outdoor item more than 0.6 m from a usable wall stays where it is, on a post
    if (!room && d > 0.6) continue;
    if (d < bd - 1e-9) {
      bd = d;
      const off = t / 2 + standoff;
      const at: P2 = s.o === 'v' ? [s.c + f.face * off, found] : [found, s.c + f.face * off];
      best = { hostWallId: f.wall.id, face: f.face, offset: q(found - s.a), at: [q(at[0]), q(at[1])], cavity: s.o === 'v' ? [s.c, found] : [found, s.c], o: s.o };
    }
  }
  return best;
}

/** The point inside a wall's cavity behind a hosted item (where its pipes or conduits drop). */
export function cavityPoint(p: Project, e: Item): { cavity: P2; room: P2; o: 'v' | 'h'; wall: Wall } | null {
  if (!e.props.hostWallId) return null;
  const w = getEl(p, e.props.hostWallId);
  if (w?.type !== 'Wall') return null;
  const s = wallSeg(w), t = s.a + (e.props.offset ?? 0), f = e.props.face ?? 1;
  const roomSide = w.props.thickness / 2 + 0.06;
  return {
    cavity: s.o === 'v' ? [s.c, t] : [t, s.c],
    room: s.o === 'v' ? [s.c + f * roomSide, t] : [t, s.c + f * roomSide],
    o: s.o, wall: w,
  };
}

/** Ceiling items: the plenum or slab above, and the height of the ceiling there. */
export function ceilingHost(p: Project, level: string, at: P2): { id: string; z: number; plenum: boolean } | null {
  const ctx = mepContext(p);
  const pl = p.elements.find((e): e is ServiceSpace => e.type === 'ServiceSpace' && e.props.kind === 'plenum' && e.level === level && strictly(at[0], at[1], e.props.rect, -1e-6));
  const so = ctx.soffit(level, at[0], at[1]);
  if (so === null) return null;
  if (pl) return { id: pl.id, z: so - (pl.props.depth ?? 0.25), plenum: true };
  const up = ctx.levelAbove(level)!;
  const slab = p.elements.find((e) => e.type === 'Slab' && e.level === up && !e.props.onGrade);
  return { id: slab?.id ?? up, z: so, plenum: false };
}

/** Is a plan point under a beam of the slab above a level? */
function underBeam(p: Project, level: string, x: number, y: number, m = 0.08): boolean {
  const ctx = mepContext(p);
  const so = ctx.soffit(level, x, y);
  if (so === null) return false;
  return ctx.beams.some((b) => Math.abs(b.zTop - so) < 0.05 && (b.o === 'v' ? Math.abs(x - b.c) < b.width / 2 + m && y > b.a && y < b.b : Math.abs(y - b.c) < b.width / 2 + m && x > b.a && x < b.b));
}

/**
 * Give every fixture and device its host (first placement), or re-snap it to the host it already has
 * (after a wall or room edit). Items whose host wall is gone keep their place and are flagged by the checks.
 */
export function withHosts(p: Project, opts: { fresh?: boolean } = {}): Project {
  // one at a time, so each item sees where the others already are
  let cur = p;
  const elements = [...p.elements];
  for (let i = 0; i < elements.length; i++) {
    const e = elements[i]!;
    if ((e.type !== 'Fixture' && e.type !== 'Device') || e.tags.includes('auto')) continue;
    const next = hostOne(cur, e, opts.fresh ?? false);
    if (next !== e) { elements[i] = next; cur = { ...cur, elements: [...elements] }; }
  }
  return cur;
}

export function hostOne<T extends Item>(p: Project, e: T, fresh: boolean): T {
  const m = mountOf(e);
  if (m === 'wall') {
    if (e.props.hostWallId && !fresh) {
      const w = getEl(p, e.props.hostWallId);
      if (w?.type !== 'Wall') return e; // unhosted: the checks list it
      const s = wallSeg(w);
      const want: P2 = s.o === 'v' ? [s.c, s.a + (e.props.offset ?? 0)] : [s.a + (e.props.offset ?? 0), s.c];
      // the room is the one on the item's side of its wall, wherever the wall now is
      const d = w.props.thickness / 2 + 0.05, f0 = e.props.face ?? 1;
      const probe: P2 = s.o === 'v' ? [s.c + f0 * d, want[1]] : [want[0], s.c + f0 * d];
      const side = p.elements.find((r): r is Space => r.type === 'Space' && r.level === w.level && r.props.cells.some((c) => strictly(probe[0], probe[1], c)));
      const face = facesFor(p, e, side).find((f) => f.wall.id === w.id && f.face === e.props.face);
      const pl = (face && placeOnWall(p, e, want, face)) ?? placeOnWall(p, e, e.props.at);
      return pl ? apply(p, e, pl) : e;
    }
    const pl = placeOnWall(p, e, e.props.at);
    if (pl) return apply(p, e, pl);
    // a switch with no wall in its own room (an open dining area) goes on the nearest wall of a neighbouring room
    if (e.type === 'Device' && e.props.kind === 'switch' && PLAN.includes(e.level)) {
      const own = roomOf(p, e);
      const others = p.elements.filter((s): s is Space => s.type === 'Space' && s.level === e.level && s.id !== own?.id && s.props.zone !== 'stair')
        .map((s) => ({ s, d: Math.min(...s.props.cells.map((c) => Math.hypot(Math.max(c.x0 - e.props.at[0], 0, e.props.at[0] - c.x1), Math.max(c.y0 - e.props.at[1], 0, e.props.at[1] - c.y1)))) }))
        .sort((a, b) => a.d - b.d);
      for (const { s, d } of others) {
        if (d > 1.5) break;
        const faces = facesFor(p, e, s);
        for (const f of faces) { const pl2 = placeOnWall(p, e, e.props.at, f); if (pl2) return apply(p, e, pl2); }
      }
    }
    // outdoors with no wall to hang on: it stands on a post (camera pole, garden light post)
    const room = roomOf(p, e);
    if (!room && e.type === 'Device') return e.props.hostId === 'post' ? e : { ...e, props: { ...e.props, hostId: 'post' } };
    // an outlet with no legal wall (glass and columns all round) becomes a floor box, except in wet rooms
    if (room && e.type === 'Device' && ['outlet', 'low-voltage'].includes(deviceType(e.props.kind).group) && room.props.zone !== 'wet' && /outlet/.test(e.props.kind)) {
      const slab = p.elements.find((s) => s.type === 'Slab' && s.level === e.level && !s.props.onGrade);
      const floor = elevOf(p, e.level);
      // 0.35 m into the room, clear of the glazing and the wall's footprint
      const cell = room.props.cells.find((c) => e.props.at[0] >= c.x0 - 0.1 && e.props.at[0] <= c.x1 + 0.1 && e.props.at[1] >= c.y0 - 0.1 && e.props.at[1] <= c.y1 + 0.1) ?? room.props.cells[0]!;
      const at: P2 = [q(Math.min(Math.max(e.props.at[0], cell.x0 + 0.35), cell.x1 - 0.35)), q(Math.min(Math.max(e.props.at[1], cell.y0 + 0.35), cell.y1 - 0.35))];
      void slab;
      return { ...e, props: { ...e.props, at, hostWallId: undefined, face: undefined, offset: undefined, hostId: `floor:${room.props.name}`, z: q(floor + 0.02), height: 0.02 } };
    }
    return e;
  }
  if (m === 'ceiling' && PLAN.includes(e.level)) {
    let at = e.props.at;
    if (underBeam(p, e.level, at[0], at[1])) {
      for (const d of [0.15, 0.25, 0.35, 0.5]) {
        const c = ([[at[0] + d, at[1]], [at[0] - d, at[1]], [at[0], at[1] + d], [at[0], at[1] - d]] as P2[]).find(([x, y]) => !underBeam(p, e.level, x, y) && !!ceilingHost(p, e.level, [x, y]));
        if (c) { at = [q(c[0]), q(c[1])]; break; }
      }
    }
    const h = ceilingHost(p, e.level, at);
    if (!h) return { ...e, props: { ...e.props, hostId: undefined } };
    const z = q(h.z - (e.type === 'Device' ? deviceType(e.props.kind).size[2] / 2 : 0));
    if (e.props.hostId === h.id && eq(e.props.z, z) && at === e.props.at) return e;
    return { ...e, props: { ...e.props, at, hostId: h.id, z } };
  }
  if (m === 'site' && e.type === 'Device' && e.props.hostId !== 'post' && e.props.kind !== 'ev-charger') return { ...e, props: { ...e.props, hostId: 'post' } };
  if (m === 'floor' && PLAN.includes(e.level)) {
    const top = mepContext(p).floorTop(e.level, e.props.at[0], e.props.at[1]);
    const slab = p.elements.find((s) => s.type === 'Slab' && s.level === e.level && top !== null && eq(s.props.topElevation, top));
    const id = slab?.id;
    if (e.props.hostId === id) return e;
    return { ...e, props: { ...e.props, hostId: id } };
  }
  return e;
}

function apply<T extends Item>(p: Project, e: T, pl: Placement): T {
  const floor = elevOf(p, PLAN.includes(e.level) ? e.level : 'SL');
  const height = e.type === 'Device' ? q(e.props.z - floor) : undefined;
  if (e.props.hostWallId === pl.hostWallId && e.props.face === pl.face && eq(e.props.offset ?? NaN, pl.offset) && eq(e.props.at[0], pl.at[0]) && eq(e.props.at[1], pl.at[1])) return e;
  return { ...e, props: { ...e.props, hostWallId: pl.hostWallId, face: pl.face, offset: pl.offset, at: pl.at, ...(height !== undefined ? { height } : {}) } };
}
