// Automatic routing of the plumbing networks from the fixtures.
// Pipes run on right-angled paths: branches below the floor (sewage) or in the ceiling (water), stacks and risers in shafts,
// the sewage collector in the crawlspace and then underground to the street. Pure: same project in, same pipes out.
import { pointInRect, q } from '../geometry';
import type { Element, Fixture, PipeSegment, PipeSystem, Project } from '../schema';
import { groundAt, groundZones, siteFrame } from '../site';
import { kindOf, minSewageSlope, rainCapacity, rainFlow, sewageDnFor, waterDnFor } from './library';

type P2 = [number, number];
type P3 = [number, number, number];

export const UTILITIES_DEFAULT = { sewerDepth: 3.0, sewerOffset: 6.5, waterMainDepth: 1.5, rainIntensity: 150 };
export const utilities = (p: Project) => p.site.utilities ?? UTILITIES_DEFAULT;

/* ---------- a right-angled tree from a root to targets ---------- */

export interface TNode { x: number; y: number; parent: number; target?: string }

/** Grow a tree: each target joins the nearest point of the tree so far with an L-shaped path. Node 0 is the root. */
export function growTree(root: P2, targets: { id: string; at: P2 }[]): TNode[] {
  const nodes: TNode[] = [{ x: root[0], y: root[1], parent: -1 }];
  const md = (a: P2, b: P2) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
  const order = [...targets].sort((a, b) => md(a.at, root) - md(b.at, root) || a.id.localeCompare(b.id));
  for (const t of order) {
    // nearest point on an existing edge (or the root)
    let best = { d: md(t.at, root), node: 0, split: null as null | { child: number; at: P2 } };
    nodes.forEach((n, i) => {
      if (n.parent < 0) return;
      const pa = nodes[n.parent]!;
      const vertical = Math.abs(n.x - pa.x) < 1e-9;
      const lo = vertical ? Math.min(n.y, pa.y) : Math.min(n.x, pa.x), hi = vertical ? Math.max(n.y, pa.y) : Math.max(n.x, pa.x);
      const along = Math.min(hi, Math.max(lo, vertical ? t.at[1] : t.at[0]));
      const pt: P2 = vertical ? [n.x, along] : [along, n.y];
      const d = md(t.at, pt);
      if (d < best.d - 1e-9) {
        const atEnd = md(pt, [n.x, n.y]) < 1e-9 ? i : md(pt, [pa.x, pa.y]) < 1e-9 ? n.parent : -1;
        best = atEnd >= 0 ? { d, node: atEnd, split: null } : { d, node: -1, split: { child: i, at: pt } };
      }
    });
    let attach = best.node;
    if (best.split) {
      const c = nodes[best.split.child]!;
      nodes.push({ x: best.split.at[0], y: best.split.at[1], parent: c.parent });
      attach = nodes.length - 1;
      c.parent = attach;
    }
    const a = nodes[attach]!;
    if (Math.abs(a.x - t.at[0]) > 1e-9 && Math.abs(a.y - t.at[1]) > 1e-9) {
      nodes.push({ x: t.at[0], y: a.y, parent: attach });
      attach = nodes.length - 1;
    }
    if (md([nodes[attach]!.x, nodes[attach]!.y], t.at) < 1e-9) nodes[attach]!.target = t.id;
    else nodes.push({ x: t.at[0], y: t.at[1], parent: attach, target: t.id });
  }
  return nodes;
}

const childrenOf = (nodes: TNode[]) => {
  const ch = nodes.map(() => [] as number[]);
  nodes.forEach((n, i) => { if (n.parent >= 0) ch[n.parent]!.push(i); });
  return ch;
};
/** Fixture ids in the subtree under each node. */
function subtreeTargets(nodes: TNode[]): string[][] {
  const ch = childrenOf(nodes);
  const memo: string[][] = nodes.map(() => []);
  const visit = (i: number): string[] => {
    const own = nodes[i]!.target ? [nodes[i]!.target!] : [];
    memo[i] = [...own, ...ch[i]!.flatMap(visit)];
    return memo[i]!;
  };
  visit(0);
  return memo;
}
const len2 = (a: TNode, b: TNode) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
/** Fall of a gravity pipe, rounded up to the model's 5 mm, so the stored slope is never below the design slope. */
const fallOf = (length: number, slope: number) => Math.ceil((length * slope) / 0.005 - 1e-9) * 0.005;
const floor5 = (z: number) => Math.floor(z / 0.005 + 1e-9) * 0.005;

/* ---------- output ---------- */

class Out {
  pipes: PipeSegment[] = [];
  auto: Fixture[] = [];
  private n = new Map<string, number>();
  pipe(network: string, level: string, system: PipeSystem, dn: number, start: P3, end: P3, o: { pressure?: boolean; load?: number; serves?: string[] } = {}) {
    if (Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]) < 0.005) return;
    const k = (this.n.get(network) ?? 0) + 1;
    this.n.set(network, k);
    this.pipes.push({
      id: `${network}-${String(k).padStart(3, '0')}`, type: 'PipeSegment', level, tags: ['auto'],
      props: {
        system, dn, material: system === 'hot' ? 'CPVC' : 'PVC', pressure: o.pressure ?? false, network,
        start: start.map(q) as P3, end: end.map(q) as P3, load: q(o.load ?? 0), serves: o.serves ?? [],
      },
    });
  }
}

/* ---------- the networks ---------- */

const DRAINS = (f: Fixture) => kindOf(f.props.kind).drainDn !== undefined;

export function routePlumbing(p: Project): { pipes: PipeSegment[]; auto: Fixture[] } {
  const out = new Out();
  const fx = p.elements.filter((e): e is Fixture => e.type === 'Fixture' && !e.tags.includes('auto'));
  if (!fx.length) return out;
  const elev = (l: string) => p.levels.find((x) => x.id === l)?.elevation ?? 0;
  const byKind = (k: string) => fx.filter((f) => f.props.kind === k);
  const fxById = new Map(fx.map((f) => [f.id, f]));
  const uhc = (ids: string[]) => ids.reduce((a, id) => a + (kindOf(fxById.get(id)?.props.kind ?? '').uhc ?? 0), 0);
  const hasWc = (ids: string[]) => ids.some((id) => fxById.get(id)?.props.kind === 'toilet');
  const zones = groundZones(p);
  const ground = (x: number, y: number) => groundAt(p, x, y, zones);
  const SL = elev('SL'), UF = elev('UF'), ROOF = elev('roof');
  const u = utilities(p);
  const f = siteFrame(p);

  /** Gravity sewage tree into a root; returns the root invert. Pipes run from each fixture down to the root. */
  const sewageTree = (network: string, level: string, root: P2, items: Fixture[], belowFloor: number): number | null => {
    if (!items.length) return null;
    const nodes = growTree(root, items.map((i) => ({ id: i.id, at: i.props.at })));
    const sub = subtreeTargets(nodes);
    const dn = nodes.map((_, i) => sewageDnFor(uhc(sub[i]!), hasWc(sub[i]!)));
    // fall from each node down to the root
    const fall: number[] = nodes.map(() => 0);
    const order = nodes.map((_, i) => i);
    const depth = (i: number): number => (nodes[i]!.parent < 0 ? 0 : 1 + depth(nodes[i]!.parent));
    order.sort((a, b) => depth(a) - depth(b));
    for (const i of order) {
      const n = nodes[i]!;
      if (n.parent >= 0) fall[i] = fall[n.parent]! + fallOf(len2(n, nodes[n.parent]!), minSewageSlope(dn[i]!));
    }
    const outletZ = (fid: string) => elev(fxById.get(fid)!.level) - belowFloor;
    const rootZ = floor5(Math.min(...nodes.map((n, i) => (n.target ? outletZ(n.target) - fall[i]! : Infinity))));
    const z = (i: number) => rootZ + fall[i]!;
    nodes.forEach((n, i) => {
      if (n.parent < 0) return;
      const pa = nodes[n.parent]!;
      out.pipe(network, level, 'sewage', dn[i]!, [n.x, n.y, z(i)], [pa.x, pa.y, z(n.parent)], { load: uhc(sub[i]!), serves: sub[i]! });
    });
    // drop from each fixture's outlet at its floor to its branch
    nodes.forEach((n, i) => {
      if (!n.target) return;
      const fix = fxById.get(n.target)!;
      out.pipe(network, level, 'sewage', kindOf(fix.props.kind).drainDn!, [n.x, n.y, elev(fix.level)], [n.x, n.y, z(i)], { load: uhc([fix.id]), serves: [fix.id] });
    });
    return rootZ;
  };

  /* ---- sewage ---- */
  const stacks = byKind('stack');
  const gt = byKind('grease-trap')[0];
  const ls = byKind('lift-station')[0];
  const nearestStack = (at: P2) => stacks.reduce((a, b) => (Math.hypot(b.props.at[0] - at[0], b.props.at[1] - at[1]) < Math.hypot(a.props.at[0] - at[0], a.props.at[1] - at[1]) ? b : a));
  const kitchenLine = (fi: Fixture) => gt && fi.level === 'SL' && (fi.props.kind === 'kitchen-sink' || fi.props.kind === 'dishwasher');
  const drains = fx.filter(DRAINS);
  const joins = new Map<string, { z: number; level: string; ids: string[] }[]>();
  if (stacks.length) {
    for (const [level, below] of [['UF', 0.35], ['SL', 0.45]] as const) {
      for (const st of stacks) {
        const items = drains.filter((d) => d.level === level && !kitchenLine(d) && nearestStack(d.props.at).id === st.id);
        const z = sewageTree(`sew-${level}-${st.id}`, level, st.props.at, items, below);
        if (z !== null) joins.set(st.id, [...(joins.get(st.id) ?? []), { z, level, ids: items.map((i) => i.id) }]);
      }
    }
  }
  const kitchenItems = drains.filter((d) => kitchenLine(d));
  const gtIn = gt ? sewageTree('sew-kitchen', 'SL', gt.props.at, kitchenItems, 0.45) : null;
  const llItems = drains.filter((d) => d.level === 'LL');
  const lsIn = ls ? sewageTree('sew-LL', 'LL', ls.props.at, llItems, 0.25) : null;

  // Collector: from the stack farthest from the street, past the others, out of the front of the house.
  const slOutline = p.levels.find((l) => l.id === 'SL')?.outline;
  if (stacks.length && slOutline) {
    const feet = [...stacks].sort((a, b) => b.props.at[1] - a.props.at[1]);
    const x0 = feet[feet.length - 1]!.props.at[0];
    const path: { at: P2; stack?: Fixture; ib?: boolean }[] = [];
    for (const st of feet) {
      const last = path[path.length - 1];
      if (last && Math.abs(last.at[0] - st.props.at[0]) > 1e-9) path.push({ at: [st.props.at[0], last.at[1]] });
      path.push({ at: st.props.at, stack: st });
    }
    const front = slOutline.y0;
    const ib1: P2 = [x0, front - 0.45], ib2: P2 = [x0, f.yStreet + 0.3], sewer: P2 = [x0, f.yStreet - u.sewerOffset];
    path.push({ at: [x0, front] }, { at: ib1, ib: true }, { at: ib2, ib: true });
    // all fixtures served by the collector
    const upstreamIds = [...[...joins.values()].flat().flatMap((j) => j.ids), ...kitchenItems.map((i) => i.id), ...llItems.map((i) => i.id)];
    const collLoad = (k: number) => {
      const ids = [...feet.slice(0, Math.max(1, path.slice(0, k + 1).filter((x) => x.stack).length)).flatMap((s) => (joins.get(s.id) ?? []).flatMap((j) => j.ids)), ...llItems.map((i) => i.id)];
      return ids;
    };
    // inverts: start under the lowest join of the first stack, fall 1 % (DN 100), step down outside to keep 0.5 m of cover
    const firstJoin = floor5(Math.min(...(joins.get(feet[0]!.id) ?? [{ z: SL - 0.6 }]).map((j) => j.z), SL - 0.6) - 0.05);
    // Each node has an inlet and an outlet invert: an inspection box may drop the flow inside it to keep 0.5 m of cover.
    const inverts = (start: number) => {
      const zin = [start], zout = [start];
      for (let k = 1; k < path.length; k++) {
        const a = path[k - 1]!.at, b = path[k]!.at;
        let z = zout[k - 1]! - fallOf(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]), 0.01);
        if (path[k]!.stack) z = Math.min(z, Math.min(...(joins.get(path[k]!.stack!.id) ?? [{ z }]).map((j) => j.z)) - 0.05);
        zin.push(z);
        zout.push(path[k]!.ib ? Math.min(z, floor5(surface(p, b, ground) - 0.5)) : z);
      }
      return { zin, zout };
    };
    // the kitchen line joins the collector where it comes closest; lower the collector if needed so it can fall into it
    let start = firstJoin;
    let gtJoin: { k: number; at: P2; z: number } | null = null;
    if (gt && gtIn !== null) {
      const gtOut = floor5(gtIn - 0.08);
      let best = { d: Infinity, k: 1, at: [0, 0] as P2 };
      for (let k = 1; k < path.length - 1; k++) {
        const a = path[k - 1]!.at, b = path[k]!.at;
        const vertical = Math.abs(a[0] - b[0]) < 1e-9;
        const lo = vertical ? Math.min(a[1], b[1]) : Math.min(a[0], b[0]), hi = vertical ? Math.max(a[1], b[1]) : Math.max(a[0], b[0]);
        const along = Math.min(hi, Math.max(lo, vertical ? gt.props.at[1] : gt.props.at[0]));
        const pt: P2 = vertical ? [a[0], along] : [along, a[1]];
        const d = Math.abs(pt[0] - gt.props.at[0]) + Math.abs(pt[1] - gt.props.at[1]);
        if (d < best.d) best = { d, k, at: pt };
      }
      path.splice(best.k, 0, { at: best.at, ib: !insideHouse(p, best.at) });
      for (let it = 0; it < 5; it++) {
        const { zin } = inverts(start);
        const need = gtOut - 0.01 * best.d - 0.02;
        if (zin[best.k]! <= need) { gtJoin = { k: best.k, at: best.at, z: zin[best.k]! }; break; }
        start = floor5(start - (zin[best.k]! - need));
      }
    }
    const { zin, zout } = inverts(start);
    const zs = zin;
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1]!, b = path[k]!;
      const ids = [...new Set([...collLoad(k - 1), ...(gtJoin && k > gtJoin.k ? kitchenItems.map((i) => i.id) : [])])];
      out.pipe('sew-collector', insideHouse(p, b.at) ? 'SL' : 'site', 'sewage', 100, [a.at[0], a.at[1], zout[k - 1]!], [b.at[0], b.at[1], zin[k]!], { load: uhc(ids), serves: ids });
    }
    const arrival = zout[zout.length - 1]! - fallOf(Math.abs(ib2[1] - sewer[1]), 0.01);
    out.pipe('sew-collector', 'site', 'sewage', 100, [ib2[0], ib2[1], zout[zout.length - 1]!], [sewer[0], sewer[1], arrival], { load: uhc(upstreamIds), serves: upstreamIds });
    path.forEach((n) => {
      if (n.ib) out.auto.push(autoFixture(`ib-auto-${String(out.auto.length + 1).padStart(2, '0')}`, 'inspection-box', n.at, surface(p, n.at, ground), insideHouse(p, n.at) ? 'SL' : 'site'));
    });
    // stacks: vertical from the top branch down to the collector, and a vent through the roof
    for (const st of stacks) {
      const k = path.findIndex((n) => n.stack?.id === st.id);
      const foot = zs[k]!;
      const js = (joins.get(st.id) ?? []).sort((a, b) => b.z - a.z);
      const top = js[0]?.z ?? foot;
      const ids = js.flatMap((j) => j.ids);
      let zTop = top;
      js.forEach((j, i) => {
        const below = i + 1 < js.length ? js[i + 1]!.z : foot;
        const carried = js.slice(0, i + 1).flatMap((x) => x.ids);
        out.pipe(`stack-${st.id}`, j.level, 'sewage', sewageDnFor(uhc(carried), hasWc(carried)), [st.props.at[0], st.props.at[1], j.z], [st.props.at[0], st.props.at[1], below], { load: uhc(carried), serves: carried });
        zTop = Math.max(zTop, j.z);
      });
      out.pipe(`vent-${st.id}`, 'roof', 'vent', 75, [st.props.at[0], st.props.at[1], zTop], [st.props.at[0], st.props.at[1], ROOF + 0.6], { serves: ids });
    }
    // kitchen line from the grease trap to the collector
    if (gt && gtIn !== null && gtJoin) {
      const zOut = floor5(gtIn - 0.08);
      const corner: P2 = [gtJoin.at[0], gt.props.at[1]];
      const ids = kitchenItems.map((i) => i.id);
      const d1 = Math.abs(gt.props.at[0] - corner[0]), d2 = Math.abs(corner[1] - gtJoin.at[1]);
      const zc = zOut - fallOf(d1, 0.01);
      out.pipe('sew-kitchen', 'site', 'sewage', 100, [gt.props.at[0], gt.props.at[1], zOut], [corner[0], corner[1], zc], { load: uhc(ids), serves: ids });
      out.pipe('sew-kitchen', 'site', 'sewage', 100, [corner[0], corner[1], zc], [gtJoin.at[0], gtJoin.at[1], Math.min(zc - fallOf(d2, 0.01), Math.max(gtJoin.z, zc - fallOf(d2, 0.01)))], { load: uhc(ids), serves: ids });
    }
    // lower level: pumped from the lift station up to the start of the collector, through the backflow valve
    if (ls && lsIn !== null) {
      const ids = llItems.map((i) => i.id);
      const bv = byKind('backflow-valve')[0];
      const zUp = SL - 0.55;
      const pts: P3[] = [[ls.props.at[0], ls.props.at[1], lsIn]];
      if (bv) pts.push([bv.props.at[0], bv.props.at[1], lsIn], [bv.props.at[0], bv.props.at[1], zUp]);
      else pts.push([ls.props.at[0], ls.props.at[1], zUp]);
      const s0 = path[0]!.at;
      const last = pts[pts.length - 1]!;
      pts.push([s0[0], last[1], zUp], [s0[0], s0[1], zUp], [s0[0], s0[1], zs[0]!]);
      for (let k = 1; k < pts.length; k++) out.pipe('sew-LL-pumped', 'LL', 'sewage', 50, pts[k - 1]!, pts[k]!, { pressure: true, load: uhc(ids), serves: ids });
    }
  }

  /* ---- water ---- */
  const tanks = byKind('roof-tank');
  const meter = byKind('water-meter')[0];
  const heater = byKind('water-heater')[0];
  const riserC: P2 = [0.2, 8.7], riserH: P2 = [0.32, 8.7], riserF: P2 = [0.15, 8.35];
  const ceiling: Record<string, number> = { LL: SL - 0.5, SL: UF - 0.35, UF: ROOF - 0.35 };
  const waterUsers = fx.filter((x) => (kindOf(x.props.kind).weight ?? 0) > 0);
  const weight = (ids: string[]) => ids.reduce((a, id) => a + (kindOf(fxById.get(id)?.props.kind ?? '').weight ?? 0), 0);
  const supplyZ = (fi: Fixture) => elev(fi.level) + (kindOf(fi.props.kind).supplyZ ?? 0.6);
  const waterTree = (system: 'cold' | 'hot', level: string, root: P2, z: number, items: Fixture[], extra: { id: string; at: P2; z: number; w: number }[] = []) => {
    const all = [...items.map((i) => ({ id: i.id, at: i.props.at, z: supplyZ(i), w: weight([i.id]) })), ...extra];
    if (!all.length) return 0;
    const nodes = growTree(root, all.map((a) => ({ id: a.id, at: a.at })));
    const sub = subtreeTargets(nodes);
    const w = (ids: string[]) => ids.reduce((s, id) => s + (all.find((a) => a.id === id)?.w ?? 0), 0);
    const net = `${system}-${level}`;
    nodes.forEach((n, i) => {
      if (n.parent < 0) return;
      const pa = nodes[n.parent]!;
      out.pipe(net, level, system, waterDnFor(w(sub[i]!)), [pa.x, pa.y, z], [n.x, n.y, z], { pressure: true, load: w(sub[i]!), serves: sub[i]! });
    });
    nodes.forEach((n) => {
      if (!n.target) return;
      const t = all.find((a) => a.id === n.target)!;
      out.pipe(net, level, system, waterDnFor(t.w), [n.x, n.y, z], [n.x, n.y, t.z], { pressure: true, load: t.w, serves: [t.id] });
    });
    return w(sub[0]!);
  };
  if (tanks.length) {
    const tankZ = Math.min(...tanks.map((t) => t.props.z)) + 0.15;
    // cold: tanks → riser → each floor
    const levels = ['UF', 'SL', 'LL'] as const;
    const heaterW = heater ? waterUsers.filter((x) => kindOf(x.props.kind).hot).reduce((a, x) => a + (kindOf(x.props.kind).weight ?? 0), 0) : 0;
    const loads: number[] = [];
    for (const L of levels) {
      const items = waterUsers.filter((x) => x.level === L);
      const extra = heater && L === 'SL' ? [{ id: heater.id, at: heater.props.at, z: heater.props.z + 0.3, w: heaterW }] : [];
      loads.push(waterTree('cold', L, riserC, ceiling[L]!, items, extra));
    }
    const allIds = [...waterUsers.map((x) => x.id), ...(heater ? [heater.id] : [])];
    let zPrev = tankZ - 0.1;
    const t0 = tanks[0]!;
    out.pipe('cold-riser', 'roof', 'cold', waterDnFor(loads.reduce((a, b) => a + b, 0)), [t0.props.at[0], t0.props.at[1], zPrev], [riserC[0], t0.props.at[1], zPrev], { pressure: true, load: loads.reduce((a, b) => a + b, 0), serves: allIds });
    out.pipe('cold-riser', 'roof', 'cold', waterDnFor(loads.reduce((a, b) => a + b, 0)), [riserC[0], t0.props.at[1], zPrev], [riserC[0], riserC[1], zPrev], { pressure: true, load: loads.reduce((a, b) => a + b, 0), serves: allIds });
    for (let i = 1; i < tanks.length; i++) {
      const t = tanks[i]!;
      out.pipe('cold-riser', 'roof', 'cold', 32, [t.props.at[0], t.props.at[1], zPrev], [t0.props.at[0], t0.props.at[1], zPrev], { pressure: true, serves: [] });
    }
    levels.forEach((L, i) => {
      const rest = loads.slice(i).reduce((a, b) => a + b, 0);
      out.pipe('cold-riser', L, 'cold', waterDnFor(rest), [riserC[0], riserC[1], zPrev], [riserC[0], riserC[1], ceiling[L]!], { pressure: true, load: rest, serves: [] });
      zPrev = ceiling[L]!;
    });
    // hot: heater → hot riser → each floor
    if (heater) {
      const hz = (L: string) => ceiling[L]! - 0.08;
      const hotUsers = waterUsers.filter((x) => kindOf(x.props.kind).hot);
      const hl: Record<string, number> = {};
      for (const L of levels) hl[L] = waterTree('hot', L, riserH, hz(L), hotUsers.filter((x) => x.level === L));
      const total = Object.values(hl).reduce((a, b) => a + b, 0);
      const ids = hotUsers.map((x) => x.id);
      out.pipe('hot-main', 'SL', 'hot', waterDnFor(total), [heater.props.at[0], heater.props.at[1], heater.props.z + 0.3], [heater.props.at[0], heater.props.at[1], hz('SL')], { pressure: true, load: total, serves: ids });
      out.pipe('hot-main', 'SL', 'hot', waterDnFor(total), [heater.props.at[0], heater.props.at[1], hz('SL')], [riserH[0], heater.props.at[1], hz('SL')], { pressure: true, load: total, serves: ids });
      out.pipe('hot-main', 'SL', 'hot', waterDnFor(total), [riserH[0], heater.props.at[1], hz('SL')], [riserH[0], riserH[1], hz('SL')], { pressure: true, load: total, serves: ids });
      out.pipe('hot-riser', 'UF', 'hot', waterDnFor(hl.UF!), [riserH[0], riserH[1], hz('SL')], [riserH[0], riserH[1], hz('UF')], { pressure: true, load: hl.UF!, serves: [] });
      out.pipe('hot-riser', 'LL', 'hot', waterDnFor(hl.LL!), [riserH[0], riserH[1], hz('SL')], [riserH[0], riserH[1], hz('LL')], { pressure: true, load: hl.LL!, serves: [] });
    }
    // feed: meter → underground → feed riser → tank inlets
    if (meter) {
      const zb = -0.6;
      const pts: P3[] = [[meter.props.at[0], meter.props.at[1], meter.props.z], [meter.props.at[0], meter.props.at[1], zb], [meter.props.at[0], riserF[1], zb], [riserF[0], riserF[1], zb], [riserF[0], riserF[1], tankZ + 0.95], [t0.props.at[0], riserF[1], tankZ + 0.95], [t0.props.at[0], t0.props.at[1], tankZ + 0.95]];
      for (let k = 1; k < pts.length; k++) out.pipe('cold-feed', k < 4 ? 'site' : 'roof', 'cold', 25, pts[k - 1]!, pts[k]!, { pressure: true, serves: tanks.map((t) => t.id) });
    }
  }

  /* ---- rain ---- */
  const cistern = byKind('rain-cistern')[0];
  const trench = byKind('infiltration-trench')[0];
  const drainsR = byKind('roof-drain');
  const rainTree = (network: string, root: P2, rootZ: number, items: Fixture[]) => {
    if (!items.length) return;
    const nodes = growTree(root, items.map((i) => ({ id: i.id, at: i.props.at })));
    const sub = subtreeTargets(nodes);
    const area = (ids: string[]) => ids.reduce((a, id) => a + (fxById.get(id)?.props.area ?? 0), 0);
    const dnOf = (a: number) => (rainFlow(a, u.rainIntensity) <= rainCapacity(100, 0.01) ? 100 : 150);
    const fall: number[] = nodes.map(() => 0);
    const depth = (i: number): number => (nodes[i]!.parent < 0 ? 0 : 1 + depth(nodes[i]!.parent));
    [...nodes.keys()].sort((a, b) => depth(a) - depth(b)).forEach((i) => {
      const n = nodes[i]!;
      if (n.parent >= 0) fall[i] = fall[n.parent]! + fallOf(len2(n, nodes[n.parent]!), 0.01);
    });
    nodes.forEach((n, i) => {
      if (n.parent < 0) return;
      const pa = nodes[n.parent]!;
      out.pipe(network, 'site', 'rain', dnOf(area(sub[i]!)), [n.x, n.y, rootZ + fall[i]!], [pa.x, pa.y, rootZ + fall[n.parent]!], { load: area(sub[i]!), serves: sub[i]! });
    });
    nodes.forEach((n, i) => {
      if (!n.target) return;
      const d = fxById.get(n.target)!;
      out.pipe(network, d.level, 'rain', 100, [n.x, n.y, d.props.z], [n.x, n.y, rootZ + fall[i]!], { load: d.props.area ?? 0, serves: [d.id] });
    });
  };
  if (cistern) {
    const inlet: P2 = [cistern.props.at[0], cistern.props.at[1] + 1.2];
    const top = cistern.props.z;
    rainTree('rain-cistern', inlet, floor5(top - 0.05), drainsR.filter((d) => !d.tags.includes('to-garden')));
    // overflow to the street gutter
    const gutter: P2 = [cistern.props.at[0], f.yStreet - 2.5];
    const zo = top - 0.1;
    out.pipe('rain-overflow', 'site', 'rain', 100, [cistern.props.at[0], cistern.props.at[1] - 1.2, zo], [gutter[0], gutter[1], zo - fallOf(Math.abs(cistern.props.at[1] - 1.2 - gutter[1]), 0.01)], { serves: [cistern.id] });
  }
  if (trench) rainTree('rain-garden', trench.props.at, trench.props.z - 0.3, drainsR.filter((d) => d.tags.includes('to-garden')));
  const sump = byKind('sump-pump')[0];
  if (sump) {
    const x = Math.min(f.xNorth(sump.props.at[1]) - 1.0, (slOutline?.x1 ?? 8.6) + 1.0);
    const pts: P3[] = [[sump.props.at[0], sump.props.at[1], sump.props.z - 0.4], [x, sump.props.at[1], ground(x, sump.props.at[1]) - 0.4], [x, f.yStreet - 2.5, -0.13]];
    for (let k = 1; k < pts.length; k++) out.pipe('rain-sump', 'site', 'rain', 50, pts[k - 1]!, pts[k]!, { pressure: true, serves: [sump.id] });
  }
  return out;
}

/** The finished surface at a point: the ground, or a patio built up on fill. */
function surface(p: Project, at: P2, ground: (x: number, y: number) => number): number {
  let z = ground(at[0], at[1]);
  for (const e of p.elements) {
    if (e.type === 'Slab' && e.props.onGrade && e.tags.includes('patio') && e.props.rect && pointInRect(at[0], at[1], e.props.rect)) z = Math.max(z, e.props.topElevation);
  }
  return z;
}

function autoFixture(id: string, kind: string, at: P2, z: number, level: string): Fixture {
  return { id, type: 'Fixture', level, tags: ['auto'], props: { kind, name: kindOf(kind).label, at: [q(at[0]), q(at[1])], z: q(z) } };
}

/** Is this point inside a room of the street or lower level (under a roof), rather than outside? */
export function insideHouse(p: Project, at: P2): boolean {
  return p.elements.some((e) => e.type === 'Space' && (e.level === 'SL' || e.level === 'LL') && e.props.cells.some((c) => pointInRect(at[0], at[1], c)));
}

/** Replace the generated pipes and inspection boxes; keep DN and material of pipes edited by hand. */
export function withPlumbing(p: Project): Project {
  const old = new Map(p.elements.filter((e): e is PipeSegment => e.type === 'PipeSegment').map((e) => [e.id, e]));
  const { pipes, auto } = routePlumbing(p);
  // Generated pipes always follow the fixtures; a DN or material chosen by hand carries over to the new pipe with the same id.
  const kept = p.elements.filter((e) => !(e.type === 'PipeSegment' && e.tags.includes('auto')) && !(e.type === 'Fixture' && e.tags.includes('auto')));
  const fresh: Element[] = pipes.map((x) => {
    const o = old.get(x.id);
    return o?.props.manual ? { ...x, props: { ...x.props, dn: o.props.dn, material: o.props.material, manual: true } } : x;
  });
  return { ...p, elements: [...kept, ...fresh, ...auto] };
}
