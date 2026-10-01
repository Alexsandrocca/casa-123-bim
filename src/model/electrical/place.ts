// Places the Version 3 electrical devices: NBR 5410 minimum points per room, the dedicated points of the brief,
// the overlay positions from plan-v2.json (panels, rack, air conditioners) and the 16 cameras.
import { mainCell, openingSegIn, q, spaceArea, spacesOn } from '../geometry';
import { boundarySegs } from '../importer';
import type { Device, Element, Fixture, Project, Space } from '../schema';
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
function nearestWallPoint(s: Space, at: P2): P2 {
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

export function placeV3Electrical(p: Project, overlays: Record<string, { elec: (string | number)[][] }>): Project {
  const devs: Device[] = [];
  const counter = new Map<string, number>();
  const add = (kind: string, level: string, at: P2, z: number, extra: Partial<Device['props']> = {}, name?: string): Device => {
    const n = (counter.get(kind) ?? 0) + 1;
    counter.set(kind, n);
    const t = deviceType(kind);
    const d: Device = {
      id: `dev-${kind}-${String(n).padStart(2, '0')}`, type: 'Device', level, tags: [],
      props: { kind, name: name ?? t.label, at: [q(at[0]), q(at[1])], z: q(z), power: t.power, ...extra },
    };
    devs.push(d);
    return d;
  };
  const anchor = (level: string, room: string, u: number, v: number): P2 | null => {
    const s = p.elements.find((e) => e.type === 'Space' && e.level === level && e.props.name === room);
    if (s?.type !== 'Space') return null;
    const c = s.props.cells[0]!;
    return [c.x0 + (c.x1 - c.x0) * u, c.y0 + (c.y1 - c.y0) * v];
  };
  const fixture = (kind: string) => p.elements.find((e): e is Fixture => e.type === 'Fixture' && e.props.kind === kind);
  const ceiling = (L: string) => elev(p, L) + p.structure.clearHeight - 0.05;

  // Rooms: lights, switches, outlets to the NBR 5410 minimums, network outlets, smoke detectors.
  for (const L of ['LL', 'SL', 'UF'] as const) {
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
      if (['Living', 'Studio · office', 'Bedroom 2', 'Bedroom 3', 'Master bedroom'].includes(s.props.name)) {
        const at = pointsOnWalls(p, s, 2)[1];
        if (at) add('network-outlet', L, at, e + 0.3, {}, `Network · ${s.props.name}`);
      }
      if (s.props.zone === 'circ') add('smoke-detector', L, [centre[0], centre[1] + 0.3], ceiling(L), {}, `Smoke detector · ${s.props.name}`);
    }
  }

  // Panels: main panel (street-level storage, from 02b), lower-level sub-panel (overlay), inverter next to the main panel.
  const ov = (L: string) => (overlays[L]?.elec ?? []) as [string, number, number, string, string?][];
  for (const [room, u, v, kind] of ov('LL')) {
    const at = anchor('LL', room, u, v);
    if (!at) continue;
    if (kind === 'panel') add('sub-panel', 'LL', [0.12, at[1]], elev(p, 'LL') + 1.5, { power: 0 }, 'Lower-level sub-panel');
    if (kind === 'rack') add('rack', 'LL', at, elev(p, 'LL') + 0.6);
  }
  add('inverter', 'SL', [1.88, 4.7], elev(p, 'SL') + 1.4);

  // Air conditioners from the overlay: indoor unit on the nearest wall, outdoor unit outside the nearest outer wall.
  for (const L of ['LL', 'SL', 'UF'] as const) {
    for (const [room, u, v, kind] of ov(L)) {
      if (kind !== 'ac') continue;
      const at = anchor(L, room, u, v);
      const s = p.elements.find((e): e is Space => e.type === 'Space' && e.level === L && e.props.name === room);
      if (!at || !s) continue;
      const wall = nearestWallPoint(s, at);
      add('ac-indoor', L, wall, elev(p, L) + 2.3, {}, `AC indoor · ${room}`);
      const lv = p.levels.find((l) => l.id === L)!.outline!;
      const sides: [number, P2][] = [[Math.abs(wall[0] - lv.x0), [lv.x0 - 0.45, wall[1]]], [Math.abs(lv.x1 - wall[0]), [lv.x1 + 0.45, wall[1]]], [Math.abs(wall[1] - lv.y0), [wall[0], lv.y0 - 0.45]], [Math.abs(lv.y1 - wall[1]), [wall[0], lv.y1 + 0.45]]];
      const outdoor = sides.sort((a, b) => a[0] - b[0])[0]![1];
      add('ac-outdoor', L, outdoor, elev(p, L) + 0.4, {}, `AC outdoor · ${room}`);
    }
  }

  // Dedicated points from the brief.
  const hob = anchor('SL', 'Kitchen', 0.5, 0.1), oven = anchor('SL', 'Kitchen', 0.25, 0.1);
  if (hob) add('hob', 'SL', hob, elev(p, 'SL') + 0.9);
  if (oven) add('oven', 'SL', oven, elev(p, 'SL') + 0.6);
  const dw = fixture('dishwasher'); if (dw) add('dishwasher', 'SL', dw.props.at, elev(p, 'SL') + 0.3);
  const wm = fixture('washer'); if (wm) add('washer-dryer', wm.level, wm.props.at, elev(p, wm.level) + 1.1);
  const hp = fixture('water-heater'); if (hp) add('heat-pump', hp.level, [hp.props.at[0] + 0.45, hp.props.at[1]], hp.props.z + 1.2);
  const pp = fixture('pressure-pump'); if (pp) add('pump-pressure', pp.level, [pp.props.at[0] + 0.3, pp.props.at[1]], pp.props.z + 0.3);
  const ls = fixture('lift-station'); if (ls) add('pump-lift', 'LL', [ls.props.at[0] + 0.5, ls.props.at[1]], elev(p, 'LL') + 0.6);
  const sp = fixture('sump-pump'); if (sp) add('pump-sump', 'LL', [sp.props.at[0], sp.props.at[1] - 0.5], sp.props.z + 0.6);

  // Exterior lighting and a LED strip in the living room.
  const SL = elev(p, 'SL'), LL = elev(p, 'LL');
  const slo = p.levels.find((l) => l.id === 'SL')!.outline!;
  add('wall-light', 'site', [1.4, slo.y0 - 0.08], SL + 2.2, {}, 'Wall light · front door');
  const carport = p.elements.find((e) => e.type === 'Carport');
  if (carport?.type === 'Carport') {
    const r = carport.props.rect;
    for (const x of [r.x0 + (r.x1 - r.x0) / 4, r.x0 + 3 * (r.x1 - r.x0) / 4]) add('ceiling-light', 'site', [x, (r.y0 + r.y1) / 2], carport.props.roofFront - 0.25, { power: 60 }, 'Light · carport');
  }
  for (const x of [2.0, 6.5]) add('wall-light', 'SL', [x, slo.y1 + 0.08], SL + 2.2, {}, 'Wall light · veranda');
  add('wall-light', 'LL', [5.0, 15.08], LL + 2.2, {}, 'Wall light · garden');
  for (const y of [3, 10]) add('wall-light', 'SL', [slo.x1 + 0.08, y], SL + 1.0, {}, 'Wall light · north ramp');
  const living = anchor('SL', 'Living', 0.5, 0.05);
  if (living) add('led-strip', 'SL', living, SL + 2.6, {}, 'LED strip · living');

  // Cameras: 16 × 4 MP at the brief's positions (bearing: 0 north, 90 east = street, 180 south, 270 west = garden) and the doorbell.
  const UF = elev(p, 'UF');
  const cams: [string, P2, number, number, string][] = [
    ['Street, south corner', [-1.3, -3.85], 2.6, 45, 'site'], ['Street, north corner', [11.9, -3.85], 2.6, 135, 'site'],
    ['Carport and patio', [8.55, -3.85], 2.4, 235, 'site'],
    ['Ramp, front', [8.75, 2.0], SL + 2.4, 280, 'SL'], ['Ramp, middle', [8.75, 8.0], SL + 2.4, 100, 'SL'], ['Ramp, garden end', [8.75, 14.8], LL + 2.4, 300, 'LL'],
    ['South passage, front', [-0.15, 1.5], SL + 2.4, 260, 'SL'], ['South passage, rear', [-0.15, 12.0], LL + 2.6, 80, 'LL'],
    ['Garden, south', [0.3, 15.12], LL + 2.5, 240, 'LL'], ['Garden, centre', [4.3, 15.12], LL + 2.5, 270, 'LL'], ['Garden, north', [8.3, 15.12], LL + 2.5, 300, 'LL'],
    ['Veranda', [4.3, 13.5], UF - 0.15, 270, 'SL'], ['Lower-level garden door', [3.0, 15.12], LL + 2.3, 230, 'LL'],
    ['Rear corner, south', [-1.3, 20.8], -1.0, 40, 'LL'], ['Rear corner, north', [12.9, 20.8], -1.0, 140, 'LL'],
    ['Lower-level hall', [3.0, 14.8], LL + 2.5, 200, 'LL'],
  ];
  for (const [name, at, z, bearing, level] of cams) add('camera', level, at, z, { bearing, tilt: 20, lensMm: 2.8 }, `Camera · ${name}`);
  add('doorbell', 'site', [2.1, slo.y0 - 0.06], SL + 1.5, { bearing: 90, tilt: 5, lensMm: 2.1 }, 'Video doorbell · front door');

  // The 02b devices keep their ids; give them their power and the street-level panel its name.
  const elements: Element[] = p.elements.map((e) => (e.type === 'Device' && e.props.kind === 'ev-charger' ? { ...e, props: { ...e.props, power: 7000 } } : e));
  return { ...p, elements: [...elements, ...devs] };
}

/** The 12 × 550 W array on the upper roof, 20° facing north, 0.5 m from the parapet. */
export function addSolar(p: Project): Project {
  const roof = p.elements.find((e) => e.id === 'roof-slab-01');
  if (roof?.type !== 'Slab' || !roof.props.rect) return p;
  const arr: Element = {
    id: 'pv-01', type: 'SolarArray', level: 'roof', tags: [],
    props: {
      name: 'PV array 12 × 550 W', modules: 12, moduleW: 550, moduleSize: [2.28, 1.13], tilt: 20, bearing: 0,
      area: roof.props.rect, setback: 0.5, roofTop: roof.props.topElevation, inverterKw: 6, batteryKwh: 0,
    },
  };
  return { ...p, elements: [...p.elements, arr] };
}
