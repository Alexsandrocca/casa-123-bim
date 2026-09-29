// Walk mode physics: stand on the highest floor within a step, and bump into walls.
import type { BoxPart, Scene3D, Surface } from './build3d';
import { floorAt } from './build3d';

export const EYE = 1.6;
export const STEP_UP = 0.4;
export const RADIUS = 0.22;

const OBSTACLE_MATS = new Set(['wallExt', 'wallInt', 'wallWet', 'retaining', 'plinth', 'parapet', 'guardGlass', 'rail', 'steel', 'concrete', 'boundary', 'frame']);

export interface WalkWorld { surfaces: Surface[]; obstacles: BoxPart[] }
export interface WalkState { x: number; y: number; foot: number }

export function walkWorld(scene: Scene3D): WalkWorld {
  const obstacles = scene.parts.filter((p): p is BoxPart => p.kind === 'box' && !p.rx && !p.rz && OBSTACLE_MATS.has(p.mat));
  return { surfaces: scene.surfaces, obstacles };
}

function blocked(w: WalkWorld, x: number, y: number, foot: number): boolean {
  const lo = foot + STEP_UP - 0.05, hi = foot + EYE + 0.15;
  for (const b of w.obstacles) {
    const [cx, cy, cz] = b.c, [sx, sy, sz] = b.s;
    if (cz + sz / 2 < lo || cz - sz / 2 > hi) continue;
    if (Math.abs(x - cx) < sx / 2 + RADIUS && Math.abs(y - cy) < sy / 2 + RADIUS) return true;
  }
  return false;
}

/** Try to move by (dx, dy). Slides along walls. Returns the new state (unchanged if fully blocked). */
export function walkStep(w: WalkWorld, s: WalkState, dx: number, dy: number): WalkState {
  const attempt = (nx: number, ny: number): WalkState | null => {
    const floor = floorAt(w.surfaces, nx, ny, s.foot + STEP_UP);
    if (floor === null) return null;
    if (blocked(w, nx, ny, floor)) return null;
    return { x: nx, y: ny, foot: floor };
  };
  return attempt(s.x + dx, s.y + dy) ?? attempt(s.x + dx, s.y) ?? attempt(s.x, s.y + dy) ?? s;
}

/** Where you land when you start walking at (x, y): the highest floor there. */
export function startAt(w: WalkWorld, x: number, y: number, from = 50): WalkState {
  return { x, y, foot: floorAt(w.surfaces, x, y, from) ?? 0 };
}

/** Walk towards each waypoint in 5 cm steps. Returns the path and whether every waypoint was reached. */
export function walkRoute(w: WalkWorld, start: WalkState, waypoints: [number, number][]): { path: WalkState[]; reached: boolean; stuckAt?: WalkState } {
  let s = start;
  const path = [s];
  for (const [tx, ty] of waypoints) {
    for (let i = 0; i < 2000; i++) {
      const d = Math.hypot(tx - s.x, ty - s.y);
      if (d < 0.06) break;
      const k = Math.min(0.05, d) / d;
      const n = walkStep(w, s, (tx - s.x) * k, (ty - s.y) * k);
      if (n === s) return { path, reached: false, stuckAt: s };
      s = n;
      path.push(s);
    }
    if (Math.hypot(tx - s.x, ty - s.y) > 0.1) return { path, reached: false, stuckAt: s };
  }
  return { path, reached: true };
}
