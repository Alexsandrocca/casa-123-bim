// Spec 08 rows in the checks bar: structure pre-sizing, thermal (NBR 15575), environment, roof equipment (Q12).
// Details live in the Engineering window; here one row per subject keeps the list readable.
import type { CheckResult } from '../checks';
import type { Project } from '../schema';
import { slabRect } from '../structure';
import { cityCode } from '../region';
import { A, valueOf } from './assumptions';
import { featureEaves } from './features';
import { type Status } from './frame';
import { envOf, frameOf, thermalOf } from './index';

const ST: Record<Status, CheckResult['status']> = { ok: 'pass', amber: 'warn', red: 'fail' };
const worst = (s: Status[]): Status => (s.includes('red') ? 'red' : s.includes('amber') ? 'amber' : 'ok');
const EST = 'Estimate (spec 08 rules of thumb); the structural engineer designs the real frame (NBR 8800, NBR 6122)';

export function engineeringChecks(p: Project): CheckResult[] {
  const out: CheckResult[] = [];
  const f = frameOf(p);

  // steel deck spans, one row per slab
  const slabs = [...new Set(f.bays.filter((b) => b.deck).map((b) => b.slabId))];
  for (const id of slabs) {
    const bays = f.bays.filter((b) => b.slabId === id && b.deck);
    const st = worst(bays.map((b) => b.deck!.status));
    const bad = bays.filter((b) => b.deck!.status !== 'ok').sort((a, b) => b.span - a.span)[0];
    out.push({
      id: `eng:deck:${id}`, group: 'Structure', elementIds: [id], title: `Steel deck spans · ${bays[0]!.slabName}`, status: ST[st],
      value: bad ? `longest ${bad.span.toFixed(2)} m: ${bad.deck!.reason}` : `all spans ≤ ${A(p, 'deckUnpropped').toFixed(2)} m`,
      rule: `Deck spans ≤ ${A(p, 'deckUnpropped').toFixed(2)} m without props, ≤ ${A(p, 'deckPropped').toFixed(2)} m with props (assumptions)`, source: 'Manufacturer-type deck table (verify with the supplier)',
    });
  }
  const members = (key: string, title: string, list: { id: string; status: Status; util: number }[], rule: string) => {
    if (!list.length) return;
    const red = list.filter((m) => m.status === 'red'), amber = list.filter((m) => m.status === 'amber');
    const top = [...list].sort((a, b) => b.util - a.util)[0]!;
    out.push({
      id: `eng:${key}`, group: 'Structure', elementIds: (red.length ? red : amber).map((m) => m.id), title,
      status: ST[worst(list.map((m) => m.status))],
      value: `${red.length} over capacity, ${amber.length} between 0.7 and 1.0, ${list.length - red.length - amber.length} fine · highest ${top.id} at ${top.util.toFixed(2)}${red.length ? ' · Engineering → Structure proposes sections' : ''}`,
      rule, source: EST,
    });
  };
  members('beams', 'Beams (pre-sizing)', f.beams.map((b) => ({ id: b.beam.id, status: b.check.status, util: b.check.util })), `Bending with fy ${A(p, 'fy')} MPa and deflection ≤ span/${A(p, 'deflection')} under ${A(p, 'gammaF')} × loads`);
  members('columns', 'Columns and piers (pre-sizing)', f.columns.map((c) => ({ id: c.col.id, status: c.check.status, util: c.check.util })), 'Axial capacity χ·A·fy/1.10, K = 1, buckling between the floors');
  members('footings', 'Footings (pre-sizing)', f.footings.map((x) => ({ id: x.footing.id, status: x.check.status, util: x.check.util })), `Soil pressure under each pad ≤ ${A(p, 'soilPressure')} kPa`);
  members('retaining', 'Retaining walls (pre-sizing)', f.retaining.map((r) => ({ id: r.wall.id, status: r.check.status, util: r.check.util })), 'Stem ≈ H/10 (min 0.20 m), base ≈ 0.6 H, with drainage');

  const qn = f.quantities;
  out.push({
    id: 'eng:steel-rate', group: 'Structure', elementIds: [], title: 'Steel per m² of floor',
    status: qn.steelPerM2 >= 25 && qn.steelPerM2 <= 45 ? 'pass' : 'warn',
    value: `${qn.steelKg.toFixed(0)} kg for ${qn.floorArea.toFixed(0)} m² = ${qn.steelPerM2.toFixed(1)} kg/m²${qn.steelPerM2 > 45 ? ' (heavy: try the proposed sections, or shorter spans)' : qn.steelPerM2 < 25 ? ' (light for a steel frame: check the sections)' : ''}`,
    rule: 'Typical steel frames for houses use 25–45 kg/m²', source: 'Rule of thumb (cross-check)',
  });

  // Q12: equipment on the roofs
  const roofBays = f.bays.filter((b) => b.points.some((pt) => /tank|heater/i.test(pt.label)));
  for (const b of roofBays) {
    const eq = b.points.filter((pt) => /tank|heater|pump|AC/i.test(pt.label));
    const kN = eq.reduce((a, pt) => a + pt.kN, 0);
    const beams = f.beams.filter((r) => r.spans.some((sp) => (sp.o === 'v' && b.spanDir === 'x' && (Math.abs(sp.c - b.lo) < 1e-4 || Math.abs(sp.c - b.hi) < 1e-4) && sp.a < b.rect.y1 && sp.b > b.rect.y0)
      || (sp.o === 'h' && b.spanDir === 'y' && (Math.abs(sp.c - b.lo) < 1e-4 || Math.abs(sp.c - b.hi) < 1e-4) && sp.a < b.rect.x1 && sp.b > b.rect.x0)));
    const st = worst([b.deck?.status ?? 'ok', ...beams.map((r) => r.check.status)]);
    out.push({
      id: `eng:roof-equipment:${b.id}`, group: 'Structure', elementIds: eq.map((pt) => pt.id).filter((id) => !id.includes(':')), title: `Roof equipment load · ${b.slabName}`,
      status: ST[st],
      value: `${eq.map((pt) => pt.label).join(', ')}: ${kN.toFixed(1)} kN on ${b.area.toFixed(1)} m² → ${b.service.toFixed(2)} kN/m² in service; deck ${b.deck?.status ?? '—'}, beams under it up to ${Math.max(0, ...beams.map((r) => r.check.util)).toFixed(2)}`,
      rule: 'Full tanks and the heat-pump heater are carried by the deck and the beams under them (Q12)', source: `${EST}; NBR 6120:2019`,
    });
  }
  out.push({
    id: 'eng:bracing', group: 'Structure', elementIds: [], title: 'Lateral bracing (wind)', status: f.bracing.length ? 'pass' : 'warn',
    value: f.bracing.length ? `${Number.isFinite(f.wind.q) ? `wind ≈ ${f.wind.q.toFixed(2)} kN/m² (V0 ${A(p, 'v0')} m/s)` : 'wind: V0 TO CONFIRM'}: ${Number.isFinite(f.wind.q) ? `${f.wind.Fx.toFixed(0)} kN along x, ${f.wind.Fy.toFixed(0)} kN along y` : 'forces not computed'} · ${f.bracing.length} braced bays proposed (Engineering → Structure)` : 'no bay found for bracing',
    rule: 'Each grid direction needs at least one braced bay or moment frame per storey', source: 'NBR 6123 (V0 TO CONFIRM); NBR 8800',
  });
  out.push({
    id: 'eng:soil', group: 'Structure', elementIds: [], title: 'Soil bearing pressure', status: 'confirm',
    value: `${valueOf(p, 'soilPressure') ?? '—'} kPa assumed · TO CONFIRM by SPT borings`, rule: 'Footings are sized on the allowable soil pressure', source: 'NBR 6122; NBR 6484 (SPT)',
  });

  // eaves added as features
  const limit = p.site.eavesLimit ?? NaN;
  for (const e of p.elements) {
    if (e.type !== 'Feature' || e.props.kind !== 'eave') continue;
    const sl = p.elements.find((x) => x.id === e.props.host);
    const base = sl?.type === 'Slab' ? sl.props.eaves ?? 0 : 0;
    const total = base + (sl?.type === 'Slab' ? featureEaves(p, sl, e.props.side ?? '') : 0);
    out.push({
      id: `eng:eave:${e.id}`, group: 'Site', elementIds: [e.id], title: `${e.props.name} (${e.props.side})`, status: Number.isNaN(limit) ? 'confirm' : total <= limit + 1e-9 ? 'pass' : 'fail',
      value: `${total.toFixed(2)} m from the wall (limit ${Number.isNaN(limit) ? 'TO CONFIRM' : `${limit.toFixed(2)} m`})`, rule: 'Eaves up to the city limit are not counted in site coverage', source: cityCode(p),
    });
    void slabRect;
  }

  // thermal
  for (const r of thermalOf(p)) {
    out.push({
      id: `eng:thermal:${r.kind}:${r.assembly.id}`, group: 'Thermal', elementIds: r.elements.map((e) => e.id), title: `${r.kind === 'roof' ? 'Roof' : 'Exterior walls'} · ${r.assembly.name}`,
      status: r.status, value: r.why,
      rule: `NBR 15575 simplified method, ${r.limit.text}`, source: `NBR 15575-${r.kind === 'roof' ? '5' : '4'}:2021 (zone ${valueOf(p, 'zone') ?? '—'} TO CONFIRM against NBR 15220-3:2024)${r.limit.verify ? '; limit to verify' : ''}`,
    });
  }

  // environment
  const env = envOf(p);
  for (const v of env.ventilation) {
    out.push({ id: `env:cross:${v.room.id}`, group: 'Environment', level: v.room.level, elementIds: [v.room.id], title: `${v.room.props.name} cross-ventilation`, status: v.status, value: v.text, rule: 'Long-stay rooms: openings on two facades, or through a door to a room on another facade', source: 'Bioclimatic design principle (NBR 15220-3 strategies)' });
    out.push({ id: `env:vent:${v.room.id}`, group: 'Environment', level: v.room.level, elementIds: [v.room.id], title: `${v.room.props.name} openable area`, status: v.areaOk ? 'pass' : 'fail', value: `${v.openable.toFixed(2)} m² openable (need ${v.need.toFixed(2)} m²)`, rule: 'Openable area at least half of the required window area (floor/8)', source: 'SP sanitary code, Decreto 12.342/78' });
  }
  for (const s of env.sun) {
    out.push({ id: `env:sun:${s.op.id}`, group: 'Environment', level: s.op.level, elementIds: [s.op.id], title: `Sun on glass ${s.op.id}`, status: s.status, value: s.text, rule: 'West glass with more than 2 h of direct sun on 21 Dec needs shading', source: 'Sun model (NOAA) with the eaves, the upper floor, brises and other shading in the model' });
  }
  for (const d of env.daylight) {
    out.push({ id: `env:daylight:${d.room.id}`, group: 'Environment', level: d.room.level, elementIds: [d.room.id], title: `${d.room.props.name} daylight`, status: d.status, value: d.text, rule: 'Average daylight factor ≥ 2 % in long-stay rooms', source: 'BRE average daylight factor formula (estimate)' });
  }
  return out;
}
