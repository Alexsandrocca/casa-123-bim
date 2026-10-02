// Electrical design: groups devices into circuits, balances the phases, routes conduits and sizes cables and breakers.
// Pure and repeatable: the same devices always give the same circuits.
import { q } from '../geometry';
import { routeConduits } from './conduits';
import type { Circuit, Device, Element, Project } from '../schema';
import { conduitFor, deviceType, dropPct, sectionFor } from './library';
import { entryLevel, topLevel } from '../schema';

type Phase = 'A' | 'B' | 'C';
const PHASES: Phase[] = ['A', 'B', 'C'];
/** Most a general circuit carries: phase voltage × 10 A (1,270 VA at 127 V). */
const maxGeneralVa = (p: Project) => p.site.region.supply.phaseV * 10;

const floorOf = (p: Project, d: Device) => (d.level === 'roof' ? topLevel(p) : d.level === 'site' || d.level === 'carport' ? entryLevel(p) : d.level);

/** The supply voltage for a point: ordinary points use the phase voltage; points that need about 220 V use the
 * phase voltage where it is already 220 V (220/380 supplies) and two phases where it is 127 V (127/220 supplies). */
export function voltageFor(p: Project, need: 'low' | 'high'): { voltage: number; line: boolean } {
  const s = p.site.region.supply;
  if (need === 'low' || s.phaseV >= 200 || s.phases < 2) return { voltage: s.phaseV, line: false };
  return { voltage: s.lineV, line: true };
}

export const panels = (p: Project) => p.elements.filter((e): e is Device => e.type === 'Device' && deviceType(e.props.kind).group === 'panel' && e.props.kind !== 'essential-panel');
export const mainPanel = (p: Project) => panels(p).find((d) => d.props.kind === 'panel');
export const subPanel = (p: Project) => panels(p).find((d) => d.props.kind === 'sub-panel');

/** Which group (and so which circuit) a device belongs to. */
function groupKey(p: Project, d: Device): { key: string; name: string; purpose: Circuit['props']['purpose']; voltage: number; line: boolean; panel: string } | null {
  const t = deviceType(d.props.kind);
  if (!['outlet', 'light', 'dedicated'].includes(t.group)) return null;
  const sub = subPanel(p), main = mainPanel(p);
  if (!main) return null;
  const onSub = !!sub && d.level === sub.level && sub.level !== main.level;
  const panel = onSub ? sub.id : main.id;
  const L = floorOf(p, d);
  const outdoor = d.level === 'site' || d.level === 'carport' || /veranda|garden|ramp|front door|carport/i.test(d.props.name);
  if (t.group === 'dedicated') return { key: `ded-${d.id}`, name: d.props.name, purpose: 'dedicated', ...voltageFor(p, t.voltage ?? 'high'), panel };
  if (t.group === 'light') {
    if (outdoor) return { key: onSub ? 'light-ext-LL' : 'light-ext', name: onSub ? 'Exterior lighting, garden' : 'Exterior lighting', purpose: 'lighting', ...voltageFor(p, 'low'), panel };
    return { key: `light-${L}`, name: `Lighting ${L}`, purpose: 'lighting', ...voltageFor(p, 'low'), panel };
  }
  const room = /· (.+?)( \(|$)/.exec(d.props.name)?.[1] ?? '';
  const cat = room === 'Kitchen' ? 'kitchen' : room === 'Laundry' ? 'laundry' : /WC|Bath/.test(room) ? 'wet' : 'general';
  return { key: `out-${L}-${cat}`, name: `Outlets ${L} ${cat}`, purpose: 'outlets', ...voltageFor(p, 'low'), panel };
}

/** Recompute circuits, phases, conduits and sizes from the devices. Devices on a circuit chosen by hand stay on it. */
export function withElectrical(p: Project): Project {
  const devices = p.elements.filter((e): e is Device => e.type === 'Device');
  const main = mainPanel(p);
  if (!main) return p;
  const oldCircuits = new Map(p.elements.filter((e): e is Circuit => e.type === 'Circuit').map((c) => [c.id, c]));

  // 1. group
  const groups = new Map<string, { name: string; purpose: Circuit['props']['purpose']; voltage: number; line: boolean; panel: string; devs: Device[] }>();
  const assign = new Map<string, string>();
  for (const d of devices) {
    const g = groupKey(p, d);
    if (!g) continue;
    if (d.props.manualCircuit && d.props.circuit) { assign.set(d.id, d.props.circuit); continue; }
    const v = groups.get(g.key) ?? { ...g, devs: [] };
    v.devs.push(d);
    groups.set(g.key, v);
  }
  // split general groups that carry too much (phase voltage × 10 A), keeping devices in order along the floor
  const circuits: { id: string; name: string; purpose: Circuit['props']['purpose']; voltage: number; line: boolean; panel: string; devs: Device[] }[] = [];
  for (const [key, g] of groups) {
    if (g.purpose === 'dedicated' || g.purpose === 'lighting') { circuits.push({ id: `ckt-${key}`, ...g }); continue; }
    const sorted = [...g.devs].sort((a, b) => a.props.at[1] - b.props.at[1] || a.props.at[0] - b.props.at[0]);
    let part: Device[] = [], va = 0, n = 1;
    for (const d of sorted) {
      if (part.length && va + d.props.power > maxGeneralVa(p)) { circuits.push({ id: `ckt-${key}-${n}`, ...g, name: `${g.name} ${n}`, devs: part }); n++; part = []; va = 0; }
      part.push(d); va += d.props.power;
    }
    if (part.length) circuits.push({ id: `ckt-${key}-${n}`, ...g, name: n > 1 ? `${g.name} ${n}` : g.name, devs: part });
  }
  for (const c of circuits) for (const d of c.devs) assign.set(d.id, c.id);
  // devices placed on a circuit by hand
  for (const [devId, cid] of assign) {
    if (circuits.some((c) => c.id === cid)) { const c = circuits.find((x) => x.id === cid)!; const d = devices.find((x) => x.id === devId)!; if (!c.devs.includes(d)) c.devs.push(d); }
  }

  // 2. conduits and lengths (spec 04b: through the floor screed, the crawlspace, the ceiling plenum or the slab above,
  // the ground and the roof zones; between floors in the electrical shaft; up or down the walls to each point)
  const routed = routeConduits(p, circuits.map((c) => ({ id: c.id, panel: devices.find((d) => d.id === c.panel)!, devs: c.devs })));
  const conduits = routed.conduits;
  const lengths = routed.lengths;
  const route = (cid: string, from: Device, devs: Device[]) => {
    const r = routeConduits(p, [{ id: cid, panel: from, devs }], conduits);
    conduits.push(...r.conduits);
    for (const [k, v] of r.lengths) lengths.set(k, v);
    routed.noRoute.push(...r.noRoute);
  };

  // 3. feeder to the sub-panel
  const sub = subPanel(p);
  const all: { id: string; name: string; purpose: Circuit['props']['purpose']; voltage: number; line: boolean; panel: string; devs: Device[] }[] = [...circuits];
  if (sub) {
    all.push({ id: 'ckt-feeder-LL', name: 'Feeder to the sub-panel', purpose: 'feeder', voltage: p.site.region.supply.lineV, line: true, panel: main.id, devs: [] });
    route('ckt-feeder-LL', main, [sub]);
  }

  // 4. loads, phases, sizes
  const loadOf = (c: (typeof all)[number]) => (c.purpose === 'feeder'
    ? q(0.8 * circuits.filter((x) => x.panel === sub?.id).reduce((a, x) => a + x.devs.reduce((s, d) => s + d.props.power, 0), 0))
    : c.devs.reduce((a, d) => a + d.props.power, 0));
  const phaseLoad: Record<string, Record<Phase, number>> = {};
  const result: Circuit[] = [];
  const order = [...all].sort((a, b) => loadOf(b) - loadOf(a) || a.id.localeCompare(b.id));
  for (const c of order) {
    const load = loadOf(c);
    const pl = (phaseLoad[c.panel] ??= { A: 0, B: 0, C: 0 });
    let phases: Phase[];
    if (c.purpose === 'feeder') { phases = ['A', 'B', 'C']; for (const ph of phases) pl[ph] += load / 3; }
    else if (c.line) {
      const pairs: Phase[][] = [['A', 'B'], ['B', 'C'], ['A', 'C']];
      phases = pairs.reduce((a, b) => (pl[b[0]!] + pl[b[1]!] < pl[a[0]!] + pl[a[1]!] ? b : a));
      for (const ph of phases) pl[ph] += load / 2;
    } else {
      phases = [PHASES.reduce((a, b) => (pl[b] < pl[a] ? b : a))];
      pl[phases[0]!] += load;
    }
    const current = c.purpose === 'feeder' ? load / (Math.sqrt(3) * c.voltage) : load / c.voltage;
    const length = lengths.get(c.id) ?? 0;
    const sized = sectionFor(c.purpose, current, c.purpose === 'feeder' ? length * Math.sqrt(3) / 2 : length, c.voltage);
    const old = oldCircuits.get(c.id);
    const section = old?.props.manualSection ?? sized.section;
    const rcd = c.purpose === 'outlets' || c.devs.some((d) => deviceType(d.props.kind).rcd || /WC|Bath|veranda|garden|ramp|carport|front door/i.test(d.props.name));
    result.push({
      id: c.id, type: 'Circuit', level: devices.find((d) => d.id === c.panel)?.level ?? entryLevel(p), tags: ['auto'],
      props: {
        name: c.name, panel: c.panel, purpose: c.purpose, voltage: c.voltage, phases, load: q(load), current: Math.round(current * 10) / 10,
        section, breaker: sized.breaker, rcd, length,
        drop: Math.round(dropPct(c.purpose === 'feeder' ? length * Math.sqrt(3) / 2 : length, current, section, c.voltage) * 100) / 100,
        ...(old?.props.manualSection ? { manualSection: old.props.manualSection } : {}),
      },
    });
  }
  result.sort((a, b) => a.id.localeCompare(b.id));
  // conduit size from the circuit's cable
  const sectionOf = new Map(result.map((c) => [c.id, c.props.section]));
  for (const c of conduits) c.props.dn = conduitFor(sectionOf.get(c.props.circuit) ?? 2.5);

  const mep = { noRoute: [...(p.mep?.noRoute ?? []).filter((n) => n.system !== 'electrical'), ...routed.noRoute], notes: [...(p.mep?.notes ?? []).filter((n) => !n.startsWith('Electrical')), ...routed.notes] };
  const elements: Element[] = p.elements
    .filter((e) => e.type !== 'Circuit' && e.type !== 'Conduit')
    .map((e) => (e.type === 'Device' && assign.has(e.id) && e.props.circuit !== assign.get(e.id) ? { ...e, props: { ...e.props, circuit: assign.get(e.id) } } : e));
  return { ...p, mep, elements: [...elements, ...result, ...conduits] };
}

/** Phase loads of a panel and the imbalance between the most and least loaded phase, %. */
export function phaseBalance(p: Project, panelId: string) {
  const pl: Record<Phase, number> = { A: 0, B: 0, C: 0 };
  for (const c of p.elements) {
    if (c.type !== 'Circuit' || c.props.panel !== panelId) continue;
    for (const ph of c.props.phases) pl[ph] += c.props.load / c.props.phases.length;
  }
  const vals = Object.values(pl), avg = vals.reduce((a, b) => a + b, 0) / 3;
  return { loads: pl, imbalance: avg > 0 ? ((Math.max(...vals) - Math.min(...vals)) / avg) * 100 : 0 };
}
