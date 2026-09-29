// Steel sections and pier sizes used by the structure. Sizes in metres (depth d × flange width b).
export interface Profile { name: string; d: number; b: number; kind: 'W' | 'HSS' | 'concrete' }

export const COLUMN_PROFILES: Profile[] = [
  { name: 'HSS 100×100×4', d: 0.1, b: 0.1, kind: 'HSS' },
  { name: 'W150×22.5', d: 0.152, b: 0.152, kind: 'W' },
  { name: 'W200×46.1', d: 0.203, b: 0.203, kind: 'W' },
  { name: 'W250×73', d: 0.253, b: 0.254, kind: 'W' },
  { name: 'HSS 150×150×6.4', d: 0.15, b: 0.15, kind: 'HSS' },
  { name: 'HSS 200×200×8', d: 0.2, b: 0.2, kind: 'HSS' },
];
export const PIER_PROFILES: Profile[] = [
  { name: 'Concrete 30×30', d: 0.3, b: 0.3, kind: 'concrete' },
  { name: 'Concrete 40×40', d: 0.4, b: 0.4, kind: 'concrete' },
];
export const BEAM_PROFILES: Profile[] = [
  { name: 'W150×13', d: 0.148, b: 0.1, kind: 'W' },
  { name: 'W200×26.6', d: 0.207, b: 0.133, kind: 'W' },
  { name: 'W250×32.7', d: 0.258, b: 0.146, kind: 'W' },
  { name: 'W310×38.7', d: 0.31, b: 0.165, kind: 'W' },
  { name: 'W360×44', d: 0.352, b: 0.171, kind: 'W' },
];

const ALL = [...COLUMN_PROFILES, ...PIER_PROFILES, ...BEAM_PROFILES];
export const profile = (name: string): Profile => ALL.find((p) => p.name === name) ?? { name, d: 0.2, b: 0.2, kind: 'W' };

export const DEFAULT_COLUMN = 'W200×46.1';
export const DEFAULT_PIER = 'Concrete 30×30';
export const DEFAULT_BEAM = 'W250×32.7';
/** Steel-deck composite slab thickness; with the 0.26 m beams below it makes the 0.40 m structure depth. */
export const DECK_SLAB = 0.14;
