// Spec 04b: conduit routing that obeys the building. Floor points are fed through the floor screed (and the crawlspace
// under the street floor), ceiling points through the ceiling plenum or the topping of the slab above, roof equipment
// through the roof zones, garden and carport points through the ground; the electrical shaft joins the floors.
// Every wall point gets its conduit up or down inside the wall behind it.
import { q } from '../geometry';
import type { Conduit, Device, PipeSegment, Project, ServiceSpace } from '../schema';
import { Layer, growTree, type TNode } from '../mep/grid';
import { cavityPoint, ceilingHost, mountOf, roomOf } from '../mep/hosting';
import { buildLayer, stepAtStart, type LayerReq, type Occ } from '../mep/layers';
import { outerD } from '../mep/library';
import { mepContext } from '../mep/spaces';
import type { NoRoute } from '../plumbing/route';

type P2 = [number, number];
type P3 = [number, number, number];
const PLAN = ['LL', 'SL', 'UF'];

export interface ConduitResult { conduits: Conduit[]; lengths: Map<string, number>; noRoute: NoRoute[]; notes: string[] }

/** Which zone feeds a device: F = floor of a level, C = ceiling of a level, R = roof zones, G = ground (garden, carport, posts). */
export function zoneOf(p: Project, d: Device): string {
  const m = mountOf(d);
  if (d.level === 'roof') {
    // equipment on the entry roof is fed through the upper floor's screed, which runs onto that roof slab
    const zone = p.elements.find((e) => e.type === 'ServiceSpace' && e.props.kind === 'roof-zone' && d.props.at[0] >= e.props.rect.x0 && d.props.at[0] <= e.props.rect.x1 && d.props.at[1] >= e.props.rect.y0 && d.props.at[1] <= e.props.rect.y1);
    const uf = p.levels.find((l) => l.id === 'UF')?.elevation ?? 0;
    if (zone?.type === 'ServiceSpace' && Math.abs((zone.props.z0 ?? 0) - uf) < 0.05) return 'F:UF';
    return 'R';
  }
  if (!PLAN.includes(d.level)) return 'G';
  if (m === 'equipment' || m === 'site') return d.level === 'LL' ? 'G' : 'G';
  if (m === 'ceiling') return roomOf(p, d) || (PLAN.includes(d.level) && ceilingHost(p, d.level, d.props.at)) ? `C:${d.level}` : 'G';
  if (d.props.hostWallId) return `F:${d.level}`;
  return roomOf(p, d) ? `F:${d.level}` : 'G';
}

const layerCache = new WeakMap<Project, Map<string, Layer>>();

export function routeConduits(p: Project, circuits: { id: string; panel: Device; devs: Device[] }[], existing: Conduit[] = []): ConduitResult {
  const res: ConduitResult = { conduits: [], lengths: new Map(), noRoute: [], notes: [] };
  const ctx = mepContext(p);
  const pipes = p.elements.filter((e): e is PipeSegment => e.type === 'PipeSegment');
  const occ: Occ[] = pipes.map((x) => ({ a: x.props.start, b: x.props.end, r: outerD(x.props.dn) / 2, carry: x.props.system, net: x.props.network }));
  const shaft = p.elements.find((e): e is ServiceSpace => e.type === 'ServiceSpace' && e.props.kind === 'shaft' && /electric/i.test(e.props.name));
  const E: P2 | null = shaft ? [q((shaft.props.rect.x0 + shaft.props.rect.x1) / 2), q((shaft.props.rect.y0 + shaft.props.rect.y1) / 2)] : null;
  let cache = layerCache.get(p);
  if (!cache) { cache = new Map(); layerCache.set(p, cache); }
  const layerFor = (zone: string, panelLevel: string): Layer => {
    const key = `${zone}|${panelLevel}`;
    const hit = cache!.get(key);
    if (hit) return hit;
    const req: LayerReq = { key: zoneName(zone), carry: 'conduit', dn: 25, diagonal: false, occ };
    if (zone.startsWith('F:')) {
      const L = zone.slice(2);
      req.screeds = [L];
      if (L === 'SL') req.crawl = true;
      if (L === panelLevel) req.ground = true; // garden and carport points leave from the panel's floor
      if (L === 'SL' && panelLevel === 'SL') req.plenums = ['LL']; // through the crawlspace into the lower level (the feeder)
    } else if (zone.startsWith('C:')) {
      const L = zone.slice(2);
      // ceiling points: conduits in the topping of the slab above, dropping through a sleeve to the light box
      const up = ctx.levelAbove(L);
      req.screeds = up ? [up] : [];
    } else if (zone === 'R') { req.roof = true; req.screeds = ['roof']; }
    const layer = buildLayer(ctx, req);
    cache!.set(key, layer);
    return layer;
  };
  const band = (L: Layer, at: P2) => {
    let k = L.cellAt(at[0], at[1]);
    if (!L.passable(k)) k = L.nearestOpen(at[0], at[1], 0.4);
    return k >= 0 ? L.z[k]! : NaN;
  };

  for (const c of circuits) {
    let n = existing.filter((x) => x.props.circuit === c.id).length;
    const seg = (a: P3, b: P3) => {
      if (Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) < 0.005) return;
      res.conduits.push({ id: `cnd-${c.id.slice(4)}-${String(++n).padStart(3, '0')}`, type: 'Conduit', level: c.panel.level, tags: ['auto'], props: { circuit: c.id, start: a.map(q) as P3, end: b.map(q) as P3, dn: 20 } });
    };
    const panel = c.panel;
    const pl = panel.level;
    const homeZone = `F:${pl}`;
    const byZone = new Map<string, Device[]>();
    for (const d of c.devs) {
      // a wall point that found no legal place is reported by the checks; no conduit is drawn to it
      if (mountOf(d) === 'wall' && !d.props.hostWallId && !d.props.hostId) { res.noRoute.push({ system: 'electrical', network: c.id, item: d.id, reason: 'not placed on a wall face (no legal position in its room)' }); continue; }
      let z = zoneOf(p, d);
      // from the street-level panel, lower-level wall points (the sub-panel) are reached through the crawlspace and plenum
      if (z === 'G' || (pl === 'SL' && z === 'F:LL' && d.props.hostWallId)) z = homeZone;
      byZone.set(z, [...(byZone.get(z) ?? []), d]);
    }
    const viaShaft = [...byZone.keys()].filter((z) => z !== homeZone && !(z === `C:${pl}` && cavityPoint(p, panel)));
    if (viaShaft.length && !byZone.has(homeZone)) byZone.set(homeZone, []);
    let worst = 0;
    const pc = cavityPoint(p, panel);
    const panelXY: P2 = pc?.cavity ?? panel.props.at;
    const offsets = new Map<string, { at: P2; dist: number; z: number }>();
    const order = [homeZone, ...[...byZone.keys()].filter((z) => z !== homeZone)];
    for (const zone of order) {
      const ds = byZone.get(zone) ?? [];
      const L = layerFor(zone, pl);
      let root: P2, base: number, rootZ: number;
      if (zone === homeZone) {
        root = panelXY;
        rootZ = band(L, root);
        base = Math.abs(panel.props.z - rootZ);
        if (!Number.isFinite(rootZ)) { for (const d of ds) res.noRoute.push({ system: 'electrical', network: c.id, item: d.id, reason: `the panel ${panel.id} has no floor or crawlspace under it` }); continue; }
        seg([root[0], root[1], panel.props.z], [root[0], root[1], rootZ]);
      } else if (zone.slice(2) === pl && pc) {
        // the same floor's ceiling: up the panel's wall into the slab above
        root = panelXY;
        rootZ = band(L, root);
        if (!Number.isFinite(rootZ)) { for (const d of ds) res.noRoute.push({ system: 'electrical', network: c.id, item: d.id, reason: `no slab above the panel ${panel.id}` }); continue; }
        seg([root[0], root[1], panel.props.z], [root[0], root[1], rootZ]);
        base = Math.abs(panel.props.z - rootZ);
      } else {
        const off = offsets.get('shaft');
        if (!E || !off) { for (const d of ds) res.noRoute.push({ system: 'electrical', network: c.id, item: d.id, reason: 'no electrical shaft to reach this floor' }); continue; }
        root = E;
        rootZ = band(L, E);
        if (!Number.isFinite(rootZ)) { for (const d of ds) res.noRoute.push({ system: 'electrical', network: c.id, item: d.id, reason: `the electrical shaft does not reach the ${zoneName(zone)}` }); continue; }
        seg([E[0], E[1], off.z], [E[0], E[1], rootZ]);
        base = off.dist + Math.abs(rootZ - off.z);
      }
      const targets = ds.map((d) => ({ id: d.id, at: attach(p, d, zoneBelow(zone)).drop }));
      if (zone === homeZone && viaShaft.length && E) targets.push({ id: 'shaft', at: E });
      if (!targets.length) continue;
      const t = growTree(L, root, targets, { bend: 0.15, hostChange: 0.2 });
      for (const f of t.failed) res.noRoute.push({ system: 'electrical', network: c.id, item: f.id, reason: `no route: ${f.reason}` });
      const nodes = t.nodes;
      const dist = treeDist(nodes);
      nodes.forEach((nd) => {
        if (nd.parent < 0) return;
        const pa = nodes[nd.parent]!;
        const buried = L.hosts[nd.host ?? -1]?.kind === 'underground' && L.hosts[pa.host ?? -1]?.kind === 'underground';
        if (buried) {
          // in the ground the conduit follows the cover, in pieces of at most 1 m
          const n = Math.max(1, Math.ceil(Math.hypot(nd.x - pa.x, nd.y - pa.y) - 1e-9));
          let prev: P3 = [pa.x, pa.y, pa.z];
          for (let k = 1; k <= n; k++) {
            const x = pa.x + (nd.x - pa.x) * k / n, y = pa.y + (nd.y - pa.y) * k / n;
            const z = k === n ? nd.z : bandOf(L, x, y, prev[2]);
            // a big change of cover (a patio edge, a car bay) is a step down on the deeper side
            if (Math.abs(z - prev[2]) > 0.08) {
              if (z < prev[2]) { seg(prev, [prev[0], prev[1], z]); seg([prev[0], prev[1], z], [x, y, z]); }
              else { seg(prev, [x, y, prev[2]]); seg([x, y, prev[2]], [x, y, z]); }
            } else seg(prev, [x, y, z]);
            prev = [x, y, z];
          }
          return;
        }
        // the step up or down happens on the side whose space holds both heights
        if (Math.abs(pa.z - nd.z) < 1e-4) seg([pa.x, pa.y, pa.z], [nd.x, nd.y, nd.z]);
        else if (stepAtStart(ctx, L, pa, nd)) { seg([pa.x, pa.y, pa.z], [pa.x, pa.y, nd.z]); seg([pa.x, pa.y, nd.z], [nd.x, nd.y, nd.z]); }
        else { seg([pa.x, pa.y, pa.z], [nd.x, nd.y, pa.z]); seg([nd.x, nd.y, pa.z], [nd.x, nd.y, nd.z]); }
      });
      nodes.forEach((nd, i) => {
        if (!nd.target) return;
        if (nd.target === 'shaft') { offsets.set('shaft', { at: [nd.x, nd.y], dist: base + dist[i]!, z: nd.z }); return; }
        const d = ds.find((x) => x.id === nd.target)!;
        const a = attach(p, d, zoneBelow(zone));
        // up (or down) inside the wall; if an opening is in the way, beside it and then along the wall to the point
        const zr = a.alongZ ?? d.props.z;
        seg([nd.x, nd.y, nd.z], [nd.x, nd.y, zr]);
        if (a.along) seg([nd.x, nd.y, zr], [a.along[0], a.along[1], zr]);
        if (a.along && Math.abs(zr - d.props.z) > 1e-4) seg([a.along[0], a.along[1], zr], [a.along[0], a.along[1], d.props.z]);
        worst = Math.max(worst, base + dist[i]! + Math.abs(d.props.z - nd.z) + (a.along ? Math.hypot(a.along[0] - nd.x, a.along[1] - nd.y) : 0));
      });
    }
    res.lengths.set(c.id, q(worst));
  }
  return res;
}

const zoneBelow = (zone: string) => !zone.startsWith('C:') && zone !== 'R';

/** Where a device's conduit arrives: inside the wall behind it (beside any door or window between it and the floor,
 *  then ≤ 1 m along inside the wall), or right above/below it. */
function attach(p: Project, d: Device, fromBelow: boolean): { drop: P2; along?: P2; alongZ?: number } {
  const cp = cavityPoint(p, d);
  // under the carport roof: up the nearest post, then along under the roof to the light
  const carport = p.elements.find((e) => e.type === 'Carport');
  if (!cp && carport?.type === 'Carport' && d.props.hostId !== 'post-own' && ['site', 'carport'].includes(d.level)) {
    const r = carport.props.rect;
    if (d.props.at[0] > r.x0 && d.props.at[0] < r.x1 && d.props.at[1] > r.y0 && d.props.at[1] < r.y1 && d.props.kind !== 'ev-charger') {
      const posts = p.elements.filter((c) => c.type === 'Column' && c.tags.includes('carport')).map((c) => (c.type === 'Column' ? c.props.at : [0, 0] as P2));
      const post = posts.reduce((a, b) => (Math.hypot(b[0] - d.props.at[0], b[1] - d.props.at[1]) < Math.hypot(a[0] - d.props.at[0], a[1] - d.props.at[1]) ? b : a));
      // beside the post, clear of its footing and of the downpipe (which takes the post's other side)
      const toBays = post[0] < (r.x0 + r.x1) / 2 ? -1 : 1;
      return { drop: [post[0] + toBays * 0.12, post[1] + (post[1] < (r.y0 + r.y1) / 2 ? 0.4 : -0.4)], along: d.props.at, alongZ: carport.props.roofFront - 0.25 };
    }
  }
  if (!cp) return { drop: d.props.at };
  const w = cp.wall;
  const v = cp.o === 'v', t0 = v ? cp.cavity[1] : cp.cavity[0];
  const a0 = v ? Math.min(w.props.start[1], w.props.end[1]) : Math.min(w.props.start[0], w.props.end[0]);
  const b0 = v ? Math.max(w.props.start[1], w.props.end[1]) : Math.max(w.props.start[0], w.props.end[0]);
  const floor = p.levels.find((l) => l.id === w.level)?.elevation ?? 0;
  const spans: [number, number][] = [];
  for (const o of p.elements) {
    if (o.type !== 'Opening' || o.props.host !== w.id) continue;
    const lo = floor + (o.props.role === 'door' ? 0 : o.props.sill), hi = floor + o.props.sill + o.props.height;
    // only openings between the device and the floor (fed from below) or the ceiling (fed from above)
    if (fromBelow ? lo > d.props.z : hi < d.props.z) continue;
    const m = o.props.role === 'door' ? 0.12 : 0.05;
    spans.push([a0 + o.props.offset - m, a0 + o.props.offset + o.props.width + m]);
  }
  if (!spans.some(([a, b]) => t0 > a && t0 < b)) return { drop: cp.cavity };
  for (let k = 1; k <= 40; k++) for (const t of [t0 - 0.025 * k, t0 + 0.025 * k]) {
    if (t < a0 + 0.15 || t > b0 - 0.15 || Math.abs(t - t0) > 1.0) continue;
    if (spans.some(([a, b]) => t > a && t < b)) continue;
    return { drop: v ? [cp.cavity[0], t] : [t, cp.cavity[1]], along: cp.cavity };
  }
  return { drop: cp.cavity };
}

const bandOf = (L: Layer, x: number, y: number, fallback: number) => { const k = L.cellAt(x, y); return k >= 0 && L.passable(k) ? L.z[k]! : fallback; };

function treeDist(nodes: TNode[]): number[] {
  const dist = nodes.map(() => 0);
  const depth = (i: number): number => (nodes[i]!.parent < 0 ? 0 : 1 + depth(nodes[i]!.parent));
  [...nodes.keys()].sort((a, b) => depth(a) - depth(b)).forEach((i) => {
    const n = nodes[i]!;
    if (n.parent < 0) return;
    const pa = nodes[n.parent]!;
    dist[i] = dist[n.parent]! + Math.abs(n.x - pa.x) + Math.abs(n.y - pa.y) + Math.abs(n.z - pa.z);
  });
  return dist;
}

export function zoneName(zone: string): string {
  if (zone === 'R') return 'roof zones';
  if (zone === 'G') return 'ground';
  const [k, L] = zone.split(':');
  return k === 'F' ? `${L} floor screed${L === 'SL' ? ' and crawlspace' : ''}` : `${L} ceiling (plenum or slab topping above)`;
}
