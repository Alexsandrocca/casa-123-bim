// Compass ↔ house coordinates. The house axes are fixed to the lot (y away from the street, x to the right when
// standing in the street); where north is comes from the project (site.lot.geo.xBearing), never from the code.
import type { Project } from './schema';

export type Compass = 'N' | 'E' | 'S' | 'W';
type Site = Pick<Project, 'site'>;

const rad = Math.PI / 180;
const norm = (b: number) => ((b % 360) + 360) % 360;

/** Unit plan vector (house x, y) of a compass bearing (0 north, 90 east). */
export function bearingDir(p: Site, bearing: number): [number, number] {
  const a = (p.site.lot.geo.xBearing - bearing) * rad;
  return [Math.cos(a), Math.sin(a)];
}

/** Compass bearing of a plan direction (house x, y). */
export const bearingOf = (p: Site, dx: number, dy: number) => norm(p.site.lot.geo.xBearing - Math.atan2(dy, dx) / rad);

/** The nearest compass point of a plan direction. */
export const compassOf = (p: Site, dx: number, dy: number): Compass => (['N', 'E', 'S', 'W'] as const)[Math.round(bearingOf(p, dx, dy) / 90) % 4]!;

/** The house direction (along an axis) that faces a compass point: the axis and its sign. */
export function axisOf(p: Site, c: Compass): { o: 'v' | 'h'; out: 1 | -1 } {
  const [x, y] = bearingDir(p, { N: 0, E: 90, S: 180, W: 270 }[c]);
  return Math.abs(x) >= Math.abs(y) ? { o: 'v', out: x > 0 ? 1 : -1 } : { o: 'h', out: y > 0 ? 1 : -1 };
}

/** East, north, up (a sun vector) → house x, y, z. */
export function enuToHouse(p: Site, [e, n, u]: [number, number, number]): [number, number, number] {
  const [ex, ey] = bearingDir(p, 90), [nx, ny] = bearingDir(p, 0);
  return [e * ex + n * nx, e * ey + n * ny, u];
}

/** The street side as a compass point (the −y side of the house). */
export const streetSide = (p: Site): Compass => compassOf(p, 0, -1);
