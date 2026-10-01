// Spec 08 CSV exports: assemblies schedule, structure schedule (members, sections, kg), cost estimate.
// Every sheet starts with the disclaimer.
import { wallSeg } from '../geometry';
import type { Project } from '../schema';
import { assemblyOf, values } from './assemblies';
import { section } from './steel';
import { DISCLAIMER, costOf, frameOf } from './index';

const cell = (v: string | number) => { const s = typeof v === 'number' ? String(+v.toFixed(3)) : v; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const rows = (head: string[], body: (string | number)[][]) => [`# ${DISCLAIMER}`, head.join(','), ...body.map((r) => r.map(cell).join(','))].join('\n') + '\n';

export function assembliesCsv(p: Project): string {
  const body: (string | number)[][] = [];
  for (const e of p.elements) {
    if (e.type !== 'Wall' && e.type !== 'Slab') continue;
    const a = assemblyOf(p, e), v = values(a);
    const size = e.type === 'Wall' ? (() => { const s = wallSeg(e); return (s.b - s.a) * e.props.height; })() : 0;
    body.push([e.id, e.type === 'Wall' ? e.props.wallType : 'slab', a.id, a.name, v.thickness, v.mass, v.weight, v.U, v.CT, v.Rw, v.cost, size, a.layers.map((l) => `${l.material} ${(l.t * 1000).toFixed(0)} mm`).join(' / ')]);
  }
  return rows(['element', 'use', 'assembly id', 'assembly', 'thickness m', 'mass kg/m2', 'weight kN/m2', 'U W/m2K', 'CT kJ/m2K', 'Rw dB', 'cost R$/m2', 'wall area m2', 'layers outside to inside'], body);
}

export function structureCsv(p: Project): string {
  const f = frameOf(p);
  const body: (string | number)[][] = [];
  for (const b of f.beams) {
    const len = Math.hypot(b.beam.props.end[0] - b.beam.props.start[0], b.beam.props.end[1] - b.beam.props.start[1]);
    const kg = section(b.beam.props.profile)?.kg ?? 0;
    body.push(['beam', b.beam.id, b.beam.props.profile, len, kg, kg * len, b.check.util, b.check.status, b.check.governing, b.proposed?.name ?? '', '']);
  }
  for (const c of f.columns) {
    const len = c.col.props.topElevation - c.col.props.baseElevation;
    const kg = section(c.col.props.profile)?.kg ?? 0;
    body.push([c.col.props.kind, c.col.id, c.col.props.profile, len, kg, kg * len, c.check.util, c.check.status, c.check.governing, c.proposed?.name ?? '', c.N]);
  }
  for (const x of f.footings) {
    const r = x.footing.props.rect;
    body.push(['footing', x.footing.id, `${(r.x1 - r.x0).toFixed(2)} × ${(r.y1 - r.y0).toFixed(2)} × ${x.footing.props.depth.toFixed(2)}`, 0, 0, 0, x.check.util, x.check.status, x.check.governing, `${x.B.toFixed(2)} × ${x.B.toFixed(2)} × ${x.h.toFixed(2)}`, x.N]);
  }
  const q = f.quantities;
  body.push(['total', 'steel', '', 0, 0, q.steelKg, 0, '', `${q.steelPerM2.toFixed(1)} kg/m² of floor (connections included)`, '', '']);
  body.push(['total', 'concrete', '', 0, 0, 0, 0, '', `${q.concrete.total.toFixed(2)} m³ (footings ${q.concrete.footings.toFixed(2)}, retaining ${q.concrete.retaining.toFixed(2)}, slabs ${q.concrete.slabs.toFixed(2)}); rebar ${q.rebarKg.toFixed(0)} kg; formwork ${q.formwork.toFixed(0)} m²`, '', '']);
  return rows(['kind', 'id', 'section / size', 'length m', 'kg/m', 'kg', 'utilisation', 'status', 'governing rule', 'proposed', 'service load kN'], body);
}

export function costCsv(p: Project): string {
  const c = costOf(p);
  const body: (string | number)[][] = c.items.map((i) => [i.group, i.label, i.qty, i.unit, i.rate, i.value, i.how]);
  body.push(['', 'Subtotal', 0, '', 0, c.subtotal, '']);
  body.push(['', 'Overheads and profit (BDI)', 0, '', 0, c.bdi, '']);
  body.push(['', 'Total by quantities', 0, '', 0, c.total, `range ${c.range(c.total).map((v) => Math.round(v)).join(' – ')}`]);
  body.push(['', 'Total by area (CUB)', c.area.equivalent, 'm² equivalent', c.area.cub ?? 0, c.area.total ?? 0, c.area.total === null ? 'CUB TO CONFIRM' : `range ${c.range(c.area.total).map((v) => Math.round(v)).join(' – ')}`]);
  return rows(['group', 'item', 'quantity', 'unit', 'rate R$', 'value R$', 'how'], body);
}
