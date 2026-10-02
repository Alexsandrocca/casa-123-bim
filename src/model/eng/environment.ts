// Environmental principle checks (spec 08), as estimates: cross-ventilation, openable area, sun on glass, daylight,
// and the energy card for water heating and solar.
import { isOpen, openingSeg, sharedEdges, spaceArea } from '../geometry';
import { isPlanLevel, type Feature, type Opening, type Project, type Space, type Wall } from '../schema';
import { buildScene, type BoxPart } from '../../scene/build3d';
import { sunPosition } from '../../scene/sun';
import { energyEstimate } from '../electrical/solar';
import { A } from './assumptions';
import { facadeOf, outward } from './features';

type Side = 'N' | 'S' | 'E' | 'W' | 'roof';
/** Long-stay rooms (same rule as the window-ratio check). */
const needsDaylight = (s: Space) => ['private', 'social', 'work'].includes(s.props.zone) && s.props.name !== 'Closet';
interface Box { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; id: string }

/** Sliding windows and glass doors open about half their area. */
export const OPENABLE = 0.5;

const elevOf = (p: Project, id: string) => p.levels.find((l) => l.id === id)?.elevation ?? 0;
const edgeAt = (c: { x0: number; y0: number; x1: number; y1: number }, o: 'v' | 'h', v: number) => (o === 'v' ? Math.abs(c.x0 - v) < 1e-4 || Math.abs(c.x1 - v) < 1e-4 : Math.abs(c.y0 - v) < 1e-4 || Math.abs(c.y1 - v) < 1e-4);
const ov = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

interface RoomOpening { id: string; side: Side; glass: number; openable: number; label: string; op?: Opening; wall?: Wall }

/** Openings that serve a room: outside windows, glass doors, cobogós and opening skylights. */
export function roomOpenings(p: Project, s: Space): RoomOpening[] {
  const out: RoomOpening[] = [];
  const walls = new Map(p.elements.filter((e): e is Wall => e.type === 'Wall').map((w) => [w.id, w]));
  for (const op of p.elements) {
    if (op.type !== 'Opening' || op.level !== s.level) continue;
    const wall = walls.get(op.props.host);
    if (!wall) continue;
    const dir = outward(p, wall);
    if (!dir) continue;
    const g = openingSeg(op, wall);
    let len = 0;
    for (const c of s.props.cells) if (edgeAt(c, g.o, g.c)) len += g.o === 'v' ? ov(g.a, g.b, c.y0, c.y1) : ov(g.a, g.b, c.x0, c.x1);
    if (len <= 0.01) continue;
    const glazed = op.props.role === 'window' || op.props.kind === 'slider' || op.tags.includes('glazed');
    if (!glazed) continue;
    const area = len * op.props.height;
    out.push({ id: op.id, side: facadeOf(p, g.o, dir), glass: op.props.role === 'window' ? area : 0, openable: area * OPENABLE, label: op.props.kind === 'slider' ? 'glass door' : 'window', op, wall });
  }
  for (const f of p.elements) {
    if (f.type !== 'Feature') continue;
    if (f.props.kind === 'cobogo') {
      const wall = walls.get(f.props.host ?? '');
      if (!wall || wall.level !== s.level) continue;
      const g = { ...openingLike(wall, f) }, dir = outward(p, wall);
      if (!dir) continue;
      let len = 0;
      for (const c of s.props.cells) if (edgeAt(c, g.o, g.c)) len += g.o === 'v' ? ov(g.a, g.b, c.y0, c.y1) : ov(g.a, g.b, c.x0, c.x1);
      if (len > 0.01) out.push({ id: f.id, side: facadeOf(p, g.o, dir), glass: 0, openable: len * (f.props.height ?? 2.1) * (Number(f.props.params.open ?? 50) / 100), label: 'cobogó' });
    }
    if (f.props.kind === 'skylight' && f.props.rect) {
      const r = f.props.rect;
      const z = elevOf(p, s.level);
      if ((f.props.z ?? 0) < z + 1 || (f.props.z ?? 0) > z + 4.5) continue;
      const a = s.props.cells.reduce((t, c) => t + ov(r.x0, r.x1, c.x0, c.x1) * ov(r.y0, r.y1, c.y0, c.y1), 0);
      if (a > 0.05) out.push({ id: f.id, side: 'roof', glass: 0, openable: f.props.params.opening === true ? a * OPENABLE : 0, label: 'skylight' });
    }
  }
  return out;
}

function openingLike(w: Wall, f: Feature) {
  const [sx, sy] = w.props.start, [ex, ey] = w.props.end;
  const v = Math.abs(sx - ex) < 1e-6;
  const a0 = v ? Math.min(sy, ey) : Math.min(sx, ex);
  const a = a0 + (f.props.offset ?? 0);
  return { o: (v ? 'v' : 'h') as 'v' | 'h', c: v ? sx : sy, a, b: a + (f.props.width ?? 1.2) };
}

/* ---------------- ventilation ---------------- */

export interface VentRow { room: Space; sides: Side[]; via?: string; status: 'pass' | 'warn'; text: string; openable: number; need: number; areaOk: boolean }

/** Rooms reached from this one through a door or an open-plan edge. */
function neighbours(p: Project, s: Space): Space[] {
  const rooms = p.elements.filter((e): e is Space => e.type === 'Space' && e.level === s.level && e.id !== s.id);
  const out = new Set<Space>();
  for (const r of rooms) {
    for (const c of s.props.cells) for (const d of r.props.cells) {
      for (const e of sharedEdges(c, d)) {
        if (isOpen(s.props.zone, r.props.zone)) out.add(r);
        for (const op of p.elements) {
          if (op.type !== 'Opening' || op.level !== s.level || op.props.role !== 'door') continue;
          const w = p.elements.find((x): x is Wall => x.type === 'Wall' && x.id === op.props.host);
          if (!w) continue;
          const g = openingSeg(op, w);
          if (g.o === e.o && Math.abs(g.c - e.c) < 1e-4 && ov(g.a, g.b, e.a, e.b) > 0.3) out.add(r);
        }
      }
    }
  }
  return [...out];
}

export function ventilation(p: Project): VentRow[] {
  const out: VentRow[] = [];
  for (const s of p.elements) {
    if (s.type !== 'Space' || !isPlanLevel(p, s.level) || !needsDaylight(s)) continue;
    const own = roomOpenings(p, s);
    const sides = [...new Set(own.filter((o) => o.openable > 0).map((o) => o.side))];
    const openable = own.reduce((a, o) => a + o.openable, 0);
    const need = spaceArea(s) / 16;
    const areaOk = openable >= need - 0.005;
    if (sides.length >= 2) {
      out.push({ room: s, sides, status: 'pass', text: `openings on ${sides.join(' and ')}`, openable, need, areaOk });
      continue;
    }
    let via: string | undefined;
    for (const n of neighbours(p, s)) {
      const ns = roomOpenings(p, n).filter((o) => o.openable > 0).map((o) => o.side);
      const other = ns.find((x) => !sides.includes(x));
      if (sides.length && other) { via = `${n.props.name} (${other})`; break; }
    }
    out.push({
      room: s, sides, via, openable, need, areaOk,
      status: via ? 'pass' : 'warn',
      text: via ? `openings on ${sides.join('')}, through the door to ${via}` : sides.length ? `openings on ${sides.join('')} only: keep the door open to a room on another side, or add a high window, cobogó or opening skylight` : 'no opening to the outside',
    });
  }
  return out;
}

/* ---------------- sun on glass and daylight (ray casting against the 3D model) ---------------- */

const OCCLUDES = new Set(['wallExt', 'wallInt', 'wallWet', 'retaining', 'plinth', 'parapet', 'slab', 'roof', 'steel', 'concrete', 'deck', 'tank', 'equipment',
  'fBrise', 'fTimber', 'fConcrete', 'fPergola', 'fGreen', 'fPlanter', 'fShutter', 'fAwning', 'fEave', 'fGutter', 'fSolar', 'door', 'garageDoor', 'boundary']);

function occluders(p: Project): Box[] {
  return buildScene(p, { doorsOpen: false }).parts
    .filter((x): x is BoxPart => x.kind === 'box' && OCCLUDES.has(x.mat))
    .map((b) => {
      // rotated boxes (stair stringers, the carport roof) as their bounding box
      const ext = b.rx || b.rz ? [b.s[0], b.s[1] * Math.abs(Math.cos(b.rx ?? 0)) + b.s[2] * Math.abs(Math.sin(b.rx ?? 0)), b.s[2] * Math.abs(Math.cos(b.rx ?? 0)) + b.s[1] * Math.abs(Math.sin(b.rx ?? 0))] : b.s;
      return { x0: b.c[0] - ext[0]! / 2, x1: b.c[0] + ext[0]! / 2, y0: b.c[1] - ext[1]! / 2, y1: b.c[1] + ext[1]! / 2, z0: b.c[2] - ext[2]! / 2, z1: b.c[2] + ext[2]! / 2, id: b.id };
    });
}

function hits(o: [number, number, number], d: [number, number, number], b: Box): boolean {
  let tmin = 1e-4, tmax = 60;
  const lo = [b.x0, b.y0, b.z0], hi = [b.x1, b.y1, b.z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]!) < 1e-12) { if (o[i]! < lo[i]! || o[i]! > hi[i]!) return false; continue; }
    let t1 = (lo[i]! - o[i]!) / d[i]!, t2 = (hi[i]! - o[i]!) / d[i]!;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}

interface Glass { op: Opening; wall: Wall; side: Side; n: [number, number, number]; pts: [number, number, number][]; boxes: Box[] }

function glassPanes(p: Project, all: Box[]): Glass[] {
  const out: Glass[] = [];
  for (const op of p.elements) {
    if (op.type !== 'Opening' || !(op.props.role === 'window' || op.props.kind === 'slider' || op.tags.includes('glazed'))) continue;
    const wall = p.elements.find((e): e is Wall => e.type === 'Wall' && e.id === op.props.host);
    if (!wall) continue;
    const dir = outward(p, wall);
    if (!dir) continue;
    const g = openingSeg(op, wall), z0 = elevOf(p, op.level) + op.props.sill, z1 = z0 + op.props.height;
    const off = g.c + dir * (wall.props.thickness / 2 + 0.03);
    const pts: [number, number, number][] = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      const t = g.a + ((i + 0.5) * (g.b - g.a)) / 3, z = z0 + ((j + 0.5) * (z1 - z0)) / 2;
      pts.push(g.o === 'v' ? [off, t, z] : [t, off, z]);
    }
    const n: [number, number, number] = g.o === 'v' ? [dir, 0, 0] : [0, dir, 0];
    // only what stands in front of the glass can shade it
    const face = g.c + dir * (wall.props.thickness / 2);
    const boxes = all.filter((b) => b.id !== op.id && (g.o === 'v' ? (dir > 0 ? b.x1 > face + 0.005 : b.x0 < face - 0.005) : (dir > 0 ? b.y1 > face + 0.005 : b.y0 < face - 0.005)));
    out.push({ op, wall, side: facadeOf(p, g.o, dir), n, pts, boxes });
  }
  return out;
}

export interface SunRow { op: Opening; side: Side; dec: number; jun: number; shading: string[]; status: 'pass' | 'warn'; text: string }

/** Hours of direct sun on each pane, 21 Dec and 21 Jun, every half hour, with all shading in the model. */
export function sunOnGlass(p: Project, panes: Glass[] = glassPanes(p, occluders(p))): SunRow[] {
  const times: { m: number; h: number; dir: [number, number, number] }[] = [];
  for (const m of [12, 6]) for (let h = 5.5; h <= 19; h += 0.5) {
    const s = sunPosition(2026, m, 21, h, p);
    if (s.altitude > 1) times.push({ m, h, dir: s.dir });
  }
  const out: SunRow[] = [];
  for (const g of panes) {
    let dec = 0, jun = 0;
    for (const t of times) {
      if (g.n[0] * t.dir[0] + g.n[1] * t.dir[1] <= 0.02) continue;
      const lit = g.pts.filter((pt) => !g.boxes.some((b) => hits(pt, t.dir, b))).length / g.pts.length;
      if (t.m === 12) dec += lit * 0.5; else jun += lit * 0.5;
    }
    const shading = p.elements.filter((e): e is Feature => e.type === 'Feature' && e.props.host === g.op.id && ['brise', 'awning', 'shutters'].includes(e.props.kind)).map((f) => f.props.name);
    const west = g.side === 'W';
    const warn = west && dec > 2 + 1e-9;
    out.push({
      op: g.op, side: g.side, dec, jun, shading,
      status: warn ? 'warn' : 'pass',
      text: `${dec.toFixed(1)} h on 21 Dec, ${jun.toFixed(1)} h on 21 Jun · facing ${g.side}${shading.length ? ` · shaded by ${shading.join(', ')}` : ''}${warn ? ' · west glass without enough shading: add a brise, shutters or an eave' : ''}`,
    });
  }
  return out;
}

/* ---------------- daylight factor ---------------- */

export interface DaylightRow { room: Space; df: number; status: 'pass' | 'warn'; text: string }

/** Average daylight factor (BRE): DF = Σ(W·θ·T) / (A·(1 − R²)), θ the visible sky angle found by ray casting. */
export function daylight(p: Project, panes: Glass[] = glassPanes(p, occluders(p))): DaylightRow[] {
  const T = A(p, 'glassT'), R = A(p, 'reflectance');
  const out: DaylightRow[] = [];
  const rays: [number, number][] = [];
  for (const az of [-60, -30, 0, 30, 60]) for (let el = 5; el < 90; el += 10) rays.push([az, el]);
  for (const s of p.elements) {
    if (s.type !== 'Space' || !isPlanLevel(p, s.level) || !needsDaylight(s)) continue;
    const floor = spaceArea(s);
    const h = p.structure.clearHeight;
    // perimeter of the room: cell edges not shared with another cell of the same room
    let per = 0;
    for (const c of s.props.cells) {
      per += 2 * ((c.x1 - c.x0) + (c.y1 - c.y0));
      for (const d of s.props.cells) if (d !== c) for (const e of sharedEdges(c, d)) per -= e.b - e.a;
    }
    const Atot = 2 * floor + per * h;
    let sum = 0;
    for (const o of roomOpenings(p, s)) {
      if (o.side === 'roof') {
        const f = p.elements.find((e) => e.id === o.id);
        const r = f?.type === 'Feature' ? f.props.rect : undefined;
        if (r) sum += (r.x1 - r.x0) * (r.y1 - r.y0) * 0.8 * 180 * T;
        continue;
      }
      const g = panes.find((x) => x.op.id === o.id);
      if (!g || !o.glass && o.label !== 'glass door') continue;
      const c = g.pts.reduce((a, pt) => [a[0] + pt[0] / g.pts.length, a[1] + pt[1] / g.pts.length, a[2] + pt[2] / g.pts.length] as [number, number, number], [0, 0, 0] as [number, number, number]);
      const base = Math.atan2(g.n[1], g.n[0]);
      let free = 0;
      for (const [az, el] of rays) {
        const a = base + (az * Math.PI) / 180, e = (el * Math.PI) / 180;
        const d: [number, number, number] = [Math.cos(a) * Math.cos(e), Math.sin(a) * Math.cos(e), Math.sin(e)];
        if (!g.boxes.some((b) => hits(c, d, b))) free++;
      }
      const theta = (90 * free) / rays.length;
      const W = (o.op?.props.width ?? 0) * (o.op?.props.height ?? 0) * 0.8;
      sum += W * theta * T;
    }
    const df = Atot > 0 ? sum / (Atot * (1 - R * R)) : 0;
    out.push({ room: s, df, status: df >= 2 - 1e-9 ? 'pass' : 'warn', text: `average daylight factor ≈ ${df.toFixed(1)} % (target ≥ 2 %)` });
  }
  return out;
}

export interface EnvReport { ventilation: VentRow[]; sun: SunRow[]; daylight: DaylightRow[] }

export function environment(p: Project): EnvReport {
  const panes = glassPanes(p, occluders(p));
  return { ventilation: ventilation(p), sun: sunOnGlass(p, panes), daylight: daylight(p, panes) };
}

/* ---------------- energy card ---------------- */

export interface EnergyCard { demandKwh: number; heatPumpKwh: number; showerKwh: number; solarHeaterKwh: number | null; pvKwh: number | null; pvKwp: number | null; text: string[] }

export function energyCard(p: Project): EnergyCard {
  const people = A(p, 'people'), litres = A(p, 'hotWater'), cop = A(p, 'heatPumpCop');
  // heat 20 °C water to 45 °C (ΔT 25 K)
  const demandKwh = (people * litres * 4.186 * 25 * 365) / 3600;
  const heatPumpKwh = demandKwh / cop, showerKwh = demandKwh / 0.95;
  const solar = p.elements.some((e) => e.type === 'Feature' && e.props.kind === 'solar-heater');
  // a solar heater covers part of the year's hot water (share for the place in site.region); the rest is electric backup
  const share = p.site.region.solarHeaterShare;
  const solarHeaterKwh = solar && share !== null ? (demandKwh * (1 - share)) / 0.95 : null;
  const pv = energyEstimate(p);
  return {
    demandKwh, heatPumpKwh, showerKwh, solarHeaterKwh, pvKwh: pv?.year ?? null, pvKwp: pv?.kwp ?? null,
    text: [
      `Hot water for ${people} people × ${litres} L/day ≈ ${demandKwh.toFixed(0)} kWh of heat a year.`,
      `Heat pump (COP ${cop}): about ${heatPumpKwh.toFixed(0)} kWh of electricity a year, against ${showerKwh.toFixed(0)} kWh with electric showers.`,
      ...(solarHeaterKwh !== null ? [`With the solar water heater (≈ ${Math.round((share ?? 0) * 100)} % solar): about ${solarHeaterKwh.toFixed(0)} kWh a year of electric backup.`] : []),
      ...(solar && share === null ? ['Solar water heater: the solar share for this city is TO CONFIRM.'] : []),
      ...(pv ? [`The ${pv.kwp.toFixed(1)} kWp PV array makes about ${pv.year.toFixed(0)} kWh a year (estimate).`] : []),
    ],
  };
}
