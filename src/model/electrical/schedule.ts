// Electrical schedules: circuits, and the bill of materials (cable by section, conduit, boxes, breakers, RCDs, devices).
import { legalCsvLines } from '../legal';
import type { Circuit, Conduit, Device, Project } from '../schema';
import { deviceType } from './library';

const csvCell = (v: string | number) => (typeof v === 'number' ? String(v) : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const len = (c: Conduit) => Math.hypot(c.props.end[0] - c.props.start[0], c.props.end[1] - c.props.start[1], c.props.end[2] - c.props.start[2]);

/** Conductors in a circuit's cable: 3 phases + neutral + earth for a feeder; otherwise phase + neutral (or two phases) + earth. */
export const conductors = (c: Circuit) => (c.props.purpose === 'feeder' ? 5 : 3);
export const poles = (c: Circuit) => c.props.phases.length;

export function circuitRows(p: Project) {
  const devices = p.elements.filter((e): e is Device => e.type === 'Device');
  return p.elements.filter((e): e is Circuit => e.type === 'Circuit').map((c) => ({
    id: c.id, name: c.props.name, panel: devices.find((d) => d.id === c.props.panel)?.props.name ?? c.props.panel,
    points: devices.filter((d) => d.props.circuit === c.id).length, load: c.props.load, voltage: c.props.voltage, phases: c.props.phases.join(''),
    current: c.props.current, section: c.props.section, breaker: c.props.breaker, rcd: c.props.rcd, length: c.props.length, drop: c.props.drop,
  })).sort((a, b) => a.panel.localeCompare(b.panel) || a.id.localeCompare(b.id));
}

export function billOfMaterials(p: Project) {
  const circuits = p.elements.filter((e): e is Circuit => e.type === 'Circuit');
  const conduits = p.elements.filter((e): e is Conduit => e.type === 'Conduit');
  const devices = p.elements.filter((e): e is Device => e.type === 'Device');
  const cable = new Map<number, number>();
  const conduit = new Map<number, number>();
  for (const c of circuits) {
    const run = conduits.filter((x) => x.props.circuit === c.id).reduce((a, x) => a + len(x), 0);
    cable.set(c.props.section, (cable.get(c.props.section) ?? 0) + run * conductors(c) * 1.1);
  }
  for (const x of conduits) conduit.set(x.props.dn, (conduit.get(x.props.dn) ?? 0) + len(x));
  const breakers = new Map<string, number>();
  for (const c of circuits) { const k = `${poles(c)}P ${c.props.breaker} A`; breakers.set(k, (breakers.get(k) ?? 0) + 1); }
  const panelsWithRcd = new Map<string, number>();
  for (const c of circuits) if (c.props.rcd) panelsWithRcd.set(c.props.panel, (panelsWithRcd.get(c.props.panel) ?? 0) + 1);
  const rcds = [...panelsWithRcd.values()].reduce((a, n) => a + Math.ceil(n / 4), 0); // one 30 mA RCD per group of up to 4 circuits
  const boxes = { 'Wall box 4×2': devices.filter((d) => ['outlet', 'switch', 'dedicated'].includes(deviceType(d.props.kind).group) && !['ac-outdoor', 'rack'].includes(d.props.kind)).length,
    'Ceiling box (octagonal)': devices.filter((d) => d.props.kind === 'ceiling-light' || d.props.kind === 'smoke-detector').length };
  const deviceCount = new Map<string, number>();
  for (const d of devices) deviceCount.set(deviceType(d.props.kind).label, (deviceCount.get(deviceType(d.props.kind).label) ?? 0) + 1);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    cable: [...cable.entries()].sort((a, b) => a[0] - b[0]).map(([section, metres]) => ({ section, metres: r1(metres) })),
    conduit: [...conduit.entries()].sort((a, b) => a[0] - b[0]).map(([dn, metres]) => ({ dn, metres: r1(metres) })),
    boxes: Object.entries(boxes).map(([item, count]) => ({ item, count })),
    breakers: [...breakers.entries()].sort().map(([item, count]) => ({ item, count })),
    protection: [{ item: 'RCD 30 mA (2P/4P, groups of up to 4 circuits)', count: rcds }, { item: 'Surge protection (DPS) per panel', count: devices.filter((d) => d.props.kind === 'panel' || d.props.kind === 'sub-panel').length }],
    devices: [...deviceCount.entries()].sort().map(([item, count]) => ({ item, count })),
  };
}

export function electricalCsv(p: Project): string {
  const rows = circuitRows(p);
  const b = billOfMaterials(p);
  const lines = [
    ...legalCsvLines(),
    'Circuits', 'Id,Circuit,Panel,Points,Load,Voltage,Phases,Current A,Section mm2,Breaker A,RCD,Length m,Drop %',
    ...rows.map((r) => [r.id, r.name, r.panel, r.points, r.load, r.voltage, r.phases, r.current, r.section, r.breaker, r.rcd ? 'yes' : 'no', r.length, r.drop].map(csvCell).join(',')),
    '', 'Cable', 'Section mm2,Metres', ...b.cable.map((x) => `${x.section},${x.metres}`),
    '', 'Conduit', 'DN mm,Metres', ...b.conduit.map((x) => `${x.dn},${x.metres}`),
    '', 'Boxes, breakers and protection', 'Item,Count', ...[...b.boxes, ...b.breakers, ...b.protection].map((x) => `${csvCell(x.item)},${x.count}`),
    '', 'Devices', 'Device,Count', ...b.devices.map((x) => `${csvCell(x.item)},${x.count}`),
  ];
  return lines.join('\n') + '\n';
}
