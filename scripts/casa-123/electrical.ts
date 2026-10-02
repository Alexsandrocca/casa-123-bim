// Casa 123 only: the Version 3 electrical devices: the rule points per room, the dedicated points of the brief,
// the overlay positions from plan-v2.json (panels, rack, air conditioners), the 16 cameras and the PV array.
// The app never imports this file; the results live in projects/casa-123/.
import type { Device, Element, Fixture, Project, Space } from '../../src/model/schema';
import { deviceMaker, nearestWallPoint, placeRoomPoints } from '../../src/model/electrical/place';

type P2 = [number, number];
const elev = (p: Project, l: string) => p.levels.find((x) => x.id === l)?.elevation ?? 0;

export function placeV3Electrical(p: Project, overlays: Record<string, { elec: (string | number)[][] }>): Project {
  const devs: Device[] = [];
  const add = deviceMaker(devs);
  const anchor = (level: string, room: string, u: number, v: number): P2 | null => {
    const s = p.elements.find((e) => e.type === 'Space' && e.level === level && e.props.name === room);
    if (s?.type !== 'Space') return null;
    const c = s.props.cells[0]!;
    return [c.x0 + (c.x1 - c.x0) * u, c.y0 + (c.y1 - c.y0) * v];
  };
  const fixture = (kind: string) => p.elements.find((e): e is Fixture => e.type === 'Fixture' && e.props.kind === kind);

  // Rooms: lights, switches, outlets to the NBR 5410 minimums, network outlets, smoke detectors.
  placeRoomPoints(p, add, (s) => ['Living', 'Studio · office', 'Bedroom 2', 'Bedroom 3', 'Master bedroom'].includes(s.props.name));

  // Panels: main panel (street-level storage, from 02b), lower-level sub-panel (overlay), inverter next to the main panel.
  const ov = (L: string) => (overlays[L]?.elec ?? []) as [string, number, number, string, string?][];
  for (const [room, u, v, kind] of ov('LL')) {
    const at = anchor('LL', room, u, v);
    if (!at) continue;
    // spec 04b: on the studio side of the studio/WC wall (no beam above it, a slab above for its ceiling conduits)
    if (kind === 'panel') add('sub-panel', 'LL', [4.2, 13.2], elev(p, 'LL') + 1.5, { power: 0 }, 'Lower-level sub-panel');
    if (kind === 'rack') add('rack', 'LL', at, elev(p, 'LL') + 0.6);
  }
  add('inverter', 'SL', [1.88, 4.7], elev(p, 'SL') + 1.4);

  // Air conditioners from the overlay: indoor unit on the nearest wall of the room; outdoor units (spec 04b) on the roof
  // zones: two in the main roof's equipment band, three on the entry roof, each with its service space and a roof drain.
  const condensers: [string, [number, number]][] = [['roof-tech', [1.1, 5.85]], ['roof-tech', [1.1, 7.0]], ['roof-entry', [0.65, 4.35]], ['roof-entry', [1.8, 4.35]], ['roof-entry', [2.45, 1.75]]];
  let ci = 0;
  for (const L of ['LL', 'SL', 'UF'] as const) {
    for (const [room, u, v, kind] of ov(L)) {
      if (kind !== 'ac') continue;
      const at = anchor(L, room, u, v);
      const s = p.elements.find((e): e is Space => e.type === 'Space' && e.level === L && e.props.name === room);
      if (!at || !s) continue;
      const wall = nearestWallPoint(s, at);
      add('ac-indoor', L, wall, elev(p, L) + 2.3, {}, `AC indoor · ${room}`);
      const [zoneId, xy] = condensers[ci++ % condensers.length]!;
      const zone = p.elements.find((e) => e.id === zoneId);
      const top = zone?.type === 'ServiceSpace' ? zone.props.z0 ?? elev(p, 'roof') : elev(p, 'roof');
      add('ac-outdoor', 'roof', xy, top + 0.3, { hostId: zoneId }, `AC outdoor · ${room}`);
    }
  }

  // Dedicated points from the brief.
  const hob = anchor('SL', 'Kitchen', 0.5, 0.1), oven = anchor('SL', 'Kitchen', 0.25, 0.1);
  if (hob) add('hob', 'SL', hob, elev(p, 'SL') + 0.9);
  if (oven) add('oven', 'SL', oven, elev(p, 'SL') + 0.6);
  const dw = fixture('dishwasher'); if (dw) add('dishwasher', 'SL', dw.props.at, elev(p, 'SL') + 0.3);
  const wm = fixture('washer'); if (wm) add('washer-dryer', wm.level, wm.props.at, elev(p, wm.level) + 1.1);
  // equipment points stand beside their equipment on the roof zones
  const hp = fixture('water-heater'); if (hp) add('heat-pump', hp.level, [hp.props.at[0], hp.props.at[1] - 0.45], hp.props.z + 0.5);
  const pp = fixture('pressure-pump'); if (pp) add('pump-pressure', pp.level, [pp.props.at[0] + 0.35, pp.props.at[1]], pp.props.z + 0.3);
  const ls = fixture('lift-station'); if (ls) add('pump-lift', 'LL', [ls.props.at[0] + 0.5, ls.props.at[1]], elev(p, 'LL') + 0.6);
  const sp = fixture('sump-pump'); if (sp) add('pump-sump', 'LL', [sp.props.at[0], sp.props.at[1] - 0.5], sp.props.z + 0.6);

  // Exterior lighting and a LED strip in the living room.
  const SL = elev(p, 'SL'), LL = elev(p, 'LL');
  const slo = p.levels.find((l) => l.id === 'SL')!.outline!;
  // (above the door head and its frame)
  add('wall-light', 'site', [1.4, slo.y0 - 0.08], SL + 2.4, {}, 'Wall light · front door');
  const carport = p.elements.find((e) => e.type === 'Carport');
  if (carport?.type === 'Carport') {
    const r = carport.props.rect;
    for (const x of [r.x0 + (r.x1 - r.x0) / 4, r.x0 + 3 * (r.x1 - r.x0) / 4]) add('ceiling-light', 'site', [x, (r.y0 + r.y1) / 2], carport.props.roofFront - 0.25, { power: 60 }, 'Light · carport');
  }
  // veranda: one light on the wall over the south window, one on the soffit of the upper floor (the slider is below)
  add('wall-light', 'SL', [2.0, slo.y1 + 0.08], SL + 2.4, {}, 'Wall light · veranda');
  add('ceiling-light', 'SL', [6.5, slo.y1 + 0.5], elev(p, 'UF') - 0.17, { power: 60 }, 'Light · veranda');
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
  // spec 04b: the array keeps the roof's north zone; tanks and equipment have the south band
  const zone = p.elements.find((e) => e.type === 'ServiceSpace' && e.props.kind === 'roof-zone' && e.props.purpose === 'pv');
  const area = zone?.type === 'ServiceSpace' ? zone.props.rect : roof.props.rect;
  const arr: Element = {
    id: 'pv-01', type: 'SolarArray', level: 'roof', tags: [],
    props: {
      name: 'PV array 12 × 550 W', modules: 12, moduleW: 550, moduleSize: [2.28, 1.13], tilt: 20, bearing: 0,
      area, setback: zone ? 0.3 : 0.5, roofTop: roof.props.topElevation, inverterKw: 6, batteryKwh: 0,
    },
  };
  return { ...p, elements: [...p.elements, arr] };
}
