// Electrical points by rule (NBR 5410 minimums per room): lights, switches, outlets, network outlets, smoke detectors.
// Generic: any project. A project's own extra points (dedicated appliances, cameras…) are its data.
import { boundarySegs, mainCell, openingSegIn, q, spaceArea, spacesOn } from '../geometry';
import { planLevels, type Device, type Fixture, type Project, type Space } from '../schema';
import { deviceType, minLightingVA, minOutlets, outletVA, type RoomKind } from './library';

export function roomKind(s: Space): RoomKind {
  const { name, zone } = s.props;
  if (zone === 'stair' || zone === 'garage') return 'none';
  if (name === 'Kitchen') return 'kitchen';
  if (name === 'Laundry') return 'service';
  if (zone === 'wet') return 'bath';
  if (zone === 'circ') return 'circulation';
  return 'other';
}

export const roomPerimeter = (s: Space) => boundarySegs(s.props.cells).reduce((a, g) => a + (g.b - g.a), 0);

type P2 = [number, number];
const elev = (p: Project, l: string) => p.levels.find((x) => x.id === l)?.elevation ?? 0;

/** Points evenly spread along a room's walls, nudged off door openings, 6 cm inside the room. */
export function pointsOnWalls(p: Project, s: Space, n: number): P2[] {
  if (n <= 0) return [];
  const segs = boundarySegs(s.props.cells);
  const total = segs.reduce((a, g) => a + (g.b - g.a), 0);
  const doors = p.elements.flatMap((e) => (e.type === 'Opening' && e.level === s.level && e.props.role === 'door' ? [openingSegIn(p, e)] : [])).filter(Boolean);
  const inside = (x: number, y: number) => s.props.cells.some((c) => x > c.x0 && x < c.x1 && y > c.y0 && y < c.y1);
  const out: P2[] = [];
  for (let k = 0; k < n; k++) {
    let d = ((k + 0.5) / n) * total;
    for (let tries = 0; tries < 8; tries++) {
      let acc = 0, pt: P2 | null = null;
      for (const g of segs) {
        const L = g.b - g.a;
        if (d <= acc + L) {
          const t = g.a + (d - acc);
          const onDoor = doors.some((o) => o!.o === g.o && Math.abs(o!.c - g.c) < 1e-6 && t > o!.a - 0.15 && t < o!.b + 0.15);
          if (onDoor) break;
          const cand: P2[] = g.o === 'v' ? [[g.c + 0.06, t], [g.c - 0.06, t]] : [[t, g.c + 0.06], [t, g.c - 0.06]];
          pt = cand.find(([x, y]) => inside(x, y)) ?? null;
          break;
        }
        acc += L;
      }
      if (pt) { out.push([q(pt[0]), q(pt[1])]); break; }
      d = (d + 0.6) % total;
    }
  }
  return out;
}

/** Nearest point 6 cm inside the room from its walls, for a position (e.g. near a basin). */
export function nearestWallPoint(s: Space, at: P2): P2 {
  let best: P2 = at, bd = Infinity;
  for (const g of boundarySegs(s.props.cells)) {
    const t = Math.min(g.b, Math.max(g.a, g.o === 'v' ? at[1] : at[0]));
    for (const off of [0.06, -0.06]) {
      const pt: P2 = g.o === 'v' ? [g.c + off, t] : [t, g.c + off];
      if (!s.props.cells.some((c) => pt[0] > c.x0 && pt[0] < c.x1 && pt[1] > c.y0 && pt[1] < c.y1)) continue;
      const d = Math.hypot(pt[0] - at[0], pt[1] - at[1]);
      if (d < bd) { bd = d; best = pt; }
    }
  }
  return [q(best[0]), q(best[1])];
}

export type AddDevice = (kind: string, level: string, at: P2, z: number, extra?: Partial<Device['props']>, name?: string) => Device;

/** A device factory with ids dev-<kind>-01, -02… */
export function deviceMaker(out: Device[], start: Map<string, number> = new Map()): AddDevice {
  return (kind, level, at, z, extra = {}, name) => {
    const n = (start.get(kind) ?? 0) + 1;
    start.set(kind, n);
    const t = deviceType(kind);
    const d: Device = {
      id: `dev-${kind}-${String(n).padStart(2, '0')}`, type: 'Device', level, tags: [],
      props: { kind, name: name ?? t.label, at: [q(at[0]), q(at[1])], z: q(z), power: t.power, ...extra },
    };
    out.push(d);
    return d;
  };
}

const defaultNetwork = (s: Space) => ['social', 'private', 'work'].includes(s.props.zone);

/** Points every room needs by the rules, on every plan level. */
export function placeRoomPoints(p: Project, add: AddDevice, network: (s: Space) => boolean = defaultNetwork): void {
  const ceiling = (L: string) => elev(p, L) + p.structure.clearHeight - 0.05;
  // Rooms: lights, switches, outlets to the NBR 5410 minimums, network outlets, smoke detectors.
  for (const L of planLevels(p)) {
    for (const s of spacesOn(p, L)) {
      const kind = roomKind(s), area = spaceArea(s), e = elev(p, L);
      const c = mainCell(s);
      const centre: P2 = [(c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2];
      // lighting
      const va = s.props.zone === 'stair' ? 100 : minLightingVA(area);
      const nLights = area > 20 ? 2 : 1;
      for (let i = 0; i < nLights; i++) {
        const at: P2 = nLights === 1 ? centre : (c.x1 - c.x0 > c.y1 - c.y0 ? [c.x0 + (c.x1 - c.x0) * (i + 1) / 3, centre[1]] : [centre[0], c.y0 + (c.y1 - c.y0) * (i + 1) / 3]);
        add('ceiling-light', L, at, ceiling(L), { power: Math.ceil(va / nLights) }, `Ceiling light · ${s.props.name}`);
      }
      // switch beside the room's first door
      const door = p.elements.find((o) => o.type === 'Opening' && o.level === L && o.props.role === 'door' && (() => {
        const g = openingSegIn(p, o);
        return g && s.props.cells.some((cc) => (g.o === 'v' ? (Math.abs(cc.x0 - g.c) < 1e-6 || Math.abs(cc.x1 - g.c) < 1e-6) && g.a >= cc.y0 - 1e-6 && g.b <= cc.y1 + 1e-6 : (Math.abs(cc.y0 - g.c) < 1e-6 || Math.abs(cc.y1 - g.c) < 1e-6) && g.a >= cc.x0 - 1e-6 && g.b <= cc.x1 + 1e-6));
      })());
      if (kind !== 'none') {
        const g = door?.type === 'Opening' ? openingSegIn(p, door) : null;
        const at = g ? nearestWallPoint(s, g.o === 'v' ? [g.c, g.b + 0.15] : [g.b + 0.15, g.c]) : pointsOnWalls(p, s, 1)[0] ?? centre;
        add('switch', L, at, e + 1.1, {}, `Switch · ${s.props.name}`);
      }
      // outlets
      const n = minOutlets(kind, area, roomPerimeter(s));
      if (kind === 'bath') {
        const basin = p.elements.find((f): f is Fixture => f.type === 'Fixture' && f.level === L && f.props.kind === 'basin' && s.props.cells.some((cc) => f.props.at[0] > cc.x0 && f.props.at[0] < cc.x1 && f.props.at[1] > cc.y0 && f.props.at[1] < cc.y1));
        const at = basin ? nearestWallPoint(s, basin.props.at) : pointsOnWalls(p, s, 1)[0];
        if (at) add('outlet', L, at, e + 1.1, { power: 600 }, `Outlet · ${s.props.name} (basin)`);
      } else {
        pointsOnWalls(p, s, n).forEach((at, i) => {
          const bench = kind === 'kitchen' || kind === 'service';
          const va = outletVA(kind, i);
          add(va >= 600 ? 'outlet-20' : 'outlet', L, at, e + (bench && va >= 600 ? 1.1 : 0.3), { power: va }, `Outlet · ${s.props.name}`);
        });
      }
      if (network(s)) {
        const at = pointsOnWalls(p, s, 2)[1];
        if (at) add('network-outlet', L, at, e + 0.3, {}, `Network · ${s.props.name}`);
      }
      if (s.props.zone === 'circ') add('smoke-detector', L, [centre[0], centre[1] + 0.3], ceiling(L), {}, `Smoke detector · ${s.props.name}`);
    }
  }

}
