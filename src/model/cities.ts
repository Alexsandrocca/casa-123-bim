// P1: what we know per city — rules (per zone), street utilities and climate — with source, date and status.
// The lot wizard takes its defaults from here. A city that is not in the table gets empty values marked TO CONFIRM
// and generic names for whom to ask. Values are never invented: anything not known stays null.
import type { FactStatus, Lot, NumFact, Region, Supply } from './schema';

export interface CityRules {
  /** The code that sets the rules, and the state sanitary code. */
  code: string | null;
  sanitary: string | null;
  zone: string | null;
  setbacks: { front: number | null; rear: number | null; sides: number | null };
  coverage: number | null;
  permeability: number | null;
  far: number | null;
  height: number | null;
  floors: number | null;
  eaves: number | null;
  /** Which of the values above the code itself gives (the others are typical values to confirm). */
  given: string[];
  source: string;
  date: string;
}

export interface CityInfo {
  city: string;
  state: string;
  /** City centre (the map opens here). */
  lat: number;
  lon: number;
  utcOffset: number;
  rules: CityRules;
  utilities: { water: string | null; power: string | null; supply: Supply | null; gas: string | null };
  climate: { zone: number | null; pvYield: Region['pvYield']; solarHeaterShare: number | null; rainIntensity: number | null };
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export const CITIES: CityInfo[] = [
  {
    city: 'Piracicaba', state: 'SP', lat: -22.725, lon: -47.649, utcOffset: -3,
    rules: {
      code: 'Piracicaba LC 474/2025', sanitary: 'SP sanitary code, Decreto 12.342/78', zone: null,
      // the setbacks are the values the Casa 123 owner was given; the zone, rates and height are still to confirm
      setbacks: { front: 4, rear: 6, sides: 1.2 }, coverage: null, permeability: null, far: null, height: null, floors: null,
      eaves: 0.7, given: ['eaves'], source: 'Piracicaba LC 474/2025 (eaves); setbacks as given for Casa 123', date: '2026-09-28',
    },
    utilities: { water: 'SEMAE', power: 'CPFL Paulista', supply: { phaseV: 127, lineV: 220, phases: 3 }, gas: null },
    climate: {
      zone: 2,
      pvYield: { monthly: [130, 120, 128, 120, 112, 104, 114, 128, 124, 132, 130, 128], source: 'PVGIS-like values, 20° facing north' },
      solarHeaterShare: 0.7, rainIntensity: 150,
    },
  },
];

export function cityInfo(city: string, state = ''): CityInfo | undefined {
  return CITIES.find((c) => norm(c.city) === norm(city) && (!state || norm(c.state) === norm(state)));
}

/** Generic names for whom to ask when the city is not in the table. */
export const GENERIC_ASK = { water: 'the water and sewer company', power: 'the electricity company', gas: 'the gas company' };

/** Typical values the wizard fills when the family answers "I don't know" (always TO CONFIRM). */
export const TYPICAL = {
  setbacks: { front: 4, rear: 3, sides: 1.5 }, coverage: 60, permeability: 20, far: 1.2, height: 9, floors: 2, eaves: 0.6,
  sewerDepth: 1.5, sewerOffset: 5, waterDepth: 0.8, supply: { phaseV: 127, lineV: 220, phases: 3 } as Supply, rainIntensity: 150,
};

const today = () => new Date().toISOString().slice(0, 10);
const fact = <T>(value: T | null, status: FactStatus, source: string, date = today()) => ({ value, status, source, date });
const ruleFact = (r: CityRules | undefined, key: string, v: number | null): NumFact =>
  v === null || !r ? fact<number>(null, 'to-confirm', r ? `${r.code ?? 'City rules'} (TO CONFIRM)` : 'City rules (TO CONFIRM)')
    : fact(v, r.given.includes(key) ? 'given' : 'to-confirm', r.source, r.date);

/** The city facts of a project (site.region) from the table, or empty and TO CONFIRM. */
export function regionFor(city: string, state: string): Region {
  const c = cityInfo(city, state);
  return {
    city, state, utcOffset: c?.utcOffset ?? -3,
    rules: { code: c?.rules.code ?? null, sanitary: c?.rules.sanitary ?? null },
    pvYield: c?.climate.pvYield ?? null, solarHeaterShare: c?.climate.solarHeaterShare ?? null,
    rainIntensity: c?.climate.rainIntensity ?? TYPICAL.rainIntensity,
  };
}

/** A lot's rules from the city table (empty and TO CONFIRM for an unknown city). */
export function rulesFor(city: string, state: string): Lot['rules'] {
  const c = cityInfo(city, state), r = c?.rules;
  return {
    zone: fact<string>(r?.zone ?? null, 'to-confirm', r ? `${r.code ?? 'City rules'} (TO CONFIRM)` : 'City rules (TO CONFIRM)'),
    setbacks: {
      front: ruleFact(r, 'setbacks', r?.setbacks.front ?? null), rear: ruleFact(r, 'setbacks', r?.setbacks.rear ?? null),
      left: ruleFact(r, 'setbacks', r?.setbacks.sides ?? null), right: ruleFact(r, 'setbacks', r?.setbacks.sides ?? null),
    },
    coverage: ruleFact(r, 'coverage', r?.coverage ?? null), permeability: ruleFact(r, 'permeability', r?.permeability ?? null),
    far: ruleFact(r, 'far', r?.far ?? null), height: ruleFact(r, 'height', r?.height ?? null), floors: ruleFact(r, 'floors', r?.floors ?? null),
    eaves: ruleFact(r, 'eaves', r?.eaves ?? null),
    notes: '',
  };
}

/** Street services from the city table: whom to ask and the usual supply; depths unknown (TO CONFIRM). */
export function servicesFor(city: string, state: string): Lot['services'] {
  const c = cityInfo(city, state), u = c?.utilities;
  const water = u?.water ?? GENERIC_ASK.water;
  return {
    sewer: { exists: fact<boolean>(null, 'to-confirm', ''), depth: fact<number>(null, 'to-confirm', ''), offset: TYPICAL.sewerOffset, ask: water },
    water: { depth: fact<number>(null, 'to-confirm', ''), ask: water },
    power: { supply: fact<Supply>(u?.supply ?? null, 'to-confirm', u?.supply ? `Usual supply of ${u.power} (TO CONFIRM)` : ''), ask: u?.power ?? GENERIC_ASK.power },
    storm: { kind: fact<'drain' | 'gutter' | 'none'>(null, 'to-confirm', ''), ask: 'Prefeitura' },
    gas: { exists: fact<boolean>(null, 'to-confirm', ''), wanted: false, ask: u?.gas ?? GENERIC_ASK.gas },
  };
}

/** A new lot: a rectangle on a flat street-facing site, everything else from the city table and TO CONFIRM. */
export function defaultLot(city: string, state: string, at?: { lat: number; lon: number }): Lot {
  const c = cityInfo(city, state);
  return {
    polygon: [[0, 0], [12, 0], [12, 30], [0, 30]],
    shape: { status: 'to-confirm', source: '' },
    streetEdges: [0],
    geo: { lat: at?.lat ?? c?.lat ?? -15.78, lon: at?.lon ?? c?.lon ?? -47.93, xBearing: 0, status: 'to-confirm', source: '' },
    terrain: { kind: 'flat', fall: 0, spots: [], status: 'to-confirm', source: '' },
    rules: rulesFor(city, state),
    services: servicesFor(city, state),
    notes: [],
    confirm: [{ text: 'Soil test (SPT borings) before the foundations are designed', who: 'soil' }],
  };
}
