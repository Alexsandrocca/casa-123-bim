// Spec 04b checks, group "MEP physics": every pipe, conduit, fixture and device inside or attached to something real.
import type { CheckResult } from '../checks';
import type { Project } from '../schema';
import { mepReport } from './analysis';

const SRC = 'Spec 04b (MEP physics); NBR 8160, 5626, 5410 practice';

export function mepChecks(p: Project): CheckResult[] {
  const hasMep = p.elements.some((e) => e.type === 'PipeSegment' || e.type === 'Conduit');
  if (!hasMep) return [];
  const rep = mepReport(p);
  const out: CheckResult[] = [];
  const G = 'MEP physics' as const;
  const lvl = (id: string) => p.elements.find((e) => e.id === id)?.level;

  /* no route */
  for (const n of p.mep?.noRoute ?? []) {
    out.push({ id: `noroute:${n.network}:${n.item}`, group: G, elementIds: [n.item], level: lvl(n.item), title: `No route · ${n.network}`, status: 'fail', value: `${n.item}: ${n.reason}`, rule: 'If no valid path exists the router says so and draws nothing', source: SRC });
  }

  /* unhosted items */
  const bad = [...rep.items.values()].filter((i) => !i.ok);
  if (!bad.length) out.push({ id: 'mep:hosted', group: G, elementIds: [], title: 'Every fixture and device is hosted', status: 'pass', value: `${rep.items.size} items on a wall face, ceiling, floor, shaft, roof zone or the ground`, rule: 'Every item is attached to a building element that can carry it', source: SRC });
  for (const i of bad) {
    const e = p.elements.find((x) => x.id === i.id);
    const at = e && (e.type === 'Device' || e.type === 'Fixture') ? [e.props.at[0], e.props.at[1], e.props.z] as [number, number, number] : undefined;
    out.push({ id: `mep:unhosted:${i.id}`, group: G, elementIds: [i.id], level: lvl(i.id), title: `Unhosted · ${i.name}`, status: 'fail', value: i.problem ?? 'unhosted', rule: 'Every item is attached to a building element that can carry it', source: SRC, at });
  }

  /* runs outside a service space */
  const segs = [...rep.segs.values()];
  const exposed = segs.filter((s) => s.exposed > 0.03);
  out.push({
    id: 'mep:exposed', group: G, elementIds: exposed.map((s) => s.id), level: exposed[0] ? lvl(exposed[0].id) : undefined,
    title: 'Pipes and conduits inside service spaces', status: exposed.length ? 'fail' : 'pass',
    value: exposed.length ? `${exposed.length} run${exposed.length > 1 ? 's' : ''} exposed or floating (e.g. ${exposed[0]!.id}: ${exposed[0]!.issues[0]})` : `${segs.length} runs, all in walls, shafts, plenums, screed, the crawlspace, the ground or roof zones`,
    rule: 'Each run is inside a wall, shaft, ceiling plenum, floor screed, crawlspace, the ground or a roof zone', source: SRC,
  });
  const wallRule = segs.filter((s) => s.issues.some((x) => /inside a wall|inside an (exterior|retaining) wall|above the crawlspace ground/.test(x)));
  out.push({
    id: 'mep:wallruns', group: G, elementIds: wallRule.map((s) => s.id), title: 'Runs follow the rules of their space', status: wallRule.length ? 'fail' : 'pass',
    value: wallRule.length ? `${wallRule.length}: ${wallRule[0]!.id} ${wallRule[0]!.issues.find((x) => /wall|crawlspace/.test(x))}` : 'walls only vertical drops and ≤ 1 m horizontal runs; nothing too close to the crawlspace ground',
    rule: 'Walls: vertical drops and horizontal runs ≤ 1.0 m (none in outer or retaining walls except conduits); crawlspace runs ≥ 0.15 m above the ground', source: SRC,
  });

  /* forbidden zones */
  const forb = segs.filter((s) => s.forbidden.length);
  out.push({
    id: 'mep:forbidden', group: G, elementIds: forb.map((s) => s.id), title: 'No run crosses a forbidden zone', status: forb.length ? 'fail' : 'pass',
    value: forb.length ? `${forb.length}: ${forb[0]!.id} crosses ${forb[0]!.forbidden[0]!.name}` : 'stair voids and flights, doors (+0.10 m), windows, columns, footings and retaining-wall cores are clear',
    rule: 'Never through stairs, door or window openings, columns, footings or retaining-wall cores; beams only through web holes', source: SRC,
  });

  /* capacity */
  out.push({
    id: 'mep:capacity', group: G, elementIds: rep.capacity.map((c) => c.id), title: 'Service spaces are not over capacity', status: rep.capacity.length ? 'fail' : 'pass',
    value: rep.capacity.length ? `${rep.capacity.length}: ${rep.capacity[0]!.text}` : 'walls hold their DN, the screed only ≤ 25 mm conduits, shafts fit their pipes',
    rule: 'Wall cavity = thickness − 2 × 15 mm (0.12 m → DN ≤ 50, 0.15 m → DN ≤ 75, DN 100 needs a shaft or a 0.20 m wall); screed ≤ 25 mm conduits; shafts sized from their pipes + 50 mm', source: SRC,
  });

  /* slopes */
  const sl = rep.slopes.filter((s) => s.bad);
  out.push({
    id: 'mep:slope', group: G, elementIds: sl.map((s) => s.id), title: 'Gravity pipes fall all the way', status: sl.length ? 'fail' : 'pass',
    value: sl.length ? `${sl.length}: ${sl[0]!.id} ${sl[0]!.bad === 'reversed' ? 'runs uphill' : `is too flat (${(sl[0]!.slope * 100).toFixed(1)} %)`}` : `${rep.slopes.length} gravity runs, none reversed or too flat`,
    rule: 'Sewage and rain fall continuously at the minimum slope (2 % DN ≤ 75, 1 % DN ≥ 100; rain 0.5 %)', source: 'NBR 8160 / NBR 10844',
  });

  /* clashes: one row each, so a click zooms to it */
  if (!rep.clashes.length) out.push({ id: 'mep:clash', group: G, elementIds: [], title: 'No clashes', status: 'pass', value: 'no pipe–pipe, pipe–conduit, MEP–structure or MEP–door/window clashes', rule: 'Runs keep clear of each other and of the structure; conduits ≥ 0.20 m from hot water', source: SRC });
  rep.clashes.forEach((c, i) => out.push({ id: `mep:clash:${i}`, group: G, elementIds: [c.a, c.b], level: lvl(c.a), title: `Clash · ${c.kind}`, status: 'fail', value: c.text, rule: 'Runs keep clear of each other and of the structure; conduits ≥ 0.20 m from hot water (project rule, to verify)', source: SRC, at: c.at }));

  /* web holes for the engineer */
  const holes = segs.filter((s) => s.holes.length);
  if (holes.length) out.push({ id: 'mep:holes', group: G, elementIds: holes.map((s) => s.id), title: 'Beam web holes (for the engineer)', status: 'pass', value: `${holes.reduce((a, s) => a + s.holes.length, 0)} holes, all ≤ 0.4 × beam depth and in the middle third of the span`, rule: 'A beam may be crossed only through a web hole Ø ≤ 0.4 × depth in the middle third of the span, flagged for the engineer', source: SRC });

  /* supports */
  const miss = rep.hangers.filter((h) => h.missing > 0);
  const n = rep.hangers.reduce((a, h) => a + h.pts.length, 0);
  out.push({
    id: 'mep:hangers', group: G, elementIds: miss.map((h) => h.seg), title: 'Horizontal runs have supports', status: miss.length ? 'fail' : 'pass',
    value: miss.length ? `${miss.length} run${miss.length > 1 ? 's' : ''} with nothing to hang from (e.g. ${miss[0]!.seg})` : `${n} hangers on ${rep.hangers.length} hung runs`,
    rule: 'Hangers on horizontal pipes at spacing by material and DN (PVC ≈ 10 × DN, max 2 m; to verify with the manufacturer); conduits every 1.2 m', source: SRC,
  });

  /* maintenance */
  const acc = rep.access.filter((a) => !a.ok);
  out.push({
    id: 'mep:access', group: G, elementIds: acc.map((a) => a.id), title: 'Equipment can be serviced', status: acc.length ? 'fail' : 'pass',
    value: acc.length ? `${acc.length}: ${acc[0]!.text}` : `${rep.access.length} pieces of equipment with a clear service space and a way to reach them`,
    rule: 'Equipment stands on a supported base with a maintenance clearance; roof zones have a hatch or ladder; the cistern stays off the entry path and car bays', source: SRC,
  });

  /* ceiling heights */
  const hb = rep.heights.filter((h) => !h.ok);
  const low = rep.heights.reduce<(typeof rep.heights)[number] | null>((a, b) => (!a || b.clear - b.need < a.clear - a.need ? b : a), null);
  if (rep.heights.length) out.push({
    id: 'mep:height', group: G, elementIds: hb.map((h) => h.id), title: 'Ceiling height under the plenums', status: hb.length ? 'fail' : 'pass',
    value: hb.length ? `${hb[0]!.name}: ${hb[0]!.clear.toFixed(2)} m (needs ${hb[0]!.need.toFixed(2)})` : low ? `lowest margin: ${low.name} ${low.clear.toFixed(2)} m (needs ${low.need.toFixed(2)})` : '',
    rule: 'At least 2.70 m in living rooms and bedrooms, 2.50 m in wet rooms, kitchens, halls and service rooms, 2.20 m under a bulkhead ≤ 0.60 m wide', source: 'Spec 04b; SP sanitary code',
  });
  return out;
}
