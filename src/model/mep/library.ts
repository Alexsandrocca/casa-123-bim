// Spec 04b: how each fixture and device is held by the building, and the physical rules of the service spaces.
// Values marked "to verify" are design assumptions for the plumbing/electrical engineers.

/** wall = fixed to a wall face; ceiling = hangs from the slab or plenum above; floor = stands on the slab;
 *  equipment = needs a host zone and a maintenance clearance; site = outdoors on the ground, a post or the boundary wall;
 *  shaft = runs inside a shaft (soil stacks). */
export type Mount = 'wall' | 'ceiling' | 'floor' | 'equipment' | 'site' | 'shaft';

const FIXTURE_MOUNT: Record<string, Mount> = {
  toilet: 'wall', basin: 'wall', shower: 'floor', 'kitchen-sink': 'wall', 'laundry-tank': 'wall', washer: 'wall', dishwasher: 'wall',
  'floor-drain': 'floor', 'garden-tap': 'wall', stack: 'shaft', 'grease-trap': 'site', 'inspection-box': 'site', 'lift-station': 'floor',
  'backflow-valve': 'floor', 'water-meter': 'site', 'roof-tank': 'equipment', 'pressure-pump': 'equipment', 'water-heater': 'equipment',
  'roof-drain': 'floor', 'rain-cistern': 'site', 'infiltration-trench': 'site', 'sump-pump': 'site',
};
const DEVICE_MOUNT: Record<string, Mount> = {
  'ceiling-light': 'ceiling', 'smoke-detector': 'ceiling', 'led-strip': 'ceiling', rack: 'floor', battery: 'wall',
  'ac-outdoor': 'equipment', 'heat-pump': 'equipment', 'pump-pressure': 'equipment', 'pump-lift': 'wall', 'pump-sump': 'site',
  'ev-charger': 'site',
};
export const fixtureMount = (kind: string): Mount => FIXTURE_MOUNT[kind] ?? 'floor';
export const deviceMount = (kind: string): Mount => DEVICE_MOUNT[kind] ?? 'wall';

/** Maintenance clearance around equipment (x, y, z), m: the free box needed to service it (to verify with the suppliers). */
export const CLEARANCE: Record<string, [number, number, number]> = {
  'roof-tank': [1.75, 1.75, 1.6], 'pressure-pump': [1.05, 0.9, 0.8], 'water-heater': [1.45, 1.45, 2.2],
  'ac-outdoor': [1.1, 1.0, 0.9], 'lift-station': [1.2, 1.2, 1.8], 'rain-cistern': [2.0, 3.8, 1.6],
};

/** Rooms where an inverter, battery or rack may hang (ventilated, not bedrooms). */
export const EQUIPMENT_ROOMS = new Set(['service', 'circ', 'work']);

/** Largest pipe DN a wall can hold: its thickness minus 2 × 15 mm cover (spec 04b §1). */
export function wallMaxDn(thickness: number): number {
  const cavity = thickness - 0.03;
  if (cavity >= 0.165) return 100;
  if (cavity >= 0.115) return 75;
  if (cavity >= 0.085) return 50;
  return 40;
}
/** Outside diameter of a pipe, m (PVC series; close enough for clashes). */
export const outerD = (dn: number) => (dn >= 100 ? 0.11 : dn >= 75 ? 0.075 : dn >= 50 ? 0.05 : dn >= 40 ? 0.04 : dn / 1000 + 0.005);
/** Longest horizontal run inside a wall (NBR practice). */
export const WALL_RUN_MAX = 1.0;
/** Floor screed: conduits up to 25 mm only. */
export const SCREED = { depth: 0.05, maxConduit: 25 };
/** Default lowered-ceiling (forro) depth under a slab. */
export const PLENUM_DEPTH = 0.25;
/** Minimum clear heights (spec 04b §1): long-stay rooms, then wet rooms, halls and service rooms; a narrow bulkhead along a wall. */
export const CLEAR_HEIGHT = { living: 2.7, wet: 2.5, bulkhead: 2.2, bulkheadWidth: 0.6 };
/** Underground cover (spec 04b §1). */
export const COVER = { garden: 0.4, drive: 0.6, waterAboveSewage: 0.2 };
/** Electrical conduits keep this far from hot water and gas (project rule, to verify). */
export const ELEC_HOT_GAP = 0.2;
/** Web penetration: hole ≤ 0.4 × beam depth, in the middle third of the span. */
export const WEB_HOLE = 0.4;
/** Crawlspace: pipes stay at least this far above the ground. */
export const CRAWL_GAP = 0.15;
/** NBR 5410 §9.1: bathroom outlets stay out of volumes 1 and 2 (0.60 m beyond the shower). */
export const SHOWER_ZONE = 0.6;
/** Items stay this far from room corners. */
export const CORNER_GAP = 0.15;

/** Hanger spacing for horizontal pipes, m. PVC ≈ 10 × DN for small sizes (to verify with the manufacturer's table). */
export function hangerSpacing(material: string, dn: number, system: string): number {
  if (system === 'conduit') return 1.2;
  const base = Math.min(2.0, Math.max(0.5, (10 * dn) / 1000));
  return material === 'PVC' ? base : Math.max(0.5, base * 0.8);
}
