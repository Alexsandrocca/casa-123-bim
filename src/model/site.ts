// The ground: lot, natural slope, the cut, the north ramp and the south passage.
// Everything is in house coordinates (x south→north, y street→rear, z up).
import type { Project, Rect } from './schema';

export type P2 = [number, number];
export interface GroundZone {
  id: string;
  name: string;
  /** Convex polygon, counter-clockwise. */
  poly: P2[];
  /** Height is linear in y: z = z0 + dzdy · (y − y0). */
  y0: number; z0: number; dzdy: number;
  surface: 'grass' | 'paving' | 'soil' | 'ramp';
}

export const RAMP_DEFAULT = { width: 4, slope: 0.125 };
export const EAVES_LIMIT_DEFAULT = 0.7;

export function siteFrame(p: Project) {
  const o = p.site.houseOrigin;
  const lot = p.site.lotPolygon.map(([x, y]) => [x - o.x, y - o.y] as P2);
  const yStreet = Math.min(...lot.map((c) => c[1]));
  const yRear = Math.max(...lot.map((c) => c[1]));
  const xSouth = Math.min(...lot.map((c) => c[0]));
  const [, nFront, nRear] = lot as [P2, P2, P2, P2];
  /** x of the north boundary at a given y. */
  const xNorth = (y: number) => nFront[0] + ((nRear[0] - nFront[0]) * (y - nFront[1])) / (nRear[1] - nFront[1]);
  const depth = yRear - yStreet;
  /** Natural ground before any work: 0.00 at the street, falling to −fall at the rear. */
  const natural = (y: number) => -p.site.fallStreetToRear * (y - yStreet) / depth;
  const house = houseRect(p);
  const garden = p.site.cut.gardenLevel;
  const ramp = p.site.ramp ?? RAMP_DEFAULT;
  const rampEndY = yStreet + (0 - garden) / ramp.slope;
  const passageEndY = p.site.cut.retainingSouthToY;
  return { lot, yStreet, yRear, xSouth, xNorth, natural, house, garden, ramp, rampEndY, passageEndY, cutY: p.site.cut.lineY };
}

export function houseRect(p: Project): Rect {
  const os = p.levels.filter((l) => l.plan && l.outline).map((l) => l.outline!);
  return {
    x0: Math.min(...os.map((o) => o.x0)), x1: Math.max(...os.map((o) => o.x1)),
    y0: Math.min(...os.map((o) => o.y0)), y1: Math.max(...os.map((o) => o.y1)),
  };
}

const quad = (x0: number, x1: (y: number) => number, ya: number, yb: number): P2[] =>
  [[x0, ya], [x1(ya), ya], [x1(yb), yb], [x0, yb]];

/** The finished ground as planar zones. */
export function groundZones(p: Project): GroundZone[] {
  const f = siteFrame(p);
  const { house: h, yStreet: ys, yRear: yr, xSouth: xs, xNorth: xn, garden, cutY } = f;
  const garageFloor = p.levels.find((l) => l.id === 'garage')?.elevation ?? 0.1;
  const garage = p.elements.find((e) => e.type === 'Space' && e.props.zone === 'garage');
  const gx0 = garage?.type === 'Space' ? Math.min(...garage.props.cells.map((c) => c.x0)) : h.x1;
  const nat = (id: string, name: string, poly: P2[], surface: GroundZone['surface']): GroundZone =>
    ({ id, name, poly, y0: ys, z0: 0, dzdy: f.natural(ys + 1), surface });
  const flat = (id: string, name: string, poly: P2[], z: number, surface: GroundZone['surface']): GroundZone =>
    ({ id, name, poly, y0: 0, z0: z, dzdy: 0, surface });
  const carport = p.elements.find((e) => e.type === 'Carport');
  const front: GroundZone[] = carport?.type === 'Carport'
    ? [
      // Version 3: pedestrian path along the south side of the carport, carport pad falling 2 % to the street.
      nat('front', 'Entry path', quad(h.x0, () => carport.props.rect.x0, ys, h.y0), 'paving'),
      { id: 'carport', name: 'Carport paving', poly: quad(carport.props.rect.x0, () => h.x1, ys, h.y0), y0: ys, z0: 0, dzdy: 0.02, surface: 'paving' },
    ]
    : [
      nat('front', 'Front garden and entry path', quad(h.x0, () => gx0, ys, h.y0), 'grass'),
      { id: 'drive', name: 'Driveway', poly: quad(gx0, () => h.x1, ys, h.y0), y0: ys, z0: 0, dzdy: garageFloor / (h.y0 - ys), surface: 'paving' },
    ];
  const zones: GroundZone[] = [
    ...front,
    nat('crawl', 'Ground under the raised floor (crawlspace)', quad(h.x0, () => h.x1, h.y0, cutY), 'soil'),
    {
      id: 'passage', name: 'South side passage', poly: quad(xs, () => h.x0, ys, f.passageEndY),
      y0: ys, z0: 0, dzdy: garden / (f.passageEndY - ys), surface: 'paving',
    },
    {
      id: 'ramp', name: 'North walking ramp', poly: quad(h.x1, xn, ys, f.rampEndY),
      y0: ys, z0: 0, dzdy: -f.ramp.slope, surface: 'ramp',
    },
    flat('garden', 'Garden', quad(h.x0, () => h.x1, cutY, yr), garden, 'grass'),
    flat('garden-s', 'Garden (south)', quad(xs, () => h.x0, f.passageEndY, yr), garden, 'grass'),
    flat('garden-n', 'Garden (north)', quad(h.x1, xn, f.rampEndY, yr), garden, 'grass'),
  ];
  return zones.filter((z) => polyArea(z.poly) > 1e-6);
}

const polyArea = (poly: P2[]) => Math.abs(poly.reduce((a, [x, y], i) => { const [u, v] = poly[(i + 1) % poly.length]!; return a + x * v - u * y; }, 0)) / 2;

export const zoneZ = (z: GroundZone, y: number) => z.z0 + z.dzdy * (y - z.y0);

export function inPoly(x: number, y: number, poly: P2[], eps = 1e-6): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i]!, [bx, by] = poly[(i + 1) % poly.length]!;
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (Math.abs(cross) < eps) continue;
    const s = Math.sign(cross);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

/** Finished ground height at a point, or the natural ground outside the lot. */
export function groundAt(p: Project, x: number, y: number, zones = groundZones(p)): number {
  let best: number | undefined;
  for (const z of zones) if (inPoly(x, y, z.poly)) best = Math.max(best ?? -Infinity, zoneZ(z, y));
  return best ?? siteFrame(p).natural(y);
}
