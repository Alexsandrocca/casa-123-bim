// Thermal check, NBR 15575-4/-5 simplified method (spec 08): U and CT of the exterior walls and the roofs by bioclimatic zone.
import type { Project, Slab, Wall } from '../schema';
import { A } from './assumptions';
import { assemblyOf, useOf, values, type Assembly } from './assemblies';

export interface ThermalLimit { U: number; CT: number | null; verify: boolean; text: string }

/** Exterior walls (NBR 15575-4:2021, simplified procedure). Zones 3–8 checked against published summaries; zones 1–2 to verify. */
export function wallLimit(zone: number, alpha: number): ThermalLimit {
  const CT = zone >= 8 ? null : 130;
  if (zone <= 2) return { U: 2.7, CT, verify: true, text: `zone ${zone}: U ≤ 2.7, CT ≥ 130 (verify)` };
  const U = alpha <= 0.6 ? 3.7 : 2.5;
  return { U, CT, verify: false, text: `zone ${zone}, α ${alpha.toFixed(2)} ${alpha <= 0.6 ? '≤' : '>'} 0.6: U ≤ ${U.toFixed(1)}${CT ? `, CT ≥ ${CT}` : ', no CT limit'}` };
}

/** Roofs (NBR 15575-5, simplified procedure). Values from the standard summary as we know it: VERIFY. */
export function roofLimit(zone: number, alpha: number): ThermalLimit {
  const lim = zone <= 2 ? 2.3 : zone <= 6 ? (alpha <= 0.6 ? 2.3 : 1.5) : (alpha <= 0.4 ? 2.3 : 1.5);
  return { U: lim, CT: null, verify: true, text: `zone ${zone}, α ${alpha.toFixed(2)}: U ≤ ${lim.toFixed(1)} (verify)` };
}

export interface ThermalRow {
  assembly: Assembly;
  kind: 'wall' | 'roof';
  elements: (Wall | Slab)[];
  area: number;
  U: number; CT: number;
  limit: ThermalLimit;
  /** confirm: the bioclimatic zone is not set yet. */
  status: 'pass' | 'fail' | 'confirm';
  why: string;
}

export function thermalRows(p: Project): ThermalRow[] {
  const zone = A(p, 'zone'), alpha = A(p, 'absorptance');
  const groups = new Map<string, ThermalRow>();
  for (const e of p.elements) {
    if (e.type !== 'Wall' && e.type !== 'Slab') continue;
    const use = useOf(e);
    if (use !== 'exterior' && use !== 'roof') continue;
    const a = assemblyOf(p, e);
    const key = `${use}:${a.id}`;
    const v = values(a);
    const area = e.type === 'Wall' ? Math.hypot(e.props.end[0] - e.props.start[0], e.props.end[1] - e.props.start[1]) * e.props.height : 0;
    let row = groups.get(key);
    if (!row) {
      const limit = use === 'roof' ? roofLimit(zone, alpha) : wallLimit(zone, alpha);
      const okU = v.U <= limit.U + 1e-9, okCT = limit.CT === null || v.CT >= limit.CT - 1e-9;
      const why = [
        `U ${v.U.toFixed(2)} ${okU ? '≤' : '>'} ${limit.U.toFixed(1)} W/m²K`,
        ...(use === 'roof' ? [] : [limit.CT === null ? `CT ${v.CT.toFixed(0)} kJ/m²K (no limit)` : `CT ${v.CT.toFixed(0)} ${okCT ? '≥' : '<'} ${limit.CT} kJ/m²K`]),
      ].join(' · ') + (okU && okCT ? '' : ' → the simplified method fails: the simulation method of NBR 15575-1 is needed');
      row = Number.isFinite(zone)
        ? { assembly: a, kind: use === 'roof' ? 'roof' : 'wall', elements: [], area: 0, U: v.U, CT: v.CT, limit, status: okU && okCT ? 'pass' : 'fail', why }
        : { assembly: a, kind: use === 'roof' ? 'roof' : 'wall', elements: [], area: 0, U: v.U, CT: v.CT, limit: { U: NaN, CT: null, verify: true, text: 'bioclimatic zone TO CONFIRM' }, status: 'confirm', why: `U ${v.U.toFixed(2)} W/m²K · CT ${v.CT.toFixed(0)} kJ/m²K · set the bioclimatic zone (Engineering → Assumptions) to check` };
      groups.set(key, row);
    }
    row.elements.push(e);
    row.area += area;
  }
  return [...groups.values()];
}
