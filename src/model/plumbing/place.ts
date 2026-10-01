// Places the Version 3 plumbing fixtures from the prototype's overlays (plan-v2.json) and adds the equipment from the brief.
import { q } from '../geometry';
import type { Fixture, Project } from '../schema';
import { kindOf } from './library';
import { UTILITIES_DEFAULT, withPlumbing } from './route';

/** Overlay entries [room, u, v, kind]: u, v inside the room's first cell, as in the prototype. */
const OVERLAY_KIND: Record<string, string> = {
  wc: 'toilet', sink: 'basin', shower: 'shower', wm: 'washer', tank: 'laundry-tank', lift: 'lift-station', drain: 'floor-drain', stack: 'stack',
};

export function placeV3Plumbing(p: Project, overlays: Record<string, { plumb: [string, number, number, string][] }>): Project {
  const fx: Fixture[] = [];
  const add = (kind: string, level: string, at: [number, number], z: number, extra: Partial<Fixture['props']> = {}, tags: string[] = []) => {
    const n = fx.filter((f) => f.props.kind === kind).length + 1;
    fx.push({
      id: `fx-${kind}-${String(n).padStart(2, '0')}`, type: 'Fixture', level, tags,
      props: { kind, name: kindOf(kind).label, at: [q(at[0]), q(at[1])], z: q(z), ...extra },
    });
  };
  const elev = (l: string) => p.levels.find((x) => x.id === l)!.elevation;
  const anchor = (level: string, room: string, u: number, v: number): [number, number] | null => {
    const s = p.elements.find((e) => e.type === 'Space' && e.level === level && e.props.name === room);
    if (s?.type !== 'Space') return null;
    const c = s.props.cells[0]!;
    return [c.x0 + (c.x1 - c.x0) * u, c.y0 + (c.y1 - c.y0) * v];
  };
  for (const level of ['LL', 'SL', 'UF'] as const) {
    for (const [room, u, v, k] of overlays[level]?.plumb ?? []) {
      if (level === 'SL' && k === 'stack') continue; // the upper-floor stacks run through the street level
      const at = anchor(level, room, u, v);
      if (!at) continue; // e.g. the garage exit, gone in Version 3
      const kind = level === 'SL' && room === 'Kitchen' && k === 'sink' ? 'kitchen-sink' : OVERLAY_KIND[k] ?? k;
      add(kind, level, at, elev(level));
    }
  }
  // Basins in the upper bathrooms (not in the prototype overlay), dishwasher next to the kitchen sink.
  for (const room of ['Bath 2', 'Bath 3', 'Master bath']) { const at = anchor('UF', room, 0.2, 0.5); if (at) add('basin', 'UF', at, elev('UF')); }
  const dw = anchor('SL', 'Kitchen', 0.95, 0.15);
  if (dw) add('dishwasher', 'SL', dw, elev('SL'));
  // Sewage equipment
  add('grease-trap', 'SL', [7.4, 4.3], elev('SL'));
  add('backflow-valve', 'LL', [0.32, 12.75], elev('LL'));
  // Water: meter in the front boundary wall, two tanks over the stair, pressure pump, heat-pump water heater on the entry roof
  add('water-meter', 'site', [1.2, -3.85], 0.3);
  add('roof-tank', 'roof', [0.85, 10.3], elev('roof'));
  add('roof-tank', 'roof', [2.15, 10.3], elev('roof'));
  add('pressure-pump', 'roof', [2.9, 9.2], elev('roof'));
  add('water-heater', 'roof', [1.6, 3.0], elev('UF'));
  add('garden-tap', 'LL', [6.0, 15.2], p.site.cut.gardenLevel);
  // Rain: roof drains with their areas, cistern under the entry path, garden trench and sump pump
  const roof = p.elements.find((e) => e.id === 'roof-slab-01');
  const eaves = roof?.type === 'Slab' ? roof.props.eaves ?? 0 : 0;
  const mainArea = roof?.type === 'Slab' && roof.props.rect ? (roof.props.rect.x1 - roof.props.rect.x0 + 2 * eaves) * (roof.props.rect.y1 - roof.props.rect.y0 + 2 * eaves) : 0;
  add('roof-drain', 'roof', [0.3, 5.3], elev('roof'), { area: q(mainArea / 2) });
  add('roof-drain', 'roof', [8.3, 5.3], elev('roof'), { area: q(mainArea / 2) });
  const entry = p.elements.find((e) => e.id === 'UF-slab-02');
  if (entry?.type === 'Slab' && entry.props.rect) {
    const r = entry.props.rect;
    add('roof-drain', 'roof', [r.x0 + 0.3, r.y0 + 0.3], entry.props.topElevation, { area: q((r.x1 - r.x0) * (r.y1 - r.y0)) });
  }
  const carport = p.elements.find((e) => e.type === 'Carport');
  if (carport?.type === 'Carport') {
    const r = carport.props.rect;
    add('roof-drain', 'site', [r.x1 - 0.15, r.y0 + 0.05], carport.props.roofFront - 0.1, { area: q((r.x1 - r.x0 + 0.3) * (r.y1 - r.y0 + 0.3)) });
  }
  const veranda = p.elements.find((e) => e.type === 'Deck' && e.props.name === 'Veranda');
  if (veranda?.type === 'Deck') {
    const r = veranda.props.rect;
    add('roof-drain', 'SL', [r.x1 - 0.3, r.y1 - 0.3], veranda.props.elevation, { area: q((r.x1 - r.x0) * (r.y1 - r.y0)) }, ['to-garden']);
  }
  add('rain-cistern', 'site', [1.3, -2.6], 0.0);
  add('infiltration-trench', 'LL', [4.3, 19.0], p.site.cut.gardenLevel);
  add('sump-pump', 'LL', [8.0, 16.6], p.site.cut.gardenLevel);

  const withFx: Project = { ...p, site: { ...p.site, utilities: UTILITIES_DEFAULT }, elements: [...p.elements, ...fx] };
  return withPlumbing(withFx);
}
