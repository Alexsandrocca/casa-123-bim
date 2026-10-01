// The estimates shown next to each element (spec 08), each with its method, assumptions, source and confidence.
import { wallSeg } from '../geometry';
import type { Beam, Column, Feature, Footing, Project, Slab, Wall } from '../schema';
import { assemblyOf, surfaceR, values } from './assemblies';
import { featureCost } from './features';
import { wallLineLoad } from './frame';
import { est, frameOf, type Estimate } from './index';

const SRC_ASM = 'Layer values from NBR 15220-2 and the preset sources (Engineering → Assemblies)';

export function wallEstimates(p: Project, w: Wall): Estimate[] {
  const a = assemblyOf(p, w), v = values(a), r = surfaceR(a.use);
  const len = (() => { const s = wallSeg(w); return s.b - s.a; })();
  return [
    est('Thickness', v.thickness, 'm', `Sum of the layers of “${a.name}”`, [], SRC_ASM),
    est('Weight', v.weight, 'kN/m²', 'Σ density × thickness of the layers (+ studs), × 9.81', [], SRC_ASM),
    est('Load on the floor', wallLineLoad(p, w), 'kN/m', 'Weight × height × solid share (doors and windows taken out)', [], SRC_ASM),
    est('U-value', v.U, 'W/m²K', `1 / (Rsi ${r.si} + Σ thickness/λ + Rse ${r.se})`, ['zone', 'absorptance'], 'NBR 15220-2 method; limits NBR 15575-4'),
    est('Thermal capacity CT', v.CT, 'kJ/m²K', 'Σ density × specific heat × thickness', ['zone'], 'NBR 15220-2 method; limit NBR 15575-4 (≥ 130 in zones 1–7)'),
    est('Sound insulation Rw', v.Rw, 'dB', v.rwMethod === 'table' ? 'Table value of the dry system' : 'Mass law: 37.5 log(m) − 42 (single heavy leaf)', [], v.rwMethod === 'table' ? 'System maker tables (to verify)' : 'Mass law (estimate)', 'low'),
    est('Cost', v.cost * Math.max(0, len * w.props.height), 'R$', `R$ ${v.cost.toFixed(0)}/m² × ${(len * w.props.height).toFixed(1)} m² (openings not taken out)`, ['costBdi'], 'Typical layer costs, to update from SINAPI-SP', 'low'),
  ];
}

export function slabEstimates(p: Project, s: Slab): Estimate[] {
  const a = assemblyOf(p, s), v = values(a);
  const f = frameOf(p);
  const bays = f.bays.filter((b) => b.slabId === s.id);
  const worst = bays.filter((b) => b.deck).sort((x, y) => (y.deck!.util) - (x.deck!.util))[0];
  const out: Estimate[] = [
    est('Build-up', v.thickness, 'm', `Sum of the layers of “${a.name}” (the drawn slab is the ${s.props.thickness.toFixed(2)} m structural deck)`, [], SRC_ASM),
    est('Own weight', v.weight, 'kN/m²', 'Σ density × thickness of the layers, × 9.81', [], SRC_ASM),
  ];
  if (a.use === 'roof' || a.use === 'terrace') out.push(est('U-value', v.U, 'W/m²K', '1 / (Rsi 0.17 + Σ thickness/λ + Rse 0.04), heat flowing down', ['zone', 'absorptance'], 'NBR 15220-2 method; limits NBR 15575-5 (verify)'));
  if (bays.length) {
    const g = Math.max(...bays.map((b) => b.g)), q = Math.max(...bays.map((b) => b.q));
    out.push(est('Dead load (max bay)', g, 'kN/m²', 'Assembly + finishes + partitions (or the walls on it) + equipment', ['finishes', 'partitions', 'tankVolume'], 'NBR 6120:2019 (verify the tables)'));
    out.push(est('Live load (max bay)', q, 'kN/m²', 'By the use of the rooms on it', ['liveDwelling', 'liveService', 'liveStair', 'liveTerrace', 'liveRoof'], 'NBR 6120:2019 (verify the tables)'));
  }
  if (worst?.deck) out.push(est('Longest deck span', worst.span, 'm', worst.deck.reason, ['deckUnpropped', 'deckPropped'], 'Manufacturer-type deck table (verify with the supplier)'));
  out.push(est('Cost', v.cost, 'R$/m²', 'Σ layer costs', [], 'Typical layer costs, to update from SINAPI-SP', 'low'));
  return out;
}

export function beamEstimates(p: Project, b: Beam): Estimate[] {
  const r = frameOf(p).beams.find((x) => x.beam.id === b.id);
  if (!r) return [];
  const worst = [...r.spans].sort((a, c) => c.w * c.L * c.L - a.w * a.L * a.L)[0];
  const out: Estimate[] = [];
  if (worst) {
    out.push(est('Line load (service)', worst.w, 'kN/m', `Deck strips that span onto it (lever rule) + walls on it; worst span ${worst.L.toFixed(2)} m`, ['finishes', 'partitions', 'liveDwelling'], 'NBR 6120:2019 loads (estimate)'));
    out.push(est('Depth by rule of thumb', worst.depthRule, 'm', `span / ${worst.primary ? '20 (primary: on columns)' : '25 (secondary: on beams)'}`, [], 'Rule of thumb for pre-design'));
  }
  out.push(est('Utilisation', r.check.util, '', r.check.governing, ['gammaF', 'fy', 'gammaA', 'deflection'], 'NBR 8800:2008 (plastic bending, top flange braced by the deck; Annex C deflection)'));
  if (r.proposed) out.push(est('Lightest section that passes', r.proposed.d, 'm deep', `${r.proposed.name} (${r.proposed.kg} kg/m): first W section from the lightest up that passes bending and deflection on every span`, ['fy', 'deflection'], 'Gerdau W table (to verify)'));
  return out;
}

export function columnEstimates(p: Project, c: Column): Estimate[] {
  const r = frameOf(p).columns.find((x) => x.col.id === c.id);
  if (!r) return [];
  return [
    est('Axial load (service)', r.N, 'kN', `Tributary areas of every slab above (${r.byLevel.map((l) => `${l.slab}: ${l.kN.toFixed(0)} kN`).join('; ')}) + own weight`, ['finishes', 'partitions', 'liveDwelling', 'liveRoof'], 'NBR 6120:2019 (estimate)'),
    est('Utilisation', r.check.util, '', r.check.governing, ['gammaF', 'fy', 'gammaA'], c.props.kind === 'pier' ? 'Concrete C25: 0.85·fcd·A (estimate)' : 'NBR 8800:2008, χ from the slenderness, K = 1'),
    ...(r.proposed ? [est('Lightest section that passes', r.proposed.kg, 'kg/m', `${r.proposed.name}: first H or square hollow section that carries ${r.Nd.toFixed(0)} kN over ${r.L.toFixed(2)} m`, ['fy'], 'Gerdau W table and HSS geometry (to verify)')] : []),
  ];
}

export function footingEstimates(p: Project, f: Footing): Estimate[] {
  const r = frameOf(p).footings.find((x) => x.footing.id === f.id);
  if (!r) return [];
  return [
    est('Load on the soil', r.N, 'kN', 'Column service load + 10 % for the footing', ['soilPressure'], 'NBR 6122 (estimate)'),
    est('Proposed square side', r.B, 'm', `√(N / σ) = √(${r.N.toFixed(0)} kN / allowable soil pressure), rounded up to 5 cm, at least 0.60 m`, ['soilPressure'], 'NBR 6122; soil TO CONFIRM by SPT', 'low', true),
    est('Proposed depth', r.h, 'm', '(side − column) / 3 for a rigid pad, at least the minimum depth', ['footingMinDepth'], 'Rule of thumb (rigid footing)'),
    est('Pressure under the drawn footing', r.pressure, 'kPa', r.check.governing, ['soilPressure'], 'NBR 6122; soil TO CONFIRM by SPT', 'low', true),
  ];
}

export function featureEstimates(p: Project, f: Feature): Estimate[] {
  const c = featureCost(p, f);
  return [est('Cost', c.value, 'R$', c.how, ['costBdi'], 'Typical supplier prices (to update)', 'low')];
}
