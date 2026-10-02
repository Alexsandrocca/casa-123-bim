// P1: the lot and what follows from it — area and sides, which boundary is the street, the rear and each side,
// the buildable envelope (inside the setbacks), the maximum areas (TO, CA, TP), the Civil Code window line,
// the natural ground, the sun on each side, and the list of things to confirm grouped by whom to ask.
// Lot coordinates: metres, origin at the front-left corner seen from the street, x along the street, y away from it.
import type { FactStatus, Lot, NumFact, Project, Who } from './schema';

export type P2 = [number, number];
export type EdgeRole = 'street' | 'rear' | 'left' | 'right';

/** Twice the signed area (positive = counter-clockwise with x right and y away from the street). */
const cross2 = (poly: P2[]) => poly.reduce((a, [x, y], i) => { const [u, v] = poly[(i + 1) % poly.length]!; return a + x * v - u * y; }, 0);
/** Area by the shoelace formula, m². */
export const polyArea = (poly: P2[]) => Math.abs(cross2(poly)) / 2;
export const sideLengths = (poly: P2[]) => poly.map(([x, y], i) => { const [u, v] = poly[(i + 1) % poly.length]!; return Math.hypot(u - x, v - y); });
export const perimeter = (poly: P2[]) => sideLengths(poly).reduce((a, b) => a + b, 0);

/** The lot with its corners counter-clockwise (street edges follow the corners). */
export function ccwLot(lot: Lot): Lot {
  if (cross2(lot.polygon) >= 0) return lot;
  const n = lot.polygon.length;
  return { ...lot, polygon: [...lot.polygon].reverse(), streetEdges: lot.streetEdges.map((i) => ((n - 2 - i) % n + n) % n).sort((a, b) => a - b) };
}

/** Outward unit normal of edge i of a counter-clockwise polygon. */
function normal(poly: P2[], i: number): P2 {
  const [ax, ay] = poly[i]!, [bx, by] = poly[(i + 1) % poly.length]!;
  const len = Math.hypot(bx - ax, by - ay) || 1;
  return [(by - ay) / len, -(bx - ax) / len];
}

/** What each boundary is: on a street, the rear (facing away from the street), or the left or right side seen from the street. */
export function edgeRoles(lot: Lot): EdgeRole[] {
  const l = ccwLot(lot);
  return l.polygon.map((_, i) => {
    if (l.streetEdges.includes(i)) return 'street';
    const [nx, ny] = normal(l.polygon, i);
    if (ny > Math.SQRT1_2) return 'rear';
    return nx < 0 ? 'left' : 'right';
  });
}

const ROLE_SETBACK = { street: 'front', rear: 'rear', left: 'left', right: 'right' } as const;
/** The setback a boundary needs (null: TO CONFIRM and empty). */
export const setbackFor = (lot: Lot, role: EdgeRole): NumFact => lot.rules.setbacks[ROLE_SETBACK[role]];

/** Keep the part of a polygon on the inner side of the line through a→b moved d inwards (Sutherland–Hodgman). */
function clipInside(poly: P2[], a: P2, b: P2, d: number): P2[] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const side = (p: P2) => ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / len - d;
  const out: P2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    const sp = side(p), sq = side(q);
    if (sp >= 0) out.push(p);
    if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out;
}

export const isConvex = (poly: P2[]) => poly.every((_, i) => {
  const [ax, ay] = poly[i]!, [bx, by] = poly[(i + 1) % poly.length]!, [cx, cy] = poly[(i + 2) % poly.length]!;
  return (bx - ax) * (cy - by) - (by - ay) * (cx - bx) >= -1e-9;
});

/** The buildable envelope: the lot moved in by each boundary's setback (an empty setback counts as 0).
 *  Exact for convex lots; for a lot with an inward corner it is on the safe side (smaller). */
export function envelope(lot: Lot): P2[] {
  const l = ccwLot(lot);
  const roles = edgeRoles(l);
  let poly: P2[] = l.polygon.map(([x, y]) => [x, y]);
  l.polygon.forEach((a, i) => {
    const d = setbackFor(l, roles[i]!).value ?? 0;
    if (poly.length >= 3) poly = clipInside(poly, a, l.polygon[(i + 1) % l.polygon.length]!, d);
  });
  return poly.length >= 3 && polyArea(poly) > 1e-6 ? poly : [];
}

/** Part of the line a→b (extended) inside a convex polygon, or null. */
function lineInPoly(poly: P2[], a: P2, b: P2): [P2, P2] | null {
  let t0 = -1e9, t1 = 1e9;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    const ex = q[0] - p[0], ey = q[1] - p[1];
    // inside: ex * (y − py) − ey * (x − px) ≥ 0
    const f0 = ex * (a[1] - p[1]) - ey * (a[0] - p[0]), fd = ex * dy - ey * dx;
    if (Math.abs(fd) < 1e-12) { if (f0 < 0) return null; continue; }
    const t = -f0 / fd;
    if (fd > 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
  }
  if (t1 - t0 < 1e-9) return null;
  return [[a[0] + dx * t0, a[1] + dy * t0], [a[0] + dx * t1, a[1] + dy * t1]];
}

/** Civil Code art. 1.301: no window within 1.50 m of a neighbour. The line 1.50 m inside each boundary that is not a street. */
export function windowLines(lot: Lot, d = 1.5): [P2, P2][] {
  const l = ccwLot(lot);
  const roles = edgeRoles(l);
  const out: [P2, P2][] = [];
  l.polygon.forEach((a, i) => {
    if (roles[i] === 'street') return;
    const b = l.polygon[(i + 1) % l.polygon.length]!;
    const [nx, ny] = normal(l.polygon, i);
    const seg = lineInPoly(l.polygon, [a[0] - nx * d, a[1] - ny * d], [b[0] - nx * d, b[1] - ny * d]);
    if (seg) out.push(seg);
  });
  return out;
}

/** Bounding box of the lot (front = y0). */
export const lotBox = (poly: P2[]) => ({ x0: Math.min(...poly.map((c) => c[0])), x1: Math.max(...poly.map((c) => c[0])), y0: Math.min(...poly.map((c) => c[1])), y1: Math.max(...poly.map((c) => c[1])) });

/** Natural ground heights of the bounding-box corners: front-left, front-right, rear-right, rear-left. 0.00 = the street at the front left. */
export function cornerHeights(lot: Lot): [number, number, number, number] {
  const t = lot.terrain, f = t.fall;
  switch (t.kind) {
    case 'flat': return [0, 0, 0, 0];
    case 'down': return [0, 0, -f, -f];
    case 'up': return [0, 0, f, f];
    case 'side': return [0, -f, -f, 0];
    case 'corners': return t.corners ?? [0, 0, 0, 0];
  }
}

/** Natural ground at a lot point: a bilinear surface over the bounding box (z = a + (b − a)u + (d − a)v + (a − b + c − d)uv). */
export function naturalAt(lot: Lot, x: number, y: number): number {
  const [a, b, c, d] = cornerHeights(lot);
  const bx = lotBox(lot.polygon);
  const u = (x - bx.x0) / (bx.x1 - bx.x0 || 1), v = (y - bx.y0) / (bx.y1 - bx.y0 || 1);
  return a + (b - a) * u + (d - a) * v + (a - b + c - d) * u * v;
}

/** The street-to-rear profile along the middle of the lot: height at the front and at the rear. */
export function profileEnds(lot: Lot): { front: number; rear: number } {
  const [a, b, c, d] = cornerHeights(lot);
  return { front: (a + b) / 2, rear: (c + d) / 2 };
}

const pct = (f: NumFact) => (f.value === null ? null : f.value / 100);

export interface LotFigures {
  area: number;
  perimeter: number;
  sides: number[];
  roles: EdgeRole[];
  /** Width along the street and depth away from it (bounding box), m. */
  width: number;
  depth: number;
  envelope: P2[];
  envelopeArea: number;
  /** TO × lot area, CA × lot area, TP × lot area (null: the rule is TO CONFIRM and empty). */
  maxFootprint: number | null;
  maxBuilt: number | null;
  minPermeable: number | null;
  convex: boolean;
}

export function lotFigures(lot: Lot): LotFigures {
  const l = ccwLot(lot);
  const area = polyArea(l.polygon), env = envelope(l), bx = lotBox(l.polygon);
  const to = pct(l.rules.coverage), tp = pct(l.rules.permeability), ca = l.rules.far.value;
  return {
    area, perimeter: perimeter(l.polygon), sides: sideLengths(l.polygon), roles: edgeRoles(l),
    width: bx.x1 - bx.x0, depth: bx.y1 - bx.y0,
    envelope: env, envelopeArea: polyArea(env),
    maxFootprint: to === null ? null : to * area,
    maxBuilt: ca === null ? null : ca * area,
    minPermeable: tp === null ? null : tp * area,
    convex: isConvex(l.polygon),
  };
}

/* ---------------- the to-confirm list ---------------- */

/** One thing to confirm: a code the UI turns into words (so it can be translated), and its values. */
export interface ConfirmItem { code: string; vars?: Record<string, string | number>; text?: string }
export interface ConfirmGroup { who: Who; ask: string; items: ConfirmItem[] }

const open = (s: FactStatus) => s === 'to-confirm';
export const WHO_ORDER: Who[] = ['prefeitura', 'water', 'power', 'gas', 'surveyor', 'soil', 'engineer'];

/** Everything still to confirm about the lot, grouped by whom to ask. With the model, design items too (a carport in the setback). */
export function toConfirm(lot: Lot, model?: Pick<Project, 'elements'>): ConfirmGroup[] {
  const s = lot.services, r = lot.rules;
  const groups = new Map<Who, ConfirmGroup>();
  const add = (who: Who, ask: string, item: ConfirmItem) => {
    const g = groups.get(who) ?? { who, ask, items: [] };
    g.items.push(item);
    groups.set(who, g);
  };
  const pref = 'Prefeitura';
  if (open(r.zone.status)) add('prefeitura', pref, { code: 'zone' });
  const sb = r.setbacks;
  if ([sb.front, sb.rear, sb.left, sb.right].some((f) => open(f.status))) add('prefeitura', pref, { code: 'setbacks' });
  const rates = [['coverage', r.coverage], ['permeability', r.permeability], ['far', r.far]] as const;
  if (rates.some(([, f]) => open(f.status))) add('prefeitura', pref, { code: 'rates' });
  if (open(r.height.status) || open(r.floors.status)) add('prefeitura', pref, { code: 'height' });
  if (open(r.eaves.status)) add('prefeitura', pref, { code: 'eaves' });
  if (model?.elements.some((e) => e.type === 'Carport')) add('prefeitura', pref, { code: 'carport' });
  if (open(s.storm.kind.status)) add('prefeitura', pref, { code: 'storm' });
  if (open(s.sewer.exists.status)) add('water', s.sewer.ask, { code: 'sewer-exists' });
  if (open(s.sewer.depth.status)) add('water', s.sewer.ask, { code: 'sewer-depth' });
  if (open(s.water.depth.status)) add('water', s.water.ask, { code: 'water-depth' });
  if (open(s.power.supply.status)) add('power', s.power.ask, { code: 'supply' });
  if (s.gas.wanted && open(s.gas.exists.status)) add('gas', s.gas.ask, { code: 'gas' });
  if (open(lot.terrain.status)) add('surveyor', '', { code: 'survey' });
  if (open(lot.shape.status)) add('surveyor', '', { code: 'shape' });
  if (open(lot.geo.status)) add('surveyor', '', { code: 'geo' });
  for (const c of lot.confirm) add(c.who, c.who === 'water' ? s.sewer.ask : c.who === 'power' ? s.power.ask : c.who === 'gas' ? s.gas.ask : c.who === 'prefeitura' ? pref : '', { code: 'text', text: c.text });
  return WHO_ORDER.flatMap((w) => (groups.has(w) ? [groups.get(w)!] : []));
}
