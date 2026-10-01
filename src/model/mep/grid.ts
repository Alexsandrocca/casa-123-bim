// Spec 04b: routing grid and graph search (A*). A layer is a raster of the service spaces at one height band
// (a ceiling plenum, the crawlspace, the ground, the floor screed…). Each cell knows its host, the pipe height there
// and its cost; forbidden zones and occupied cells are blocked. Trees are grown target by target, each joining the
// tree built so far by the cheapest legal path, with penalties for length, bends and changes of space.
import type { Rect } from '../schema';

export type P2 = [number, number];
export const RES = 0.05;

export interface HostRef { id: string; kind: string; name: string }

export class Layer {
  readonly nx: number;
  readonly ny: number;
  /** Cells in one sheet. A layer may stack sheets (the floor screed over the crawlspace); a run moves between them
   *  vertically, through a sleeve in the slab, wherever no beam is in the way. */
  readonly n: number;
  readonly cost: Float32Array;
  readonly z: Float32Array;
  readonly host: Int16Array;
  readonly hosts: HostRef[] = [];
  /** Why a cell is blocked (index into reasons), for the "no route" message. */
  readonly why: Int16Array;
  readonly reasons: string[] = [];
  /** Web-hole cells: 1 = beam along y (cross it in x), 2 = beam along x (cross it in y). */
  readonly web: Uint8Array;
  /** Height range of the beams over the cell (no change of height through them). NaN where there is none. */
  readonly beamZ0: Float32Array;
  readonly beamZ1: Float32Array;
  constructor(readonly key: string, readonly bounds: Rect, readonly diagonal: boolean, readonly res = RES, readonly sheets = 1) {
    this.nx = Math.max(1, Math.ceil((bounds.x1 - bounds.x0) / res) + 1);
    this.ny = Math.max(1, Math.ceil((bounds.y1 - bounds.y0) / res) + 1);
    this.n = this.nx * this.ny;
    const n = this.n * sheets;
    this.cost = new Float32Array(n).fill(Infinity);
    this.z = new Float32Array(n).fill(NaN);
    this.host = new Int16Array(n).fill(-1);
    this.why = new Int16Array(n).fill(-1);
    this.web = new Uint8Array(n);
    this.beamZ0 = new Float32Array(n).fill(NaN);
    this.beamZ1 = new Float32Array(n).fill(NaN);
  }
  ix(x: number) { return Math.round((x - this.bounds.x0) / this.res); }
  iy(y: number) { return Math.round((y - this.bounds.y0) / this.res); }
  idx(i: number, j: number, s = 0) { return s * this.n + j * this.nx + i; }
  /** The cells of every sheet at a point (or [] outside). */
  cellsAt(x: number, y: number): number[] {
    const i = this.ix(x), j = this.iy(y);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return [];
    return Array.from({ length: this.sheets }, (_, s) => this.idx(i, j, s));
  }
  /** The first open cell at a point (sheet 0 first), else the sheet-0 cell, else -1. */
  cellAt(x: number, y: number) { const cs = this.cellsAt(x, y); return cs.find((k) => this.passable(k)) ?? cs[0] ?? -1; }
  xy(k: number): P2 { const pk = k % this.n, i = pk % this.nx, j = (pk - i) / this.nx; return [this.bounds.x0 + i * this.res, this.bounds.y0 + j * this.res]; }
  hostRef(h: HostRef): number {
    let k = this.hosts.findIndex((x) => x.id === h.id);
    if (k < 0) { this.hosts.push(h); k = this.hosts.length - 1; }
    return k;
  }
  /** Cells whose centre lies in a rectangle (closed, with a small tolerance), in one sheet or all of them. */
  forRect(r: Rect, fn: (k: number, x: number, y: number) => void, grow = 0, sheet?: number) {
    const i0 = Math.max(0, Math.ceil((r.x0 - grow - this.bounds.x0) / this.res - 1e-6)), i1 = Math.min(this.nx - 1, Math.floor((r.x1 + grow - this.bounds.x0) / this.res + 1e-6));
    const j0 = Math.max(0, Math.ceil((r.y0 - grow - this.bounds.y0) / this.res - 1e-6)), j1 = Math.min(this.ny - 1, Math.floor((r.y1 + grow - this.bounds.y0) / this.res + 1e-6));
    const s0 = sheet ?? 0, s1 = sheet ?? this.sheets - 1;
    for (let s = s0; s <= s1; s++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = this.idx(i, j, s); fn(k, this.bounds.x0 + i * this.res, this.bounds.y0 + j * this.res); }
  }
  /** Paint a host area: cost multiplier, pipe height (a number or a function of x, y). */
  paint(r: Rect, h: HostRef, cost: number, z: number | ((x: number, y: number) => number), onlyIf?: (k: number, x: number, y: number) => boolean, sheet = 0) {
    const hk = this.hostRef(h);
    this.forRect(r, (k, x, y) => {
      if (onlyIf && !onlyIf(k, x, y)) return;
      this.cost[k] = cost; this.host[k] = hk; this.z[k] = typeof z === 'number' ? z : z(x, y); this.why[k] = -1;
    }, 0, sheet);
  }
  private reason(reason: string) {
    let rk = this.reasons.indexOf(reason);
    if (rk < 0) { this.reasons.push(reason); rk = this.reasons.length - 1; }
    return rk;
  }
  block(r: Rect, reason: string, grow = 0) {
    const rk = this.reason(reason);
    this.forRect(r, (k) => { this.cost[k] = Infinity; this.why[k] = rk; }, grow);
  }
  blockCell(k: number, reason: string) { this.cost[k] = Infinity; this.why[k] = this.reason(reason); }
  blockDisc(x: number, y: number, rad: number, reason: string) {
    const rk = this.reason(reason);
    this.forRect({ x0: x - rad, x1: x + rad, y0: y - rad, y1: y + rad }, (k, cx, cy) => { if (Math.hypot(cx - x, cy - y) <= rad + 1e-6) { this.cost[k] = Infinity; this.why[k] = rk; } });
  }
  /** Multiply the cost of passable cells (soft avoidance). */
  penalise(r: Rect, factor: number) { this.forRect(r, (k) => { if (Number.isFinite(this.cost[k]!)) this.cost[k] = this.cost[k]! * factor; }); }
  passable(k: number) { return k >= 0 && Number.isFinite(this.cost[k]!); }
  /** Nearest passable cell to a point within a radius (or -1). */
  nearestOpen(x: number, y: number, rad = 0.8): number {
    let best = -1, bd = Infinity;
    this.forRect({ x0: x - rad, x1: x + rad, y0: y - rad, y1: y + rad }, (k, cx, cy) => {
      if (!this.passable(k)) return;
      const d = Math.hypot(cx - x, cy - y);
      if (d < bd - 1e-9) { bd = d; best = k; }
    });
    return best;
  }
  /** Reason a point is not routable. */
  reasonAt(x: number, y: number): string {
    const k = this.cellAt(x, y);
    if (k < 0) return 'outside the routing area';
    const w = this.why[k]!;
    return w >= 0 ? this.reasons[w]! : 'not inside a service space for this system';
  }
}

/* ---------------- A* with direction states (bends cost) ---------------- */

const DIRS8: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const DIRS4: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];

class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, val: number) {
    const k = this.k, v = this.v;
    k.push(key); v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const pi = (i - 1) >> 1;
      if (v[pi]! <= v[i]!) break;
      [k[pi], k[i]] = [k[i]!, k[pi]!]; [v[pi], v[i]] = [v[i]!, v[pi]!];
      i = pi;
    }
  }
  pop(): number {
    const k = this.k, v = this.v;
    const top = k[0]!;
    const lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      k[0] = lk; v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < k.length && v[l]! < v[m]!) m = l;
        if (r < k.length && v[r]! < v[m]!) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i]!, k[m]!]; [v[m], v[i]] = [v[i]!, v[m]!];
        i = m;
      }
    }
    return top;
  }
}

export interface SearchOpts {
  /** Extra cost per 45° of turn, m-equivalent. */
  bend?: number;
  /** Extra cost when the host changes (wall → plenum, crawlspace → ground…). */
  hostChange?: number;
  /** Search window margin around start and goals. */
  margin?: number;
}

/**
 * Cheapest path from a start cell to any goal cell. Returns cells from start to the goal reached, or null.
 * The heuristic is the plan distance to the nearest goal segment (admissible: every step costs at least its length).
 */
export function search(L: Layer, start: number, isGoal: (k: number) => boolean, goalSegs: [P2, P2][], o: SearchOpts = {}): number[] | null {
  const dirs = L.diagonal ? DIRS8 : DIRS4, D = dirs.length;
  const bend = o.bend ?? 0.25, hc = o.hostChange ?? 0.4;
  const [sx, sy] = L.xy(start);
  // window
  let wx0 = sx, wx1 = sx, wy0 = sy, wy1 = sy;
  for (const [a, b] of goalSegs) { wx0 = Math.min(wx0, a[0], b[0]); wx1 = Math.max(wx1, a[0], b[0]); wy0 = Math.min(wy0, a[1], b[1]); wy1 = Math.max(wy1, a[1], b[1]); }
  const m = o.margin ?? 3;
  const i0 = Math.max(0, L.ix(wx0 - m)), i1 = Math.min(L.nx - 1, L.ix(wx1 + m)), j0 = Math.max(0, L.iy(wy0 - m)), j1 = Math.min(L.ny - 1, L.iy(wy1 + m));
  const h = (x: number, y: number) => {
    let best = Infinity;
    for (const [a, b] of goalSegs) {
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
      best = Math.min(best, Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy));
    }
    return best;
  };
  const g = new Map<number, number>();
  const from = new Map<number, number>();
  const heap = new Heap();
  // start: any direction, no bend cost
  const s0 = start * (D + 1) + D;
  g.set(s0, 0);
  heap.push(s0, h(sx, sy));
  let steps = 0;
  while (heap.size) {
    const st = heap.pop();
    const cell = Math.floor(st / (D + 1)), dir = st % (D + 1);
    const gc = g.get(st)!;
    if (isGoal(cell) && cell !== start) {
      const path = [cell];
      let cur = st;
      while (from.has(cur)) { cur = from.get(cur)!; path.push(Math.floor(cur / (D + 1))); }
      return path.reverse().filter((c, i, a) => i === 0 || c !== a[i - 1]);
    }
    if (isGoal(cell) && cell === start) return [cell];
    if (++steps > 400000) return null;
    const sh = Math.floor(cell / L.n), pk = cell % L.n, ci = pk % L.nx, cj = (pk - ci) / L.nx;
    // between sheets: straight up or down through the slab, not through a beam
    for (let s2 = 0; s2 < L.sheets; s2++) {
      if (s2 === sh) continue;
      const nk = s2 * L.n + pk;
      if (!L.passable(nk)) continue;
      const lo = Math.min(L.z[nk]!, L.z[cell]!), hi = Math.max(L.z[nk]!, L.z[cell]!);
      if (!Number.isNaN(L.beamZ0[nk]!) && hi > L.beamZ0[nk]! && lo < L.beamZ1[nk]!) continue;
      const ns = nk * (D + 1) + (dir < D ? dir : D);
      const ng = gc + (hi - lo) + hc + 0.2;
      if (ng < (g.get(ns) ?? Infinity) - 1e-9) {
        g.set(ns, ng);
        from.set(ns, st);
        const [nx, ny] = L.xy(nk);
        heap.push(ns, ng + h(nx, ny));
      }
    }
    for (let d = 0; d < D; d++) {
      const ni = ci + dirs[d]![0], nj = cj + dirs[d]![1];
      if (ni < i0 || ni > i1 || nj < j0 || nj > j1) continue;
      const nk = sh * L.n + nj * L.nx + ni;
      const c = L.cost[nk]!;
      if (!Number.isFinite(c)) continue;
      if (L.diagonal && dirs[d]![0] && dirs[d]![1]) {
        // no corner cutting through blocked cells
        if (!L.passable(sh * L.n + cj * L.nx + ni) || !L.passable(sh * L.n + nj * L.nx + ci)) continue;
      }
      // a beam is crossed straight through its web, and a run never changes height on a beam's line
      const dx = dirs[d]![0], dy = dirs[d]![1];
      const wn = L.web[nk]!, wc = L.web[cell]!;
      if ((wn === 1 || wc === 1) && dy !== 0) continue;
      if ((wn === 2 || wc === 2) && dx !== 0) continue;
      const za = L.z[nk]!, zc = L.z[cell]!;
      if (Math.abs(za - zc) > 0.02) {
        const lo = Math.min(za, zc), hi = Math.max(za, zc);
        const crosses = (k: number) => !Number.isNaN(L.beamZ0[k]!) && hi > L.beamZ0[k]! && lo < L.beamZ1[k]!;
        if (crosses(nk) || crosses(cell)) continue;
      }
      let turn = 0;
      if (dir < D) {
        const diff = Math.abs(d - dir), steps45 = Math.min(diff, D - diff) * (D === 8 ? 1 : 2);
        if (steps45 > 2) continue; // never turn back on itself or by 135°
        turn = steps45 * bend;
      }
      const len = (dirs[d]![0] && dirs[d]![1] ? Math.SQRT2 : 1) * L.res;
      const change = L.host[nk] !== L.host[cell] ? hc : 0;
      const ng = gc + len * Math.max(c, L.cost[cell]!) + turn + change;
      const ns = nk * (D + 1) + d;
      if (ng < (g.get(ns) ?? Infinity) - 1e-9) {
        g.set(ns, ng);
        from.set(ns, st);
        const [nx, ny] = L.xy(nk);
        heap.push(ns, ng + h(nx, ny));
      }
    }
  }
  return null;
}

/* ---------------- trees ---------------- */

export interface TNode { x: number; y: number; z: number; parent: number; target?: string; host?: number }

export interface TreeResult { nodes: TNode[]; failed: { id: string; reason: string }[] }

/** Corner points of a cell path: where the direction, the host or the height changes. */
export function corners(L: Layer, path: number[]): number[] {
  if (path.length <= 2) return path;
  const out = [path[0]!];
  for (let i = 1; i < path.length - 1; i++) {
    const a = L.xy(path[i - 1]!), b = L.xy(path[i]!), c = L.xy(path[i + 1]!);
    const d1 = [Math.round((b[0] - a[0]) / L.res), Math.round((b[1] - a[1]) / L.res)], d2 = [Math.round((c[0] - b[0]) / L.res), Math.round((c[1] - b[1]) / L.res)];
    const k = path[i]!, kn = path[i + 1]!;
    if (L.host[k] !== L.host[kn] || Math.abs(L.z[k]! - L.z[kn]!) > 0.15) {
      // a change of space: both sides of the boundary are nodes, so the step up or down happens right there
      out.push(k);
      if (i + 1 < path.length - 1) out.push(kn);
    } else if (d1[0] !== d2[0] || d1[1] !== d2[1]) out.push(k);
  }
  out.push(path[path.length - 1]!);
  return out.filter((k, i) => i === 0 || k !== out[i - 1]);
}

/**
 * Grow a tree from a root through a layer to each target. Targets are joined in order of distance; each takes the cheapest
 * path to any point of the tree so far. Targets that cannot be reached are reported with the reason.
 */
export function growTree(L: Layer, root: P2, targets: { id: string; at: P2 }[], o: SearchOpts = {}): TreeResult {
  const failed: { id: string; reason: string }[] = [];
  const nodes: TNode[] = [];
  let rootCell = L.cellAt(root[0], root[1]);
  if (!L.passable(rootCell)) rootCell = L.nearestOpen(root[0], root[1]);
  if (rootCell < 0) return { nodes: [], failed: targets.map((t) => ({ id: t.id, reason: `the start (${root[0].toFixed(2)}, ${root[1].toFixed(2)}) is ${L.reasonAt(root[0], root[1])}` })) };
  const rz = L.z[rootCell]!;
  nodes.push({ x: root[0], y: root[1], z: rz, parent: -1, host: L.host[rootCell]! });
  // the stub from the exact root to its grid cell
  const [rcx, rcy] = L.xy(rootCell);
  let rootGrid = 0;
  if (Math.hypot(rcx - root[0], rcy - root[1]) > 1e-6) { nodes.push({ x: rcx, y: rcy, z: rz, parent: 0, host: L.host[rootCell]! }); rootGrid = 1; }
  // cell → node / edge membership
  const nodeAt = new Map<number, number>([[rootCell, rootGrid]]);
  const edgeCells = new Map<number, { child: number; cells: number[] }>(); // cell → edge (child node) it lies on
  const edges: { child: number; cells: number[] }[] = [];
  const addEdge = (child: number, cells: number[]) => {
    const e = { child, cells };
    edges.push(e);
    for (const c of cells) if (!nodeAt.has(c)) edgeCells.set(c, e);
  };
  const segs = (): [P2, P2][] => nodes.filter((n) => n.parent >= 0).map((n) => [[n.x, n.y], [nodes[n.parent]!.x, nodes[n.parent]!.y]] as [P2, P2]).concat([[[rcx, rcy], [rcx, rcy]]]);
  const order = [...targets].sort((a, b) => Math.hypot(a.at[0] - root[0], a.at[1] - root[1]) - Math.hypot(b.at[0] - root[0], b.at[1] - root[1]) || a.id.localeCompare(b.id));
  for (const t of order) {
    let tc = L.cellAt(t.at[0], t.at[1]);
    if (!L.passable(tc)) tc = L.nearestOpen(t.at[0], t.at[1], 0.2);
    if (tc < 0) { failed.push({ id: t.id, reason: `${L.reasonAt(t.at[0], t.at[1])} at (${t.at[0].toFixed(2)}, ${t.at[1].toFixed(2)})` }); continue; }
    const inTree = (k: number) => nodeAt.has(k) || edgeCells.has(k);
    const path = search(L, tc, inTree, segs(), o);
    if (!path) { failed.push({ id: t.id, reason: `no legal path through the ${L.key} (blocked by ${L.reasonAt(t.at[0], t.at[1]) === 'not inside a service space for this system' ? 'walls, voids or structure' : L.reasonAt(t.at[0], t.at[1])})` }); continue; }
    // the joint
    const hitCell = path[path.length - 1]!;
    let attach: number;
    if (nodeAt.has(hitCell)) attach = nodeAt.get(hitCell)!;
    else {
      const e = edgeCells.get(hitCell)!;
      const child = nodes[e.child]!;
      const [hx, hy] = L.xy(hitCell);
      nodes.push({ x: hx, y: hy, z: L.z[hitCell]!, parent: child.parent, host: L.host[hitCell]! });
      attach = nodes.length - 1;
      child.parent = attach;
      nodeAt.set(hitCell, attach);
      edgeCells.delete(hitCell);
      const at = e.cells.indexOf(hitCell);
      const lower = e.cells.slice(0, at), upper = e.cells.slice(at + 1);
      e.cells = lower;
      addEdge(attach, upper);
    }
    // walk the new path from the joint back to the target, adding corner nodes
    const cs = corners(L, path).reverse(); // joint … target cell
    let prev = attach, prevIdx = path.length - 1;
    for (let i = 1; i < cs.length; i++) {
      const k = cs[i]!;
      const [x, y] = L.xy(k);
      nodes.push({ x, y, z: L.z[k]!, parent: prev, host: L.host[k]! });
      const idx = path.lastIndexOf(k, prevIdx);
      addEdge(nodes.length - 1, path.slice(idx + 1, prevIdx));
      nodeAt.set(k, nodes.length - 1);
      prev = nodes.length - 1; prevIdx = idx;
    }
    // exact target point: two short straight pieces from the cell centre (no skewed stub)
    const [tcx, tcy] = L.xy(tc);
    if (Math.hypot(tcx - t.at[0], tcy - t.at[1]) > 1e-6) {
      if (Math.abs(t.at[0] - tcx) > 1e-6 && Math.abs(t.at[1] - tcy) > 1e-6) { nodes.push({ x: t.at[0], y: tcy, z: L.z[tc]!, parent: prev, host: L.host[tc]! }); prev = nodes.length - 1; }
      nodes.push({ x: t.at[0], y: t.at[1], z: L.z[tc]!, parent: prev, target: t.id, host: L.host[tc]! });
    } else if (nodes[prev]!.target) nodes.push({ x: t.at[0], y: t.at[1], z: L.z[tc]!, parent: prev, target: t.id, host: L.host[tc]! });
    else nodes[prev]!.target = t.id;
  }
  return { nodes, failed };
}

/** Straight path between two points through a layer (for single runs such as a collector leg). */
export function routePath(L: Layer, a: P2, b: P2, o: SearchOpts = {}): { pts: { x: number; y: number; z: number; host: number }[]; reason?: string } {
  let ac = L.cellAt(a[0], a[1]); if (!L.passable(ac)) ac = L.nearestOpen(a[0], a[1], 0.6);
  let bc = L.cellAt(b[0], b[1]); if (!L.passable(bc)) bc = L.nearestOpen(b[0], b[1], 0.6);
  if (ac < 0) return { pts: [], reason: `start is ${L.reasonAt(a[0], a[1])}` };
  if (bc < 0) return { pts: [], reason: `end is ${L.reasonAt(b[0], b[1])}` };
  const path = search(L, ac, (k) => k === bc, [[b, b]], o);
  if (!path) return { pts: [], reason: `no legal path through the ${L.key}` };
  const cs = corners(L, path);
  const pts = cs.map((k) => { const [x, y] = L.xy(k); return { x, y, z: L.z[k]!, host: L.host[k]! }; });
  // exact ends
  const first = pts[0]!, last = pts[pts.length - 1]!;
  if (Math.hypot(first.x - a[0], first.y - a[1]) > 1e-6) pts.unshift({ x: a[0], y: a[1], z: first.z, host: first.host }, ...(Math.abs(first.x - a[0]) > 1e-6 && Math.abs(first.y - a[1]) > 1e-6 ? [{ x: first.x, y: a[1], z: first.z, host: first.host }] : []));
  if (Math.hypot(last.x - b[0], last.y - b[1]) > 1e-6) pts.push(...(Math.abs(last.x - b[0]) > 1e-6 && Math.abs(last.y - b[1]) > 1e-6 ? [{ x: b[0], y: last.y, z: last.z, host: last.host }] : []), { x: b[0], y: b[1], z: last.z, host: last.host });
  return { pts };
}
