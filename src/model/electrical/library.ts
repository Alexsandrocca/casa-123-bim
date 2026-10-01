// Electrical devices, cables and breakers (NBR 5410, simplified for design). Supply: CPFL 127/220 V three-phase (to confirm).

export type DeviceGroup = 'outlet' | 'light' | 'switch' | 'dedicated' | 'panel' | 'low-voltage' | 'camera' | 'solar';

export interface DeviceType {
  label: string;
  short: string;
  group: DeviceGroup;
  /** Default design power: VA for outlets/lights, W for appliances. */
  power: number;
  /** Supply voltage of a dedicated point. */
  voltage?: 127 | 220;
  /** Mounting height above the floor (Brazilian defaults). */
  height: number;
  /** Needs a 30 mA RCD. */
  rcd?: boolean;
  size: [number, number, number];
}

export const DEVICES: Record<string, DeviceType> = {
  outlet: { label: 'Outlet 10 A', short: 'O', group: 'outlet', power: 100, height: 0.3, rcd: true, size: [0.08, 0.04, 0.12] },
  'outlet-20': { label: 'Outlet 20 A', short: 'O20', group: 'outlet', power: 600, height: 1.1, rcd: true, size: [0.08, 0.04, 0.12] },
  switch: { label: 'Smart switch (Matter/Zigbee)', short: 'S', group: 'switch', power: 0, height: 1.1, size: [0.08, 0.04, 0.12] },
  'ceiling-light': { label: 'Ceiling light', short: 'L', group: 'light', power: 100, height: 2.65, size: [0.3, 0.3, 0.05] },
  'wall-light': { label: 'Wall light', short: 'WL', group: 'light', power: 60, height: 2.2, size: [0.15, 0.1, 0.2] },
  'led-strip': { label: 'LED strip', short: 'LED', group: 'light', power: 60, height: 2.6, size: [1.5, 0.03, 0.03] },
  hob: { label: 'Induction hob 7 kW', short: 'HOB', group: 'dedicated', power: 7000, voltage: 220, height: 0.9, size: [0.6, 0.5, 0.05] },
  oven: { label: 'Oven', short: 'OV', group: 'dedicated', power: 2500, voltage: 220, height: 0.6, size: [0.6, 0.55, 0.6] },
  dishwasher: { label: 'Dishwasher point', short: 'DW', group: 'dedicated', power: 1500, voltage: 127, height: 0.3, rcd: true, size: [0.08, 0.04, 0.12] },
  'washer-dryer': { label: 'Washer/dryer point', short: 'WD', group: 'dedicated', power: 2500, voltage: 220, height: 1.1, rcd: true, size: [0.08, 0.04, 0.12] },
  'heat-pump': { label: 'Heat-pump water heater', short: 'HP', group: 'dedicated', power: 1500, voltage: 220, height: 1.2, rcd: true, size: [0.1, 0.06, 0.15] },
  'ac-indoor': { label: 'Air conditioner, indoor unit', short: 'AC', group: 'low-voltage', power: 0, height: 2.3, size: [0.9, 0.22, 0.3] },
  'ac-outdoor': { label: 'Air conditioner, outdoor unit 12,000 BTU', short: 'ACo', group: 'dedicated', power: 1200, voltage: 220, height: 0.4, size: [0.8, 0.3, 0.55] },
  'ev-charger': { label: 'EV charger 7 kW', short: 'EV', group: 'dedicated', power: 7000, voltage: 220, height: 1.3, rcd: true, size: [0.08, 0.25, 0.35] },
  'pump-pressure': { label: 'Pressure pump', short: 'PP', group: 'dedicated', power: 750, voltage: 220, height: 0.3, rcd: true, size: [0.08, 0.04, 0.12] },
  'pump-lift': { label: 'Lift-station pump', short: 'LP', group: 'dedicated', power: 1100, voltage: 220, height: 0.6, rcd: true, size: [0.08, 0.04, 0.12] },
  'pump-sump': { label: 'Garden sump pump', short: 'SP', group: 'dedicated', power: 750, voltage: 220, height: 0.6, rcd: true, size: [0.08, 0.04, 0.12] },
  rack: { label: 'Rack: NVR, PoE switch, UPS 1.5 kVA', short: 'RACK', group: 'dedicated', power: 900, voltage: 127, height: 1.0, size: [0.6, 0.6, 1.2] },
  'network-outlet': { label: 'Network outlet (Cat 6)', short: 'NET', group: 'low-voltage', power: 0, height: 0.3, size: [0.08, 0.04, 0.12] },
  camera: { label: 'IP camera 4 MP PoE', short: 'CAM', group: 'camera', power: 0, height: 2.6, size: [0.12, 0.12, 0.12] },
  doorbell: { label: 'Video doorbell (PoE)', short: 'DB', group: 'camera', power: 0, height: 1.5, size: [0.05, 0.03, 0.14] },
  'smoke-detector': { label: 'Smoke detector', short: 'SD', group: 'low-voltage', power: 0, height: 2.7, size: [0.12, 0.12, 0.05] },
  panel: { label: 'Main electrical panel', short: 'QDG', group: 'panel', power: 0, height: 1.5, size: [0.12, 0.5, 0.7] },
  'sub-panel': { label: 'Lower-level sub-panel', short: 'QD-LL', group: 'panel', power: 0, height: 1.5, size: [0.12, 0.4, 0.5] },
  'essential-panel': { label: 'Essential-loads panel (battery)', short: 'QE', group: 'panel', power: 0, height: 1.5, size: [0.12, 0.3, 0.4] },
  inverter: { label: 'Hybrid inverter 6 kW', short: 'INV', group: 'solar', power: 0, height: 1.4, size: [0.15, 0.45, 0.6] },
  battery: { label: 'Battery 10 kWh LFP', short: 'BAT', group: 'solar', power: 0, height: 0.5, size: [0.2, 0.6, 1.0] },
};

export const deviceType = (kind: string): DeviceType => DEVICES[kind] ?? { label: kind, short: '?', group: 'low-voltage', power: 0, height: 1, size: [0.1, 0.1, 0.1] };

/** Copper cable, PVC 70 °C, two loaded conductors in conduit (NBR 5410 table 36, method B1). Section mm² → A. */
export const CABLE_CAPACITY: [number, number][] = [[1.5, 17.5], [2.5, 24], [4, 32], [6, 41], [10, 57], [16, 76], [25, 101], [35, 125]];
export const BREAKERS = [10, 16, 20, 25, 32, 40, 50, 63, 80, 100];
export const RHO_CU = 0.0178; // Ω·mm²/m
export const MAX_DROP = 4; // %

export const capacity = (section: number) => CABLE_CAPACITY.find((c) => c[0] === section)?.[1] ?? 0;

/** Smallest standard breaker at or above the design current. */
export const breakerFor = (current: number) => BREAKERS.find((b) => b >= current - 1e-9) ?? BREAKERS[BREAKERS.length - 1]!;

/** Voltage drop of a single-phase or phase-to-phase circuit, %. */
export const dropPct = (length: number, current: number, section: number, voltage: number) => (200 * length * current * RHO_CU) / (section * voltage);

/** Cable section: the minimum for the purpose, then up until it carries the breaker and the voltage drop is ≤ 4 %. */
export function sectionFor(purpose: 'lighting' | 'outlets' | 'dedicated' | 'feeder', current: number, length: number, voltage: number): { section: number; breaker: number } {
  const min = purpose === 'lighting' ? 1.5 : 2.5;
  const breaker = breakerFor(Math.max(current, purpose === 'lighting' ? 10 : 16));
  for (const [s, cap] of CABLE_CAPACITY) {
    if (s < min) continue;
    if (cap >= breaker && dropPct(length, current, s, voltage) <= MAX_DROP) return { section: s, breaker };
  }
  const last = CABLE_CAPACITY[CABLE_CAPACITY.length - 1]!;
  return { section: last[0], breaker };
}

/** Conduit size for a number of cables of a section (rough fill rule). */
export const conduitFor = (section: number) => (section <= 2.5 ? 20 : section <= 6 ? 25 : 32);

/* ---------- NBR 5410 §9.5.2: minimum points ---------- */

export type RoomKind = 'kitchen' | 'service' | 'bath' | 'other' | 'circulation' | 'none';

/** Lighting: 100 VA for the first 6 m², plus 60 VA for every full 4 m² beyond. */
export const minLightingVA = (area: number) => (area <= 6 ? 100 : 100 + 60 * Math.floor((area - 6) / 4 + 1e-9));

/** Outlets: kitchens and service areas 1 per 3.5 m of perimeter; bathrooms 1 near the basin; other rooms ≤ 6 m² one, else 1 per 5 m. */
export function minOutlets(kind: RoomKind, area: number, perimeter: number): number {
  if (kind === 'none') return 0;
  if (kind === 'kitchen' || kind === 'service') return Math.ceil(perimeter / 3.5 - 1e-9);
  if (kind === 'bath') return 1;
  if (kind === 'circulation') return 1;
  return area <= 6 ? 1 : Math.ceil(perimeter / 5 - 1e-9);
}

/** Outlet design power: kitchens/service the first three 600 VA, the rest 100 VA; elsewhere 100 VA. */
export const outletVA = (kind: RoomKind, index: number) => ((kind === 'kitchen' || kind === 'service') && index < 3 ? 600 : 100);

/* ---------- cameras ---------- */

/** Horizontal field of view for a lens on a 1/2.7" sensor (5.4 mm wide), degrees. */
export const cameraFov = (lensMm: number) => (2 * Math.atan(5.4 / (2 * lensMm)) * 180) / Math.PI;
/** Useful range for recognising a person, m (rule of thumb ≈ 4.5 m per mm of focal length). */
export const cameraRange = (lensMm: number) => 4.5 * lensMm;
export const CAMERA_POE_W = 6.5;
export const POE_SWITCH = { ports: 24, budgetW: 250 };
export const NVR = { channels: 16, storageTB: 8 };
/** 4 MP H.265 continuous recording, average bit rate. */
export const CAMERA_MBPS = 2;
