// Engineering assumptions (spec 08). One editable list: changing a value updates every estimate at once.
// The model stores only what the family changed (project.assumptions); everything else is the default here.
import type { Project } from '../schema';

export type AssumptionGroup = 'Site and soil' | 'Loads (NBR 6120)' | 'Steel and deck' | 'Concrete' | 'Thermal' | 'Wind' | 'Cost' | 'Environment';

export interface Assumption {
  key: string;
  label: string;
  unit: string;
  group: AssumptionGroup;
  /** null = no value yet (TO CONFIRM, shown as an empty field). */
  value: number | null;
  source: string;
  /** Still to be confirmed by a survey, an authority or a professional. */
  toConfirm?: boolean;
  min?: number;
  max?: number;
  step?: number;
}

const T6120 = 'NBR 6120:2019, verify the table';
const RULE = 'Rule of thumb for pre-design';
const COST = 'Typical value, to update from SINAPI-SP (Caixa) before using it';

export const ASSUMPTIONS: Assumption[] = [
  // site and soil
  { key: 'soilPressure', label: 'Allowable soil pressure', unit: 'kPa', group: 'Site and soil', value: 150, source: 'Typical for stiff soil; TO CONFIRM by SPT borings (NBR 6122, NBR 6484)', toConfirm: true, min: 50, max: 600, step: 10 },
  { key: 'footingMinDepth', label: 'Minimum footing depth', unit: 'm', group: 'Site and soil', value: 0.4, source: RULE, min: 0.3, max: 1.5, step: 0.05 },
  // loads
  { key: 'finishes', label: 'Finishes, ceilings and services', unit: 'kN/m²', group: 'Loads (NBR 6120)', value: 1.0, source: T6120, min: 0, max: 5, step: 0.1 },
  { key: 'partitions', label: 'Partitions (where no walls are drawn)', unit: 'kN/m²', group: 'Loads (NBR 6120)', value: 1.0, source: `${T6120} (light partitions allowance)`, min: 0, max: 5, step: 0.1 },
  { key: 'liveDwelling', label: 'Live load · rooms of the dwelling', unit: 'kN/m²', group: 'Loads (NBR 6120)', value: 1.5, source: `${T6120} (dwellings)`, min: 0, max: 10, step: 0.5 },
  { key: 'liveService', label: 'Live load · laundry and service areas', unit: 'kN/m²', group: 'Loads (NBR 6120)', value: 2.0, source: `${T6120} (service areas)`, min: 0, max: 10, step: 0.5 },
  { key: 'liveStair', label: 'Live load · stairs', unit: 'kN/m²', group: 'Loads (NBR 6120)', value: 2.5, source: `${T6120} (stairs, private use)`, min: 0, max: 10, step: 0.5 },
  { key: 'liveTerrace', label: 'Live load · veranda and terraces', unit: 'kN/m²', group: 'Loads (NBR 6120)', value: 2.5, source: `${T6120} (balconies and terraces)`, min: 0, max: 10, step: 0.5 },
  { key: 'liveRoof', label: 'Live load · roof (maintenance access only)', unit: 'kN/m²', group: 'Loads (NBR 6120)', value: 1.0, source: `${T6120} (roofs, maintenance only)`, min: 0, max: 5, step: 0.25 },
  { key: 'tankVolume', label: 'Roof water tanks (each)', unit: 'L', group: 'Loads (NBR 6120)', value: 1000, source: 'Brief: 2 × 1,000 L', min: 0, max: 5000, step: 100 },
  { key: 'tankExtra', label: 'Extra for the tank structure', unit: '%', group: 'Loads (NBR 6120)', value: 10, source: 'Spec 08', min: 0, max: 50, step: 5 },
  { key: 'gammaF', label: 'Load factor (all loads)', unit: '×', group: 'Loads (NBR 6120)', value: 1.4, source: 'NBR 8681 typical combination, as one factor for the estimate', min: 1, max: 2, step: 0.05 },
  // steel and deck
  { key: 'fy', label: 'Steel yield strength', unit: 'MPa', group: 'Steel and deck', value: 345, source: 'ASTM A572 Gr. 50 (Gerdau W profiles)', min: 235, max: 450, step: 5 },
  { key: 'gammaA', label: 'Steel resistance factor γa1', unit: '×', group: 'Steel and deck', value: 1.1, source: 'NBR 8800:2008', min: 1, max: 1.5, step: 0.05 },
  { key: 'deflection', label: 'Beam deflection limit (span / n)', unit: 'n', group: 'Steel and deck', value: 350, source: 'NBR 8800 Annex C (floor beams, span/350)', min: 200, max: 600, step: 10 },
  { key: 'deckUnpropped', label: 'Steel deck · max span without props', unit: 'm', group: 'Steel and deck', value: 2.7, source: 'Manufacturer-type table, MF-75 0.95 mm, 14 cm slab (verify with the supplier)', min: 1.5, max: 4.5, step: 0.05 },
  { key: 'deckPropped', label: 'Steel deck · max span with props', unit: 'm', group: 'Steel and deck', value: 4.2, source: 'Manufacturer-type table, composite stage (verify with the supplier)', min: 2, max: 6, step: 0.05 },
  { key: 'steelExtra', label: 'Connections and bracing on top of the members', unit: '%', group: 'Steel and deck', value: 10, source: RULE, min: 0, max: 40, step: 1 },
  // concrete
  { key: 'rebarFooting', label: 'Rebar in footings', unit: 'kg/m³', group: 'Concrete', value: 60, source: RULE, min: 0, max: 200, step: 5 },
  { key: 'rebarWall', label: 'Rebar in retaining walls', unit: 'kg/m³', group: 'Concrete', value: 90, source: RULE, min: 0, max: 200, step: 5 },
  { key: 'rebarSlab', label: 'Rebar in slabs (mesh and bars)', unit: 'kg/m³', group: 'Concrete', value: 35, source: RULE, min: 0, max: 200, step: 5 },
  // thermal
  { key: 'zone', label: 'Bioclimatic zone', unit: '1–8', group: 'Thermal', value: null, source: 'NBR 15220-3:2024 table of cities, TO CONFIRM for the project city', toConfirm: true, min: 1, max: 8, step: 1 },
  { key: 'absorptance', label: 'Solar absorptance α of the outside colour', unit: '0–1', group: 'Thermal', value: 0.5, source: 'Spec 05 sets the colours; light colours ≈ 0.3, mid ≈ 0.5, dark ≈ 0.8', min: 0.1, max: 1, step: 0.05 },
  // wind
  { key: 'v0', label: 'Basic wind speed V0', unit: 'm/s', group: 'Wind', value: null, source: 'NBR 6123 isopleth map, TO CONFIRM for the project city', toConfirm: true, min: 30, max: 50, step: 1 },
  { key: 's2', label: 'Terrain and height factor S2', unit: '×', group: 'Wind', value: 0.88, source: 'NBR 6123, category IV, class A, z ≈ 7 m (verify)', min: 0.6, max: 1.2, step: 0.01 },
  // cost
  { key: 'cub', label: 'CUB (R8-N, Sinduscon-SP, Sep 2026)', unit: 'R$/m²', group: 'Cost', value: 2238.58, source: 'Sinduscon-SP, CUB R8-N, reference Sep 2026 (read 2026-10-01). R1-N (single house) not found: TO CONFIRM', toConfirm: true, min: 0, max: 20000, step: 10 },
  { key: 'cubExtras', label: 'Not in the CUB (foundations, retaining, site, systems, fees)', unit: '%', group: 'Cost', value: 25, source: 'NBR 12721: the CUB leaves these out. Rule of thumb', min: 0, max: 100, step: 1 },
  { key: 'wVeranda', label: 'Equivalent-area weight · covered veranda', unit: '×', group: 'Cost', value: 0.75, source: 'NBR 12721 weights (verify)', min: 0, max: 1, step: 0.05 },
  { key: 'wCarport', label: 'Equivalent-area weight · carport', unit: '×', group: 'Cost', value: 0.5, source: 'NBR 12721 weights (verify)', min: 0, max: 1, step: 0.05 },
  { key: 'wOpen', label: 'Equivalent-area weight · open patio and terraces', unit: '×', group: 'Cost', value: 0.3, source: 'NBR 12721 weights (verify)', min: 0, max: 1, step: 0.05 },
  { key: 'costSteel', label: 'Steel frame, made and erected', unit: 'R$/kg', group: 'Cost', value: 18, source: COST, min: 0, max: 100, step: 0.5 },
  { key: 'costConcrete', label: 'Concrete in footings, placed', unit: 'R$/m³', group: 'Cost', value: 750, source: COST, min: 0, max: 5000, step: 10 },
  { key: 'costRebar', label: 'Rebar, cut and placed', unit: 'R$/kg', group: 'Cost', value: 12, source: COST, min: 0, max: 100, step: 0.5 },
  { key: 'costFormwork', label: 'Formwork', unit: 'R$/m²', group: 'Cost', value: 90, source: COST, min: 0, max: 1000, step: 5 },
  { key: 'costExcavation', label: 'Excavation and removal', unit: 'R$/m³', group: 'Cost', value: 85, source: COST, min: 0, max: 1000, step: 5 },
  { key: 'costWindow', label: 'Windows (aluminium and glass)', unit: 'R$/m²', group: 'Cost', value: 1200, source: COST, min: 0, max: 10000, step: 50 },
  { key: 'costDoor', label: 'Inside door, fitted', unit: 'R$ each', group: 'Cost', value: 1400, source: COST, min: 0, max: 20000, step: 50 },
  { key: 'costSlider', label: 'Glass sliders and outside doors', unit: 'R$/m²', group: 'Cost', value: 1500, source: COST, min: 0, max: 10000, step: 50 },
  { key: 'costStair', label: 'Steel stair with treads', unit: 'R$ each', group: 'Cost', value: 28000, source: COST, min: 0, max: 200000, step: 500 },
  { key: 'costPlumbing', label: 'Plumbing, per metre of pipe (average)', unit: 'R$/m', group: 'Cost', value: 95, source: COST, min: 0, max: 1000, step: 5 },
  { key: 'costFixture', label: 'Sanitary fixture, fitted (average)', unit: 'R$ each', group: 'Cost', value: 1600, source: COST, min: 0, max: 20000, step: 50 },
  { key: 'costElecPoint', label: 'Electrical point with cable and conduit', unit: 'R$ each', group: 'Cost', value: 260, source: COST, min: 0, max: 5000, step: 10 },
  { key: 'costPv', label: 'Solar PV, installed', unit: 'R$/kWp', group: 'Cost', value: 3800, source: COST, min: 0, max: 20000, step: 100 },
  { key: 'costBdi', label: 'Contractor overheads and profit (BDI)', unit: '%', group: 'Cost', value: 20, source: 'Typical BDI for small works (verify with the builder)', min: 0, max: 60, step: 1 },
  // environment
  { key: 'people', label: 'People living in the house', unit: '', group: 'Environment', value: 4, source: 'Brief', min: 1, max: 12, step: 1 },
  { key: 'hotWater', label: 'Hot water per person per day', unit: 'L', group: 'Environment', value: 50, source: 'Rule of thumb (40 °C)', min: 10, max: 200, step: 5 },
  { key: 'heatPumpCop', label: 'Heat-pump water heater COP', unit: '×', group: 'Environment', value: 3, source: 'Manufacturer-type value (verify)', min: 1, max: 6, step: 0.1 },
  { key: 'glassT', label: 'Glass light transmittance (with dirt)', unit: '0–1', group: 'Environment', value: 0.7, source: 'Clear double glazing ≈ 0.75–0.8, less dirt', min: 0.2, max: 0.95, step: 0.05 },
  { key: 'reflectance', label: 'Average room reflectance', unit: '0–1', group: 'Environment', value: 0.5, source: 'Light walls and ceiling', min: 0.2, max: 0.9, step: 0.05 },
];

const BY_KEY = new Map(ASSUMPTIONS.map((a) => [a.key, a]));
export const assumption = (key: string) => BY_KEY.get(key);

/** The value in use: the family's value if they changed it, else the default. Throws on an unknown key. */
export function A(p: Project, key: string): number {
  const v = valueOf(p, key);
  if (v === null) return NaN;
  return v;
}
export function valueOf(p: Project, key: string): number | null {
  const a = BY_KEY.get(key);
  if (!a) throw new Error(`Unknown assumption ${key}`);
  const stored = p.assumptions?.[key];
  return stored !== undefined ? stored : a.value;
}
/** Is the value the family's own (changed from the default)? */
export const changed = (p: Project, key: string) => p.assumptions?.[key] !== undefined && p.assumptions[key] !== BY_KEY.get(key)?.value;
