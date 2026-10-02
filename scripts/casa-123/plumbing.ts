// Casa 123 only (the app never imports this file; the results live in projects/casa-123/).
// Places the Version 3 plumbing fixtures from the prototype's overlays (plan-v2.json) and adds the equipment from the brief.
// The pipes are routed afterwards (withPlumbing), once the hosts and service spaces are in place.
import { q } from '../../src/model/geometry';
import type { Fixture, Project } from '../../src/model/schema';
import { kindOf } from '../../src/model/plumbing/library';
/** Casa 123 street services (SEMAE to confirm). */
const CASA_UTILITIES = { sewerDepth: 3.0, sewerOffset: 6.5, waterMainDepth: 1.5, rainIntensity: 150 };

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
      // spec 04b: the stacks run in shafts beside the wet wall (x 3.28–3.52), clear of the beam on grid line x 3.20
      if (kind === 'stack') { at[0] = 3.4; if (at[1] < 8) at[1] = 6.05; } // the front stack at the front of its shaft keeps the roof clear for the solar array
      // the laundry is under the stair (no ceiling to feed it from): washer and tank go on the wall shared with the hall
      if (kind === 'washer' || kind === 'laundry-tank') at[1] = 12.3;
      // the lift station stands clear of the stair foot and the walls, with room around its lid
      if (kind === 'lift-station') { at[0] = 0.75; at[1] = 13.2; }
      add(kind, level, at, elev(level));
    }
  }
  // Basins in the upper bathrooms (not in the prototype overlay), dishwasher next to the kitchen sink.
  for (const room of ['Bath 2', 'Bath 3', 'Master bath']) { const at = anchor('UF', room, 0.2, 0.5); if (at) add('basin', 'UF', at, elev('UF')); }
  const dw = anchor('SL', 'Kitchen', 0.95, 0.15);
  if (dw) add('dishwasher', 'SL', dw, elev('SL'));
  // Sewage equipment
  add('grease-trap', 'SL', [7.4, 4.3], elev('SL'));
  add('backflow-valve', 'LL', [1.35, 13.75], elev('LL'));
  // Water: meter in the front boundary wall, two tanks over the stair, pressure pump, heat-pump water heater on the entry roof
  add('water-meter', 'site', [1.2, -3.85], 0.3);
  // spec 04b: tanks and pump in the roof's south zone over the stair and service band (Q14); the north stays for the solar array
  add('roof-tank', 'roof', [1.0, 8.6], elev('roof'));
  add('roof-tank', 'roof', [1.0, 10.1], elev('roof'));
  add('pressure-pump', 'roof', [1.0, 11.45], elev('roof'));
  add('water-heater', 'roof', [1.6, 3.0], elev('UF'));
  // on the garden wall of the lower WC, beside its window, fed from the WC's lowered ceiling
  add('garden-tap', 'LL', [4.65, 15.25], p.site.cut.gardenLevel);
  // Rain: roof drains with their areas, cistern under the entry path, garden trench and sump pump
  const roof = p.elements.find((e) => e.id === 'roof-slab-01');
  const eaves = roof?.type === 'Slab' ? roof.props.eaves ?? 0 : 0;
  const mainArea = roof?.type === 'Slab' && roof.props.rect ? (roof.props.rect.x1 - roof.props.rect.x0 + 2 * eaves) * (roof.props.rect.y1 - roof.props.rect.y0 + 2 * eaves) : 0;
  // main roof: the screed falls south to two drains over the water shaft, in the equipment band; their downpipes run
  // in that shaft straight down to the crawlspace (the north of the roof stays free for the solar array)
  add('roof-drain', 'roof', [0.3, 5.92], elev('roof'), { area: q(mainArea / 2) });
  add('roof-drain', 'roof', [0.3, 6.07], elev('roof'), { area: q(mainArea / 2) });
  const entry = p.elements.find((e) => e.id === 'UF-slab-02');
  if (entry?.type === 'Slab' && entry.props.rect) {
    const r = entry.props.rect;
    add('roof-drain', 'roof', [r.x0 + 0.3, r.y0 + 0.3], entry.props.topElevation, { area: q((r.x1 - r.x0) * (r.y1 - r.y0)) });
  }
  const carport = p.elements.find((e) => e.type === 'Carport');
  if (carport?.type === 'Carport') {
    const r = carport.props.rect;
    add('roof-drain', 'site', [r.x1 - 0.3, r.y0 + 0.05], carport.props.roofFront - 0.1, { area: q((r.x1 - r.x0 + 0.3) * (r.y1 - r.y0 + 0.3)) });
  }
  const veranda = p.elements.find((e) => e.type === 'Deck' && e.props.name === 'Veranda');
  if (veranda?.type === 'Deck') {
    const r = veranda.props.rect;
    add('roof-drain', 'SL', [r.x1 - 0.3, r.y1 - 0.3], veranda.props.elevation, { area: q((r.x1 - r.x0) * (r.y1 - r.y0)) }, ['to-garden']);
  }
  // spec 04b: the cistern leaves the entry path for the front of the south passage, buried (lid on a riser to the paving)
  add('rain-cistern', 'site', [-0.75, -2.3], -1.5);
  add('infiltration-trench', 'LL', [4.3, 19.0], p.site.cut.gardenLevel);
  add('sump-pump', 'LL', [8.0, 16.6], p.site.cut.gardenLevel);

  const sv = p.site.lot.services, u = CASA_UTILITIES, est = (value: number, source: string) => ({ value, status: 'to-confirm' as const, source, date: '2026-10-02' });
  const services = { ...sv, sewer: { ...sv.sewer, depth: est(u.sewerDepth, 'Estimate, SEMAE to confirm'), offset: u.sewerOffset }, water: { ...sv.water, depth: est(u.waterMainDepth, 'Estimate') } };
  return { ...p, site: { ...p.site, lot: { ...p.site.lot, services }, region: { ...p.site.region, rainIntensity: u.rainIntensity } }, elements: [...p.elements, ...fx] };
}
