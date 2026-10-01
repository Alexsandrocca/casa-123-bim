// Architectural features (spec 08): placeable parametric elements. Each has its properties, its geometry (the same
// boxes feed the 3D view, the 2D symbol and the sun check), its weight on the structure, its cost and its effect on the checks.
import { eq, openingSeg, pointInRect, q, wallSeg } from '../geometry';
import type { Feature, FeatureKind, Opening, Project, Rect, Slab, Wall } from '../schema';
import { slabRect } from '../structure';

export interface Box3 { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; mat: FeatureMat }
export type FeatureMat = 'brise' | 'timber' | 'concreteScreen' | 'pergola' | 'cover' | 'greenRoof' | 'skyGlass' | 'planter' | 'gutter' | 'shutter' | 'awning' | 'solarHeater' | 'eave';

type Param = number | string | boolean;
export interface FeatureType {
  kind: FeatureKind;
  label: string;
  /** what it is placed on */
  host: 'window' | 'opening' | 'wall' | 'roof' | 'floor';
  hint: string;
  params: Record<string, Param>;
  /** choices for text params */
  choices?: Record<string, string[]>;
  /** units of number params */
  units?: Record<string, string>;
  effect: string;
}

export const FEATURE_TYPES: FeatureType[] = [
  { kind: 'brise', label: 'Brise-soleil', host: 'window', hint: 'Click a window.', params: { orientation: 'horizontal', depth: 0.4, spacing: 0.3, angle: 0, material: 'aluminium' }, choices: { orientation: ['horizontal', 'vertical'], material: ['aluminium', 'wood', 'concrete'] }, units: { depth: 'm', spacing: 'm', angle: '°' }, effect: 'Shades the window: the sun check counts it.' },
  { kind: 'pergola', label: 'Pergola', host: 'floor', hint: 'Click on the plan where it stands.', params: { height: 2.6, spacing: 0.5, cover: 'none' }, choices: { cover: ['none', 'glass', 'polycarbonate', 'vegetation'] }, units: { height: 'm', spacing: 'm' }, effect: 'Shades what is under it; a cover keeps the rain off.' },
  { kind: 'cobogo', label: 'Cobogó screen wall', host: 'wall', hint: 'Click an outside wall.', params: { pattern: 'square', open: 50 }, choices: { pattern: ['square', 'diamond', 'round'] }, units: { open: '%' }, effect: 'Counts as ventilation, not as window glass.' },
  { kind: 'skylight', label: 'Skylight', host: 'roof', hint: 'Click inside an upper-floor room (or on a roof in 3D).', params: { opening: true }, effect: 'Counts for daylight and, when it opens, for stack ventilation.' },
  { kind: 'eave', label: 'Eave / roof overhang', host: 'roof', hint: 'Click an outside wall under a roof edge.', params: { depth: 0.5 }, units: { depth: 'm' }, effect: 'Shades the windows below; the 0.70 m city limit is checked.' },
  { kind: 'green-roof', label: 'Green roof', host: 'roof', hint: 'Click on a roof (3D) or an upper-floor room.', params: { substrate: 0.1 }, units: { substrate: 'm' }, effect: 'Adds its saturated weight to the roof; keeps the roof cooler.' },
  { kind: 'planter', label: 'Facade planter', host: 'wall', hint: 'Click an outside wall.', params: { depth: 0.4, boxHeight: 0.4, mount: 0.9 }, units: { depth: 'm', boxHeight: 'm', mount: 'm above the floor' }, effect: 'Green on the facade; needs a drip line.' },
  { kind: 'gutter', label: 'Gutter and rain chain', host: 'roof', hint: 'Click an outside wall under a roof edge.', params: { chain: true }, effect: 'Takes the roof water to the ground at one end.' },
  { kind: 'shutters', label: 'Louvred shutters (venezianas)', host: 'window', hint: 'Click a bedroom window.', params: { material: 'aluminium', closed: false }, choices: { material: ['aluminium', 'wood'] }, effect: 'Shade and privacy; the sun check counts them only when closed.' },
  { kind: 'awning', label: 'Awning over a door', host: 'opening', hint: 'Click the front door (or any outside door).', params: { depth: 1.0, material: 'glass' }, choices: { material: ['glass', 'metal'] }, units: { depth: 'm' }, effect: 'Rain cover at the door; shades the glass below it.' },
  { kind: 'solar-heater', label: 'Solar water-heater panel', host: 'roof', hint: 'Click on a roof (3D) or an upper-floor room.', params: { area: 4, tank: 300 }, units: { area: 'm²', tank: 'L' }, effect: 'Option against the heat pump: see the energy card.' },
];
export const featureType = (k: string) => FEATURE_TYPES.find((t) => t.kind === k)!;

const num = (f: Feature, k: string, d = 0) => (typeof f.props.params[k] === 'number' ? (f.props.params[k] as number) : d);
const str = (f: Feature, k: string, d = '') => (typeof f.props.params[k] === 'string' ? (f.props.params[k] as string) : d);
const bool = (f: Feature, k: string) => f.props.params[k] === true;
const elevOf = (p: Project, id: string) => p.levels.find((l) => l.id === id)?.elevation ?? 0;

/** Which way is outside from a wall: +1 / −1 along its normal, or 0 for a wall inside the house. */
export function outward(p: Project, w: Wall): 1 | -1 | 0 {
  const s = wallSeg(w), m = (s.a + s.b) / 2;
  const inRoom = (x: number, y: number) => p.elements.some((e) => e.type === 'Space' && e.level === w.level && e.props.cells.some((c) => x > c.x0 && x < c.x1 && y > c.y0 && y < c.y1));
  const d = w.props.thickness / 2 + 0.05;
  const plus = s.o === 'v' ? inRoom(s.c + d, m) : inRoom(m, s.c + d);
  const minus = s.o === 'v' ? inRoom(s.c - d, m) : inRoom(m, s.c - d);
  if (plus && !minus) return -1;
  if (minus && !plus) return 1;
  return 0;
}

/** Compass side a wall faces (house x = north, y = west/garden, −y = east/street). */
export function facadeOf(o: 'v' | 'h', out: 1 | -1): 'N' | 'S' | 'E' | 'W' {
  return o === 'v' ? (out > 0 ? 'N' : 'S') : (out > 0 ? 'W' : 'E');
}

function hostOpening(p: Project, f: Feature): { op: Opening; wall: Wall } | null {
  const op = p.elements.find((e): e is Opening => e.type === 'Opening' && e.id === f.props.host);
  const wall = op && p.elements.find((e): e is Wall => e.type === 'Wall' && e.id === op.props.host);
  return op && wall ? { op, wall } : null;
}

/** A box sticking out of a wall face: along the wall from a to b, out from `from` to `to` (distances from the wall line), z0–z1. */
function outBox(o: 'v' | 'h', c: number, out: number, a: number, b: number, from: number, to: number, z0: number, z1: number, mat: FeatureMat): Box3 {
  const p0 = c + out * from, p1 = c + out * to;
  return o === 'v'
    ? { x0: Math.min(p0, p1), x1: Math.max(p0, p1), y0: a, y1: b, z0, z1, mat }
    : { x0: a, x1: b, y0: Math.min(p0, p1), y1: Math.max(p0, p1), z0, z1, mat };
}

/** The roof slab whose edge runs along a wall's line (eave and gutter hosts). */
export function roofEdgeFor(p: Project, w: Wall): { slab: Slab; side: 'N' | 'S' | 'E' | 'W' } | null {
  const s = wallSeg(w), out = outward(p, w);
  if (!out) return null;
  const top = elevOf(p, w.level) + w.props.height;
  let best: { slab: Slab; side: 'N' | 'S' | 'E' | 'W'; dz: number } | null = null;
  for (const sl of p.elements) {
    if (sl.type !== 'Slab' || sl.props.onGrade) continue;
    const r = slabRect(p, sl);
    const edge = s.o === 'v' ? (out > 0 ? r.x1 : r.x0) : (out > 0 ? r.y1 : r.y0);
    if (!eq(edge, s.c)) continue;
    const dz = Math.abs(sl.props.topElevation - sl.props.thickness - top);
    if (dz > 0.6) continue;
    if (!best || dz < best.dz) best = { slab: sl, side: facadeOf(s.o, out), dz };
  }
  return best;
}

/** The geometry of a feature, in house coordinates. */
export function featureBoxes(p: Project, f: Feature): Box3[] {
  const k = f.props.kind;
  if (k === 'brise' || k === 'shutters' || k === 'awning') {
    const h = hostOpening(p, f);
    if (!h) return [];
    const s = openingSeg(h.op, h.wall), out = outward(p, h.wall) || 1, floor = elevOf(p, h.op.level);
    const t = h.wall.props.thickness / 2;
    const z0 = floor + h.op.props.sill, z1 = z0 + h.op.props.height;
    if (k === 'awning') {
      const d = num(f, 'depth', 1);
      return [outBox(s.o, s.c, out, s.a - 0.2, s.b + 0.2, t, t + d, z1 + 0.15, z1 + 0.22, 'awning')];
    }
    if (k === 'shutters') {
      const w = (s.b - s.a) / 2;
      if (bool(f, 'closed')) return [outBox(s.o, s.c, out, s.a, s.b, t + 0.02, t + 0.06, z0, z1, 'shutter')];
      return [outBox(s.o, s.c, out, s.a - w, s.a, t + 0.02, t + 0.06, z0, z1, 'shutter'), outBox(s.o, s.c, out, s.b, s.b + w, t + 0.02, t + 0.06, z0, z1, 'shutter')];
    }
    const depth = num(f, 'depth', 0.4), sp = Math.max(0.08, num(f, 'spacing', 0.3)), ang = (num(f, 'angle', 0) * Math.PI) / 180;
    const mat: FeatureMat = str(f, 'material') === 'wood' ? 'timber' : str(f, 'material') === 'concrete' ? 'concreteScreen' : 'brise';
    const gap = 0.1, out0 = t + gap, reach = depth * Math.cos(ang), rise = Math.max(0.02, depth * Math.abs(Math.sin(ang)));
    const boxes: Box3[] = [];
    if (str(f, 'orientation', 'horizontal') === 'horizontal') {
      for (let z = z1; z > z0 - 1e-6; z -= sp) boxes.push(outBox(s.o, s.c, out, s.a - 0.1, s.b + 0.1, out0, out0 + reach, z - rise, z, mat));
    } else {
      const along = Math.max(0.03, depth * Math.abs(Math.sin(ang)));
      for (let a = s.a - 0.1; a < s.b + 0.1 + 1e-6; a += sp) boxes.push(outBox(s.o, s.c, out, a - along / 2, a + along / 2, out0, out0 + reach, z0 - 0.1, z1 + 0.1, mat));
    }
    return boxes;
  }
  if (k === 'cobogo' || k === 'planter') {
    const w = p.elements.find((e): e is Wall => e.type === 'Wall' && e.id === f.props.host);
    if (!w) return [];
    const s = wallSeg(w), out = outward(p, w) || 1, floor = elevOf(p, w.level);
    const a = s.a + (f.props.offset ?? 0), b = a + (f.props.width ?? 1.2);
    if (k === 'cobogo') return [outBox(s.o, s.c, out, a, b, -w.props.thickness / 2, w.props.thickness / 2, floor + (f.props.sill ?? 0), floor + (f.props.sill ?? 0) + (f.props.height ?? 2.1), 'concreteScreen')];
    const z0 = floor + num(f, 'mount', 0.9);
    return [outBox(s.o, s.c, out, a, b, w.props.thickness / 2, w.props.thickness / 2 + num(f, 'depth', 0.4), z0, z0 + num(f, 'boxHeight', 0.4), 'planter')];
  }
  if (k === 'eave' || k === 'gutter') {
    const sl = p.elements.find((e): e is Slab => e.type === 'Slab' && e.id === f.props.host);
    if (!sl || !f.props.side) return [];
    const r = slabRect(p, sl), e0 = sl.props.eaves ?? 0, top = sl.props.topElevation;
    const side = f.props.side;
    const o: 'v' | 'h' = side === 'N' || side === 'S' ? 'v' : 'h';
    const out = side === 'N' || side === 'W' ? 1 : -1;
    const c = o === 'v' ? (out > 0 ? r.x1 : r.x0) : (out > 0 ? r.y1 : r.y0);
    const [a, b] = o === 'v' ? [r.y0 - e0, r.y1 + e0] : [r.x0 - e0, r.x1 + e0];
    if (k === 'eave') return [outBox(o, c, out, a, b, e0, e0 + num(f, 'depth', 0.5), top - 0.12, top, 'eave')];
    const reach = e0 + featureEaves(p, sl, side);
    const boxes = [outBox(o, c, out, a, b, reach, reach + 0.15, top - 0.15, top, 'gutter')];
    if (bool(f, 'chain')) {
      const ground = Math.min(elevOf(p, 'SL'), top - 3);
      boxes.push(outBox(o, c, out, b - 0.25, b - 0.2, reach + 0.05, reach + 0.1, ground, top - 0.15, 'gutter'));
    }
    return boxes;
  }
  const r = f.props.rect;
  if (!r) return [];
  const z = f.props.z ?? 0;
  if (k === 'pergola') {
    const h = num(f, 'height', 2.6), sp = Math.max(0.2, num(f, 'spacing', 0.5));
    const boxes: Box3[] = [];
    for (const [x, y] of [[r.x0, r.y0], [r.x1, r.y0], [r.x0, r.y1], [r.x1, r.y1]] as [number, number][]) boxes.push({ x0: x - 0.06, x1: x + 0.06, y0: y - 0.06, y1: y + 0.06, z0: z, z1: z + h, mat: 'pergola' });
    for (const y of [r.y0, r.y1]) boxes.push({ x0: r.x0 - 0.2, x1: r.x1 + 0.2, y0: y - 0.05, y1: y + 0.05, z0: z + h - 0.2, z1: z + h, mat: 'pergola' });
    for (let x = r.x0; x <= r.x1 + 1e-6; x += sp) boxes.push({ x0: x - 0.03, x1: x + 0.03, y0: r.y0 - 0.2, y1: r.y1 + 0.2, z0: z + h, z1: z + h + 0.12, mat: 'pergola' });
    const cover = str(f, 'cover', 'none');
    if (cover !== 'none') boxes.push({ x0: r.x0 - 0.2, x1: r.x1 + 0.2, y0: r.y0 - 0.2, y1: r.y1 + 0.2, z0: z + h + 0.12, z1: z + h + 0.14, mat: cover === 'vegetation' ? 'greenRoof' : 'cover' });
    return boxes;
  }
  if (k === 'skylight') return [{ ...r, z0: z - 0.15, z1: z + 0.25, mat: 'skyGlass' }];
  if (k === 'green-roof') return [{ ...r, z0: z, z1: z + num(f, 'substrate', 0.1) + 0.04, mat: 'greenRoof' }];
  if (k === 'solar-heater') return [{ ...r, z0: z + 0.2, z1: z + 0.9, mat: 'solarHeater' }, { x0: r.x0, x1: r.x0 + 0.5, y0: r.y0, y1: r.y1, z0: z + 0.9, z1: z + 1.4, mat: 'solarHeater' }];
  return [];
}

/** Extra overhang an eave feature adds to one side of a roof. */
export function featureEaves(p: Project, sl: Slab, side: string): number {
  return p.elements.reduce((a, e) => (e.type === 'Feature' && e.props.kind === 'eave' && e.props.host === sl.id && e.props.side === side ? Math.max(a, num(e, 'depth', 0.5)) : a), 0);
}

/** Weights on the structure, as point loads on a 1 m grid (so they spread over the bays they cover). */
export function featureLoads(p: Project): { id: string; label: string; at: [number, number]; kN: number; how: string }[] {
  const out: { id: string; label: string; at: [number, number]; kN: number; how: string }[] = [];
  const spread = (f: Feature, r: Rect, kNm2: number, how: string) => {
    const nx = Math.max(1, Math.ceil(r.x1 - r.x0)), ny = Math.max(1, Math.ceil(r.y1 - r.y0));
    const each = (kNm2 * (r.x1 - r.x0) * (r.y1 - r.y0)) / (nx * ny);
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) out.push({ id: f.id, label: f.props.name, at: [r.x0 + ((i + 0.5) * (r.x1 - r.x0)) / nx, r.y0 + ((j + 0.5) * (r.y1 - r.y0)) / ny], kN: each, how });
  };
  for (const f of p.elements) {
    if (f.type !== 'Feature') continue;
    const r = f.props.rect;
    if (f.props.kind === 'green-roof' && r) spread(f, r, 14 * num(f, 'substrate', 0.1) + 0.25, `saturated substrate ${(num(f, 'substrate', 0.1) * 100).toFixed(0)} cm (1,400 kg/m³) + drainage`);
    if (f.props.kind === 'pergola' && r) spread(f, r, 0.25 + (str(f, 'cover') === 'glass' ? 0.3 : str(f, 'cover') === 'polycarbonate' ? 0.05 : str(f, 'cover') === 'vegetation' ? 0.15 : 0), 'timber or steel pergola with its cover');
    if (f.props.kind === 'solar-heater' && r) out.push({ id: f.id, label: f.props.name, at: [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2], kN: (num(f, 'area', 4) * 20 + num(f, 'tank', 300) + 60) * 0.00981, how: 'collectors 20 kg/m² + boiler full' });
  }
  return out;
}

/** Cost of a feature, R$, with how it was worked out. Typical values to update from suppliers or SINAPI-SP. */
export function featureCost(p: Project, f: Feature): { value: number; how: string } {
  const k = f.props.kind;
  const h = hostOpening(p, f);
  const winArea = h ? h.op.props.width * h.op.props.height : 0;
  const r = f.props.rect, area = r ? (r.x1 - r.x0) * (r.y1 - r.y0) : 0;
  const len = (() => {
    if (k !== 'eave' && k !== 'gutter') return 0;
    const sl = p.elements.find((e): e is Slab => e.type === 'Slab' && e.id === f.props.host);
    if (!sl) return 0;
    const rr = slabRect(p, sl);
    return f.props.side === 'N' || f.props.side === 'S' ? rr.y1 - rr.y0 : rr.x1 - rr.x0;
  })();
  switch (k) {
    case 'brise': { const u = { aluminium: 950, wood: 750, concrete: 650 }[str(f, 'material', 'aluminium')] ?? 950; return { value: u * (winArea + 0.4), how: `${(winArea + 0.4).toFixed(2)} m² × R$ ${u}/m²` }; }
    case 'shutters': { const u = str(f, 'material') === 'wood' ? 1100 : 850; return { value: u * winArea, how: `${winArea.toFixed(2)} m² × R$ ${u}/m²` }; }
    case 'awning': { const u = str(f, 'material') === 'metal' ? 700 : 1400; const a = h ? (h.op.props.width + 0.4) * num(f, 'depth', 1) : 0; return { value: u * a, how: `${a.toFixed(2)} m² × R$ ${u}/m²` }; }
    case 'pergola': { const u = 420 + ({ glass: 650, polycarbonate: 250, vegetation: 80 } as Record<string, number>)[str(f, 'cover', 'none')]! || 420; return { value: u * area, how: `${area.toFixed(2)} m² × R$ ${u}/m²` }; }
    case 'cobogo': { const a = (f.props.width ?? 1.2) * (f.props.height ?? 2.1); return { value: 380 * a, how: `${a.toFixed(2)} m² × R$ 380/m²` }; }
    case 'planter': { const l = f.props.width ?? 1.2; return { value: 900 * l + 350, how: `${l.toFixed(2)} m × R$ 900/m + drip line R$ 350` }; }
    case 'skylight': { const v = 3500 + 2500 * area + (bool(f, 'opening') ? 1800 : 0); return { value: v, how: `R$ 3,500 + ${area.toFixed(2)} m² × R$ 2,500${bool(f, 'opening') ? ' + opener R$ 1,800' : ''}` }; }
    case 'eave': return { value: 650 * len * Math.max(0.3, num(f, 'depth', 0.5)) / 0.5, how: `${len.toFixed(2)} m × R$ 650/m per 0.5 m of depth` };
    case 'gutter': return { value: 180 * len + (bool(f, 'chain') ? 450 : 0), how: `${len.toFixed(2)} m × R$ 180/m${bool(f, 'chain') ? ' + rain chain R$ 450' : ''}` };
    case 'green-roof': return { value: 320 * area, how: `${area.toFixed(2)} m² × R$ 320/m² (on top of the roof assembly)` };
    case 'solar-heater': return { value: 5500 + 1100 * num(f, 'area', 4), how: `boiler R$ 5,500 + ${num(f, 'area', 4)} m² × R$ 1,100` };
  }
  return { value: 0, how: '' };
}

/* ---------------- placing ---------------- */

export interface PlaceTarget { opening?: string; wall?: string; slab?: string; at?: [number, number]; level?: string }

const fid = (p: Project, kind: string) => {
  let n = 0;
  for (const e of p.elements) if (e.id.startsWith(`feat-${kind}-`)) n = Math.max(n, Number(e.id.slice(`feat-${kind}-`.length)) || 0);
  return `feat-${kind}-${String(n + 1).padStart(2, '0')}`;
};

/** The roof slab directly above a plan point on a level (the lowest suspended slab above it), or the slab itself. */
export function roofAbove(p: Project, level: string, at: [number, number]): Slab | undefined {
  const z = elevOf(p, level);
  return p.elements
    .filter((e): e is Slab => e.type === 'Slab' && !e.props.onGrade && e.props.topElevation > z + 0.5 && pointInRect(at[0], at[1], slabRect(p, e)))
    .sort((a, b) => a.props.topElevation - b.props.topElevation)[0];
}

/** A new feature of this kind for a click; a message when the place does not suit it. */
export function makeFeature(p: Project, kind: FeatureKind, t: PlaceTarget): Feature | string {
  const ft = featureType(kind);
  const base = { id: fid(p, kind), type: 'Feature' as const, tags: [] as string[], props: { kind, name: ft.label, params: { ...ft.params } } };
  if (ft.host === 'window' || ft.host === 'opening') {
    const op = p.elements.find((e): e is Opening => e.type === 'Opening' && e.id === t.opening);
    if (!op) return `${ft.hint}`;
    const wall = p.elements.find((e): e is Wall => e.type === 'Wall' && e.id === op.props.host);
    if (!wall || !outward(p, wall)) return `A ${ft.label.toLowerCase()} goes on an outside ${ft.host === 'window' ? 'window' : 'door or window'}.`;
    if (ft.host === 'window' && op.props.role !== 'window' && op.props.kind !== 'slider') return `${ft.label} goes on a window.`;
    if (p.elements.some((e) => e.type === 'Feature' && e.props.kind === kind && e.props.host === op.id)) return `That ${op.props.role} already has one.`;
    return { ...base, level: op.level, props: { ...base.props, host: op.id } };
  }
  if (kind === 'eave' || kind === 'gutter') {
    let slab: Slab | undefined, side: 'N' | 'S' | 'E' | 'W' | undefined;
    const wall = p.elements.find((e): e is Wall => e.type === 'Wall' && e.id === t.wall);
    if (wall) { const r = roofEdgeFor(p, wall); slab = r?.slab; side = r?.side; }
    if (!slab && t.slab && t.at) {
      slab = p.elements.find((e): e is Slab => e.type === 'Slab' && e.id === t.slab);
      if (slab) {
        const r = slabRect(p, slab), [x, y] = t.at;
        const d = { S: x - r.x0, N: r.x1 - x, E: y - r.y0, W: r.y1 - y } as const;
        side = (Object.keys(d) as ('N' | 'S' | 'E' | 'W')[]).reduce((a, b) => (d[b] < d[a] ? b : a));
      }
    }
    if (!slab || !side) return 'Click an outside wall that has a roof edge right above it (the top floor walls), or a roof in 3D.';
    return { ...base, level: slab.level, props: { ...base.props, host: slab.id, side } };
  }
  if (ft.host === 'wall') {
    const wall = p.elements.find((e): e is Wall => e.type === 'Wall' && e.id === t.wall);
    if (!wall || !outward(p, wall) || wall.props.wallType === 'retaining') return `${ft.label}: ${ft.hint}`;
    const s = wallSeg(wall), width = kind === 'cobogo' ? 1.2 : 1.2;
    const along = t.at ? (s.o === 'v' ? t.at[1] : t.at[0]) : (s.a + s.b) / 2;
    const offset = q(Math.min(Math.max(along - width / 2 - s.a, 0.1), s.b - s.a - width - 0.1));
    return { ...base, level: wall.level, props: { ...base.props, host: wall.id, offset, width, ...(kind === 'cobogo' ? { height: 2.1, sill: 0.1 } : {}) } };
  }
  if (ft.host === 'roof') {
    const slab = t.slab ? p.elements.find((e): e is Slab => e.type === 'Slab' && e.id === t.slab) : t.at && t.level ? roofAbove(p, t.level, t.at) : undefined;
    if (!slab || !t.at) return ft.hint;
    const r = slabRect(p, slab), [x, y] = t.at;
    if (kind === 'green-roof') {
      const inset = 0.6;
      return { ...base, level: slab.level, props: { ...base.props, host: slab.id, rect: { x0: r.x0 + inset, y0: r.y0 + inset, x1: r.x1 - inset, y1: r.y1 - inset }, z: slab.props.topElevation } };
    }
    const [w, d] = kind === 'skylight' ? [1.0, 1.0] : [2.0, 2.0];
    const cx = Math.min(Math.max(x, r.x0 + w / 2 + 0.3), r.x1 - w / 2 - 0.3), cy = Math.min(Math.max(y, r.y0 + d / 2 + 0.3), r.y1 - d / 2 - 0.3);
    return { ...base, level: slab.level, props: { ...base.props, host: slab.id, rect: { x0: q(cx - w / 2), y0: q(cy - d / 2), x1: q(cx + w / 2), y1: q(cy + d / 2) }, z: slab.props.topElevation } };
  }
  // pergola: on the floor of the clicked level (or the patio / the ground there)
  if (!t.at || !t.level) return ft.hint;
  const [x, y] = t.at, level = t.level, floor = elevOf(p, level);
  const z = p.elements.filter((e): e is Slab => e.type === 'Slab' && pointInRect(x, y, slabRect(p, e)) && e.props.topElevation <= floor + 0.05)
    .reduce((a, s) => Math.max(a, s.props.topElevation), -Infinity);
  return { ...base, level, props: { ...base.props, rect: { x0: q(x - 1.5), y0: q(y - 1.5), x1: q(x + 1.5), y1: q(y + 1.5) }, z: Number.isFinite(z) ? z : floor } };
}
