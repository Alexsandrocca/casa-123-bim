// Pure geometry on the model. Nothing here keeps state.
import type { Element, Opening, Project, Rect, Space, Wall, WallType, Zone } from './schema';

export const E = 1e-6;
/** Internal resolution: 5 mm. */
export const q = (v: number) => Math.round(Math.round(v / 0.005) * 0.005 * 1000) / 1000;
/** Editing snap: 5 cm. */
export const snap = (v: number) => q(Math.round(v / 0.05) * 0.05);
export const eq = (a: number, b: number) => Math.abs(a - b) < 1e-4;

export const MIN_ROOM_WIDTH = 0.8;
export const DOOR_MARGIN = 0.05;
export const WINDOW_MARGIN = 0.1;

export const WALL_THICKNESS: Record<WallType, number> = { exterior: 0.2, interior: 0.12, wet: 0.15, retaining: 0.25 };

/** Same rule as OPEN() in the prototype: which zone pairs have no wall between them. */
export function isOpen(a: Zone, b: Zone): boolean {
  if (a === b && (a === 'social' || a === 'circ')) return true;
  const s = new Set([a, b]);
  if (s.has('stair') && (s.has('circ') || s.has('social'))) return true;
  if (s.has('social') && s.has('circ')) return true;
  return false;
}

export type Orient = 'v' | 'h';
/** A segment on an axis line: o='v' is the line x=c from y=a to y=b; o='h' is y=c from x=a to x=b. */
export interface Seg { o: Orient; c: number; a: number; b: number }

export const byLevel = <T extends Element['type']>(p: Project, level: string, type: T) =>
  p.elements.filter((e): e is Extract<Element, { type: T }> => e.type === type && e.level === level);

export const spacesOn = (p: Project, level: string) => byLevel(p, level, 'Space');
export const wallsOn = (p: Project, level: string) => byLevel(p, level, 'Wall');
export const openingsOn = (p: Project, level: string) => byLevel(p, level, 'Opening');
export const getEl = (p: Project, id: string) => p.elements.find((e) => e.id === id);
export const levelOf = (p: Project, id: string) => p.levels.find((l) => l.id === id);

export function wallSeg(w: Wall): Seg {
  const [sx, sy] = w.props.start;
  const [ex, ey] = w.props.end;
  if (eq(sx, ex)) return { o: 'v', c: sx, a: Math.min(sy, ey), b: Math.max(sy, ey) };
  return { o: 'h', c: sy, a: Math.min(sx, ex), b: Math.max(sx, ex) };
}

export function segToWallEnds(s: Seg): { start: [number, number]; end: [number, number] } {
  return s.o === 'v'
    ? { start: [q(s.c), q(s.a)], end: [q(s.c), q(s.b)] }
    : { start: [q(s.a), q(s.c)], end: [q(s.b), q(s.c)] };
}

export const wallLength = (w: Wall) => { const s = wallSeg(w); return s.b - s.a; };

/** Where an opening sits, as a segment on its host's line. */
export function openingSeg(op: Opening, host: Wall): Seg {
  const s = wallSeg(host);
  const a = q(s.a + op.props.offset);
  return { o: s.o, c: s.c, a, b: q(a + op.props.width) };
}

export function openingSegIn(p: Project, op: Opening): Seg | null {
  const host = getEl(p, op.props.host);
  return host && host.type === 'Wall' ? openingSeg(op, host) : null;
}

export const cellArea = (c: Rect) => (c.x1 - c.x0) * (c.y1 - c.y0);
export const spaceArea = (s: Space) => s.props.cells.reduce((sum, c) => sum + cellArea(c), 0);
/** The cell that carries the room label: the biggest, favouring roomy cells over narrow strips. */
const labelScore = (c: Rect) => cellArea(c) * Math.min(c.x1 - c.x0, c.y1 - c.y0);
export const mainCell = (s: Space) =>
  s.props.cells.reduce((a, b) => (labelScore(a) >= labelScore(b) ? a : b));

/** Edges shared by two cells (overlap longer than 2 cm). */
export function sharedEdges(a: Rect, b: Rect): Seg[] {
  const r: Seg[] = [];
  if (eq(a.x1, b.x0) || eq(a.x0, b.x1)) {
    const x = eq(a.x1, b.x0) ? a.x1 : a.x0;
    const s0 = Math.max(a.y0, b.y0), s1 = Math.min(a.y1, b.y1);
    if (s1 - s0 > 0.02) r.push({ o: 'v', c: x, a: s0, b: s1 });
  }
  if (eq(a.y1, b.y0) || eq(a.y0, b.y1)) {
    const y = eq(a.y1, b.y0) ? a.y1 : a.y0;
    const s0 = Math.max(a.x0, b.x0), s1 = Math.min(a.x1, b.x1);
    if (s1 - s0 > 0.02) r.push({ o: 'h', c: y, a: s0, b: s1 });
  }
  return r;
}

export interface TypedSeg extends Seg { wallType: WallType }

/** Interior walls from the cells: between two different rooms whose zones are not open to each other. */
export function deriveInteriorSegs(spaces: Space[]): TypedSeg[] {
  const cells = spaces.flatMap((s) => s.props.cells.map((c) => ({ c, s })));
  const raw: TypedSeg[] = [];
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const A = cells[i]!, B = cells[j]!;
      if (A.s.id === B.s.id || isOpen(A.s.props.zone, B.s.props.zone)) continue;
      const wet = A.s.props.zone === 'wet' || B.s.props.zone === 'wet';
      for (const seg of sharedEdges(A.c, B.c)) raw.push({ ...seg, wallType: wet ? 'wet' : 'interior' });
    }
  }
  return mergeSegs(raw);
}

/** Merge collinear, touching segments of the same type into one run. */
export function mergeSegs(segs: TypedSeg[]): TypedSeg[] {
  const sorted = segs
    .map((s) => ({ ...s, c: q(s.c), a: q(s.a), b: q(s.b) }))
    .sort((x, y) => (x.o === y.o ? (x.c === y.c ? (x.wallType === y.wallType ? x.a - y.a : x.wallType < y.wallType ? -1 : 1) : x.c - y.c) : x.o < y.o ? -1 : 1));
  const out: TypedSeg[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && last.o === s.o && eq(last.c, s.c) && last.wallType === s.wallType && s.a <= last.b + 1e-4) {
      last.b = Math.max(last.b, s.b);
    } else out.push({ ...s });
  }
  return out;
}

/* ---------- drag handles: connected runs of cell edges on one line (as in the prototype) ---------- */

export interface Handle extends Seg { locked: boolean; spaceIds: string[] }

function onOutline(outline: Rect, o: Orient, c: number) {
  return o === 'v' ? eq(c, outline.x0) || eq(c, outline.x1) : eq(c, outline.y0) || eq(c, outline.y1);
}

function components(iv: [number, number][]): [number, number][] {
  const s = iv.slice().sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1e-4) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

function cellEdgeAt(c: Rect, o: Orient, v: number) {
  return o === 'v' ? eq(c.x0, v) || eq(c.x1, v) : eq(c.y0, v) || eq(c.y1, v);
}

export function lineHandles(p: Project, level: string): Handle[] {
  const lv = levelOf(p, level);
  if (!lv?.outline) return [];
  const spaces = spacesOn(p, level);
  const cells = spaces.flatMap((s) => s.props.cells.map((c) => ({ c, s })));
  const seen = new Set<string>();
  const out: Handle[] = [];
  for (const { c } of cells) {
    for (const [o, v] of [['v', c.x0], ['v', c.x1], ['h', c.y0], ['h', c.y1]] as [Orient, number][]) {
      const k = `${o}:${v.toFixed(3)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (onOutline(lv.outline, o, v)) continue;
      const iv = cells.filter((x) => cellEdgeAt(x.c, o, v)).map((x) => (o === 'v' ? [x.c.y0, x.c.y1] : [x.c.x0, x.c.x1]) as [number, number]);
      for (const [a, b] of components(iv)) {
        if (touchesOutside(cells.map((x) => x.c), o, v, a, b)) continue; // an outer wall: fixed
        const inside = cells.filter((x) => cellEdgeAt(x.c, o, v) && (o === 'v' ? x.c.y0 >= a - E && x.c.y1 <= b + E : x.c.x0 >= a - E && x.c.x1 <= b + E));
        out.push({ o, c: v, a, b, locked: inside.some((x) => x.s.props.lock), spaceIds: [...new Set(inside.map((x) => x.s.id))] });
      }
    }
  }
  return out;
}

/** Does any part of this run have rooms on one side only (the building's outer edge)? */
function touchesOutside(cells: Rect[], o: Orient, v: number, a: number, b: number): boolean {
  const cuts = [a, b, ...cells.flatMap((c) => (o === 'v' ? [c.y0, c.y1] : [c.x0, c.x1])).filter((t) => t > a && t < b)].sort((u, w) => u - w);
  for (let i = 0; i + 1 < cuts.length; i++) {
    const t = (cuts[i]! + cuts[i + 1]!) / 2;
    const side = (d: number) => cells.some((c) => (o === 'v' ? pointInRect(v + d, t, c) : pointInRect(t, v + d, c)));
    if (!side(0.01) || !side(-0.01)) return true;
  }
  return false;
}

export function findHandle(p: Project, level: string, o: Orient, c: number, at: number): Handle | undefined {
  return lineHandles(p, level).find((h) => h.o === o && eq(h.c, c) && at >= h.a - E && at <= h.b + E);
}

/** Glass area of a room: windows on any of its cell edges, width times height (same as the prototype). */
export function glassArea(p: Project, space: Space): number {
  let g = 0;
  for (const op of openingsOn(p, space.level)) {
    if (op.props.role !== 'window') continue;
    const s = openingSegIn(p, op);
    if (!s) continue;
    for (const c of space.props.cells) {
      if (!cellEdgeAt(c, s.o, s.c)) continue;
      const ov = s.o === 'v' ? Math.min(s.b, c.y1) - Math.max(s.a, c.y0) : Math.min(s.b, c.x1) - Math.max(s.a, c.x0);
      if (ov > 0) g += ov * op.props.height;
    }
  }
  return g;
}

export const pointInRect = (x: number, y: number, r: Rect) => x >= r.x0 - E && x <= r.x1 + E && y >= r.y0 - E && y <= r.y1 + E;

/** Lot coordinates of a house point. */
export const toLot = (p: Project, x: number, y: number): [number, number] => [x + p.site.houseOrigin.x, y + p.site.houseOrigin.y];

export function distPointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Shortest distance between two 2D segments (they do not cross in our use). */
export function distSegSeg(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): number {
  return Math.min(
    distPointToSegment(a[0], a[1], c[0], c[1], d[0], d[1]),
    distPointToSegment(b[0], b[1], c[0], c[1], d[0], d[1]),
    distPointToSegment(c[0], c[1], a[0], a[1], b[0], b[1]),
    distPointToSegment(d[0], d[1], a[0], a[1], b[0], b[1]),
  );
}

/** Outer edges of a set of cells: every cell edge that no other cell touches from the other side, merged into runs. */
export function boundarySegs(cells: { x0: number; y0: number; x1: number; y1: number }[]): Seg[] {
  const raw: Seg[] = [];
  const subtract = (iv: [number, number][], a: number, b: number) =>
    iv.flatMap(([u, v]) => (b <= u || a >= v ? [[u, v]] : [...(a > u ? [[u, a]] : []), ...(b < v ? [[b, v]] : [])]) as [number, number][]);
  for (const c of cells) {
    const edges: [Seg['o'], number, number, number, 'lo' | 'hi'][] = [
      ['h', c.y0, c.x0, c.x1, 'lo'], ['h', c.y1, c.x0, c.x1, 'hi'], ['v', c.x0, c.y0, c.y1, 'lo'], ['v', c.x1, c.y0, c.y1, 'hi'],
    ];
    for (const [o, at, a, b, side] of edges) {
      let iv: [number, number][] = [[a, b]];
      for (const d of cells) {
        if (d === c) continue;
        const touches = o === 'h' ? (side === 'lo' ? eq(d.y1, at) : eq(d.y0, at)) : (side === 'lo' ? eq(d.x1, at) : eq(d.x0, at));
        if (touches) iv = subtract(iv, o === 'h' ? d.x0 : d.y0, o === 'h' ? d.x1 : d.y1);
      }
      for (const [u, v] of iv) if (v - u > 1e-4) raw.push({ o, c: at, a: u, b: v });
    }
  }
  const sorted = raw.sort((u, v) => (u.o === v.o ? (u.c === v.c ? u.a - v.a : u.c - v.c) : u.o < v.o ? -1 : 1));
  const out: Seg[] = [];
  for (const x of sorted) {
    const last = out[out.length - 1];
    if (last && last.o === x.o && eq(last.c, x.c) && x.a <= last.b + 1e-4) last.b = Math.max(last.b, x.b);
    else out.push({ ...x });
  }
  return out;
}

/** A level elevation as the drawings write it: +0.60, −2.50. */
export const fmtLevel = (v: number) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(2)}`;
