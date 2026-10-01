// Steel sections and pier sizes used by the structure. Sizes in metres (depth d × flange width b).
// Spec 08: the steel lists come from the section table (eng/steel.ts), the same one the pre-sizing picks from.
import { HSS_SECTIONS, W_SECTIONS } from './eng/steel';

export interface Profile { name: string; d: number; b: number; kind: 'W' | 'HSS' | 'concrete' }

const toProfile = (s: { name: string; d: number; bf: number; kind: 'W' | 'HSS' }): Profile => ({ name: s.name, d: s.d, b: s.bf, kind: s.kind });

export const COLUMN_PROFILES: Profile[] = [...W_SECTIONS.filter((s) => s.h), ...HSS_SECTIONS].sort((a, b) => a.kg - b.kg).map(toProfile);
export const PIER_PROFILES: Profile[] = [
  { name: 'Concrete 30×30', d: 0.3, b: 0.3, kind: 'concrete' },
  { name: 'Concrete 40×40', d: 0.4, b: 0.4, kind: 'concrete' },
];
export const BEAM_PROFILES: Profile[] = [...W_SECTIONS].sort((a, b) => a.kg - b.kg).map(toProfile);

const ALL = [...COLUMN_PROFILES, ...PIER_PROFILES, ...BEAM_PROFILES];
export const profile = (name: string): Profile => ALL.find((p) => p.name === name) ?? { name, d: 0.2, b: 0.2, kind: 'W' };

export const DEFAULT_COLUMN = 'W200×46.1';
export const DEFAULT_PIER = 'Concrete 30×30';
export const DEFAULT_BEAM = 'W250×32.7';
/** Steel-deck composite slab thickness; with the 0.26 m beams below it makes the 0.40 m structure depth. */
export const DECK_SLAB = 0.14;
