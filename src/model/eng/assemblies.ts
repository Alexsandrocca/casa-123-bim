// Assemblies (spec 08): walls, floors and roofs as ordered layers, outside → inside (top → bottom for floors and roofs).
// Values are typical; each preset names its sources. Costs are typical values to update from SINAPI-SP.
import type { Project, Slab, Wall } from '../schema';

export interface Layer {
  material: string;
  /** thickness m */
  t: number;
  /** density kg/m³ (equivalent for hollow blocks and framed layers) */
  rho: number;
  /** conductivity W/mK (equivalent for hollow blocks and framed layers) */
  lambda: number;
  /** specific heat kJ/kgK */
  c: number;
  /** R$/m² of this layer, fitted */
  cost: number;
  /** m³ of concrete per m² of this layer (for the quantities) */
  concrete?: number;
  /** the structural layer (the deck slab drawn in the model) */
  structural?: boolean;
  /** extra weight not in ρ·t (studs, purlins), kg/m² */
  extraKg?: number;
}

export type AssemblyUse = 'exterior' | 'interior' | 'wet' | 'retaining' | 'floor' | 'terrace' | 'roof' | 'ground' | 'patio';

export interface Assembly {
  id: string;
  name: string;
  use: AssemblyUse;
  /** other uses it may be chosen for */
  alsoFor?: AssemblyUse[];
  layers: Layer[];
  /** Acoustic Rw from a table (dry systems); masonry uses the mass law. */
  rwTable?: number;
  fire: string;
  source: string;
}

const NBR15220 = 'NBR 15220-2 material values (ρ, λ, c)';
// common layers
const render = (t: number, cost = 55): Layer => ({ material: 'Cement render', t, rho: 1900, lambda: 1.15, c: 1.0, cost });
const plaster = (t: number, cost = 40): Layer => ({ material: 'Plaster (render inside)', t, rho: 1900, lambda: 1.15, c: 1.0, cost });
const paint = (cost: number, inside = false): Layer => ({ material: inside ? 'Paint inside' : 'Paint outside', t: 0, rho: 0, lambda: 1, c: 0, cost });
const tile = (cost = 110): Layer => ({ material: 'Ceramic tile and adhesive', t: 0.01, rho: 2000, lambda: 1.05, c: 0.92, cost });
const gypsum = (cost = 45, name = 'Gypsum board 12.5 mm'): Layer => ({ material: name, t: 0.0125, rho: 800, lambda: 0.35, c: 0.84, cost });
const screed = (t = 0.05): Layer => ({ material: 'Cement screed', t, rho: 2000, lambda: 1.15, c: 1.0, cost: 45 });
const deck = (): Layer => ({ material: 'Steel deck MF-75 0.95 mm + concrete 14 cm', t: 0.14, rho: 1900, lambda: 1.75, c: 1.0, cost: 265, concrete: 0.75, structural: true });
const waterproof = (cost = 95): Layer => ({ material: 'Waterproofing membrane 4 mm', t: 0.004, rho: 1100, lambda: 0.17, c: 1.46, cost });
const xps = (t: number): Layer => ({ material: `XPS insulation ${Math.round(t * 1000)} mm`, t, rho: 35, lambda: 0.035, c: 1.42, cost: t * 1700 });

export const ASSEMBLIES: Assembly[] = [
  /* ---------- exterior walls ---------- */
  {
    id: 'ext-ceramic-14', name: 'Ceramic block 14 cm, rendered', use: 'exterior',
    layers: [paint(25), render(0.035), { material: 'Ceramic hollow block 14 × 19 × 29', t: 0.14, rho: 750, lambda: 0.66, c: 0.92, cost: 75 }, plaster(0.025), paint(20, true)],
    fire: 'Non-combustible; about 120 min (masonry, typical)',
    source: `${NBR15220}; block equivalent λ and ρ from NBR 15220-3 Annex D walls (U ≈ 2.3)`,
  },
  {
    id: 'ext-concrete-14', name: 'Concrete block 14 cm, rendered', use: 'exterior',
    layers: [paint(25), render(0.035), { material: 'Concrete hollow block 14 × 19 × 39', t: 0.14, rho: 1070, lambda: 1.0, c: 1.0, cost: 70 }, plaster(0.025), paint(20, true)],
    fire: 'Non-combustible; about 120 min (masonry, typical)',
    source: `${NBR15220}; block equivalent values from NBR 15220-3 Annex D (U ≈ 2.8)`,
  },
  {
    id: 'ext-lsf', name: 'Light steel frame (cement board, OSB, membrane, 90 mm stud with rock wool, drywall)', use: 'exterior',
    layers: [
      { material: 'Base coat and finish 5 mm', t: 0.005, rho: 1700, lambda: 0.7, c: 1.0, cost: 45 },
      { material: 'Cement board 10 mm', t: 0.01, rho: 1400, lambda: 0.35, c: 0.84, cost: 65 },
      { material: 'Weather membrane', t: 0.0005, rho: 400, lambda: 0.2, c: 1.0, cost: 12 },
      { material: 'OSB 11 mm', t: 0.011, rho: 650, lambda: 0.13, c: 1.7, cost: 45 },
      { material: 'Steel studs 90 mm @ 400 + rock wool', t: 0.09, rho: 40, lambda: 0.055, c: 0.84, cost: 115, extraKg: 6 },
      gypsum(), paint(20, true),
    ],
    rwTable: 45,
    fire: 'About 30 min with one drywall layer inside; 60 min needs two layers or fire boards (verify with the system maker)',
    source: `${NBR15220}; stud layer equivalent λ 0.055 includes the steel bridging (estimate); Rw from LSF system tables`,
  },
  {
    id: 'ext-lsf-eifs', name: 'Light steel frame with external insulation (EIFS-like, 50 mm EPS)', use: 'exterior',
    layers: [
      { material: 'Base coat and finish 5 mm', t: 0.005, rho: 1700, lambda: 0.7, c: 1.0, cost: 45 },
      { material: 'EPS insulation 50 mm', t: 0.05, rho: 15, lambda: 0.04, c: 1.42, cost: 95 },
      { material: 'Cement board 10 mm', t: 0.01, rho: 1400, lambda: 0.35, c: 0.84, cost: 65 },
      { material: 'Weather membrane', t: 0.0005, rho: 400, lambda: 0.2, c: 1.0, cost: 12 },
      { material: 'OSB 11 mm', t: 0.011, rho: 650, lambda: 0.13, c: 1.7, cost: 45 },
      { material: 'Steel studs 90 mm @ 400 + rock wool', t: 0.09, rho: 40, lambda: 0.055, c: 0.84, cost: 115, extraKg: 6 },
      gypsum(), paint(20, true),
    ],
    rwTable: 47,
    fire: 'EPS must be fire-retardant grade with fire breaks at each floor; about 30 min inside (verify)',
    source: `${NBR15220}; EIFS practice; Rw from LSF system tables`,
  },
  /* ---------- interior walls ---------- */
  {
    id: 'int-ceramic-9', name: 'Ceramic block 9 cm, plastered', use: 'interior', alsoFor: ['wet'],
    layers: [paint(20, true), plaster(0.015, 35), { material: 'Ceramic hollow block 9 × 19 × 29', t: 0.09, rho: 800, lambda: 0.6, c: 0.92, cost: 55 }, plaster(0.015, 35), paint(20, true)],
    fire: 'Non-combustible; about 60 min (typical)',
    source: NBR15220,
  },
  {
    id: 'wet-ceramic-9', name: 'Ceramic block 9 cm, rendered and tiled (wet rooms)', use: 'wet', alsoFor: ['interior'],
    layers: [tile(), render(0.02, 40), { material: 'Ceramic hollow block 9 × 19 × 29', t: 0.09, rho: 800, lambda: 0.6, c: 0.92, cost: 55 }, render(0.02, 40), tile()],
    fire: 'Non-combustible; about 60 min (typical)',
    source: NBR15220,
  },
  {
    id: 'int-drywall-95', name: 'Drywall 95 mm (70 mm stud, one board each side)', use: 'interior',
    layers: [paint(20, true), gypsum(), { material: 'Steel studs 70 mm, air', t: 0.07, rho: 0, lambda: 0.41, c: 1.0, cost: 45, extraKg: 4 }, gypsum(), paint(20, true)],
    rwTable: 37,
    fire: 'About 30 min (one standard board each side)',
    source: `${NBR15220}; Rw from drywall system tables (ABNT NBR 15758)`,
  },
  {
    id: 'int-drywall-95-wool', name: 'Drywall 95 mm with mineral wool', use: 'interior',
    layers: [paint(20, true), gypsum(), { material: 'Steel studs 70 mm + mineral wool', t: 0.07, rho: 32, lambda: 0.045, c: 0.84, cost: 70, extraKg: 4 }, gypsum(), paint(20, true)],
    rwTable: 43,
    fire: 'About 30 min (one standard board each side)',
    source: `${NBR15220}; Rw from drywall system tables (ABNT NBR 15758)`,
  },
  {
    id: 'int-drywall-ru', name: 'Drywall 95 mm, RU (moisture-resistant) boards, with wool', use: 'wet', alsoFor: ['interior'],
    layers: [tile(), gypsum(55, 'RU gypsum board 12.5 mm'), { material: 'Steel studs 70 mm + mineral wool', t: 0.07, rho: 32, lambda: 0.045, c: 0.84, cost: 70, extraKg: 4 }, gypsum(55, 'RU gypsum board 12.5 mm'), paint(20, true)],
    rwTable: 43,
    fire: 'About 30 min (one board each side)',
    source: `${NBR15220}; RU boards for wet areas (ABNT NBR 14715); Rw from system tables`,
  },
  /* ---------- retaining ---------- */
  {
    id: 'ret-rc-25', name: 'Reinforced concrete 25 cm, waterproofed, with drainage membrane', use: 'retaining',
    layers: [
      { material: 'Drainage membrane (HDPE dimpled sheet)', t: 0.008, rho: 120, lambda: 0.2, c: 1.0, cost: 35 },
      waterproof(75),
      { material: 'Reinforced concrete 25 cm', t: 0.25, rho: 2500, lambda: 1.75, c: 1.0, cost: 0, concrete: 1, structural: true },
      paint(20, true),
    ],
    fire: 'Non-combustible; more than 120 min',
    source: `${NBR15220}; concrete, rebar and formwork are costed with the structure quantities`,
  },
  /* ---------- floors ---------- */
  {
    id: 'floor-deck-14', name: 'Steel deck with 14 cm concrete, screed and porcelain tile', use: 'floor',
    layers: [tile(120), screed(), deck(), paint(20, true)],
    fire: 'About 60 min with the mesh (typical composite slab); the steel beams below need protection (verify)',
    source: `${NBR15220}; deck mass for MF-75 with a 14 cm slab (manufacturer type)`,
  },
  {
    id: 'terrace-deck-14', name: 'Steel deck 14 cm, waterproofed, outdoor tile (veranda roof)', use: 'terrace', alsoFor: ['floor'],
    layers: [tile(130), screed(0.04), waterproof(), screed(0.03), deck(), paint(20, true)],
    fire: 'About 60 min (typical composite slab)',
    source: `${NBR15220}; terrace practice (NBR 9575 waterproofing)`,
  },
  {
    id: 'ground-slab-15', name: 'Ground slab 15 cm on gravel, screed and tile', use: 'ground',
    layers: [tile(120), screed(), { material: 'Reinforced concrete slab 15 cm', t: 0.15, rho: 2500, lambda: 1.75, c: 1.0, cost: 160, concrete: 1, structural: true }, { material: 'Polyethylene sheet and gravel 5 cm', t: 0.05, rho: 1600, lambda: 1.3, c: 0.8, cost: 25 }],
    fire: 'Non-combustible',
    source: NBR15220,
  },
  {
    id: 'patio-paving', name: 'Patio: stone paving on a 10 cm slab over compacted fill', use: 'patio',
    layers: [{ material: 'Stone or concrete paving 3 cm', t: 0.03, rho: 2300, lambda: 1.4, c: 0.92, cost: 140 }, screed(0.04), { material: 'Concrete slab 10 cm', t: 0.1, rho: 2400, lambda: 1.75, c: 1.0, cost: 110, concrete: 1, structural: true }, { material: 'Compacted fill (per m² of patio)', t: 0, rho: 0, lambda: 1, c: 0, cost: 60 }],
    fire: 'Non-combustible',
    source: NBR15220,
  },
  /* ---------- roofs ---------- */
  {
    id: 'roof-deck-xps-gravel', name: 'Steel deck, waterproofing, XPS 50 mm and gravel (inverted roof)', use: 'roof',
    layers: [
      { material: 'Gravel 5 cm', t: 0.05, rho: 1600, lambda: 2.0, c: 0.8, cost: 25 },
      { material: 'Geotextile', t: 0, rho: 0, lambda: 1, c: 0, cost: 8 },
      xps(0.05), waterproof(), screed(0.05), deck(), paint(20, true),
    ],
    fire: 'Non-combustible roof surface (gravel ballast)',
    source: `${NBR15220}; inverted roof practice`,
  },
  {
    id: 'roof-sandwich-50', name: 'Insulated sandwich metal panel 50 mm on steel purlins', use: 'roof',
    layers: [{ material: 'Sandwich panel, steel skins + PUR 50 mm', t: 0.05, rho: 220, lambda: 0.025, c: 1.4, cost: 180, structural: true }, { material: 'Steel purlins (per m²)', t: 0, rho: 0, lambda: 1, c: 0, cost: 60, extraKg: 8 }],
    rwTable: 25,
    fire: 'PUR core: check the fire class of the panel (IT 10/CBPMESP)',
    source: `${NBR15220}; panel maker tables (U ≈ 0.45)`,
  },
  {
    id: 'roof-green', name: 'Green roof, extensive (10 cm substrate) on steel deck', use: 'roof',
    layers: [
      { material: 'Sedum and substrate 10 cm (saturated)', t: 0.1, rho: 1400, lambda: 0.5, c: 1.2, cost: 120 },
      { material: 'Filter fabric and drainage layer 25 mm', t: 0.025, rho: 100, lambda: 0.3, c: 1.0, cost: 60 },
      { material: 'Root barrier and waterproofing', t: 0.005, rho: 1100, lambda: 0.17, c: 1.46, cost: 140 },
      xps(0.04), screed(0.05), deck(), paint(20, true),
    ],
    fire: 'Extensive green roofs need gravel fire breaks at the edges and around openings (verify)',
    source: `${NBR15220}; FLL / green-roof practice (saturated weight)`,
  },
];

export const assemblyById = (id: string) => ASSEMBLIES.find((a) => a.id === id);

export const DEFAULT_ASSEMBLY: Record<AssemblyUse, string> = {
  exterior: 'ext-ceramic-14', interior: 'int-ceramic-9', wet: 'wet-ceramic-9', retaining: 'ret-rc-25',
  floor: 'floor-deck-14', terrace: 'terrace-deck-14', roof: 'roof-deck-xps-gravel', ground: 'ground-slab-15', patio: 'patio-paving',
};

export const USE_LABEL: Record<AssemblyUse, string> = {
  exterior: 'Exterior walls', interior: 'Interior walls', wet: 'Wet-room walls', retaining: 'Retaining walls',
  floor: 'Floors', terrace: 'Veranda roof (terrace)', roof: 'Roofs', ground: 'Ground slab', patio: 'Patio',
};

export const optionsFor = (use: AssemblyUse) => ASSEMBLIES.filter((a) => a.use === use || a.alsoFor?.includes(use));

/** What the element is used as. */
export function useOf(e: Wall | Slab): AssemblyUse {
  if (e.type === 'Wall') return e.props.wallType;
  if (e.tags.includes('patio')) return 'patio';
  if (e.props.onGrade) return 'ground';
  if (e.tags.includes('lower-roof')) return 'terrace';
  if (e.level === 'roof' || e.props.parapet !== undefined) return 'roof';
  return 'floor';
}

/** The assembly of an element: its own, else the project's default for its use, else the library default. */
export function assemblyOf(p: Project, e: Wall | Slab): Assembly {
  const use = useOf(e);
  return assemblyById(e.props.assemblyId ?? '') ?? assemblyById(p.engineering?.assemblyDefaults?.[use] ?? '') ?? assemblyById(DEFAULT_ASSEMBLY[use])!;
}

/* ---------- calculations ---------- */

export interface AssemblyValues {
  thickness: number;
  /** kg/m² */
  mass: number;
  /** kN/m² */
  weight: number;
  /** W/m²K */
  U: number;
  /** total resistance m²K/W, with the surface resistances */
  R: number;
  /** kJ/m²K */
  CT: number;
  /** dB */
  Rw: number;
  rwMethod: 'table' | 'mass law';
  /** R$/m² */
  cost: number;
  /** m³ of concrete per m² */
  concrete: number;
}

/** Surface resistances (NBR 15220-2): walls horizontal flow 0.13 / 0.04; roofs and floors downward flow (summer) 0.17 / 0.04. */
export const surfaceR = (use: AssemblyUse) => (['roof', 'terrace', 'floor', 'ground', 'patio'].includes(use) ? { si: 0.17, se: 0.04 } : { si: 0.13, se: 0.04 });

export function values(a: Assembly): AssemblyValues {
  const thickness = a.layers.reduce((s, l) => s + l.t, 0);
  const mass = a.layers.reduce((s, l) => s + l.rho * l.t + (l.extraKg ?? 0), 0);
  const { si, se } = surfaceR(a.use);
  const R = si + se + a.layers.reduce((s, l) => s + (l.t > 0 ? l.t / l.lambda : 0), 0);
  const CT = a.layers.reduce((s, l) => s + l.rho * l.c * l.t, 0);
  // mass law for single-leaf heavy walls (Rw ≈ 37.5 log m − 42, valid above ~100 kg/m²); light systems use their tables
  const Rw = a.rwTable ?? Math.max(20, 37.5 * Math.log10(Math.max(mass, 10)) - 42);
  return {
    thickness, mass, weight: (mass * 9.81) / 1000, U: 1 / R, R, CT, Rw, rwMethod: a.rwTable ? 'table' : 'mass law',
    cost: a.layers.reduce((s, l) => s + l.cost, 0), concrete: a.layers.reduce((s, l) => s + (l.concrete ?? 0) * l.t, 0),
  };
}

/** Wall thickness that follows from an assembly (5 mm steps). */
export const wallThicknessOf = (a: Assembly) => Math.round(values(a).thickness / 0.005) * 0.005;
