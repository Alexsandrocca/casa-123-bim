// Automatic routing of the plumbing networks (spec 03, rebuilt in spec 04b).
// Every run goes through a service space: ceiling plenums, shafts, walls, the crawlspace or the ground, found by a
// graph search (A*) that avoids stair voids, doors, windows, columns, footings and retaining-wall cores and crosses a
// beam only through a web hole. Systems are routed in order of difficulty: sewage, rain, vents, hot, cold.
// Gravity pipes fall continuously at the NBR 8160 minimum slope. Anything that cannot be routed is reported, never drawn.
// Pure: same project in, same pipes out.
import { pointInRect, q } from '../geometry';
import type { Element, Fixture, PipeSegment, PipeSystem, Project, Rect, ServiceSpace } from '../schema';
import { siteFrame } from '../site';
import { Layer, growTree, routePath, type TNode } from '../mep/grid';
import { cavityPoint, placeOnWall } from '../mep/hosting';
import { buildLayer, stepAtStart, type LayerReq, type Occ } from '../mep/layers';
import { deviceMount, fixtureMount as fixtureMountOf, outerD } from '../mep/library';
import { mepContext, type Carry, type MepContext } from '../mep/spaces';
import { kindOf, minSewageSlope, rainCapacity, rainFlow, sewageDnFor, waterDnFor } from './library';

type P2 = [number, number];
type P3 = [number, number, number];

export const UTILITIES_DEFAULT = { sewerDepth: 3.0, sewerOffset: 6.5, waterMainDepth: 1.5, rainIntensity: 150 };
export const utilities = (p: Project) => p.site.utilities ?? UTILITIES_DEFAULT;

export interface NoRoute { system: string; network: string; item: string; reason: string }

/** Fall of a gravity pipe, rounded up to the model's 5 mm, so the stored slope is never below the design slope. */
const fallOf = (length: number, slope: number) => Math.ceil((length * slope) / 0.005 - 1e-9) * 0.005;
const floor5 = (z: number) => Math.floor(z / 0.005 + 1e-9) * 0.005;
const d2 = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/* ---------- output ---------- */

class Out {
  pipes: PipeSegment[] = [];
  auto: Fixture[] = [];
  noRoute: NoRoute[] = [];
  notes: string[] = [];
  occ: Occ[] = [];
  private n = new Map<string, number>();
  pipe(network: string, level: string, system: PipeSystem, dn: number, start: P3, end: P3, o: { pressure?: boolean; load?: number; serves?: string[] } = {}) {
    if (![...start, ...end].every(Number.isFinite)) { this.fail(system, network, o.serves?.[0] ?? network, 'no height for this run (its space has no room for it)'); return; }
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
    this.occ.push({ a: start, b: end, r: outerD(dn) / 2, carry: system as Carry, net: network });
  }
  poly(network: string, level: string, system: PipeSystem, dn: number, pts: P3[], o: { pressure?: boolean; load?: number; serves?: string[] } = {}) {
    for (let i = 1; i < pts.length; i++) this.pipe(network, level, system, dn, pts[i - 1]!, pts[i]!, o);
  }
  fail(system: string, network: string, item: string, reason: string) { this.noRoute.push({ system, network, item, reason }); }
}

/* ---------- shafts: each vertical pipe gets its own slot ---------- */

class Shafts {
  private used = new Map<string, { t: number; half: number }[]>();
  constructor(private ss: ServiceSpace[], private out: Out) {}
  at(x: number, y: number) { return this.ss.find((s) => pointInRect(x, y, s.props.rect)); }
  private long(s: ServiceSpace) { const r = s.props.rect; return r.y1 - r.y0 >= r.x1 - r.x0 ? 'y' : 'x'; }
  reserve(s: ServiceSpace, xy: P2, dn: number) {
    const t = this.long(s) === 'y' ? xy[1] : xy[0];
    this.used.set(s.id, [...(this.used.get(s.id) ?? []), { t, half: outerD(dn) / 2 }]);
  }
  /** A free position along the shaft's long side, 25 mm clear of the others and of the shaft walls. */
  slot(s: ServiceSpace, dn: number, label: string): P2 {
    const r = s.props.rect, ax = this.long(s);
    const a = ax === 'y' ? r.y0 : r.x0, b = ax === 'y' ? r.y1 : r.x1, mid = ax === 'y' ? (r.x0 + r.x1) / 2 : (r.y0 + r.y1) / 2;
    const half = outerD(dn) / 2, gap = 0.03;
    const used = [...(this.used.get(s.id) ?? [])].sort((u, v) => u.t - v.t);
    let t = a + gap + half;
    for (const u of used) {
      if (t + half + gap <= u.t - u.half + 1e-9) break;
      t = Math.max(t, u.t + u.half + gap + half);
    }
    if (t + half + gap > b + 1e-9) this.out.notes.push(`${s.props.name} is full: ${label} needs ${(t + half + gap - b).toFixed(2)} m more; make the shaft larger.`);
    this.used.set(s.id, [...used, { t, half }]);
    return ax === 'y' ? [q(mid), q(t)] : [q(t), q(mid)];
  }
}

/* ---------- the networks ---------- */

const DRAINS = (f: Fixture) => kindOf(f.props.kind).drainDn !== undefined;

export function routePlumbing(p: Project): { pipes: PipeSegment[]; auto: Fixture[]; noRoute: NoRoute[]; notes: string[] } {
  const out = new Out();
  usedDrops.length = 0;
  const fx = p.elements.filter((e): e is Fixture => e.type === 'Fixture' && !e.tags.includes('auto'));
  if (!fx.length) return out;
  const ctx = mepContext(p);
  const elev = (l: string) => ctx.elev(l);
  const byKind = (k: string) => fx.filter((f) => f.props.kind === k);
  const fxById = new Map(fx.map((f) => [f.id, f]));
  const uhc = (ids: string[]) => ids.reduce((a, id) => a + (kindOf(fxById.get(id)?.props.kind ?? '').uhc ?? 0), 0);
  const hasWc = (ids: string[]) => ids.some((id) => fxById.get(id)?.props.kind === 'toilet');
  const u = utilities(p);
  const f = siteFrame(p);
  const ROOF = elev('roof');
  const shaftEls = p.elements.filter((e): e is ServiceSpace => e.type === 'ServiceSpace' && e.props.kind === 'shaft');
  const shafts = new Shafts(shaftEls, out);
  const street: Rect = { x0: Math.min(...p.site.lotPolygon.map((c) => c[0] - p.site.houseOrigin.x)) - 0.5, x1: Math.max(...p.site.lotPolygon.map((c) => c[0] - p.site.houseOrigin.x)) + 0.5, y0: f.yStreet - u.sewerOffset - 0.6, y1: f.yStreet };
  // ceiling boxes of lights and detectors: pipes in the plenums keep clear of them
  const elecShaft = shaftEls.find((s) => /electric/i.test(s.props.name));
  const elecPoints = p.elements.flatMap((d) => {
    if (d.type !== 'Device' || !d.props.hostWallId) return [];
    const cp = cavityPoint(p, d);
    const panel = /panel/.test(d.props.kind);
    return cp ? [{ at: cp.cavity, r: panel ? 0.4 : 0.26, why: `the conduit of ${d.props.name} (0.20 m from hot water)` }] : [];
  });
  const ceilingBoxes = (level: string, gap = 0.08) => [
    ...p.elements.flatMap((d) => (d.type === 'Device' && d.level === level && deviceMount(d.props.kind) === 'ceiling' ? [{ at: d.props.at, r: gap, why: `the box of ${d.props.name}` }] : [])),
    // hot water keeps 0.20 m from the conduits rising in the electrical shaft, and from every wall point's conduit
    ...(elecShaft && gap > 0.2 ? [{ at: [(elecShaft.props.rect.x0 + elecShaft.props.rect.x1) / 2, (elecShaft.props.rect.y0 + elecShaft.props.rect.y1) / 2] as P2, r: Math.hypot(elecShaft.props.rect.x1 - elecShaft.props.rect.x0, elecShaft.props.rect.y1 - elecShaft.props.rect.y0) / 2 + 0.2, why: 'the electrical shaft (0.20 m from hot water)' }] : []),
    ...(gap > 0.2 ? elecPoints : []),
  ];
  const layer = (req: Omit<LayerReq, 'occ'>, exclude: (o: Occ) => boolean = () => false): Layer => buildLayer(ctx, { ...req, occ: out.occ.filter((o) => !exclude(o)) });

  /* ===== sewage ===== */
  const stacks = byKind('stack');
  for (const st of stacks) {
    const s = shafts.at(st.props.at[0], st.props.at[1]);
    if (s) shafts.reserve(s, st.props.at, 100);
    else out.fail('sewage', `stack-${st.id}`, st.id, 'the soil stack is not inside a shaft');
  }
  const gt = byKind('grease-trap')[0];
  const ls = byKind('lift-station')[0];
  const nearestStack = (at: P2) => stacks.reduce((a, b) => (Math.hypot(b.props.at[0] - at[0], b.props.at[1] - at[1]) < Math.hypot(a.props.at[0] - at[0], a.props.at[1] - at[1]) ? b : a));
  const kitchenLine = (fi: Fixture) => !!gt && fi.level === 'SL' && (fi.props.kind === 'kitchen-sink' || fi.props.kind === 'dishwasher');
  const drains = fx.filter(DRAINS);

  /** Gravity tree into a root: z is worked out from the root up at the minimum slopes, then the whole tree is lowered
   *  until every node sits at or below the height its host allows. Returns the root invert. */
  const gravityTree = (system: 'sewage' | 'rain', network: string, level: string, L: Layer, root: P2, items: { id: string; at: P2; top: number; dn: number; load: number }[], o: { fixedRoot?: number; slope?: (dn: number) => number; dnOf?: (ids: string[]) => number; loadOf?: (ids: string[]) => number } = {}): { rootZ: number; nodes: TNode[]; z: (i: number) => number; served: string[] } | null => {
    if (!items.length) return null;
    const t = growTree(L, root, items.map((i) => ({ id: i.id, at: i.at })), { bend: 0.2 });
    for (const fl of t.failed) out.fail(system, network, fl.id, `no route: ${fl.reason}`);
    const nodes = t.nodes;
    if (nodes.length < 1) return null;
    const ch = nodes.map(() => [] as number[]);
    nodes.forEach((n, i) => { if (n.parent >= 0) ch[n.parent]!.push(i); });
    const sub: string[][] = nodes.map(() => []);
    const visit = (i: number): string[] => (sub[i] = [...(nodes[i]!.target ? [nodes[i]!.target!] : []), ...ch[i]!.flatMap(visit)]);
    visit(0);
    const byId = new Map(items.map((i) => [i.id, i]));
    const dnOf = o.dnOf ?? ((ids: string[]) => Math.max(...ids.map((id) => byId.get(id)?.dn ?? 40), 40));
    const loadOf = o.loadOf ?? ((ids: string[]) => ids.reduce((a, id) => a + (byId.get(id)?.load ?? 0), 0));
    const slope = o.slope ?? minSewageSlope;
    const dn = nodes.map((_, i) => dnOf(sub[i]!));
    const fall = nodes.map(() => 0);
    const depth = (i: number): number => (nodes[i]!.parent < 0 ? 0 : 1 + depth(nodes[i]!.parent));
    [...nodes.keys()].sort((a, b) => depth(a) - depth(b)).forEach((i) => {
      const n = nodes[i]!;
      if (n.parent >= 0) fall[i] = fall[n.parent]! + fallOf(d2(n, nodes[n.parent]!), slope(dn[i]!));
    });
    // the tree's own band (top of the pipe below the water and ceiling layers), and the fixtures' outlets
    const top = nodes.map((n) => Math.min(Number.isFinite(n.z) ? n.z : Infinity, n.target ? byId.get(n.target)?.top ?? Infinity : Infinity));
    let rootZ: number;
    let zs: number[];
    if (o.fixedRoot !== undefined) {
      // the outlet is fixed (cistern, trench): from it upstream, each node as high as its space allows, never below
      // what the slope needs (a steeper fall is fine)
      rootZ = o.fixedRoot;
      zs = nodes.map(() => rootZ);
      [...nodes.keys()].sort((a, b) => depth(a) - depth(b)).forEach((i) => {
        const n = nodes[i]!;
        if (n.parent < 0) return;
        const need = zs[n.parent]! + fallOf(d2(n, nodes[n.parent]!), slope(dn[i]!));
        // inside a plenum or shaft the pipe keeps to its band (it cannot hang below the ceiling); buried it simply falls
        const kind = n.host !== undefined && n.host >= 0 ? L.hosts[n.host]!.kind : '';
        zs[i] = (kind === 'plenum' || kind === 'shaft') && Number.isFinite(top[i]!) ? Math.max(need, floor5(top[i]!)) : need;
      });
    } else {
      rootZ = floor5(Math.min(...top.map((t, i) => t - fall[i]!)));
      zs = nodes.map((_, i) => rootZ + fall[i]!);
    }
    const z = (i: number) => zs[i]!;
    nodes.forEach((n, i) => {
      if (n.parent < 0) return;
      const pa = nodes[n.parent]!;
      out.pipe(network, level, system, dn[i]!, [n.x, n.y, z(i)], [pa.x, pa.y, z(n.parent)], { load: loadOf(sub[i]!), serves: sub[i]! });
    });
    return { rootZ, nodes, z, served: sub[0]! };
  };

  // fixture drains: a vertical drop from the outlet at the floor through the slab (a sleeve) to the branch below
  const sewageItems = (items: Fixture[]) => items.map((i) => ({ id: i.id, at: i.props.at, top: Infinity, dn: kindOf(i.props.kind).drainDn ?? 40, load: kindOf(i.props.kind).uhc ?? 0 }));
  const sewDn = (ids: string[]) => sewageDnFor(uhc(ids), hasWc(ids));
  const dropFixtures = (network: string, level: string, t: NonNullable<ReturnType<typeof gravityTree>>) => {
    t.nodes.forEach((n, i) => {
      if (!n.target) return;
      const fix = fxById.get(n.target);
      if (!fix) return;
      out.pipe(network, level, 'sewage', kindOf(fix.props.kind).drainDn!, [n.x, n.y, elev(fix.level)], [n.x, n.y, t.z(i)], { load: uhc([fix.id]), serves: [fix.id] });
    });
  };
  const joins = new Map<string, { z: number; level: string; ids: string[] }[]>();
  if (stacks.length) {
    // upper floor: branches hang in the street-level ceiling plenum under the steel deck
    for (const st of stacks) {
      const items = drains.filter((d) => d.level === 'UF' && nearestStack(d.props.at).id === st.id);
      const net = `sew-UF-${st.id}`;
      const L = layer({ key: 'street-level ceiling plenum', carry: 'sewage', dn: hasWc(items.map((i) => i.id)) ? 100 : 75, diagonal: true, plenums: ['SL'], reserved: ceilingBoxes('SL') });
      const t = gravityTree('sewage', net, 'UF', L, st.props.at, sewageItems(items), { dnOf: sewDn, loadOf: uhc });
      if (t) { dropFixtures(net, 'UF', t); joins.set(st.id, [...(joins.get(st.id) ?? []), { z: t.rootZ, level: 'UF', ids: t.served }]); }
    }
    // street level: branches in the crawlspace
    for (const st of stacks) {
      const items = drains.filter((d) => d.level === 'SL' && !kitchenLine(d) && nearestStack(d.props.at).id === st.id);
      const net = `sew-SL-${st.id}`;
      const L = layer({ key: 'crawlspace', carry: 'sewage', dn: 100, diagonal: true, crawl: true });
      const t = gravityTree('sewage', net, 'SL', L, st.props.at, sewageItems(items), { dnOf: sewDn, loadOf: uhc });
      if (t) { dropFixtures(net, 'SL', t); joins.set(st.id, [...(joins.get(st.id) ?? []), { z: t.rootZ, level: 'SL', ids: t.served }]); }
    }
  }
  const kitchenItems = drains.filter(kitchenLine);
  let gtIn: number | null = null;
  if (gt && kitchenItems.length) {
    const L = layer({ key: 'crawlspace and ground', carry: 'sewage', dn: 75, diagonal: true, crawl: true, ground: true });
    const t = gravityTree('sewage', 'sew-kitchen', 'SL', L, gt.props.at, sewageItems(kitchenItems), { dnOf: sewDn, loadOf: uhc });
    if (t) { dropFixtures('sew-kitchen', 'SL', t); gtIn = t.rootZ; }
  }
  const llItems = drains.filter((d) => d.level === 'LL');
  let lsIn: number | null = null;
  if (ls && llItems.length) {
    const L = layer({ key: 'ground under the lower level', carry: 'sewage', dn: 100, diagonal: true, underLL: true });
    const t = gravityTree('sewage', 'sew-LL', 'LL', L, ls.props.at, sewageItems(llItems), { dnOf: sewDn, loadOf: uhc });
    if (t) { dropFixtures('sew-LL', 'LL', t); lsIn = t.rootZ; }
  }

  // Collector: from the stack farthest from the street, past the others, out of the house and to the street sewer.
  let collectorStart: { at: P2; z: number } | null = null;
  if (stacks.length) {
    const feet = [...stacks].sort((a, b) => b.props.at[1] - a.props.at[1]);
    const L = layer({ key: 'collector route (plenum, crawlspace, ground)', carry: 'sewage', dn: 100, plenums: ['LL'], crawl: true, ground: true, extra: [street], groundCost: 1.1, reserved: ceilingBoxes('LL') }, (o) => o.net.startsWith('sew-'));
    const x0 = feet[feet.length - 1]!.props.at[0];
    const ib2: P2 = [x0, f.yStreet + 0.3], sewer: P2 = [x0, f.yStreet - u.sewerOffset];
    interface CN { at: P2; band: number; host: string; stack?: Fixture; ib?: boolean }
    const path: CN[] = [];
    const add = (pts: { x: number; y: number; z: number; host: number }[]) => {
      const push = (x: number, y: number, z: number, host: number) => {
        const last = path[path.length - 1];
        if (last && Math.hypot(last.at[0] - x, last.at[1] - y) < 1e-6) return;
        path.push({ at: [x, y], band: z, host: host >= 0 ? L.hosts[host]!.kind : '' });
      };
      pts.forEach((pt, i) => {
        const prev = pts[i - 1];
        // buried runs are cut into 1 m pieces so the collector can follow the cover
        if (prev && pt.host >= 0 && L.hosts[pt.host]!.kind === 'underground' && d2(prev, pt) > 1.0) {
          const n = Math.ceil(d2(prev, pt) - 1e-9);
          for (let k = 1; k < n; k++) {
            const x = prev.x + (pt.x - prev.x) * k / n, y = prev.y + (pt.y - prev.y) * k / n;
            push(x, y, bandAt(L, [x, y], pt.z), pt.host);
          }
        }
        push(pt.x, pt.y, pt.z, pt.host);
      });
    };
    let ok = true;
    const legs: [P2, P2, Fixture?][] = [];
    for (let k = 1; k < feet.length; k++) legs.push([feet[k - 1]!.props.at, feet[k]!.props.at, feet[k]]);
    legs.push([feet[feet.length - 1]!.props.at, ib2]);
    path.push({ at: feet[0]!.props.at, band: Infinity, host: 'shaft', stack: feet[0] });
    for (const [a, b, st] of legs) {
      const r = routePath(L, a, b, { bend: 0.3, hostChange: 0.2 });
      if (!r.pts.length) { out.fail('sewage', 'sew-collector', st?.id ?? 'street', `no route for the collector: ${r.reason}`); ok = false; break; }
      add(r.pts);
      if (st) path[path.length - 1]!.stack = st;
    }
    if (ok) {
      path[path.length - 1]!.ib = true;
      // inspection boxes: where the collector leaves the house, and at every turn outside
      for (let k = 1; k < path.length - 1; k++) {
        const n = path[k]!;
        if (n.host !== 'underground') continue;
        const prev = path[k - 1]!, next = path[k + 1]!;
        const turn = Math.abs((n.at[0] - prev.at[0]) * (next.at[1] - n.at[1]) - (n.at[1] - prev.at[1]) * (next.at[0] - n.at[0])) > 1e-6;
        if (prev.host !== 'underground' || turn) n.ib = true;
      }
      const upstreamOf = (k: number) => [...feet.filter((s) => path.slice(0, k + 1).some((n) => n.stack?.id === s.id)).flatMap((s) => (joins.get(s.id) ?? []).flatMap((j) => j.ids)), ...llItems.map((i) => i.id)];
      const top0 = Math.min(...(joins.get(feet[0]!.id) ?? []).map((j) => j.z), Infinity) - 0.05;
      let junction: { k: number; z: number } | null = null;
      const inverts = (start: number) => {
        const zin = [start], zout = [start];
        for (let k = 1; k < path.length; k++) {
          const a = path[k - 1]!.at, b = path[k]!.at;
          let z = zout[k - 1]! - fallOf(Math.hypot(a[0] - b[0], a[1] - b[1]), 0.01);
          if (path[k]!.stack) z = Math.min(z, Math.min(...(joins.get(path[k]!.stack!.id) ?? [{ z }]).map((j) => j.z)) - 0.05);
          zin.push(z);
          // drop to the host's band: a vertical inside the house, inside an inspection box outside
          const band = Number.isFinite(path[k]!.band) ? floor5(path[k]!.band) : z;
          // a little lower than the slope gives: the piece is just steeper; much lower: a drop inside an inspection box
          if (band < z && z - band <= 0.15 && path[k]!.host === 'underground' && !path[k]!.ib) { z = band; zin[zin.length - 1] = z; }
          let zo = Math.min(z, band);
          if (junction && k === junction.k) zo = Math.min(zo, floor5(junction.z));
          if (zo < z - 1e-6 && path[k]!.host === 'underground') path[k]!.ib = true;
          zout.push(zo);
        }
        return { zin, zout };
      };
      let start = floor5(Math.min(top0, Number.isFinite(path[1]?.band ?? NaN) ? path[1]!.band : top0));
      // the kitchen line joins where it comes closest outside; lower the collector if needed so it can fall into it
      let gtJoin: { k: number; pts: { x: number; y: number; z: number; host: number }[]; zOut: number } | null = null;
      if (gt && gtIn !== null) {
        const zOut = floor5(gtIn - 0.08);
        const Lg = layer({ key: 'ground', carry: 'sewage', dn: 100, ground: true, crawl: false }, (o) => o.net === 'sew-kitchen' || o.net === 'sew-collector');
        let best: { k: number; d: number } | null = null;
        for (let k = 1; k < path.length; k++) {
          if (path[k]!.host !== 'underground' || !path[k]!.ib) continue;
          const d = Math.hypot(path[k]!.at[0] - gt.props.at[0], path[k]!.at[1] - gt.props.at[1]);
          if (!best || d < best.d) best = { k, d };
        }
        if (best) {
          const r = routePath(Lg, gt.props.at, path[best.k]!.at, { bend: 0.4 });
          if (!r.pts.length) out.fail('sewage', 'sew-kitchen', gt.id, `no route from the grease trap to the collector: ${r.reason}`);
          else {
            let len = 0;
            for (let i = 1; i < r.pts.length; i++) len += d2(r.pts[i - 1]!, r.pts[i]!);
            const arrive = zOut - fallOf(len, 0.01);
            // the collector drops inside the junction box so the kitchen line can fall into it
            junction = { k: best.k, z: arrive - 0.02 };
            gtJoin = { k: best.k, pts: r.pts, zOut };
          }
        }
      }
      const { zin, zout } = inverts(start);
      collectorStart = { at: path[0]!.at, z: zout[0]! };
      for (let k = 1; k < path.length; k++) {
        const a = path[k - 1]!, b = path[k]!;
        const ids = [...new Set([...upstreamOf(k - 1), ...(gtJoin && k > gtJoin.k ? kitchenItems.map((i) => i.id) : [])])];
        const lvl = b.host === 'underground' ? 'site' : b.host === 'plenum' ? 'LL' : 'SL';
        out.pipe('sew-collector', lvl, 'sewage', 100, [a.at[0], a.at[1], zout[k - 1]!], [b.at[0], b.at[1], zin[k]!], { load: uhc(ids), serves: ids });
        if (zout[k]! < zin[k]! - 1e-6 && !b.ib) out.pipe('sew-collector', lvl, 'sewage', 100, [b.at[0], b.at[1], zin[k]!], [b.at[0], b.at[1], zout[k]!], { load: uhc(ids), serves: ids });
      }
      const all = [...upstreamOf(path.length), ...kitchenItems.map((i) => i.id)];
      const zEnd = zout[zout.length - 1]!;
      out.pipe('sew-collector', 'site', 'sewage', 100, [ib2[0], ib2[1], zEnd], [sewer[0], sewer[1], zEnd - fallOf(Math.abs(ib2[1] - sewer[1]), 0.01)], { load: uhc(all), serves: all });
      path.forEach((n) => { if (n.ib) out.auto.push(autoFixture(`ib-auto-${String(out.auto.length + 1).padStart(2, '0')}`, 'inspection-box', n.at, ctx.surface(n.at[0], n.at[1]), 'site')); });
      // kitchen line from the grease trap
      if (gtJoin) {
        const ids = kitchenItems.map((i) => i.id);
        let z = gtJoin.zOut;
        const pts = gtJoin.pts;
        for (let i = 1; i < pts.length; i++) {
          const nz = z - fallOf(d2(pts[i - 1]!, pts[i]!), 0.01);
          out.pipe('sew-kitchen', 'site', 'sewage', 100, [pts[i - 1]!.x, pts[i - 1]!.y, z], [pts[i]!.x, pts[i]!.y, nz], { load: uhc(ids), serves: ids });
          z = nz;
          if (i < pts.length - 1) out.auto.push(autoFixture(`ib-auto-${String(out.auto.length + 1).padStart(2, '0')}`, 'inspection-box', [pts[i]!.x, pts[i]!.y], ctx.surface(pts[i]!.x, pts[i]!.y), 'site'));
        }
      }
      // stacks: vertical in their shafts from the top branch down to the collector
      for (const st of stacks) {
        const k = path.findIndex((n) => n.stack?.id === st.id);
        if (k < 0) continue;
        const foot = zin[k]!;
        const js = (joins.get(st.id) ?? []).sort((a, b) => b.z - a.z);
        js.forEach((j, i) => {
          const below = i + 1 < js.length ? js[i + 1]!.z : foot;
          const carried = js.slice(0, i + 1).flatMap((x) => x.ids);
          out.pipe(`stack-${st.id}`, j.level === 'UF' ? 'SL' : 'SL', 'sewage', sewageDnFor(uhc(carried), hasWc(carried)), [st.props.at[0], st.props.at[1], j.z], [st.props.at[0], st.props.at[1], below], { load: uhc(carried), serves: carried });
        });
      }
    }
  }
  // lower level: pumped from the lift station up a wall into the lower-level plenum and to the start of the collector
  type Riser = { fail: string } | { Lp: Layer; pts: P3[]; room: P2; band: number };
  const llRiser = (item: Fixture, network: string, dn: number, along: number, z0: number): Riser | null => {
    const pl = placeOnWall(p, item, item.props.at);
    if (!pl) return null;
    const w = p.elements.find((e) => e.id === pl.hostWallId);
    if (w?.type !== 'Wall') return null;
    const Lp = layer({ key: 'lower-level ceiling plenum', carry: 'sewage', dn, plenums: ['LL'], reserved: ceilingBoxes('LL') }, (o) => o.net === network);
    const t = w.props.thickness / 2 + 0.07;
    const cav: P2 = pl.o === 'v' ? [pl.cavity[0], pl.cavity[1] + along] : [pl.cavity[0] + along, pl.cavity[1]];
    const room: P2 = pl.o === 'v' ? [pl.cavity[0] + pl.face * t, cav[1]] : [cav[0], pl.cavity[1] + pl.face * t];
    const k = Lp.cellAt(room[0], room[1]);
    const band = k >= 0 && Lp.passable(k) ? Lp.z[k]! : NaN;
    if (!Number.isFinite(band)) return { fail: `the wall above ${item.id} does not reach a ceiling plenum` };
    const turn = Math.min(band, beamBottomOver(ctx, cav, z0, band) - outerD(dn) / 2 - 0.012);
    const pts: P3[] = [[item.props.at[0], item.props.at[1], z0], [cav[0], cav[1], z0], [cav[0], cav[1], turn], [room[0], room[1], turn], [room[0], room[1], band]];
    return { Lp, pts, room, band };
  };
  if (ls && lsIn !== null && collectorStart) {
    const ids = llItems.map((i) => i.id);
    const r0 = llRiser(ls, 'sew-LL-pumped', 50, 0, lsIn);
    if (!r0 || 'fail' in r0) out.fail('sewage', 'sew-LL-pumped', ls.id, r0 && 'fail' in r0 ? r0.fail : 'the lift station has no wall to rise in');
    else {
      const cs = collectorStart;
      const r = routePath(r0.Lp, r0.room, cs.at, { bend: 0.3 });
      if (!r.pts.length) out.fail('sewage', 'sew-LL-pumped', ls.id, `no route for the pumped line: ${r.reason}`);
      else {
        out.poly('sew-LL-pumped', 'LL', 'sewage', 50, r0.pts, { pressure: true, load: uhc(ids), serves: ids });
        const pts: P3[] = [];
        r.pts.forEach((x, i) => {
          const prev = i ? r.pts[i - 1]! : null;
          const pz = i ? pts[pts.length - 1]![2] : r0.band;
          if (Math.abs(x.z - pz) > 1e-4 && prev) {
            if (stepAtStart(ctx, r0.Lp, prev, x)) pts.push([prev.x, prev.y, x.z]);
            else pts.push([x.x, x.y, pz]);
          }
          pts.push([x.x, x.y, x.z]);
        });
        pts.push([cs.at[0], cs.at[1], cs.z + 0.06]);
        out.poly('sew-LL-pumped', 'LL', 'sewage', 50, pts, { pressure: true, load: uhc(ids), serves: ids });
      }
    }
  }

  /* ===== rain: roof drains down shafts or facades, then to the cistern (or the garden trench) ===== */
  const cistern = byKind('rain-cistern')[0];
  const trench = byKind('infiltration-trench')[0];
  const drainsR = byKind('roof-drain');
  const rainDn = (a: number) => (rainFlow(a, u.rainIntensity) <= rainCapacity(100, 0.01) ? 100 : 150);
  const rainNet = (network: string, root: P2, rootZ: number, items: Fixture[]) => {
    if (!items.length) return;
    // each drain's downpipe: in a shaft, or fixed to the outside face of the nearest outer wall (or carport post)
    const feet: { id: string; at: P2; top: number; dn: number; load: number }[] = [];
    const pipesDown: { d: Fixture; xy: P2; inShaft: boolean }[] = [];
    for (const d of items) {
      const s = shafts.at(d.props.at[0], d.props.at[1]);
      let xy: P2 = d.props.at;
      if (s) xy = shafts.slot(s, 100, `the downpipe of ${d.id}`);
      else xy = facadePoint(p, d.props.at) ?? d.props.at;
      pipesDown.push({ d, xy, inShaft: !!s });
      feet.push({ id: d.id, at: xy, top: Infinity, dn: 100, load: d.props.area ?? 0 });
    }
    const L = layer({ key: 'crawlspace, lower-level plenum and ground', carry: 'rain', dn: 100, plenums: ['LL'], crawl: true, ground: true }, (o) => o.net === network);
    const area = (ids: string[]) => ids.reduce((a, id) => a + (fxById.get(id)?.props.area ?? 0), 0);
    const t = gravityTree('rain', network, 'site', L, root, feet, { fixedRoot: rootZ, slope: () => 0.01, dnOf: (ids) => rainDn(area(ids)), loadOf: area });
    if (!t) return;
    t.nodes.forEach((n, i) => {
      if (!n.target) return;
      const pd = pipesDown.find((x) => x.d.id === n.target)!;
      const d = pd.d;
      // from the drain to the downpipe (a short run on the roof or through the parapet), then down
      // a carport drain drops under the carport's beam before it reaches the post; a roof drain crosses its parapet
      const zh = d.level === 'site' ? d.props.z - 0.35 : d.props.z - 0.05;
      const o2 = { load: d.props.area ?? 0, serves: [d.id] };
      const run = Math.hypot(pd.xy[0] - d.props.at[0], pd.xy[1] - d.props.at[1]);
      // the short run to the downpipe falls at 2 %
      const ze = zh - fallOf(run, 0.02);
      if (run > 0.01) out.poly(network, d.level, 'rain', 100, [[d.props.at[0], d.props.at[1], d.props.z - 0.05], ...(zh < d.props.z - 0.05 - 1e-6 ? [[d.props.at[0], d.props.at[1], zh] as P3] : []), [pd.xy[0], pd.xy[1], ze]], o2);
      out.pipe(network, d.level, 'rain', 100, [pd.xy[0], pd.xy[1], run > 0.01 ? ze : zh], [n.x, n.y, t.z(i)], o2);
    });
  };
  if (cistern) rainNet('rain-cistern', [cistern.props.at[0], cistern.props.at[1] + kindOf('rain-cistern').size[1] / 2 - 0.2], floor5(cistern.props.z - 0.15), drainsR.filter((d) => !d.tags.includes('to-garden')));
  if (trench) rainNet('rain-garden', trench.props.at, trench.props.z - 0.5, drainsR.filter((d) => d.tags.includes('to-garden')));
  // cistern overflow: by gravity along the south passage to the garden infiltration trench (Q10, option c)
  if (cistern && trench) {
    const Lg = layer({ key: 'ground', carry: 'rain', dn: 100, ground: true }, (o) => o.net === 'rain-overflow');
    const from: P2 = [cistern.props.at[0], cistern.props.at[1] + kindOf('rain-cistern').size[1] / 2 + 0.1];
    const r = routePath(Lg, from, trench.props.at, { bend: 0.3 });
    if (!r.pts.length) out.fail('rain', 'rain-overflow', cistern.id, `no route for the overflow: ${r.reason}`);
    else {
      const z0 = floor5(cistern.props.z - 0.3);
      let z = z0 - fallOf(Math.hypot(from[0] - cistern.props.at[0], from[1] - cistern.props.at[1]), 0.01);
      out.pipe('rain-overflow', 'site', 'rain', 100, [cistern.props.at[0], cistern.props.at[1], z0], [from[0], from[1], z], { serves: [cistern.id] });
      for (const [a, b] of pieces(r.pts, 1.0)) {
        const nz = Math.min(z - fallOf(d2(a, b), 0.01), floor5(bandAt(Lg, [b.x, b.y], b.z)));
        out.pipe('rain-overflow', 'site', 'rain', 100, [a.x, a.y, z], [b.x, b.y, nz], { serves: [cistern.id] });
        z = nz;
      }
    }
  }
  const sump = byKind('sump-pump')[0];
  if (sump) {
    const Lg = layer({ key: 'ground', carry: 'rain', dn: 50, ground: true, extra: [street] }, (o) => o.net === 'rain-sump');
    const to: P2 = [Math.min(f.xNorth(f.yStreet) - 0.6, sump.props.at[0]), f.yStreet - 2.5];
    const r = routePath(Lg, sump.props.at, to, { bend: 0.3 });
    if (!r.pts.length) out.fail('rain', 'rain-sump', sump.id, `no route for the sump line: ${r.reason}`);
    else out.poly('rain-sump', 'site', 'rain', 50, [[sump.props.at[0], sump.props.at[1], sump.props.z - 0.4], ...r.pts.map((x) => [x.x, x.y, Number.isFinite(x.z) ? x.z : -0.5] as P3)], { pressure: true, serves: [sump.id] });
  }

  /* ===== vents: each stack continues up its shaft through the roof; the lift station has its own vent ===== */
  for (const st of stacks) {
    const top = Math.max(...out.pipes.filter((x) => x.props.network === `stack-${st.id}`).flatMap((x) => [x.props.start[2], x.props.end[2]]), -Infinity);
    if (!Number.isFinite(top)) continue;
    const ids = (joins.get(st.id) ?? []).flatMap((j) => j.ids);
    out.pipe(`vent-${st.id}`, 'UF', 'vent', 75, [st.props.at[0], st.props.at[1], top], [st.props.at[0], st.props.at[1], ROOF - 0.14], { serves: ids });
    out.pipe(`vent-${st.id}`, 'roof', 'vent', 75, [st.props.at[0], st.props.at[1], ROOF - 0.14], [st.props.at[0], st.props.at[1], ROOF + 0.6], { serves: ids });
  }
  if (ls) {
    // the sealed lift station's own vent: under the slab to the nearest outer wall that rises to the roof, then up
    // its facade on brackets to above the parapet (the bulkhead to the stack shafts is full)
    // deep enough to leave the house with its cover; under the slab it first runs along to the wall point's line
    const z0 = floor5(Math.min(ls.props.z - 0.27, ctx.surface(...(ventFacade(p, ctx, ls.props.at)?.face ?? ls.props.at)) - 0.45));
    const foot = ventFacade(p, ctx, ls.props.at);
    if (!foot) out.fail('vent', 'vent-lift', ls.id, 'no outer wall rising to the roof near the lift station');
    else {
      const roofTop = ROOF + 0.6;
      const v = Math.abs(foot.under[0] - foot.face[0]) > 1e-6; // the wall runs along y
      const turn: P3 = v ? [ls.props.at[0], foot.under[1], z0] : [foot.under[0], ls.props.at[1], z0];
      out.poly('vent-lift', 'LL', 'vent', 50, [[ls.props.at[0], ls.props.at[1], z0], turn, [foot.under[0], foot.under[1], z0], [foot.face[0], foot.face[1], z0], [foot.face[0], foot.face[1], roofTop]], { serves: [ls.id] });
    }
  }

  /* ===== water: tanks → water shaft → ceiling plenums → down the walls to each fixture ===== */
  const tanks = byKind('roof-tank');
  const meter = byKind('water-meter')[0];
  const heater = byKind('water-heater')[0];
  const waterShaft = shaftEls.find((s) => s.props.name.toLowerCase().includes('water'));
  const waterUsers = fx.filter((x) => (kindOf(x.props.kind).weight ?? 0) > 0);
  const weight = (ids: string[]) => ids.reduce((a, id) => a + (kindOf(fxById.get(id)?.props.kind ?? '').weight ?? 0), 0);
  const supplyZ = (fi: Fixture) => elev(fi.level) + (kindOf(fi.props.kind).supplyZ ?? 0.6);
  const stackShaft = (st: Fixture) => shafts.at(st.props.at[0], st.props.at[1]);
  /** A water tree in one layer. Extra targets carry the weight of what lies beyond (another floor, the heater). */
  type WT = { id: string; at: P2; w: number; finish?: (z: number, node: TNode) => void; alt?: WT; below?: boolean };
  const waterTree = (system: 'cold' | 'hot', network: string, level: string, L: Layer, root: P2, targets: WT[]): number => {
    if (!targets.length) return 0;
    // a fixture whose own side of the wall has no plenum is fed from the other side of the same wall
    targets = targets.map((a) => (a.alt && !L.passable(L.cellAt(a.at[0], a.at[1])) && L.passable(L.cellAt(a.alt.at[0], a.alt.at[1])) ? a.alt : a));
    const t = growTree(L, root, targets.map((a) => ({ id: a.id, at: a.at })), { bend: 0.25 });
    for (const fl of t.failed) out.fail(system, network, fl.id, `no route: ${fl.reason}`);
    const nodes = t.nodes;
    const ch = nodes.map(() => [] as number[]);
    nodes.forEach((n, i) => { if (n.parent >= 0) ch[n.parent]!.push(i); });
    const sub: string[][] = nodes.map(() => []);
    const visit = (i: number): string[] => (sub[i] = [...(nodes[i]!.target ? [nodes[i]!.target!] : []), ...ch[i]!.flatMap(visit)]);
    if (nodes.length) visit(0);
    const w = (ids: string[]) => ids.reduce((s, id) => s + (targets.find((a) => a.id === id)?.w ?? 0), 0);
    nodes.forEach((n, i) => {
      if (n.parent < 0) return;
      const pa = nodes[n.parent]!;
      const dn = waterDnFor(w(sub[i]!)), o = { pressure: true, load: w(sub[i]!), serves: sub[i]! };
      if (Math.abs(pa.z - n.z) < 1e-4) out.pipe(network, level, system, dn, [pa.x, pa.y, pa.z], [n.x, n.y, n.z], o);
      else if (stepAtStart(ctx, L, pa, n)) out.poly(network, level, system, dn, [[pa.x, pa.y, pa.z], [pa.x, pa.y, n.z], [n.x, n.y, n.z]], o);
      else out.poly(network, level, system, dn, [[pa.x, pa.y, pa.z], [n.x, n.y, pa.z], [n.x, n.y, n.z]], o);
    });
    nodes.forEach((n) => { if (n.target) targets.find((a) => a.id === n.target)?.finish?.(n.z, n); });
    return nodes.length ? w(sub[0]!) : 0;
  };
  /** The last metres to a fixture: from the plenum beside its wall, under any beam on that wall, into the wall and down. */
  const toFixture = (system: 'cold' | 'hot', network: string, fi: Fixture): WT => {
    // a fixture on the floor (shower) takes its supply from the nearest wall of its room
    let cp = cavityPoint(p, fi);
    if (!cp && fixtureMountOf(fi.props.kind) === 'floor') {
      const pl = placeOnWall(p, fi, fi.props.at);
      const w = pl ? p.elements.find((e) => e.id === pl.hostWallId) : undefined;
      if (pl && w?.type === 'Wall') {
        const t = w.props.thickness / 2 + 0.06;
        cp = { cavity: pl.cavity, room: pl.o === 'v' ? [pl.cavity[0] + pl.face * t, pl.cavity[1]] : [pl.cavity[0], pl.cavity[1] + pl.face * t], o: pl.o, wall: w };
      }
    }
    const side = system === 'cold' ? -0.06 : 0.06;
    const wgt = weight([fi.id]);
    if (!cp) {
      // equipment and floor fixtures without a wall: straight down (or up) at the fixture
      return { id: fi.id, at: fi.props.at, w: wgt, finish: (z) => out.pipe(network, fi.level, system, waterDnFor(wgt), [fi.props.at[0], fi.props.at[1], z], [fi.props.at[0], fi.props.at[1], supplyZ(fi)], { pressure: true, load: wgt, serves: [fi.id] }) };
    }
    const along = (pt: P2): P2 => (cp.o === 'v' ? [pt[0], pt[1] + side] : [pt[0] + side, pt[1]]);
    const cav = along(cp.cavity);
    // a drop never passes a door or window of its wall: it comes down beside the opening and runs ≤ 1 m in the wall
    // under the sill to the fixture (cold to one side, hot to the other)
    const t0 = cp.o === 'v' ? cav[1] : cav[0];
    const sz = supplyZ(fi);
    const blockers: [number, number][] = openingSpans(p, cp.wall, sz);
    let td = t0;
    let below = false;
    // columns in the wall are blockers too
    const wa = Math.min(cp.wall.props.start[cp.o === 'v' ? 1 : 0], cp.wall.props.end[cp.o === 'v' ? 1 : 0]);
    for (const c of p.elements) {
      if (c.type !== 'Column') continue;
      const onLine = cp.o === 'v' ? Math.abs(c.props.at[0] - cp.cavity[0]) < 0.2 : Math.abs(c.props.at[1] - cp.cavity[1]) < 0.2;
      if (onLine) { const t = cp.o === 'v' ? c.props.at[1] : c.props.at[0]; blockers.push([t - 0.2, t + 0.2]); }
    }
    const hit = blockers.find(([a, b]) => t0 > a && t0 < b);
    if (hit) {
      const elecAt = p.elements.flatMap((d) => (d.type === 'Device' && d.props.hostWallId === cp.wall.id ? [wa + (d.props.offset ?? 0)] : []));
      const free = (t: number) => !blockers.some(([a, b]) => t > a && t < b) && !elecAt.some((e) => Math.abs(e - t) < 0.3);
      // within the fixture's own width the hose reaches the point: no pipe along the wall
      const half = Math.max(0, kindOf(fi.props.kind).size[0] / 2 - 0.05);
      const centre = t0 - side;
      const pick = (sign: number, avoid?: number) => {
        for (let k = 0; k * 0.01 <= half; k++) for (const t of [centre + sign * k * 0.01, centre - sign * k * 0.01]) {
          if (free(t) && (avoid === undefined || Math.abs(t - avoid) >= 0.08)) return t;
        }
        return undefined;
      };
      // cold first, then hot at least 8 cm away from it
      const coldT = pick(-1);
      const tw = system === 'cold' ? coldT : pick(1, coldT);
      const sideSign = system === 'cold' ? -1 : 1;
      if (tw !== undefined) td = tw;
      else if (cp.wall.props.wallType === 'exterior' || cp.wall.props.wallType === 'retaining') below = true;
      else {
        const cands: number[] = [];
        for (let k = 0; k < 12; k++) cands.push(sideSign < 0 ? hit[0] - 0.01 - 0.05 * k : hit[1] + 0.01 + 0.05 * k, sideSign < 0 ? hit[1] + 0.13 + 0.05 * k : hit[0] - 0.13 - 0.05 * k);
        const tc = cands.find((t) => Math.abs(t - t0) <= 1.0 && free(t));
        if (tc === undefined) below = true; else td = tc;
      }
    }
    // a hose inside the fixture's width needs no pipe along the wall; beyond it, ≤ 1 m in an inside wall
    const halfW = Math.max(0, kindOf(fi.props.kind).size[0] / 2 - 0.05);
    const alongWall = Math.abs(td - (t0 - side)) > halfW + 1e-6;
    if (below) {
      // the drop would cross a window of an outer wall: fed through the floor, inside the fixture's footprint
      // behind the drain (towards the wall) and to its side, clear of the fixture's own drain
      const fx0 = fi.props.at;
      const toWall = cp.o === 'v' ? Math.sign(cp.cavity[0] - fx0[0]) : Math.sign(cp.cavity[1] - fx0[1]);
      const back = Math.max(0, Math.min(0.14, Math.abs((cp.o === 'v' ? cp.cavity[0] - fx0[0] : cp.cavity[1] - fx0[1])) - cp.wall.props.thickness / 2 - 0.04));
      const pt: P2 = cp.o === 'v' ? [fx0[0] + toWall * back, fx0[1] + side * 1.5] : [fx0[0] + side * 1.5, fx0[1] + toWall * back];
      return { id: fi.id, at: pt, w: wgt, below: true, finish: (z) => out.pipe(network, fi.level, system, waterDnFor(wgt), [pt[0], pt[1], z], [pt[0], pt[1], sz], { pressure: true, load: wgt, serves: [fi.id] }) };
    }
    const at = (pt: P2, t: number): P2 => (cp.o === 'v' ? [pt[0], t] : [t, pt[1]]);
    const make = (room0: P2): WT => {
      const room = at(room0, td), cavD = at(cav, td);
      return {
        id: fi.id, at: room, w: wgt,
        finish: (z) => {
          const dn = waterDnFor(wgt);
          const turn = Math.min(z, beamBottomOver(ctx, cavD, sz, z) - outerD(dn) / 2 - 0.012);
          const pts: P3[] = [[room[0], room[1], z], [room[0], room[1], turn], [cavD[0], cavD[1], turn], [cavD[0], cavD[1], sz]];
          if (alongWall) pts.push([cav[0], cav[1], sz]);
          out.poly(network, fi.level, system, dn, pts, { pressure: true, load: wgt, serves: [fi.id] });
        },
      };
    };
    const room = along(cp.room);
    const other = along([2 * cp.cavity[0] - cp.room[0], 2 * cp.cavity[1] - cp.room[1]]);
    return { ...make(room), alt: make(other) };
  };
  if (tanks.length && waterShaft) {
    const tankZ = Math.min(...tanks.map((t) => t.props.z)) + 0.15;
    // hot water keeps 0.20 m from the conduits that drop to the ceiling boxes
    const gap = (carry: Carry) => (carry === 'hot' ? 0.26 : 0.08);
    const layers = new Map<string, Layer>();
    const extraRes = (carry: Carry) => [...otherSlots(carry), ...(carry === 'hot' ? coldPoints : [])];
    const ceilL = (level: string, carry: Carry) => {
      const k = `${level}|${carry}|${out.occ.length}`;
      if (!layers.has(k)) layers.set(k, layer({ key: `${level} ceiling plenum`, carry, dn: 40, plenums: [level], reserved: [...ceilingBoxes(level, gap(carry)), ...extraRes(carry)] }));
      return layers.get(k)!;
    };
    const llL = (carry: Carry) => layer({ key: 'crawlspace and lower-level plenum', carry, dn: 40, plenums: ['LL'], crawl: true, reserved: [...ceilingBoxes('LL', gap(carry)), ...extraRes(carry)] });
    const roofL = (carry: Carry) => layer({ key: 'roof equipment zone', carry, dn: 40, roof: true });
    // hot first (closer rule to the conduits), then cold
    const hotUsers = waterUsers.filter((x) => kindOf(x.props.kind).hot);
    const ufGroups = stacks.map((st) => ({ st, s: stackShaft(st) })).filter((g) => g.s);
    const ufOf = (users: Fixture[], st: Fixture) => users.filter((x) => x.level === 'UF' && nearestStack(x.props.at).id === st.id);
    // every riser slot is booked first, so the hot trees (routed first) keep off the cold risers to come
    const booked = new Map<string, P2>();
    for (const system of ['hot', 'cold'] as const) {
      const users = system === 'hot' ? hotUsers : waterUsers;
      for (const g of ufGroups) if (ufOf(users, g.st).length) booked.set(`${system}:UF:${g.st.id}`, shafts.slot(g.s!, 32, `${system} water riser`));
      if (users.some((x) => x.level === 'LL')) booked.set(`${system}:LL`, shafts.slot(waterShaft, 32, `${system} water to the lower level`));
    }
    booked.set('cold:riser', shafts.slot(waterShaft, 40, 'cold water riser'));
    if (meter) booked.set('cold:feed', shafts.slot(waterShaft, 25, 'water feed'));
    const otherSlots = (system: string) => [...booked].filter(([k]) => !k.startsWith(system) || k === 'cold:feed').map(([k, at]) => ({ at, r: 0.045, why: `the ${k.replace(':', ' ')} slot` }));
    // and hot keeps clear of the cold drops beside each fixture
    const coldPoints = waterUsers.flatMap((fi) => { const t = toFixture('cold', 'x', fi); return [{ at: t.at, r: 0.035, why: 'a cold drop' }, ...(t.alt ? [{ at: t.alt.at, r: 0.035, why: 'a cold drop' }] : [])]; });
    const plan = (system: 'cold' | 'hot') => {
      const users = system === 'hot' ? hotUsers : waterUsers;
      const net = (s: string) => `${system}-${s}`;
      // upper floor: from each stack shaft, in the upper-floor ceiling plenum
      const ufSlots = new Map<string, P2>();
      let ufW = 0;
      const belowUF: WT[] = [];
      for (const g of ufGroups) {
        const items = ufOf(users, g.st);
        if (!items.length) continue;
        const slot = booked.get(`${system}:UF:${g.st.id}`)!;
        ufSlots.set(g.st.id, slot);
        const wts = items.map((i) => toFixture(system, net(`UF-${g.st.id}`), i));
        belowUF.push(...wts.filter((w) => w.below).map((w) => ({ ...w, finish: (z: number, n: TNode) => { const fi = fxById.get(w.id)!; out.pipe(net('SL'), 'UF', system, waterDnFor(w.w), [w.at[0], w.at[1], z], [w.at[0], w.at[1], supplyZ(fi)], { pressure: true, load: w.w, serves: [fi.id] }); void n; } })));
        ufW += waterTree(system, net(`UF-${g.st.id}`), 'UF', ceilL('UF', system), slot, wts.filter((w) => !w.below));
      }
      // lower level: from the water shaft foot, through the crawlspace into the lower-level plenum
      const llItems2 = users.filter((x) => x.level === 'LL');
      const llSlot = llItems2.length ? booked.get(`${system}:LL`) ?? null : null;
      let llW = 0;
      const llL0 = llL(system);
      // street-level fixtures under a window of an outer wall are fed from the crawlspace, up through the floor
      const belowSL = users.filter((x) => x.level === 'SL').map((i) => toFixture(system, net('LL'), i)).filter((w) => w.below);
      if (llSlot || belowSL.length) {
        const wts = [...llItems2.map((i) => toFixture(system, net('LL'), i)), ...belowSL];
        const reach = (a: WT) => llL0.passable(llL0.cellAt(a.at[0], a.at[1])) || (!!a.alt && llL0.passable(llL0.cellAt(a.alt.at[0], a.alt.at[1])));
        const direct = wts.filter((w) => !w.below || belowSL.includes(w)).filter(reach);
        const under = llItems2.filter((_, i) => !reach(wts[i]!) || wts[i]!.below);
        // rooms with no ceiling to feed from (the laundry under the stair): down a wall, under the slab, up their own wall
        let afterward: (() => void) | null = null;
        if (under.length) {
          const Lu = layer({ key: 'ground under the lower-level slab', carry: system, dn: 32, underLL: true });
          const drop = dropPoint(p, ctx, llL0, under, Lu);
          if (!drop) for (const fi of under) out.fail(system, net('LL'), fi.id, 'no ceiling plenum above it and no wall to bring the pipe under the slab');
          else {
            const zU = rootZ(Lu, drop.cav);
            const wu = weight(under.map((x) => x.id));
            direct.push({ id: `drop:${system}-LL`, at: drop.room, w: wu, finish: (z) => out.poly(net('LL'), 'LL', system, waterDnFor(wu), [[drop.room[0], drop.room[1], z], [drop.cav[0], drop.cav[1], z], [drop.cav[0], drop.cav[1], zU]], { pressure: true, load: wu, serves: under.map((x) => x.id) }) });
            afterward = () => waterTree(system, net('LL-under'), 'LL', Lu, drop.cav, under.map((fi) => {
              const cp = cavityPoint(p, fi);
              const side = system === 'cold' ? -0.06 : 0.06;
              const cav: P2 = cp ? (cp.o === 'v' ? [cp.cavity[0], cp.cavity[1] + side] : [cp.cavity[0] + side, cp.cavity[1]]) : fi.props.at;
              const wg = weight([fi.id]);
              return { id: fi.id, at: cav, w: wg, finish: (z: number) => out.pipe(net('LL-under'), 'LL', system, waterDnFor(wg), [cav[0], cav[1], z], [cav[0], cav[1], supplyZ(fi)], { pressure: true, load: wg, serves: [fi.id] }) };
            }));
          }
        }
        if (llSlot) llW = waterTree(system, net('LL'), 'LL', llL0, llSlot, direct);
        else for (const w of belowSL) out.fail(system, net('LL'), w.id, 'no water reaches the crawlspace under it');
        afterward?.();
      }
      return { users, ufSlots, llSlot, llW, ufW, llL0, belowUF, belowSL: belowSL.map((w) => w.id) };
    };
    // ----- hot: heater on a roof → down through its slab into the street-level plenum
    let hotPlan: ReturnType<typeof plan> | null = null;
    if (heater) {
      hotPlan = plan('hot');
      const slL = ceilL('SL', 'hot');
      const targets: WT[] = [
        ...hotPlan.users.filter((x) => x.level === 'SL' && !hotPlan!.belowSL.includes(x.id)).map((i) => toFixture('hot', 'hot-SL', i)),
        ...hotPlan.belowUF,
        ...[...hotPlan.ufSlots].map(([sid, at]) => ({ id: `riser:${sid}`, at, w: weight(ufOf(hotPlan!.users, fxById.get(sid)!).map((x) => x.id).filter((id) => !hotPlan!.belowUF.some((b) => b.id === id))), finish: (z: number) => { const top = hotRiserTop(); out.pipe(`hot-riser-${sid}`, 'UF', 'hot', 32, [at[0], at[1], z], [at[0], at[1], top(at)], { pressure: true, serves: ufOf(hotPlan!.users, fxById.get(sid)!).map((x) => x.id) }); } })),
        ...(hotPlan.llSlot ? [{ id: 'riser:LL', at: hotPlan.llSlot, w: weight([...hotPlan.users.filter((x) => x.level === 'LL').map((x) => x.id), ...hotPlan.belowSL]), finish: (z: number) => { const at = hotPlan!.llSlot!; const zb = rootZ(hotPlan!.llL0, at); out.pipe('hot-riser-LL', 'SL', 'hot', 32, [at[0], at[1], z], [at[0], at[1], zb], { pressure: true }); } }] : []),
      ];
      const hk = slL.cellAt(heater.props.at[0], heater.props.at[1]);
      const hz = hk >= 0 && slL.passable(hk) ? slL.z[hk]! : NaN;
      if (!Number.isFinite(hz)) out.fail('hot', 'hot-SL', heater.id, 'the water heater does not stand over a ceiling plenum');
      else {
        const total = waterTree('hot', 'hot-SL', 'SL', slL, heater.props.at, targets);
        out.pipe('hot-main', 'SL', 'hot', waterDnFor(total), [heater.props.at[0], heater.props.at[1], heater.props.z + 0.3], [heater.props.at[0], heater.props.at[1], hz], { pressure: true, load: total, serves: hotUsers.map((x) => x.id) });
      }
    }
    function hotRiserTop() { return (at: P2) => { const L = ceilL('UF', 'hot'); return rootZ(L, at); }; }
    // ----- cold
    const coldPlan = plan('cold');
    const slL = ceilL('SL', 'cold');
    const coldSlot = booked.get('cold:riser')!;
    const heaterW = heater ? weight(hotUsers.map((x) => x.id)) : 0;
    const coldTargets: WT[] = [
      ...coldPlan.users.filter((x) => x.level === 'SL' && !coldPlan.belowSL.includes(x.id)).map((i) => toFixture('cold', 'cold-SL', i)),
      ...coldPlan.belowUF,
      ...(heater ? [{ id: heater.id, at: [heater.props.at[0] + 0.1, heater.props.at[1]] as P2, w: heaterW, finish: (z: number) => out.pipe('cold-SL', 'SL', 'cold', waterDnFor(heaterW), [heater.props.at[0] + 0.1, heater.props.at[1], z], [heater.props.at[0] + 0.1, heater.props.at[1], heater.props.z + 0.3], { pressure: true, load: heaterW, serves: [heater.id] }) }] : []),
      ...[...coldPlan.ufSlots].map(([sid, at]) => ({ id: `riser:${sid}`, at, w: weight(ufOf(waterUsers, fxById.get(sid)!).map((x) => x.id).filter((id) => !coldPlan.belowUF.some((b) => b.id === id))), finish: (z: number) => out.pipe(`cold-riser-${sid}`, 'UF', 'cold', 32, [at[0], at[1], z], [at[0], at[1], rootZ(ceilL('UF', 'cold'), at)], { pressure: true, serves: ufOf(waterUsers, fxById.get(sid)!).map((x) => x.id) }) })),
      ...(coldPlan.llSlot ? [{ id: 'riser:LL', at: coldPlan.llSlot, w: weight([...waterUsers.filter((x) => x.level === 'LL').map((x) => x.id), ...coldPlan.belowSL]), finish: (z: number) => { const at = coldPlan.llSlot!; out.pipe('cold-riser-LL', 'SL', 'cold', 32, [at[0], at[1], z], [at[0], at[1], rootZ(coldPlan.llL0, at)], { pressure: true }); } }] : []),
    ];
    const total = waterTree('cold', 'cold-SL', 'SL', slL, coldSlot, coldTargets);
    const zSL = rootZ(slL, coldSlot);
    // tanks → roof zone → the water shaft → down to the street-level plenum
    const roofC = roofL('cold');
    const zRoof = rootZ(roofC, coldSlot);
    const allIds = [...waterUsers.map((x) => x.id), ...(heater ? [heater.id] : [])];
    if (Number.isFinite(zRoof)) {
      waterTree('cold', 'cold-tanks', 'roof', roofC, coldSlot, tanks.map((t) => ({ id: t.id, at: t.props.at, w: total / tanks.length, finish: (z: number) => out.pipe('cold-tanks', 'roof', 'cold', waterDnFor(total), [t.props.at[0], t.props.at[1], z], [t.props.at[0], t.props.at[1], tankZ - 0.1], { pressure: true, load: total / tanks.length, serves: allIds }) })));
      out.pipe('cold-riser', 'UF', 'cold', waterDnFor(total), [coldSlot[0], coldSlot[1], zRoof], [coldSlot[0], coldSlot[1], zSL], { pressure: true, load: total, serves: allIds });
    } else out.fail('cold', 'cold-tanks', waterShaft.id, 'the water shaft does not reach a roof equipment zone');
    // feed: meter → ground → crawlspace → up the water shaft → roof zone → tank inlets
    if (meter) {
      const feedSlot = booked.get('cold:feed')!;
      const Lf = layer({ key: 'ground and crawlspace', carry: 'cold', dn: 25, ground: true, crawl: true });
      const r = routePath(Lf, meter.props.at, feedSlot, { bend: 0.3 });
      if (!r.pts.length) out.fail('cold', 'cold-feed', meter.id, `no route for the feed: ${r.reason}`);
      else {
        const pts: P3[] = [[meter.props.at[0], meter.props.at[1], meter.props.z], [r.pts[0]!.x, r.pts[0]!.y, bandAt(Lf, [r.pts[0]!.x, r.pts[0]!.y], r.pts[0]!.z)]];
        // buried, it follows the ground in short pieces; inside the crawlspace it hangs at its band
        for (const [, b] of pieces(r.pts, 1.0)) pts.push([b.x, b.y, bandAt(Lf, [b.x, b.y], b.z)]);
        const zr = rootZ(roofL('cold'), feedSlot) + 0.08;
        pts.push([feedSlot[0], feedSlot[1], zr]);
        out.poly('cold-feed', 'site', 'cold', 25, pts, { pressure: true, serves: tanks.map((t) => t.id) });
        const Lr = layer({ key: 'roof equipment zone', carry: 'cold', dn: 25, roof: true }, (o) => o.net === 'cold-feed');
        for (const t of tanks) {
          const rr = routePath(Lr, feedSlot, t.props.at, { bend: 0.3 });
          if (!rr.pts.length) { out.fail('cold', 'cold-feed', t.id, `no route to the tank: ${rr.reason}`); continue; }
          out.poly('cold-feed', 'roof', 'cold', 25, [...rr.pts.map((x) => [x.x, x.y, zr] as P3), [t.props.at[0], t.props.at[1], tankZ + 0.8]], { pressure: true, serves: [t.id] });
        }
      }
    }
  }
  return out;
}

/** A path cut into pieces no longer than `max`, so a buried pipe can follow the ground. */
function pieces<T extends { x: number; y: number; z: number }>(pts: T[], max: number): [T, T][] {
  const out: [T, T][] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const n = Math.max(1, Math.ceil(d2(a, b) / max - 1e-9));
    let prev = a;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const nx = { ...b, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
      out.push([prev, nx]);
      prev = nx;
    }
  }
  return out;
}
const bandAt = (L: Layer, at: P2, fallback: number) => { const k = L.cellAt(at[0], at[1]); return k >= 0 && L.passable(k) ? L.z[k]! : fallback; };

/** Height of a layer's band at a point (its nearest open cell). */
function rootZ(L: Layer, at: P2): number {
  let k = L.cellAt(at[0], at[1]);
  if (!L.passable(k)) k = L.nearestOpen(at[0], at[1], 0.4);
  return k >= 0 ? L.z[k]! : NaN;
}

/** Bottom of a beam over a wall point between two heights (a pipe coming down into the wall turns under it), or +∞. */
export function beamBottomOver(ctx: MepContext, at: P2, zLo = -Infinity, zHi = Infinity): number {
  let z = Infinity;
  for (const b of ctx.beams) {
    const on = b.o === 'v' ? Math.abs(at[0] - b.c) < b.width / 2 + 0.03 && at[1] > b.a && at[1] < b.b : Math.abs(at[1] - b.c) < b.width / 2 + 0.03 && at[0] > b.a && at[0] < b.b;
    const zb = b.zTop - b.depth;
    if (on && zb > zLo && zb < zHi + 0.3) z = Math.min(z, zb);
  }
  return z;
}

/** Where the lift-station vent reaches an outer wall that runs, floor above floor, up to the roof: a point under the
 *  wall (clear of footings and openings) and the matching point on its outside face. */
function ventFacade(p: Project, ctx: MepContext, at: P2): { under: P2; face: P2 } | null {
  const outer = p.elements.filter((w): w is Extract<Element, { type: 'Wall' }> => w.type === 'Wall' && w.props.wallType === 'exterior');
  const covers = (level: string, x: number, y: number) => outer.some((w) => w.level === level && (Math.abs(w.props.start[0] - w.props.end[0]) < 1e-6
    ? Math.abs(w.props.start[0] - x) < 1e-6 && y > Math.min(w.props.start[1], w.props.end[1]) + 0.2 && y < Math.max(w.props.start[1], w.props.end[1]) - 0.2
    : Math.abs(w.props.start[1] - y) < 1e-6 && x > Math.min(w.props.start[0], w.props.end[0]) + 0.2 && x < Math.max(w.props.start[0], w.props.end[0]) - 0.2));
  const footing = (x: number, y: number) => p.elements.some((f) => f.type === 'Footing' && x > f.props.rect.x0 - 0.1 && x < f.props.rect.x1 + 0.1 && y > f.props.rect.y0 - 0.1 && y < f.props.rect.y1 + 0.1);
  let best: { under: P2; face: P2 } | null = null, bd = Infinity;
  for (const w of outer.filter((x) => x.level === 'LL')) {
    const v = Math.abs(w.props.start[0] - w.props.end[0]) < 1e-6, c = v ? w.props.start[0] : w.props.start[1];
    const a = v ? Math.min(w.props.start[1], w.props.end[1]) : Math.min(w.props.start[0], w.props.end[0]), b = v ? Math.max(w.props.start[1], w.props.end[1]) : Math.max(w.props.start[0], w.props.end[0]);
    for (let t = a + 0.25; t <= b - 0.25 + 1e-9; t += 0.05) {
      const pt: P2 = v ? [c, t] : [t, c];
      if (!['SL', 'UF'].every((L) => covers(L, pt[0], pt[1]))) continue;
      if (footing(pt[0], pt[1])) continue;
      // never across a door; in front of as few windows as possible
      let windows = 0;
      let door = false;
      for (const x of outer) {
        const xv = Math.abs(x.props.start[0] - x.props.end[0]) < 1e-6;
        if (xv !== v || Math.abs((xv ? x.props.start[0] : x.props.start[1]) - c) > 1e-6) continue;
        const a0 = xv ? Math.min(x.props.start[1], x.props.end[1]) : Math.min(x.props.start[0], x.props.end[0]);
        for (const o of p.elements) {
          if (o.type !== 'Opening' || o.props.host !== x.id) continue;
          if (t > a0 + o.props.offset - 0.1 && t < a0 + o.props.offset + o.props.width + 0.1) { if (o.props.role === 'door') door = true; else windows++; }
        }
      }
      if (door) continue;
      // outside = the side with no room
      const probe = (s: number): P2 => (v ? [c + s * (w.props.thickness / 2 + 0.1), t] : [t, c + s * (w.props.thickness / 2 + 0.1)]);
      const side = ctx.inRoom('LL', ...probe(1)) || ctx.inRoom('SL', ...probe(1)) ? -1 : 1;
      const face: P2 = v ? [q(c + side * (w.props.thickness / 2 + 0.07)), q(t)] : [q(t), q(c + side * (w.props.thickness / 2 + 0.07))];
      const d = Math.hypot(pt[0] - at[0], pt[1] - at[1]) + 5 * windows;
      if (d < bd) { bd = d; best = { under: [q(pt[0]), q(pt[1])], face }; }
    }
  }
  return best;
}

/** Spans along a wall taken by its openings above a height (doors with their 0.10 m frame, windows ± 0.05 m). */
function openingSpans(p: Project, w: { id: string; props: { start: [number, number]; end: [number, number] } }, z: number): [number, number][] {
  const [sx, sy] = w.props.start, [ex, ey] = w.props.end;
  const v = Math.abs(sx - ex) < 1e-6, a0 = v ? Math.min(sy, ey) : Math.min(sx, ex);
  const out: [number, number][] = [];
  for (const o of p.elements) {
    if (o.type !== 'Opening' || o.props.host !== w.id) continue;
    const floor = p.levels.find((l) => l.id === o.level)?.elevation ?? 0;
    const door = o.props.role === 'door';
    if (!door && floor + o.props.sill + o.props.height < z) continue;
    const m = door ? 0.12 : 0.045;
    out.push([a0 + o.props.offset - m, a0 + o.props.offset + o.props.width + m]);
  }
  return out;
}

/** Where a water pipe goes down a wall from a lower-level plenum to run under the slab: an inside wall with a plenum
 *  on one side, no beam over it, clear of its openings, as close as possible to the fixtures it serves. */
const usedDrops: P2[] = [];
function dropPoint(p: Project, ctx: MepContext, L: Layer, items: Fixture[], Lu?: Layer): { cav: P2; room: P2 } | null {
  const cx = items.reduce((a, f) => a + f.props.at[0], 0) / items.length, cy = items.reduce((a, f) => a + f.props.at[1], 0) / items.length;
  let best: { cav: P2; room: P2 } | null = null, bd = Infinity;
  for (const w of p.elements) {
    if (w.type !== 'Wall' || w.level !== 'LL' || (w.props.wallType !== 'interior' && w.props.wallType !== 'wet')) continue;
    const [sx, sy] = w.props.start, [ex, ey] = w.props.end;
    const v = Math.abs(sx - ex) < 1e-6, c = v ? sx : sy, a = v ? Math.min(sy, ey) : Math.min(sx, ex), b = v ? Math.max(sy, ey) : Math.max(sx, ex);
    const ops = p.elements.filter((o) => o.type === 'Opening' && o.props.host === w.id).map((o) => (o.type === 'Opening' ? [a + o.props.offset - 0.15, a + o.props.offset + o.props.width + 0.15] : [0, 0]));
    for (let t = a + 0.2; t <= b - 0.2 + 1e-9; t += 0.1) {
      if (ops.some(([u, z]) => t > u! && t < z!)) continue;
      const cav: P2 = v ? [c, t] : [t, c];
      if (beamBottomOver(ctx, cav) < Infinity) continue;
      if (!L.passable(L.cellAt(cav[0], cav[1]))) continue;
      if (Lu && !Lu.passable(Lu.cellAt(cav[0], cav[1]))) continue;
      if (p.elements.some((d) => d.type === 'Device' && d.props.hostWallId === w.id && Math.abs((d.props.offset ?? 0) + a - t) < 0.35)) continue;
      if (usedDrops.some((u) => Math.hypot(u[0] - cav[0], u[1] - cav[1]) < 0.15)) continue;
      for (const side of [1, -1]) {
        const room: P2 = v ? [c + side * (w.props.thickness / 2 + 0.06), t] : [t, c + side * (w.props.thickness / 2 + 0.06)];
        if (!L.passable(L.cellAt(room[0], room[1]))) continue;
        const d = Math.hypot(cav[0] - cx, cav[1] - cy);
        if (d < bd) { bd = d; best = { cav: [q(cav[0]), q(cav[1])], room: [q(room[0]), q(room[1])] }; }
      }
    }
  }
  if (best) usedDrops.push(best.cav);
  return best;
}

/** A downpipe point on the outside face of the nearest outer wall (or a carport post). */
function facadePoint(p: Project, at: P2): P2 | null {
  let best: P2 | null = null, bd = Infinity;
  for (const w of p.elements) {
    if (w.type !== 'Wall' || w.props.wallType !== 'exterior') continue;
    const [sx, sy] = w.props.start, [ex, ey] = w.props.end;
    const v = Math.abs(sx - ex) < 1e-6;
    const c = v ? sx : sy, a = v ? Math.min(sy, ey) : Math.min(sx, ex), b = v ? Math.max(sy, ey) : Math.max(sx, ex);
    const t0 = Math.min(b - 0.1, Math.max(a + 0.1, v ? at[1] : at[0]));
    const off = w.props.thickness / 2 + 0.07;
    // slide along the facade until the foot of the downpipe is clear of every footing
    const clear = (pt: P2) => !p.elements.some((f) => f.type === 'Footing' && pt[0] > f.props.rect.x0 - 0.08 && pt[0] < f.props.rect.x1 + 0.08 && pt[1] > f.props.rect.y0 - 0.08 && pt[1] < f.props.rect.y1 + 0.08);
    for (const side of [1, -1]) {
      let pt: P2 = v ? [c + side * off, t0] : [t0, c + side * off];
      for (const d of [0, -0.2, 0.2, -0.4, 0.4, -0.6, 0.6, -0.8, 0.8]) {
        const t = Math.min(b - 0.1, Math.max(a + 0.1, t0 + d));
        const cand: P2 = v ? [c + side * off, t] : [t, c + side * off];
        if (clear(cand)) { pt = cand; break; }
      }
      const inside = p.elements.some((s) => s.type === 'Space' && s.level === w.level && s.props.cells.some((cc) => pt[0] > cc.x0 && pt[0] < cc.x1 && pt[1] > cc.y0 && pt[1] < cc.y1));
      if (inside) continue;
      const d = Math.hypot(pt[0] - at[0], pt[1] - at[1]);
      if (d < bd) { bd = d; best = [q(pt[0]), q(pt[1])]; }
    }
  }
  for (const c of p.elements) {
    if (c.type !== 'Column' || !c.tags.includes('carport')) continue;
    const pt: P2 = [c.props.at[0], c.props.at[1] + 0.4];
    const d = Math.hypot(pt[0] - at[0], pt[1] - at[1]);
    if (d < bd) { bd = d; best = [q(pt[0]), q(pt[1])]; }
  }
  return bd < 1.0 ? best : null;
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
  const { pipes, auto, noRoute, notes } = routePlumbing(p);
  const kept = p.elements.filter((e) => !(e.type === 'PipeSegment' && e.tags.includes('auto')) && !(e.type === 'Fixture' && e.tags.includes('auto')));
  const fresh: Element[] = pipes.map((x) => {
    const o = old.get(x.id);
    return o?.props.manual ? { ...x, props: { ...x.props, dn: o.props.dn, material: o.props.material, manual: true } } : x;
  });
  const others = (p.mep?.noRoute ?? []).filter((n) => n.system === 'electrical');
  const otherNotes = (p.mep?.notes ?? []).filter((n) => n.startsWith('Electrical'));
  return { ...p, mep: { noRoute: [...noRoute, ...others], notes: [...notes, ...otherNotes] }, elements: [...kept, ...fresh, ...auto] };
}
