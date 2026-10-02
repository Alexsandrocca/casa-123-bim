// Solar array: module layout on the roof (clear of tanks, pump and vents), shading with the sun model, energy estimate.
import { sunPosition } from '../../scene/sun';
import type { Fixture, Project, SolarArray } from '../schema';
import { kindOf } from '../plumbing/library';
import { axisOf, bearingDir, compassOf } from '../orientation';

export interface Module {
  x: number; y: number; z: number; /** footprint */ x0: number; x1: number; y0: number; y1: number; zTop: number;
  /** House plan direction the module faces (its low edge is on this side). */
  face: [number, number];
}
type Box = { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };

export const solarArray = (p: Project) => p.elements.find((e): e is SolarArray => e.type === 'SolarArray');

/**
 * The layout works in a frame where the modules face +u (u, v along the house axes): u is the house axis closest
 * to the array's bearing. Rectangles stay rectangles; everything is mapped back to house coordinates.
 */
function solarFrame(p: Project, a: SolarArray) {
  const { o, out } = axisOf(p, compassOf(p, ...bearingDir(p, a.props.bearing)));
  const to = (x: number, y: number): [number, number] => (o === 'v' ? [out * x, y] : [out * y, x]);
  const from = (u: number, v: number): [number, number] => (o === 'v' ? [out * u, v] : [v, out * u]);
  const rect = <R extends { x0: number; x1: number; y0: number; y1: number }>(r: R, f: (a: number, b: number) => [number, number]): R => {
    const [a0, b0] = f(r.x0, r.y0), [a1, b1] = f(r.x1, r.y1);
    return { ...r, x0: Math.min(a0, a1), x1: Math.max(a0, a1), y0: Math.min(b0, b1), y1: Math.max(b0, b1) };
  };
  return {
    toRect: <R extends { x0: number; x1: number; y0: number; y1: number }>(r: R) => rect(r, to),
    fromRect: <R extends { x0: number; x1: number; y0: number; y1: number }>(r: R) => rect(r, from),
    toDir: ([x, y, z]: [number, number, number]): [number, number, number] => [...to(x, y), z],
    face: from(1, 0),
  };
}

/** Sun height at noon on the winter solstice for the project's latitude. */
const winterNoonAltitude = (lat: number) => 90 - Math.abs(lat - (lat < 0 ? 23.44 : -23.44));
/** Height of the module frame's low edge above the roof. */
const STAND = 0.25;

/** Things on the roof the array must keep clear of (with 0.15 m around them). */
export function roofObstacles(p: Project, roofTop: number): Box[] {
  const out: Box[] = [];
  for (const f of p.elements) {
    if (f.type !== 'Fixture') continue;
    const t = kindOf(f.props.kind);
    const onRoof = Math.abs(f.props.z - roofTop) < 0.05;
    if (onRoof) {
      const [sx, sy, sz] = t.size;
      out.push({ x0: f.props.at[0] - sx / 2 - 0.15, x1: f.props.at[0] + sx / 2 + 0.15, y0: f.props.at[1] - sy / 2 - 0.15, y1: f.props.at[1] + sy / 2 + 0.15, z0: roofTop, z1: roofTop + sz });
    }
  }
  // vent terminals through the roof
  for (const v of p.elements) {
    if (v.type !== 'PipeSegment' || v.props.system !== 'vent') continue;
    const [x, y, z] = v.props.end;
    if (z > roofTop && v.props.start[2] < roofTop + 0.01 && Math.abs(v.props.start[0] - x) < 1e-6) out.push({ x0: x - 0.25, x1: x + 0.25, y0: y - 0.25, y1: y + 0.25, z0: roofTop, z1: z });
  }
  return out;
}

/** Lay modules out in rows facing the array's bearing, spaced so the row in front does not shade them at winter noon; keep the layout with most modules. */
export function layoutModules(p: Project, a: SolarArray = solarArray(p)!): Module[] {
  if (!a) return [];
  const sf = solarFrame(p, a);
  const [L, W] = a.props.moduleSize;
  const t = (a.props.tilt * Math.PI) / 180;
  const winterNoon = (winterNoonAltitude(p.site.lot.geo.lat) * Math.PI) / 180;
  const obstacles = roofObstacles(p, a.props.roofTop).map(sf.toRect);
  const ar = sf.toRect(a.props.area);
  const area = { x0: ar.x0 + a.props.setback, x1: ar.x1 - a.props.setback, y0: ar.y0 + a.props.setback, y1: ar.y1 - a.props.setback };
  let best: Module[] = [];
  for (const portrait of [true, false]) {
    const up = portrait ? L : W, across = portrait ? W : L;
    const depth = up * Math.cos(t), rise = up * Math.sin(t);
    const pitch = depth + rise / Math.tan(winterNoon);
    for (let ox = 0; ox < pitch; ox += 0.05) {
      for (let oy = 0; oy < across + 0.02; oy += 0.1) {
        const mods: Module[] = [];
        // rows from the edge the modules face backwards (u decreasing)
        for (let x1 = area.x1 - ox; x1 - depth >= area.x0 - 1e-9; x1 -= pitch) {
          for (let y0 = area.y0 + oy; y0 + across <= area.y1 + 1e-9; y0 += across + 0.02) {
            const m = { x0: x1 - depth, x1, y0, y1: y0 + across };
            if (obstacles.some((o) => o.x0 < m.x1 && o.x1 > m.x0 && o.y0 < m.y1 && o.y1 > m.y0)) continue;
            const z0 = a.props.roofTop + STAND;
            mods.push({ ...m, x: (m.x0 + m.x1) / 2, y: (m.y0 + m.y1) / 2, z: z0 + rise / 2, zTop: z0 + rise, face: sf.face });
          }
        }
        if (mods.length > best.length || (mods.length === best.length && mods.length && Math.max(...mods.map((m) => m.x1)) > Math.max(...best.map((m) => m.x1)))) best = mods;
        if (best.length >= a.props.modules && mods === best) break;
      }
    }
  }
  // keep the modules nearest the facing edge first
  return best.sort((m, n) => n.x - m.x || m.y - n.y).slice(0, a.props.modules).map((m) => {
    const r = sf.fromRect(m);
    return { ...r, x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 };
  });
}

/** Plan depth of a module along its slope (the side that goes up the slope, seen from above). */
export const moduleDepth = (m: Module) => (Math.abs(m.face[0]) > 0.5 ? m.x1 - m.x0 : m.y1 - m.y0);
/** Portrait or landscape: the side that goes up the slope. */
export function moduleUpSide(p: Project, m: Module): number {
  const a = solarArray(p)!;
  const t = (a.props.tilt * Math.PI) / 180;
  return moduleDepth(m) / Math.cos(t);
}

function rayHitsBox(o: [number, number, number], d: [number, number, number], b: Box): boolean {
  let tmin = 1e-4, tmax = 1e9;
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

/**
 * Share of the yearly sun the modules lose to shade: sample points on each module, hourly on the solstices and the equinox,
 * against the other modules, the parapet and the equipment on the roof. Weighted by the sun's height.
 */
export function shadingLoss(p: Project, mods: Module[] = layoutModules(p)): { loss: number; worst: string } {
  const a = solarArray(p);
  if (!a || !mods.length) return { loss: 0, worst: '' };
  const roof = p.elements.find((e) => e.type === 'Slab' && e.level === 'roof');
  const parapet = roof?.type === 'Slab' ? roof.props.parapet ?? 0 : 0;
  const sf = solarFrame(p, a);
  mods = mods.map((m) => ({ ...m, ...sf.toRect(m) }));
  const r = sf.toRect(a.props.area), top = a.props.roofTop;
  const occluders: Box[] = [
    ...roofObstacles(p, top).map(sf.toRect).map((o) => ({ ...o, x0: o.x0 + 0.15, x1: o.x1 - 0.15, y0: o.y0 + 0.15, y1: o.y1 - 0.15 })),
    { x0: r.x0 - 0.15, x1: r.x0, y0: r.y0, y1: r.y1, z0: top, z1: top + parapet }, { x0: r.x1, x1: r.x1 + 0.15, y0: r.y0, y1: r.y1, z0: top, z1: top + parapet },
    { x0: r.x0, x1: r.x1, y0: r.y0 - 0.15, y1: r.y0, z0: top, z1: top + parapet }, { x0: r.x0, x1: r.x1, y0: r.y1, y1: r.y1 + 0.15, z0: top, z1: top + parapet },
  ];
  const days: [number, number][] = [[6, 21], [12, 21], [3, 21], [9, 21]];
  let total = 0, shaded = 0;
  const byTime = new Map<string, number>();
  for (const [mo, day] of days) {
    for (let h = 7; h <= 17; h += 1) {
      const s0 = sunPosition(2026, mo, day, h, p);
      if (s0.altitude <= 5) continue;
      const s = { ...s0, dir: sf.toDir(s0.dir) };
      const w = Math.sin((s.altitude * Math.PI) / 180);
      for (const m of mods) {
        // each other module as four steps rising from its low edge (the side it faces) to its high edge
        const others: Box[] = mods.filter((o) => o !== m).flatMap((o) => [0, 1, 2, 3].map((k) => ({
          x0: o.x1 - (o.x1 - o.x0) * (k + 1) / 4, x1: o.x1 - (o.x1 - o.x0) * k / 4, y0: o.y0, y1: o.y1,
          z0: top + STAND, z1: top + STAND + (o.zTop - top - STAND) * (k + 1) / 4,
        })));
        for (const fx of [0.15, 0.5, 0.85]) for (const fy of [0.2, 0.8]) {
          // point on the tilted surface: low edge at u1, high edge at u0
          const x = m.x1 - (m.x1 - m.x0) * fx, y = m.y0 + (m.y1 - m.y0) * fy, z = top + STAND + (m.zTop - top - STAND) * fx + 0.01;
          total += w;
          if ([...others, ...occluders].some((b) => rayHitsBox([x, y, z], s.dir, b))) {
            shaded += w;
            const k = `${mo === 6 ? '21 Jun' : mo === 12 ? '21 Dec' : mo === 3 ? '21 Mar' : '21 Sep'} ${h}:00`;
            byTime.set(k, (byTime.get(k) ?? 0) + w);
          }
        }
      }
    }
  }
  const worst = [...byTime.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? '';
  return { loss: total ? shaded / total : 0, worst };
}

/** When the project has no yield for its place: a flat 1,350 kWh/kWp/year (a low Brazilian value), TO CONFIRM. */
export const GENERIC_YIELD = Array.from({ length: 12 }, () => 112.5);
/** Specific yield for the project's place, kWh per kWp per month (site.region.pvYield), or the generic one. */
export const yieldFor = (p: Project) => p.site.region.pvYield?.monthly ?? GENERIC_YIELD;
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function energyEstimate(p: Project) {
  const a = solarArray(p);
  if (!a) return null;
  const mods = layoutModules(p, a);
  const kwp = (mods.length * a.props.moduleW) / 1000;
  const { loss } = shadingLoss(p, mods);
  const monthly = yieldFor(p).map((y) => Math.round(y * kwp * (1 - loss)));
  return { kwp, placed: mods.length, monthly, year: monthly.reduce((x, y) => x + y, 0), loss, dcAc: kwp / a.props.inverterKw };
}

export const isRoofFixture = (f: Fixture, roofTop: number) => Math.abs(f.props.z - roofTop) < 0.05;
