// Plumbing fixtures and equipment. Values for design only; the plumbing engineer confirms them.
// UHC = sewage fixture units (NBR 8160, table 3). Weight = water demand weight P (NBR 5626, annex A).

export type FixtureGroup = 'fixture' | 'sewage' | 'water' | 'rain';

export interface FixtureType {
  label: string;
  short: string;
  group: FixtureGroup;
  /** Drain: DN of the fixture branch and its fixture units. */
  drainDn?: number;
  uhc?: number;
  /** Water: weight P and whether it takes hot water too. */
  weight?: number;
  hot?: boolean;
  /** Height of the water outlet above the floor (pressure check). */
  supplyZ?: number;
  /** Size of the 3D box (x, y, z) and its height above (or, if negative, below) the fixture's z. */
  size: [number, number, number];
  zOffset?: number;
}

export const LIBRARY: Record<string, FixtureType> = {
  toilet: { label: 'Toilet (WC)', short: 'WC', group: 'fixture', drainDn: 100, uhc: 6, weight: 0.3, supplyZ: 0.3, size: [0.38, 0.65, 0.42] },
  basin: { label: 'Basin', short: 'B', group: 'fixture', drainDn: 40, uhc: 1, weight: 0.3, hot: true, supplyZ: 0.6, size: [0.5, 0.4, 0.85] },
  shower: { label: 'Shower drain', short: 'SH', group: 'fixture', drainDn: 40, uhc: 2, weight: 0.4, hot: true, supplyZ: 2.1, size: [0.8, 0.8, 0.03] },
  'kitchen-sink': { label: 'Kitchen sink', short: 'S', group: 'fixture', drainDn: 50, uhc: 3, weight: 0.7, hot: true, supplyZ: 0.6, size: [0.9, 0.55, 0.9] },
  'laundry-tank': { label: 'Laundry tank', short: 'T', group: 'fixture', drainDn: 40, uhc: 3, weight: 0.7, hot: true, supplyZ: 0.9, size: [0.6, 0.55, 0.9] },
  washer: { label: 'Washing machine', short: 'W', group: 'fixture', drainDn: 50, uhc: 3, weight: 1.0, supplyZ: 0.9, size: [0.6, 0.6, 0.85] },
  dishwasher: { label: 'Dishwasher', short: 'DW', group: 'fixture', drainDn: 50, uhc: 2, weight: 1.0, supplyZ: 0.5, size: [0.6, 0.6, 0.85] },
  'floor-drain': { label: 'Floor drain', short: 'FD', group: 'fixture', drainDn: 40, uhc: 1, size: [0.15, 0.15, 0.02] },
  'garden-tap': { label: 'Garden tap', short: 'GT', group: 'fixture', weight: 0.4, supplyZ: 0.6, size: [0.1, 0.1, 0.6] },
  stack: { label: 'Soil stack', short: 'TQ', group: 'sewage', size: [0.15, 0.15, 0.05] },
  'grease-trap': { label: 'Grease trap', short: 'CG', group: 'sewage', size: [0.6, 0.6, 0.6], zOffset: -0.6 },
  'inspection-box': { label: 'Inspection box', short: 'CI', group: 'sewage', size: [0.6, 0.6, 0.6], zOffset: -0.6 },
  'lift-station': { label: 'Lift station (sealed, pump, alarm, check valve)', short: 'LIFT', group: 'sewage', size: [0.8, 0.8, 1.2], zOffset: -1.2 },
  'backflow-valve': { label: 'Backflow valve', short: 'BV', group: 'sewage', size: [0.25, 0.25, 0.25] },
  'water-meter': { label: 'Water meter', short: 'M', group: 'water', size: [0.4, 0.2, 0.4] },
  'roof-tank': { label: 'Roof water tank 1,000 L', short: 'TANK', group: 'water', size: [1.15, 1.15, 0.95] },
  'pressure-pump': { label: 'Pressure pump (upper-floor showers)', short: 'PUMP', group: 'water', size: [0.45, 0.3, 0.35] },
  'water-heater': { label: 'Heat-pump water heater 300 L', short: 'HP', group: 'water', size: [0.65, 0.65, 1.8] },
  'roof-drain': { label: 'Roof drain', short: 'RD', group: 'rain', size: [0.2, 0.2, 0.05] },
  'rain-cistern': { label: 'Rain reuse cistern 5,000 L (long, buried)', short: 'CIST', group: 'rain', size: [1.3, 3.2, 1.2], zOffset: -1.25 },
  'infiltration-trench': { label: 'Infiltration trench', short: 'TR', group: 'rain', size: [6.0, 0.8, 0.6], zOffset: -0.6 },
  'sump-pump': { label: 'Garden sump pump', short: 'SP', group: 'rain', size: [0.5, 0.5, 0.8], zOffset: -0.8 },
};

export const kindOf = (kind: string): FixtureType => LIBRARY[kind] ?? { label: kind, short: '?', group: 'fixture', size: [0.3, 0.3, 0.3] };

/** Sewage pipe DN needed for the fixture units it carries (NBR 8160, simplified). A toilet always needs DN 100. */
export function sewageDnFor(uhc: number, withToilet: boolean): number {
  if (withToilet) return 100;
  if (uhc <= 3) return 40;
  if (uhc <= 6) return 50;
  if (uhc <= 20) return 75;
  return 100;
}

/** Minimum slope of a gravity sewage pipe (NBR 8160): DN ≤ 75 → 2 %, DN ≥ 100 → 1 %. */
export const minSewageSlope = (dn: number) => (dn <= 75 ? 0.02 : 0.01);

/** Water: design flow Q = 0.3 √ΣP (l/s) and the smallest DN that carries it below 3 m/s (NBR 5626). */
export const waterFlow = (sumP: number) => 0.3 * Math.sqrt(sumP);
export function waterDnFor(sumP: number): number {
  const q = waterFlow(sumP) / 1000; // m³/s
  for (const dn of [20, 25, 32, 40, 50, 60]) {
    const inner = dn * 0.8 / 1000; // approximate inner diameter, m
    if (q / (Math.PI * inner * inner / 4) <= 3) return dn;
  }
  return 75;
}

/** Rain: capacity of a gravity pipe, litres per minute (NBR 10844, table 4, n = 0.011). */
const RAIN_CAPACITY: Record<number, [number, number][]> = {
  75: [[0.005, 59], [0.01, 84], [0.02, 118], [0.04, 167]],
  100: [[0.005, 153], [0.01, 217], [0.02, 306], [0.04, 433]],
  150: [[0.005, 453], [0.01, 639], [0.02, 903], [0.04, 1280]],
};
export function rainCapacity(dn: number, slope: number): number {
  const t = RAIN_CAPACITY[dn] ?? RAIN_CAPACITY[100]!;
  let best = 0;
  for (const [s, c] of t) if (slope >= s - 1e-9) best = c;
  return best;
}
/** Rain flow from a roof area at a rainfall intensity (mm/h), litres per minute. */
export const rainFlow = (areaM2: number, intensity: number) => (intensity * areaM2) / 60;
