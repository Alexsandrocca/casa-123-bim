// Cameras: coverage of the lot (with blind spots), PoE budget and NVR storage.
import { pointInRect } from '../geometry';
import type { Device, Project, Rect } from '../schema';
import { bearingDir } from '../orientation';
import { inPoly, siteFrame } from '../site';
import { CAMERA_MBPS, CAMERA_POE_W, NVR, POE_SWITCH, cameraFov, cameraRange } from './library';

export const cameras = (p: Project) => p.elements.filter((e): e is Device => e.type === 'Device' && (e.props.kind === 'camera' || e.props.kind === 'doorbell'));


/** The house in plan: every room cell of every floor. */
const footprint = (p: Project): Rect[] => p.elements.flatMap((e) => (e.type === 'Space' ? e.props.cells : []));

function segHitsRect(ax: number, ay: number, bx: number, by: number, r: Rect): boolean {
  // Liang–Barsky clip of a segment against a rectangle
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  for (const [pp, qq] of [[-dx, ax - r.x0], [dx, r.x1 - ax], [-dy, ay - r.y0], [dy, r.y1 - ay]] as [number, number][]) {
    if (Math.abs(pp) < 1e-12) { if (qq < 0) return false; continue; }
    const t = qq / pp;
    if (pp < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return t1 - t0 > 0.02;
}

export interface Coverage { cell: number; total: number; covered: number; blind: [number, number][]; pct: number }

/** Covered share of the open lot (outside the house), on a 0.5 m grid. A camera sees within its range and angle, not through the house. */
export function coverage(p: Project, cell = 0.5): Coverage {
  const f = siteFrame(p);
  const rooms = footprint(p);
  const cams = cameras(p).filter((c) => !rooms.some((r) => pointInRect(c.props.at[0], c.props.at[1], r) && !(c.props.at[0] - r.x0 < 0.1 || r.x1 - c.props.at[0] < 0.1 || c.props.at[1] - r.y0 < 0.1 || r.y1 - c.props.at[1] < 0.1)));
  const blind: [number, number][] = [];
  let total = 0, covered = 0;
  const xs = f.lot.map((q) => q[0]), ys = f.lot.map((q) => q[1]);
  for (let x = Math.min(...xs) + cell / 2; x < Math.max(...xs); x += cell) {
    for (let y = Math.min(...ys) + cell / 2; y < Math.max(...ys); y += cell) {
      if (!inPoly(x, y, f.lot) || rooms.some((r) => pointInRect(x, y, r))) continue;
      total++;
      const seen = cams.some((c) => {
        const [cx, cy] = c.props.at;
        const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
        const lens = c.props.lensMm ?? 2.8;
        if (d > cameraRange(lens)) return false;
        const [ux, uy] = bearingDir(p, c.props.bearing ?? 0);
        const ang = (Math.acos(Math.max(-1, Math.min(1, (dx * ux + dy * uy) / Math.max(d, 1e-9)))) * 180) / Math.PI;
        if (d > 0.3 && ang > cameraFov(lens) / 2) return false;
        return !rooms.some((r) => !pointInRect(cx, cy, r) && segHitsRect(cx, cy, x, y, r));
      });
      if (seen) covered++; else blind.push([x, y]);
    }
  }
  return { cell, total, covered, blind, pct: total ? (covered / total) * 100 : 0 };
}

export function poeBudget(p: Project) {
  const n = cameras(p).length;
  const watts = n * CAMERA_POE_W;
  return { used: n, ports: POE_SWITCH.ports, watts, budgetW: POE_SWITCH.budgetW, ok: n <= POE_SWITCH.ports && watts <= POE_SWITCH.budgetW };
}

/** Days of continuous recording the NVR holds at 4 MP H.265. */
export function nvrDays(p: Project) {
  const n = cameras(p).filter((c) => c.props.kind === 'camera').length;
  const gbPerDay = (CAMERA_MBPS * 1e6 / 8 * 86400 / 1e9) * n;
  return { cameras: n, gbPerDay: Math.round(gbPerDay), days: gbPerDay ? (NVR.storageTB * 1000) / gbPerDay : Infinity, channelsOk: n <= NVR.channels, ...NVR };
}
