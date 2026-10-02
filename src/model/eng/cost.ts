// Cost estimate (spec 08), two methods side by side with a ±25 % range.
//   1. By area: CUB/m² × equivalent area (NBR 12721 weights), plus what the CUB leaves out.
//   2. By quantities: assemblies, structure, openings, systems and features × editable unit costs.
import { openingSeg, wallSeg } from '../geometry';
import { isPlanLevel, planLevels, type Project, type Slab, type Wall } from '../schema';
import { slabRect, slabVoids } from '../structure';
import { energyEstimate } from '../electrical/solar';
import { kindOf } from '../plumbing/library';
import { A, valueOf } from './assumptions';
import { assemblyOf, values } from './assemblies';
import { featureCost, outward } from './features';
import type { Quantities } from './frame';

export interface CostItem { key: string; group: string; label: string; qty: number; unit: string; rate: number; value: number; how: string }

export interface CostEstimate {
  /** method 1 */
  area: { main: number; veranda: number; carport: number; open: number; equivalent: number; cub: number | null; extras: number; total: number | null };
  /** method 2 */
  items: CostItem[];
  subtotal: number;
  bdi: number;
  total: number;
  perM2: number;
  /** gross area used for cost per m² */
  gross: number;
  range: (v: number) => [number, number];
}

const RANGE = 0.25;

function slabArea(p: Project, s: Slab): number {
  const r = slabRect(p, s);
  const area = s.props.spaces
    ? p.elements.flatMap((x) => (x.type === 'Space' && s.props.spaces!.includes(x.id) ? x.props.cells : [])).reduce((a, c) => a + (c.x1 - c.x0) * (c.y1 - c.y0), 0)
    : (r.x1 - r.x0) * (r.y1 - r.y0);
  return area - slabVoids(p, s).reduce((a, c) => a + (c.x1 - c.x0) * (c.y1 - c.y0), 0);
}

function netWallArea(p: Project, w: Wall): number {
  const s = wallSeg(w);
  const holes = p.elements.reduce((a, o) => a + (o.type === 'Opening' && o.props.host === w.id ? o.props.width * o.props.height : 0), 0);
  return Math.max(0, (s.b - s.a) * w.props.height - holes);
}

export function costEstimate(p: Project, q: Quantities): CostEstimate {
  /* ---- method 1: by area ---- */
  const main = p.elements.reduce((a, s) => a + (s.type === 'Space' && isPlanLevel(p, s.level) ? s.props.cells.reduce((t, c) => t + (c.x1 - c.x0) * (c.y1 - c.y0), 0) : 0), 0);
  let veranda = 0, open = 0, carport = 0;
  for (const d of p.elements) {
    if (d.type === 'Carport') carport += (d.props.rect.x1 - d.props.rect.x0) * (d.props.rect.y1 - d.props.rect.y0);
    // decks on the lowest floor of a house with several floors are garden paving, not built area
    if (d.type !== 'Deck' || (planLevels(p).length > 1 && d.level === planLevels(p)[0])) continue;
    const r = d.props.rect, total = (r.x1 - r.x0) * (r.y1 - r.y0);
    // the part with a slab over it is a covered veranda
    let covered = 0;
    for (const s of p.elements) {
      if (s.type !== 'Slab' || s.props.onGrade || s.props.topElevation < d.props.elevation + 2) continue;
      const sr = slabRect(p, s);
      covered += Math.max(0, Math.min(r.x1, sr.x1) - Math.max(r.x0, sr.x0)) * Math.max(0, Math.min(r.y1, sr.y1) - Math.max(r.y0, sr.y0));
    }
    covered = Math.min(covered, total);
    veranda += covered; open += total - covered;
  }
  const equivalent = main + veranda * A(p, 'wVeranda') + carport * A(p, 'wCarport') + open * A(p, 'wOpen');
  const cub = valueOf(p, 'cub');
  const extras = A(p, 'cubExtras') / 100;
  const areaTotal = cub === null ? null : cub * equivalent * (1 + extras);

  /* ---- method 2: by quantities ---- */
  const items: CostItem[] = [];
  const add = (key: string, group: string, label: string, qty: number, unit: string, rate: number, how?: string) => {
    if (qty <= 0 || rate <= 0) return;
    const ex = items.find((i) => i.key === key);
    if (ex) { ex.qty += qty; ex.value += qty * rate; ex.how = `${ex.qty.toFixed(1)} ${unit} × R$ ${rate.toFixed(0)}`; return; }
    items.push({ key, group, label, qty, unit, rate, value: qty * rate, how: how ?? `${qty.toFixed(1)} ${unit} × R$ ${rate.toFixed(0)}` });
  };
  for (const w of p.elements) {
    if (w.type !== 'Wall') continue;
    const a = assemblyOf(p, w);
    add(`wall:${a.id}`, 'Walls', a.name, netWallArea(p, w), 'm²', values(a).cost);
  }
  for (const s of p.elements) {
    if (s.type !== 'Slab') continue;
    const a = assemblyOf(p, s);
    add(`slab:${a.id}`, 'Floors and roofs', a.name, slabArea(p, s), 'm²', values(a).cost);
  }
  add('steel', 'Structure', 'Steel frame (beams, columns, connections)', q.steelKg, 'kg', A(p, 'costSteel'));
  add('concrete', 'Structure', 'Concrete in footings and retaining walls', q.concrete.footings + q.concrete.retaining, 'm³', A(p, 'costConcrete'));
  add('rebar', 'Structure', 'Rebar in footings and retaining walls', q.concrete.footings * A(p, 'rebarFooting') + q.concrete.retaining * A(p, 'rebarWall'), 'kg', A(p, 'costRebar'));
  add('formwork', 'Structure', 'Formwork', q.formwork, 'm²', A(p, 'costFormwork'));
  add('excavation', 'Site', 'Excavation for the lower level and the footings', q.excavation, 'm³', A(p, 'costExcavation'));
  for (const c of p.elements) if (c.type === 'Carport') add('carport-roof', 'Site', 'Carport roof sheet', (c.props.rect.x1 - c.props.rect.x0) * (c.props.rect.y1 - c.props.rect.y0), 'm²', 220);
  for (const o of p.elements) {
    if (o.type !== 'Opening') continue;
    const w = p.elements.find((e): e is Wall => e.type === 'Wall' && e.id === o.props.host);
    const outside = w ? outward(p, w) !== 0 : false;
    const area = o.props.width * o.props.height;
    if (o.props.role === 'window') add('windows', 'Openings', 'Windows', area, 'm²', A(p, 'costWindow'));
    else if (o.props.kind === 'slider' || o.props.kind === 'garage' || outside) add('outer-doors', 'Openings', 'Glass sliders and outside doors', area, 'm²', A(p, 'costSlider'));
    else add('doors', 'Openings', 'Inside doors', 1, 'each', A(p, 'costDoor'));
    void openingSeg;
  }
  add('stairs', 'Structure', 'Stairs', p.elements.filter((e) => e.type === 'Stair').length, 'each', A(p, 'costStair'));
  const pipeM = p.elements.reduce((a, e) => a + (e.type === 'PipeSegment' ? Math.hypot(e.props.end[0] - e.props.start[0], e.props.end[1] - e.props.start[1], e.props.end[2] - e.props.start[2]) : 0), 0);
  add('pipes', 'Systems', 'Plumbing pipes and fittings', pipeM, 'm', A(p, 'costPlumbing'));
  add('fixtures', 'Systems', 'Sanitary fixtures and equipment', p.elements.filter((e) => e.type === 'Fixture' && !e.tags.includes('auto') && kindOf(e.props.kind).group !== undefined && e.props.kind !== 'stack').length, 'each', A(p, 'costFixture'));
  add('elec', 'Systems', 'Electrical points with cable and conduit', p.elements.filter((e) => e.type === 'Device').length, 'each', A(p, 'costElecPoint'));
  const pv = energyEstimate(p);
  if (pv) add('pv', 'Systems', 'Solar PV', pv.kwp, 'kWp', A(p, 'costPv'));
  for (const f of p.elements) {
    if (f.type !== 'Feature') continue;
    const c = featureCost(p, f);
    items.push({ key: f.id, group: 'Features', label: f.props.name, qty: 1, unit: 'each', rate: c.value, value: c.value, how: c.how });
  }
  const subtotal = items.reduce((a, i) => a + i.value, 0);
  const bdi = subtotal * (A(p, 'costBdi') / 100);
  const total = subtotal + bdi;
  return {
    area: { main, veranda, carport, open, equivalent, cub, extras, total: areaTotal },
    items: items.sort((a, b) => b.value - a.value), subtotal, bdi, total, perM2: main ? total / main : 0, gross: main,
    range: (v) => [v * (1 - RANGE), v * (1 + RANGE)],
  };
}

export const brl = (v: number) => `R$ ${Math.round(v).toLocaleString('en-US')}`;
