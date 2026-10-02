// Loads and structural pre-sizing (spec 08). ESTIMATES, not engineering calculations: the rules an experienced engineer
// uses before the real design, so the family can compare options with realistic numbers.
//   slab bays → beams (line loads) → columns (tributary areas of every floor above) → footings (soil pressure).
import { eq, openingSeg, pointInRect, wallSeg, type Seg } from '../geometry';
import { isPlanLevel, type Beam, type Column, type Footing, type Opening, type Project, type Rect, type Slab, type Wall } from '../schema';
import { groundAt, groundZones, siteFrame } from '../site';
import { slabCovers, slabRect, slabVoids } from '../structure';
import { layoutModules, solarArray } from '../electrical/solar';
import { A } from './assumptions';
import { assemblyOf, useOf, values, type AssemblyUse } from './assemblies';
import { BEAM_CANDIDATES, COLUMN_CANDIDATES, section, type Section } from './steel';
import { featureLoads } from './features';
import { WEB_HOLE, outerD } from '../mep/library';

export type Status = 'ok' | 'amber' | 'red';
/** Utilisation colours: green < 0.7, amber 0.7–1.0, red > 1.0. */
export const statusOf = (u: number): Status => (!Number.isFinite(u) ? 'red' : u < 0.7 ? 'ok' : u <= 1.0 + 1e-9 ? 'amber' : 'red');

const E_STEEL = 2.0e8; // kN/m²
const G = 9.81 / 1000; // kg → kN
const FCK_PIER = 25e3; // kN/m² (C25 piers)

export interface PointLoad { id: string; label: string; at: [number, number]; kN: number; how: string }

export interface Bay {
  id: string;
  slabId: string;
  slabName: string;
  rect: Rect;
  use: AssemblyUse;
  /** standing level (rooms on it) */
  level: string;
  /** The deck spans along x or y (between the two beams it rests on); null = not carried on two sides. */
  spanDir: 'x' | 'y' | null;
  span: number;
  /** the two beam lines the deck rests on (x or y coordinates) */
  lo: number;
  hi: number;
  area: number;
  dead: { assembly: number; finishes: number; partitions: number; walls: number; points: number };
  live: number;
  liveLabel: string;
  g: number;
  q: number;
  /** kN/m² */
  service: number;
  factored: number;
  points: PointLoad[];
  deck: { util: number; status: Status; reason: string } | null;
}

export interface MemberCheck { util: number; status: Status; governing: string }

export interface BeamSpan {
  beamId: string;
  a: number; b: number; o: 'v' | 'h'; c: number;
  L: number;
  primary: boolean;
  /** service line load without self weight, kN/m, and its parts */
  w: number;
  parts: { slab: number; walls: number };
  depthRule: number;
}
export interface BeamResult {
  beam: Beam;
  spans: BeamSpan[];
  current: Section | undefined;
  check: MemberCheck;
  proposed: Section | undefined;
  /** worst span, its design moment and deflection with the current section */
  Md: number; MRd: number; defl: number; deflLimit: number;
}
export interface ColumnResult {
  col: Column;
  /** service and factored axial load at the base, kN */
  N: number; Nd: number;
  byLevel: { slab: string; kN: number }[];
  L: number;
  current: Section | undefined;
  NRd: number;
  slenderness: number;
  check: MemberCheck;
  proposed: Section | undefined;
}
export interface FootingResult {
  footing: Footing;
  carries: string;
  N: number;
  /** proposed square side and depth, m */
  B: number; h: number;
  pressure: number;
  check: MemberCheck;
}
export interface RetainingResult { wall: Wall; H: number; tNeed: number; tHas: number; base: number; check: MemberCheck }
export interface Lintel { opening: Opening; wall: Wall; span: number; kind: 'concrete lintel' | 'steel header'; depth: number }
export interface Bracing { storey: string; dir: 'x' | 'y'; line: string; from: number; to: number; windows: number; text: string }

/* ---------------- helpers ---------------- */

const elevOf = (p: Project, id: string) => p.levels.find((l) => l.id === id)?.elevation ?? 0;
const overlap1 = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const rectOverlap = (r: Rect, s: Rect) => overlap1(r.x0, r.x1, s.x0, s.x1) * overlap1(r.y0, r.y1, s.y0, s.y1);
const beamSeg = (b: Beam): Seg => {
  const [sx, sy] = b.props.start, [ex, ey] = b.props.end;
  return eq(sx, ex) ? { o: 'v', c: sx, a: Math.min(sy, ey), b: Math.max(sy, ey) } : { o: 'h', c: sy, a: Math.min(sx, ex), b: Math.max(sx, ex) };
};
const soffit = (s: Slab) => s.props.topElevation - s.props.thickness;
const isHouse = (e: { tags: string[] }) => !e.tags.includes('carport');

export const suspendedSlabs = (p: Project) => p.elements.filter((e): e is Slab => e.type === 'Slab' && !e.props.onGrade);

/** The plan level whose floor is this slab (rooms stand on it). */
function standingLevel(p: Project, s: Slab): string {
  const l = p.levels.find((x) => Math.abs(x.elevation - s.props.topElevation) < 0.05 && x.plan && x.outline && pointInRect((slabRect(p, s).x0 + slabRect(p, s).x1) / 2, (slabRect(p, s).y0 + slabRect(p, s).y1) / 2, x.outline));
  return l?.id ?? s.level;
}

/** Weight of a wall per metre: its assembly × height × the solid share (openings out). kN/m */
export function wallLineLoad(p: Project, w: Wall): number {
  const v = values(assemblyOf(p, w));
  const s = wallSeg(w), len = s.b - s.a;
  const holes = p.elements.reduce((a, o) => a + (o.type === 'Opening' && o.props.host === w.id ? o.props.width * o.props.height : 0), 0);
  const solid = len > 0 ? Math.max(0.2, 1 - holes / (len * w.props.height)) : 1;
  return v.weight * w.props.height * solid;
}

/** Walls standing on a suspended slab (not retaining walls). */
function wallsOn(p: Project, s: Slab): Wall[] {
  return p.elements.filter((w): w is Wall => {
    if (w.type !== 'Wall' || w.props.wallType === 'retaining') return false;
    if (Math.abs(elevOf(p, w.level) - s.props.topElevation) > 0.05) return false;
    const g = wallSeg(w), m = (g.a + g.b) / 2;
    const [x, y] = g.o === 'v' ? [g.c, m] : [m, g.c];
    return [[0.06, 0], [-0.06, 0], [0, 0.06], [0, -0.06]].some(([dx, dy]) => slabCovers(p, s, x + dx!, y + dy!));
  });
}

const beamsUnder = (p: Project, s: Slab) => {
  const r = slabRect(p, s), z = soffit(s), e = (s.props.eaves ?? 0) + 0.05;
  // a beam line may run on under the next slab at the same height: keep any beam that overlaps this one
  return p.elements.filter((b): b is Beam => {
    if (b.type !== 'Beam' || !isHouse(b) || Math.abs(b.props.elevation - z) >= 0.05) return false;
    const g = beamSeg(b);
    return g.o === 'v'
      ? g.c >= r.x0 - e && g.c <= r.x1 + e && overlap1(g.a, g.b, r.y0, r.y1) > 0.05
      : g.c >= r.y0 - e && g.c <= r.y1 + e && overlap1(g.a, g.b, r.x0, r.x1) > 0.05;
  });
};

/** Is the line (o, c) from a to b carried by beams for at least 90 % of it? */
function carried(beams: Beam[], o: 'v' | 'h', c: number, a: number, b: number): boolean {
  let got = 0;
  for (const bm of beams) { const s = beamSeg(bm); if (s.o === o && eq(s.c, c)) got += overlap1(s.a, s.b, a, b); }
  return got >= 0.9 * (b - a);
}

/* ---------------- point loads (equipment) ---------------- */

export function pointLoads(p: Project): PointLoad[] {
  const out: PointLoad[] = [];
  const tankL = A(p, 'tankVolume'), extra = 1 + A(p, 'tankExtra') / 100;
  for (const f of p.elements) {
    if (f.type === 'Fixture') {
      if (f.props.kind === 'roof-tank') out.push({ id: f.id, label: `Water tank ${tankL.toFixed(0)} L, full`, at: f.props.at, kN: (tankL + 40) * G * extra, how: `${tankL.toFixed(0)} L of water + 40 kg tank, + ${((extra - 1) * 100).toFixed(0)} % for the structure` });
      if (f.props.kind === 'water-heater') out.push({ id: f.id, label: 'Heat-pump water heater 300 L, full', at: f.props.at, kN: (300 + 90) * G, how: '300 L of water + 90 kg unit (Q12)' });
      if (f.props.kind === 'pressure-pump') out.push({ id: f.id, label: 'Pressure pump', at: f.props.at, kN: 35 * G, how: '35 kg' });
    }
    if (f.type === 'Device' && f.props.kind === 'ac-outdoor' && f.level === 'roof') out.push({ id: f.id, label: 'AC outdoor unit', at: f.props.at, kN: 45 * G, how: '45 kg with its stand' });
  }
  const arr = solarArray(p);
  if (arr) for (const [i, m] of layoutModules(p, arr).entries()) out.push({ id: `${arr.id}:${i}`, label: 'PV module with its frame', at: [m.x, m.y], kN: 34 * G, how: '28 kg module + 6 kg frame and ballast' });
  out.push(...featureLoads(p));
  return out;
}

/* ---------------- bays ---------------- */

export function slabBays(p: Project, s: Slab, points: PointLoad[] = pointLoads(p)): Bay[] {
  const r = slabRect(p, s);
  const voids = slabVoids(p, s);
  const beams = beamsUnder(p, s);
  const use = useOf(s);
  const asm = values(assemblyOf(p, s));
  const deckSlab = assemblyOf(p, s).layers.some((l) => l.structural && /deck/i.test(l.material));
  const level = standingLevel(p, s);
  const xs = [...new Set([r.x0, r.x1, ...beams.map(beamSeg).filter((g) => g.o === 'v').map((g) => g.c)].map((v) => +v.toFixed(3)))].filter((v) => v >= r.x0 - 1e-6 && v <= r.x1 + 1e-6).sort((a, b) => a - b);
  const ys = [...new Set([r.y0, r.y1, ...beams.map(beamSeg).filter((g) => g.o === 'h').map((g) => g.c)].map((v) => +v.toFixed(3)))].filter((v) => v >= r.y0 - 1e-6 && v <= r.y1 + 1e-6).sort((a, b) => a - b);
  const walls = wallsOn(p, s).map((w) => ({ w, seg: wallSeg(w), kNm: wallLineLoad(p, w) }));
  const rooms = p.elements.filter((e) => e.type === 'Space' && e.level === level);
  const out: Bay[] = [];
  for (let j = 0; j + 1 < ys.length; j++) {
    for (let i = 0; i + 1 < xs.length; i++) {
      const b: Rect = { x0: xs[i]!, x1: xs[i + 1]!, y0: ys[j]!, y1: ys[j + 1]! };
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      if (b.x1 - b.x0 < 0.05 || b.y1 - b.y0 < 0.05 || !slabCovers(p, s, cx, cy, voids)) continue;
      const area = (b.x1 - b.x0) * (b.y1 - b.y0);
      // the deck runs on to the nearest beam line on each side (a partial line, like a stair trimmer, does not stop it)
      const find = (o: 'v' | 'h', lines: number[], from: number, step: -1 | 1, a: number, z: number) => {
        for (let k = from; k >= 0 && k < lines.length; k += step) if (carried(beams, o, lines[k]!, a, z)) return lines[k]!;
        return undefined;
      };
      const xl = find('v', xs, i, -1, b.y0, b.y1), xh = find('v', xs, i + 1, 1, b.y0, b.y1);
      const yl = find('h', ys, j, -1, b.x0, b.x1), yh = find('h', ys, j + 1, 1, b.x0, b.x1);
      const sx = xl !== undefined && xh !== undefined, sy = yl !== undefined && yh !== undefined;
      const wx = sx ? xh! - xl! : Infinity, wy = sy ? yh! - yl! : Infinity;
      const spanDir: Bay['spanDir'] = sx && sy ? (wx <= wy ? 'x' : 'y') : sx ? 'x' : sy ? 'y' : null;
      const span = spanDir === 'x' ? wx : spanDir === 'y' ? wy : Math.max(b.x1 - b.x0, b.y1 - b.y0);
      const [lo, hi] = spanDir === 'x' ? [xl!, xh!] : spanDir === 'y' ? [yl!, yh!] : [0, 0];
      // walls inside the bay (or on an edge with no beam) are spread over it; walls on beams load the beam
      let wallKN = 0;
      for (const { seg, kNm } of walls) {
        const along = seg.o === 'v' ? overlap1(seg.a, seg.b, b.y0, b.y1) : overlap1(seg.a, seg.b, b.x0, b.x1);
        if (along <= 0) continue;
        const lo = seg.o === 'v' ? b.x0 : b.y0, hi = seg.o === 'v' ? b.x1 : b.y1;
        if (seg.c > lo + 1e-6 && seg.c < hi - 1e-6) wallKN += kNm * along;
        else if ((eq(seg.c, lo) || eq(seg.c, hi)) && !carried(beams, seg.o, seg.c, seg.o === 'v' ? b.y0 : b.x0, seg.o === 'v' ? b.y1 : b.x1)) wallKN += (kNm * along) / 2;
      }
      const pts = points.filter((pt) => pt.at[0] >= b.x0 - 1e-6 && pt.at[0] < b.x1 + 1e-6 && pt.at[1] >= b.y0 - 1e-6 && pt.at[1] < b.y1 + 1e-6
        && Math.abs(pointZ(p, pt) - s.props.topElevation) < 0.6);
      const floorUse = use === 'floor' || use === 'terrace';
      const room = rooms.find((sp) => sp.type === 'Space' && sp.props.cells.some((c) => pointInRect(cx, cy, c)));
      const zone = room?.type === 'Space' ? room.props.zone : undefined;
      const [live, liveLabel] = use === 'roof' ? [A(p, 'liveRoof'), 'roof, maintenance only'] as const
        : use === 'terrace' ? [A(p, 'liveTerrace'), 'veranda and terraces'] as const
          : zone === 'service' ? [A(p, 'liveService'), 'service area'] as const
            : zone === 'stair' ? [A(p, 'liveStair'), 'stair'] as const
              : [A(p, 'liveDwelling'), 'rooms of the dwelling'] as const;
      const dead = {
        assembly: asm.weight,
        finishes: A(p, 'finishes'),
        partitions: floorUse && wallKN === 0 && !walls.some(({ seg }) => (seg.o === 'v' ? overlap1(seg.a, seg.b, b.y0, b.y1) > 0 && seg.c >= b.x0 - 1e-6 && seg.c <= b.x1 + 1e-6 : overlap1(seg.a, seg.b, b.x0, b.x1) > 0 && seg.c >= b.y0 - 1e-6 && seg.c <= b.y1 + 1e-6)) ? A(p, 'partitions') : 0,
        walls: wallKN / area,
        points: pts.reduce((a, pt) => a + pt.kN, 0) / area,
      };
      const g = dead.assembly + dead.finishes + dead.partitions + dead.walls + dead.points;
      const service = g + live;
      let deck: Bay['deck'] = null;
      if (deckSlab) {
        const un = A(p, 'deckUnpropped'), pr = A(p, 'deckPropped');
        if (!spanDir) deck = { util: Infinity, status: 'red', reason: 'not carried by beams on two opposite sides' };
        else if (span <= un + 1e-9) deck = { util: span / un, status: statusOf(span / un), reason: `deck span ${span.toFixed(2)} m ≤ ${un.toFixed(2)} m without props` };
        else if (span <= pr + 1e-9) deck = { util: Math.max(span / pr, 0.7), status: 'amber', reason: `deck span ${span.toFixed(2)} m > ${un.toFixed(2)} m: needs props during the pour (or a thicker deck)` };
        else deck = { util: span / pr, status: 'red', reason: `deck span ${span.toFixed(2)} m > ${pr.toFixed(2)} m even with props: add a beam or use a deeper deck` };
      }
      out.push({
        id: `${s.id}:${i}:${j}`, slabId: s.id, slabName: s.props.name, rect: b, use, level, spanDir, span, lo, hi, area, dead, live, liveLabel,
        g, q: live, service, factored: A(p, 'gammaF') * service, points: pts, deck,
      });
    }
  }
  return out;
}

/** Height a point load stands at (fixtures and devices carry their own z; PV on the main roof). */
function pointZ(p: Project, pt: PointLoad): number {
  const el = p.elements.find((e) => e.id === pt.id);
  if (el?.type === 'Fixture') return el.props.z;
  if (el?.type === 'Device') return el.props.z - 0.3;
  if (el?.type === 'Feature') return el.props.z ?? 0;
  return solarArray(p)?.props.roofTop ?? 0;
}

/* ---------------- beams ---------------- */

/** Columns and piers standing under a beam line at its height. */
const supportsOn = (p: Project, s: Seg, z: number) => p.elements.filter((c): c is Column => c.type === 'Column' && isHouse(c)
  && c.props.topElevation >= z - 0.06 && c.props.baseElevation < z - 0.1
  && (s.o === 'v' ? eq(c.props.at[0], s.c) && c.props.at[1] >= s.a - 0.05 && c.props.at[1] <= s.b + 0.05 : eq(c.props.at[1], s.c) && c.props.at[0] >= s.a - 0.05 && c.props.at[0] <= s.b + 0.05));

export function beamSpans(p: Project, b: Beam, bays: Bay[], wallLoads: { seg: Seg; kNm: number; z: number }[]): BeamSpan[] {
  const s = beamSeg(b), z = b.props.elevation;
  const cols = supportsOn(p, s, z).map((c) => (s.o === 'v' ? c.props.at[1] : c.props.at[0]));
  const stops = [...new Set([s.a, s.b, ...cols.filter((t) => t > s.a + 0.05 && t < s.b - 0.05)].map((v) => +v.toFixed(3)))].sort((u, v) => u - v);
  const out: BeamSpan[] = [];
  for (let i = 0; i + 1 < stops.length; i++) {
    const a = stops[i]!, e = stops[i + 1]!, L = e - a;
    if (L < 0.1) continue;
    const atCol = (t: number) => cols.some((c) => Math.abs(c - t) < 0.06);
    let slab = 0, walls = 0;
    for (const bay of bays) {
      if (Math.abs(soffitOfBay(p, bay) - z) > 0.05) continue;
      // the beam carries its share of every deck strip that spans onto it (lever rule between the two beams)
      const dirOk = (s.o === 'v' && bay.spanDir === 'x') || (s.o === 'h' && bay.spanDir === 'y');
      if (!dirOk || !(eq(bay.lo, s.c) || eq(bay.hi, s.c))) continue;
      const [c0, c1, a0, a1] = s.o === 'v' ? [bay.rect.x0, bay.rect.x1, bay.rect.y0, bay.rect.y1] : [bay.rect.y0, bay.rect.y1, bay.rect.x0, bay.rect.x1];
      const mid = (c0 + c1) / 2, share = eq(bay.lo, s.c) ? (bay.hi - mid) / (bay.hi - bay.lo) : (mid - bay.lo) / (bay.hi - bay.lo);
      slab += bay.service * (c1 - c0) * share * overlap1(a, e, a0, a1);
    }
    for (const w of wallLoads) if (Math.abs(w.z - z) < 0.5 && w.seg.o === s.o && eq(w.seg.c, s.c)) walls += w.kNm * overlap1(a, e, w.seg.a, w.seg.b);
    const primary = atCol(a) && atCol(e);
    out.push({ beamId: b.id, a, b: e, o: s.o, c: s.c, L, primary, w: (slab + walls) / L, parts: { slab: slab / L, walls: walls / L }, depthRule: L / (primary ? 20 : 25) });
  }
  return out;
}

const soffitCache = new WeakMap<Project, Map<string, number>>();
function soffitOfBay(p: Project, bay: Bay): number {
  let m = soffitCache.get(p);
  if (!m) { m = new Map(); soffitCache.set(p, m); }
  if (!m.has(bay.slabId)) { const s = p.elements.find((e) => e.id === bay.slabId) as Slab; m.set(bay.slabId, soffit(s)); }
  return m.get(bay.slabId)!;
}

/** Bending (plastic, top flange braced by the deck) and deflection of a simply supported span. */
export function checkBeamSpan(p: Project, sp: BeamSpan, sec: Section): { util: number; governing: string; Md: number; MRd: number; defl: number; limit: number } {
  const w = sp.w + sec.kg * G;
  const Md = (A(p, 'gammaF') * w * sp.L ** 2) / 8;
  const MRd = (sec.Zx * A(p, 'fy') * 1000) / A(p, 'gammaA');
  const defl = (5 * w * sp.L ** 4) / (384 * E_STEEL * sec.Ix);
  const limit = sp.L / A(p, 'deflection');
  const ub = Md / MRd, ud = defl / limit;
  return {
    util: Math.max(ub, ud), Md, MRd, defl, limit,
    governing: ub >= ud ? `bending: Md ${Md.toFixed(1)} kNm / MRd ${MRd.toFixed(1)} kNm` : `deflection: ${(defl * 1000).toFixed(1)} mm / ${(limit * 1000).toFixed(1)} mm (span/${A(p, 'deflection').toFixed(0)})`,
  };
}

/** Lightest W section that passes every span. */
/** The lightest section that passes every span. P1 (Q20): within the structure zone (maxDepth) when one passes there,
 *  because a deeper beam takes the room the services run in; otherwise the lightest one overall. */
export function pickBeam(p: Project, spans: BeamSpan[], maxDepth = Infinity, minDepth = 0): Section | undefined {
  const ok = (sec: Section) => sec.d >= minDepth - 1e-9 && spans.every((sp) => checkBeamSpan(p, sp, sec).util <= 1);
  return BEAM_CANDIDATES.find((sec) => sec.d <= maxDepth + 1e-9 && ok(sec)) ?? BEAM_CANDIDATES.find(ok);
}

/** P1 (Q20): the depth a beam keeps for the pipes and conduits that cross it through a web hole now
 *  (hole Ø ≤ 0.4 × depth, 20 mm of web above and below), so a lighter section never cuts a route off. */
export function holeDepth(p: Project, b: Beam): number {
  const g = beamSeg(b), zTop = b.props.elevation, d = section(b.props.profile)?.d ?? 0;
  const ax = g.o === 'v' ? 0 : 1;
  let need = 0;
  for (const e of p.elements) {
    if (e.type !== 'PipeSegment' && e.type !== 'Conduit') continue;
    const a = e.props.start, c = e.props.end;
    if (Math.hypot(c[0] - a[0], c[1] - a[1]) < 0.01 || Math.abs(c[ax]! - a[ax]!) < 1e-9) continue;
    const t = (g.c - a[ax]!) / (c[ax]! - a[ax]!);
    if (t < 0 || t > 1) continue;
    const along = g.o === 'v' ? a[1] + (c[1] - a[1]) * t : a[0] + (c[0] - a[0]) * t;
    if (along < g.a - 0.01 || along > g.b + 0.01) continue;
    const z = a[2] + (c[2] - a[2]) * t, r = outerD(e.props.dn) / 2;
    if (z - r >= zTop - 1e-3 || z + r <= zTop - d + 1e-3) continue;
    need = Math.max(need, 2 * r / WEB_HOLE, zTop - z + r + 0.02);
  }
  return need;
}

/** Room for a beam under a floor: the structure depth less the slab it carries (Casa 123: 0.40 − 0.14 = 0.26 m). */
export function beamZone(p: Project, b: Beam): number {
  const s = suspendedSlabs(p).find((x) => Math.abs(soffit(x) - b.props.elevation) < 0.05);
  return p.structure.structureDepth - (s?.props.thickness ?? 0);
}

/* ---------------- columns ---------------- */

/** Compression resistance NBR 8800: χ·A·fy / γa1, K = 1, about the weak axis. */
export function columnCapacity(p: Project, sec: Section, L: number): { NRd: number; chi: number; slenderness: number } {
  const fy = A(p, 'fy') * 1000;
  const r = Math.min(sec.rx, sec.ry);
  const slenderness = L / r;
  const l0 = (slenderness / Math.PI) * Math.sqrt(fy / E_STEEL);
  const chi = l0 <= 1.5 ? 0.658 ** (l0 * l0) : 0.877 / (l0 * l0);
  return { NRd: (chi * sec.A * fy) / A(p, 'gammaA'), chi, slenderness };
}

/* ---------------- the whole frame ---------------- */

export interface Frame {
  bays: Bay[];
  points: PointLoad[];
  beams: BeamResult[];
  columns: ColumnResult[];
  footings: FootingResult[];
  retaining: RetainingResult[];
  lintels: Lintel[];
  bracing: Bracing[];
  wind: { q: number; Fx: number; Fy: number; Vk: number };
  quantities: Quantities;
}

export interface Quantities {
  steelKg: number; steelBeamsKg: number; steelColumnsKg: number; floorArea: number; steelPerM2: number;
  concrete: { footings: number; retaining: number; slabs: number; total: number };
  rebarKg: number; formwork: number; excavation: number;
}

export function frame(p: Project): Frame {
  const points = pointLoads(p);
  const slabs = suspendedSlabs(p);
  const bays = slabs.flatMap((s) => slabBays(p, s, points));
  // wall line loads, at the height of the beams under them
  const wallLoads: { seg: Seg; kNm: number; z: number; w: Wall }[] = [];
  for (const s of slabs) for (const w of wallsOn(p, s)) wallLoads.push({ seg: wallSeg(w), kNm: wallLineLoad(p, w), z: soffit(s), w });

  /* beams */
  const beams: BeamResult[] = [];
  for (const b of p.elements) {
    if (b.type !== 'Beam' || !isHouse(b)) continue;
    const spans = beamSpans(p, b, bays, wallLoads);
    const current = section(b.props.profile);
    let worst = { util: 0, governing: 'no load', Md: 0, MRd: 0, defl: 0, limit: 0 };
    if (current) for (const sp of spans) { const c = checkBeamSpan(p, sp, current); if (c.util > worst.util) worst = c; }
    beams.push({
      beam: b, spans, current, proposed: pickBeam(p, spans, beamZone(p, b), holeDepth(p, b)),
      check: current ? { util: worst.util, status: statusOf(worst.util), governing: worst.governing } : { util: NaN, status: 'red', governing: 'section not in the table' },
      Md: worst.Md, MRd: worst.MRd, defl: worst.defl, deflLimit: worst.limit,
    });
  }

  /* columns: tributary areas of every slab they carry */
  const columns: ColumnResult[] = [];
  const supportsOf = new Map<string, Column[]>();
  for (const s of slabs) {
    const z = soffit(s), r = slabRect(p, s);
    supportsOf.set(s.id, p.elements.filter((c): c is Column => c.type === 'Column' && isHouse(c) && c.props.topElevation >= z - 0.06 && c.props.baseElevation < z - 0.1
      && pointInRect(c.props.at[0], c.props.at[1], { x0: r.x0 - 0.05, y0: r.y0 - 0.05, x1: r.x1 + 0.05, y1: r.y1 + 0.05 })));
  }
  for (const c of p.elements) {
    if (c.type !== 'Column' || !isHouse(c)) continue;
    const [x, y] = c.props.at;
    const byLevel: { slab: string; kN: number }[] = [];
    for (const s of slabs) {
      const sup = supportsOf.get(s.id)!;
      if (!sup.includes(c)) continue;
      const r = slabRect(p, s), e = s.props.eaves ?? 0;
      const xs = [...new Set(sup.map((u) => u.props.at[0]))].sort((u, v) => u - v);
      const ys = [...new Set(sup.filter((u) => eq(u.props.at[0], x) || true).map((u) => u.props.at[1]))].sort((u, v) => u - v);
      // neighbours on the same line only (piers sit between the rows of some lines)
      const yLine = [...new Set(sup.filter((u) => eq(u.props.at[0], x)).map((u) => u.props.at[1]))].sort((u, v) => u - v);
      const xLine = [...new Set(sup.filter((u) => eq(u.props.at[1], y)).map((u) => u.props.at[0]))].sort((u, v) => u - v);
      const half = (arr: number[], v: number, lo: number, hi: number): [number, number] => {
        const i = arr.findIndex((t) => eq(t, v));
        return [i > 0 ? (arr[i - 1]! + v) / 2 : lo, i >= 0 && i < arr.length - 1 ? (arr[i + 1]! + v) / 2 : hi];
      };
      const [tx0, tx1] = half(xLine.length > 1 ? xLine : xs, x, r.x0 - e, r.x1 + e);
      const [ty0, ty1] = half(yLine.length > 1 ? yLine : ys, y, r.y0 - e, r.y1 + e);
      const trib: Rect = { x0: tx0, x1: tx1, y0: ty0, y1: ty1 };
      let kN = 0;
      for (const bay of bays) if (bay.slabId === s.id) kN += bay.service * rectOverlap(trib, bay.rect);
      for (const w of wallLoads) {
        if (Math.abs(w.z - soffit(s)) > 0.05) continue;
        const inside = w.seg.o === 'v' ? (w.seg.c >= trib.x0 - 1e-6 && w.seg.c <= trib.x1 + 1e-6 ? overlap1(w.seg.a, w.seg.b, trib.y0, trib.y1) : 0) : (w.seg.c >= trib.y0 - 1e-6 && w.seg.c <= trib.y1 + 1e-6 ? overlap1(w.seg.a, w.seg.b, trib.x0, trib.x1) : 0);
        // a wall exactly on the tributary edge is shared with the neighbour
        const edge = w.seg.o === 'v' ? eq(w.seg.c, trib.x0) || eq(w.seg.c, trib.x1) : eq(w.seg.c, trib.y0) || eq(w.seg.c, trib.y1);
        kN += w.kNm * inside * (edge ? 0.5 : 1);
      }
      byLevel.push({ slab: s.props.name, kN });
    }
    const current = section(c.props.profile);
    const height = c.props.topElevation - c.props.baseElevation;
    const selfKN = (current?.kg ?? (c.props.kind === 'pier' ? 0.09 * 2500 : 40)) * G * height;
    const N = byLevel.reduce((a, l) => a + l.kN, 0) + selfKN;
    const Nd = A(p, 'gammaF') * N;
    // buckling length: the longest stretch between the beams that frame into it
    const levelsOn = p.elements.filter((b): b is Beam => b.type === 'Beam' && isHouse(b) && b.props.elevation > c.props.baseElevation + 0.1 && b.props.elevation < c.props.topElevation - 0.1
      && (() => { const g = beamSeg(b); return g.o === 'v' ? eq(g.c, x) && y >= g.a - 0.05 && y <= g.b + 0.05 : eq(g.c, y) && x >= g.a - 0.05 && x <= g.b + 0.05; })()).map((b) => b.props.elevation);
    const marks = [c.props.baseElevation, ...levelsOn, c.props.topElevation].sort((u, v) => u - v);
    const L = Math.max(...marks.slice(1).map((m, i) => m - marks[i]!));
    let NRd: number, slenderness: number, proposed: Section | undefined;
    if (c.props.kind === 'pier') {
      const side = c.props.profile.includes('40') ? 0.4 : 0.3;
      NRd = (0.85 * FCK_PIER / 1.4) * side * side; slenderness = L / (side / Math.sqrt(12)); proposed = undefined;
    } else {
      const cap = current ? columnCapacity(p, current, L) : { NRd: 0, slenderness: Infinity };
      NRd = cap.NRd; slenderness = cap.slenderness;
      proposed = COLUMN_CANDIDATES.find((sec) => columnCapacity(p, sec, L).NRd >= A(p, 'gammaF') * (N - selfKN + sec.kg * G * height) && columnCapacity(p, sec, L).slenderness <= 200);
    }
    const u = Nd / NRd;
    columns.push({
      col: c, N, Nd, byLevel, L, current, NRd, slenderness, proposed,
      check: { util: u, status: statusOf(u), governing: `axial: Nd ${Nd.toFixed(0)} kN / NRd ${NRd.toFixed(0)} kN (L ${L.toFixed(2)} m, KL/r ${slenderness.toFixed(0)})` },
    });
  }

  /* footings */
  const footings: FootingResult[] = [];
  const sigma = A(p, 'soilPressure'), minH = A(p, 'footingMinDepth');
  for (const f of p.elements) {
    if (f.type !== 'Footing' || f.props.kind !== 'pad' || !isHouse(f)) continue;
    const col = columns.find((c) => c.col.id === f.props.carries);
    if (!col) continue;
    const r = f.props.rect, side = Math.min(r.x1 - r.x0, r.y1 - r.y0);
    const N = col.N * 1.1;
    const { B, h } = sizeFooting(col.N, sigma, minH, col.current ? Math.max(col.current.d, col.current.bf) : 0.3);
    const pressure = N / ((r.x1 - r.x0) * (r.y1 - r.y0));
    const u = pressure / sigma;
    footings.push({
      footing: f, carries: col.col.id, N, B, h, pressure,
      check: { util: u, status: statusOf(u), governing: `soil: ${pressure.toFixed(0)} kPa under ${side.toFixed(2)} m / allowable ${sigma.toFixed(0)} kPa (TO CONFIRM by SPT)` },
    });
  }

  return {
    bays, points, beams, columns, footings,
    retaining: retainingWalls(p), lintels: lintels(p), bracing: bracing(p), wind: wind(p),
    quantities: quantities(p, beams, columns, footings),
  };
}

/** Square pad: area = service load (+10 % for the footing) / allowable pressure, side rounded up to 5 cm (min 0.60 m);
 *  depth ≥ (side − column) / 3 for a rigid pad, rounded up to 5 cm, and at least the minimum depth. */
export function sizeFooting(Nservice: number, sigma: number, minH: number, column: number): { B: number; h: number } {
  const up = (v: number) => Math.round(Math.ceil(v / 0.05 - 1e-9) * 0.05 * 1000) / 1000;
  const B = Math.max(0.6, up(Math.sqrt((Nservice * 1.1) / sigma)));
  return { B, h: Math.max(minH, up((B - column) / 3)) };
}

/* ---------------- retaining walls, lintels, bracing, wind ---------------- */

function retainingWalls(p: Project): RetainingResult[] {
  const out: RetainingResult[] = [];
  const zones = groundZones(p);
  for (const w of p.elements) {
    if (w.type !== 'Wall' || w.props.wallType !== 'retaining') continue;
    const s = wallSeg(w), lv = p.levels.find((l) => l.id === w.level);
    const o = lv?.outline;
    const floor = elevOf(p, w.level);
    let H = 0;
    for (let k = 0; k <= 4; k++) {
      const t = s.a + ((s.b - s.a) * (k + 0.5)) / 5;
      // outside: away from the middle of the level
      const mid = s.o === 'v' ? ((o?.x0 ?? 0) + (o?.x1 ?? 0)) / 2 : ((o?.y0 ?? 0) + (o?.y1 ?? 0)) / 2;
      const out = s.c < mid ? -1 : 1;
      const [x, y] = s.o === 'v' ? [s.c + out * 0.4, t] : [t, s.c + out * 0.4];
      H = Math.max(H, groundAt(p, x, y, zones) - floor);
    }
    const conc = assemblyOf(p, w).layers.find((l) => /concrete/i.test(l.material))?.t ?? w.props.thickness;
    const tNeed = Math.max(0.2, H / 10);
    const u = tNeed / conc;
    out.push({ wall: w, H, tNeed, tHas: conc, base: 0.6 * H, check: { util: u, status: statusOf(u), governing: `stem ≈ H/10 = ${tNeed.toFixed(2)} m (min 0.20) for ${H.toFixed(2)} m of soil; has ${conc.toFixed(2)} m` } });
  }
  return out;
}

function lintels(p: Project): Lintel[] {
  const out: Lintel[] = [];
  for (const o of p.elements) {
    if (o.type !== 'Opening' || o.props.width <= 1.2 + 1e-9) continue;
    const w = p.elements.find((e): e is Wall => e.type === 'Wall' && e.id === o.props.host);
    if (!w || w.props.wallType === 'retaining') continue;
    const masonry = assemblyOf(p, w).layers.some((l) => /block/i.test(l.material));
    out.push({ opening: o, wall: w, span: o.props.width, kind: masonry ? 'concrete lintel' : 'steel header', depth: Math.round(Math.max(0.1, Math.ceil((o.props.width / 10) / 0.05 - 1e-9) * 0.05) * 100) / 100 });
  }
  return out;
}

function wind(p: Project) {
  const Vk = A(p, 'v0') * A(p, 's2');
  const q = (0.613 * Vk * Vk) / 1000; // kN/m²
  const h = Math.max(...p.levels.map((l) => l.elevation)) + 0.3 - 0; // to the parapet, from the street
  const xs = p.levels.filter((l) => l.outline).map((l) => l.outline!);
  const wx = Math.max(...xs.map((o) => o.x1)) - Math.min(...xs.map((o) => o.x0));
  const wy = Math.max(...xs.map((o) => o.y1)) - Math.min(...xs.map((o) => o.y0));
  // wind along y hits the street facade (width wx); along x it hits the side facades (width wy)
  return { q, Vk, Fy: q * 1.2 * wx * h, Fx: q * 1.2 * wy * h };
}

/** Proposed braced bays: per storey and direction, the bays between two columns with the least window, far apart. */
function bracing(p: Project): Bracing[] {
  const out: Bracing[] = [];
  const cols = p.elements.filter((c): c is Column => c.type === 'Column' && isHouse(c) && c.props.kind === 'column');
  for (const lv of p.levels) {
    if (!lv.plan || !lv.outline) continue;
    const z0 = lv.elevation, z1 = z0 + 1.5;
    const here = cols.filter((c) => c.props.baseElevation < z1 && c.props.topElevation > z0 + 1);
    for (const dir of ['x', 'y'] as const) {
      // planes along x are the lines y = const
      const o: 'h' | 'v' = dir === 'x' ? 'h' : 'v';
      const lines = [...new Set(here.map((c) => (o === 'h' ? c.props.at[1] : c.props.at[0])))];
      const cands: Bracing[] = [];
      for (const ln of lines) {
        const on = here.filter((c) => eq(o === 'h' ? c.props.at[1] : c.props.at[0], ln)).map((c) => (o === 'h' ? c.props.at[0] : c.props.at[1])).sort((a, b) => a - b);
        for (let i = 0; i + 1 < on.length; i++) {
          const a = on[i]!, b = on[i + 1]!;
          let win = 0;
          for (const op of p.elements) {
            if (op.type !== 'Opening' || op.level !== lv.id) continue;
            const host = p.elements.find((w): w is Wall => w.type === 'Wall' && w.id === op.props.host);
            if (!host) continue;
            const s = openingSeg(op, host);
            if (s.o === o && eq(s.c, ln)) win += overlap1(s.a, s.b, a, b);
          }
          const wall = p.elements.some((w) => w.type === 'Wall' && w.level === lv.id && (() => { const s = wallSeg(w); return s.o === o && eq(s.c, ln) && overlap1(s.a, s.b, a, b) > 0.5 * (b - a); })());
          if (!wall) continue;
          const what = win < 0.05 ? 'X-bracing, no windows in the way' : win < 0.5 * (b - a) ? `K-bracing around ${win.toFixed(2)} m of windows` : `moment frame (${win.toFixed(2)} m of windows)`;
          cands.push({ storey: lv.shortName, dir, line: `${o === 'h' ? 'y' : 'x'} = ${ln.toFixed(2)}`, from: a, to: b, windows: win, text: what });
        }
      }
      cands.sort((u, v) => u.windows - v.windows || (v.to - v.from) - (u.to - u.from));
      const first = cands[0];
      if (!first) continue;
      out.push(first);
      // a second one on another line, for torsion
      const second = cands.find((c) => c.line !== first.line);
      if (second) out.push(second);
    }
  }
  return out;
}

function quantities(p: Project, beams: BeamResult[], columns: ColumnResult[], footings: FootingResult[]): Quantities {
  const kgOf = (name: string) => section(name)?.kg ?? 30;
  let steelBeamsKg = 0, steelColumnsKg = 0;
  for (const b of p.elements) {
    if (b.type === 'Beam') steelBeamsKg += kgOf(b.props.profile) * Math.hypot(b.props.end[0] - b.props.start[0], b.props.end[1] - b.props.start[1]);
    if (b.type === 'Column' && b.props.kind === 'column') steelColumnsKg += kgOf(b.props.profile) * (b.props.topElevation - b.props.baseElevation);
  }
  void beams; void columns;
  const steelKg = (steelBeamsKg + steelColumnsKg) * (1 + A(p, 'steelExtra') / 100);
  const floorArea = p.elements.reduce((a, s) => a + (s.type === 'Space' && isPlanLevel(p, s.level) ? s.props.cells.reduce((t, c) => t + (c.x1 - c.x0) * (c.y1 - c.y0), 0) : 0), 0);
  let fc = 0, form = 0, exc = 0;
  for (const f of p.elements) {
    if (f.type !== 'Footing') continue;
    const fr = footings.find((x) => x.footing.id === f.id);
    const r = f.props.rect, w = r.x1 - r.x0, l = r.y1 - r.y0;
    const [bw, bl, h] = fr ? [fr.B, fr.B, fr.h] : [w, l, f.props.depth];
    fc += bw * bl * h; form += 2 * (bw + bl) * h; exc += (bw + 0.6) * (bl + 0.6) * (h + 0.3);
  }
  let rc = 0, slabsC = 0;
  for (const w of p.elements) {
    if (w.type !== 'Wall' || w.props.wallType !== 'retaining') continue;
    const s = wallSeg(w), t = assemblyOf(p, w).layers.find((l) => /concrete/i.test(l.material))?.t ?? w.props.thickness;
    const fz = p.elements.find((f) => f.type === 'Footing' && f.props.carries === w.id);
    const base = fz?.type === 'Footing' ? fz.props.topElevation : elevOf(p, w.level);
    const h = elevOf(p, w.level) + w.props.height - base;
    rc += (s.b - s.a) * h * t; form += 2 * (s.b - s.a) * h;
  }
  for (const f of p.elements) if (f.type === 'Footing' && f.props.kind === 'strip') { const r = f.props.rect; fc += (r.x1 - r.x0) * (r.y1 - r.y0) * f.props.depth; }
  for (const s of p.elements) {
    if (s.type !== 'Slab') continue;
    const v = values(assemblyOf(p, s));
    const r = slabRect(p, s);
    const area = s.props.spaces
      ? p.elements.flatMap((x) => (x.type === 'Space' && s.props.spaces!.includes(x.id) ? x.props.cells : [])).reduce((a, c) => a + (c.x1 - c.x0) * (c.y1 - c.y0), 0)
      : (r.x1 - r.x0) * (r.y1 - r.y0);
    const voids = slabVoids(p, s).reduce((a, c) => a + (c.x1 - c.x0) * (c.y1 - c.y0), 0);
    slabsC += (area - voids) * v.concrete;
    form += 2 * ((r.x1 - r.x0) + (r.y1 - r.y0)) * s.props.thickness;
  }
  // the lower level is dug out of the slope: volume between the natural ground and the lower floor
  const ll = p.levels.find((l) => l.id === 'LL');
  const { natural } = siteFrame(p);
  if (ll?.outline) {
    const o = ll.outline;
    for (let x = o.x0 + 0.25; x < o.x1; x += 0.5) for (let y = o.y0 + 0.25; y < o.y1; y += 0.5) {
      const nat = natural(y);
      exc += Math.max(0, nat - (ll.elevation - 0.25)) * 0.25;
    }
  }
  const rebarKg = fc * A(p, 'rebarFooting') + rc * A(p, 'rebarWall') + slabsC * A(p, 'rebarSlab');
  return {
    steelKg, steelBeamsKg, steelColumnsKg, floorArea, steelPerM2: floorArea ? steelKg / floorArea : 0,
    concrete: { footings: fc, retaining: rc, slabs: slabsC, total: fc + rc + slabsC }, rebarKg, formwork: form, excavation: exc,
  };
}

export { rectOverlap, beamSeg };
