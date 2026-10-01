// Engineering estimates for a project (spec 08). Every view reads this; nothing keeps its own copy.
// Results are cached per project object, so an edit (a new project) recomputes everything at once.
import type { Project } from '../schema';
import { costEstimate, type CostEstimate } from './cost';
import { environment, energyCard, type EnergyCard, type EnvReport } from './environment';
import { frame, type Frame } from './frame';
import { thermalRows, type ThermalRow } from './thermal';

/** One estimated number: what it is, how it was worked out, on what assumptions, from which source, how sure. */
export interface Estimate {
  label: string;
  value: number | null;
  unit: string;
  /** the rule used */
  method: string;
  /** keys of the assumptions it depends on */
  assumptions: string[];
  source: string;
  confidence: 'low' | 'medium';
  toConfirm?: boolean;
}

export const est = (label: string, value: number | null, unit: string, method: string, assumptions: string[], source: string, confidence: 'low' | 'medium' = 'medium', toConfirm = false): Estimate =>
  ({ label, value, unit, method, assumptions, source, confidence, toConfirm });

export const DISCLAIMER = 'Preliminary estimates for design decisions. Structural, thermal and cost values must be confirmed by licensed professionals (ART/RRT).';

const frames = new WeakMap<Project, Frame>();
const thermals = new WeakMap<Project, ThermalRow[]>();
const costs = new WeakMap<Project, CostEstimate>();
const envs = new WeakMap<Project, EnvReport>();
const energies = new WeakMap<Project, EnergyCard>();

const memo = <T>(m: WeakMap<Project, T>, p: Project, f: () => T): T => {
  let v = m.get(p);
  if (v === undefined) { v = f(); m.set(p, v); }
  return v;
};

export const frameOf = (p: Project) => memo(frames, p, () => frame(p));
export const thermalOf = (p: Project) => memo(thermals, p, () => thermalRows(p));
export const costOf = (p: Project) => memo(costs, p, () => costEstimate(p, frameOf(p).quantities));
export const envOf = (p: Project) => memo(envs, p, () => environment(p));
export const energyOf = (p: Project) => memo(energies, p, () => energyCard(p));

export type { CostEstimate, Frame, ThermalRow, EnvReport, EnergyCard };
