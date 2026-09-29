// Generates the steel frame from the grid and the slabs: columns, piers, beams and footings.
import { eq, pointInRect, q } from './geometry';
import { DEFAULT_BEAM, DEFAULT_COLUMN, DEFAULT_PIER, profile } from './profiles';
import type { Beam, Column, Element, Footing, Project, Rect, Slab, Space } from './schema';
import { groundAt, groundZones } from './site';

export const slabs = (p: Project) => p.elements.filter((e): e is Slab => e.type === 'Slab');

/** The slab's plan extent (without eaves). */
export function slabRect(p: Project, s: Slab): Rect {
  if (s.props.rect) return s.props.rect;
  const cells = p.elements.flatMap((e) => (e.type === 'Space' && s.props.spaces?.includes(e.id) ? e.props.cells : []));
  return {
    x0: Math.min(...cells.map((c) => c.x0)), y0: Math.min(...cells.map((c) => c.y0)),
    x1: Math.max(...cells.map((c) => c.x1)), y1: Math.max(...cells.map((c) => c.y1)),
  };
}

export function slabVoids(p: Project, s: Slab): Rect[] {
  return p.elements.flatMap((e) => (e.type === 'Space' && s.props.voidSpaces.includes(e.id) ? e.props.cells : []));
}

const strictlyIn = (x: number, y: number, r: Rect) => x > r.x0 + 1e-6 && x < r.x1 - 1e-6 && y > r.y0 + 1e-6 && y < r.y1 - 1e-6;

/** Is there slab at this point? Edges count; the inside of a void does not. */
export function slabCovers(p: Project, s: Slab, x: number, y: number, voids = slabVoids(p, s)): boolean {
  if (s.props.spaces) {
    const cells = p.elements.flatMap((e) => (e.type === 'Space' && s.props.spaces!.includes(e.id) ? e.props.cells : []));
    if (!cells.some((c) => pointInRect(x, y, c))) return false;
  } else if (!pointInRect(x, y, slabRect(p, s))) return false;
  return !voids.some((v) => strictlyIn(x, y, v));
}

const D = 0.05;
const quadrants = (x: number, y: number): [number, number][] => [[x + D, y + D], [x - D, y + D], [x + D, y - D], [x - D, y - D]];

interface Line { o: 'v' | 'h'; c: number; a: number; b: number; z: number }

function mergeLines(ls: Line[]): Line[] {
  const s = [...ls].sort((u, v) => (u.o + u.z.toFixed(3) + u.c.toFixed(3)).localeCompare(v.o + v.z.toFixed(3) + v.c.toFixed(3)) || u.a - v.a);
  const out: Line[] = [];
  for (const l of s) {
    const last = out[out.length - 1];
    if (last && last.o === l.o && eq(last.c, l.c) && eq(last.z, l.z) && l.a <= last.b + 1e-4) last.b = Math.max(last.b, l.b);
    else out.push({ ...l });
  }
  return out;
}

/** Beam lines of one suspended slab: grid lines, slab edges and trimmers around stair wells, never across a void. */
function slabBeamLines(p: Project, s: Slab): Line[] {
  const r = slabRect(p, s);
  const voidSpaces = p.elements.filter((e): e is Space => e.type === 'Space' && s.props.voidSpaces.includes(e.id));
  const voids = voidSpaces.flatMap((v) => v.props.cells);
  const stairVoids = voidSpaces.filter((v) => v.props.zone === 'stair').flatMap((v) => v.props.cells);
  const z = q(s.props.topElevation - s.props.thickness);
  const inX = (v: number) => v >= r.x0 - 1e-6 && v <= r.x1 + 1e-6;
  const inY = (v: number) => v >= r.y0 - 1e-6 && v <= r.y1 + 1e-6;
  const edge = (o: 'v' | 'h', c: number) => (o === 'v' ? eq(c, r.x0) || eq(c, r.x1) : eq(c, r.y0) || eq(c, r.y1));
  const out: Line[] = [];
  const cut = (o: 'v' | 'h', c: number, a: number, b: number) => {
    // Split at void boundaries; keep pieces with slab on at least one side.
    // Outline edges along a stair well are kept too: the outer wall above the well sits on them.
    const stops = [a, b, ...voids.flatMap((v) => (o === 'v' ? [v.y0, v.y1] : [v.x0, v.x1])).filter((t) => t > a && t < b)].sort((u, v) => u - v);
    for (let i = 0; i + 1 < stops.length; i++) {
      const pa = stops[i]!, pb = stops[i + 1]!;
      if (pb - pa < 0.05) continue;
      const m = (pa + pb) / 2;
      const sides: [number, number][] = o === 'v' ? [[c + D, m], [c - D, m]] : [[m, c + D], [m, c - D]];
      const covered = sides.some(([x, y]) => slabCovers(p, s, x, y, voids));
      const wellEdge = edge(o, c) && sides.some(([x, y]) => stairVoids.some((v) => pointInRect(x, y, v)));
      if (covered || wellEdge) out.push({ o, c, a: pa, b: pb, z });
    }
  };
  const xs = [...new Set([...p.grid.x.filter(inX), r.x0, r.x1].map(q))];
  const ys = [...new Set([...p.grid.y.filter(inY), r.y0, r.y1].map(q))];
  for (const x of xs) cut('v', x, r.y0, r.y1);
  for (const y of ys) cut('h', y, r.x0, r.x1);
  // Trimmers: along the edges of each stair well only.
  for (const v of stairVoids) {
    for (const x of [v.x0, v.x1]) if (inX(x) && !xs.some((g) => eq(g, x))) cut('v', x, Math.max(v.y0, r.y0), Math.min(v.y1, r.y1));
    for (const y of [v.y0, v.y1]) if (inY(y) && !ys.some((g) => eq(g, y))) cut('h', y, Math.max(v.x0, r.x0), Math.min(v.x1, r.x1));
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Columns, piers, beams and footings for the whole house. Replaces any existing generated structure. */
export function generateStructure(p: Project): Element[] {
  const all = slabs(p);
  const suspended = all.filter((s) => !s.props.onGrade);
  const ground = all.find((s) => s.props.onGrade && s.level === 'LL');
  const zones = groundZones(p);
  const out: Element[] = [];
  let nb = 0, nc = 0, np = 0, nf = 0;

  for (const l of mergeLines(suspended.flatMap((s) => slabBeamLines(p, s)))) {
    const beam: Beam = {
      id: `beam-${pad(++nb)}`, type: 'Beam', level: levelAt(p, l.z), tags: ['generated'],
      props: {
        start: l.o === 'v' ? [q(l.c), q(l.a)] : [q(l.a), q(l.c)],
        end: l.o === 'v' ? [q(l.c), q(l.b)] : [q(l.b), q(l.c)],
        profile: DEFAULT_BEAM, elevation: l.z,
      },
    };
    out.push(beam);
  }

  const footingFor = (col: Column, size: number, depth: number): Footing => ({
    id: `footing-${pad(++nf)}`, type: 'Footing', level: col.level, tags: ['generated'],
    props: {
      kind: 'pad', carries: col.id, depth, topElevation: col.props.baseElevation,
      rect: { x0: q(col.props.at[0] - size / 2), y0: q(col.props.at[1] - size / 2), x1: q(col.props.at[0] + size / 2), y1: q(col.props.at[1] + size / 2) },
    },
  });
  const baseAt = (x: number, y: number) => {
    if (ground && quadrants(x, y).some(([a, b]) => slabCovers(p, ground, a, b))) {
      return { z: q(ground.props.topElevation - ground.props.thickness), level: 'LL' };
    }
    return { z: q(groundAt(p, x, y, zones) - 0.3), level: 'SL' };
  };

  // Columns at the grid intersections under any suspended slab.
  for (const y of p.grid.y) {
    for (const x of p.grid.x) {
      const over = suspended.filter((s) => quadrants(x, y).some(([a, b]) => slabCovers(p, s, a, b)));
      if (!over.length) continue;
      const top = Math.max(...over.map((s) => s.props.topElevation - s.props.thickness));
      const base = baseAt(x, y);
      const col: Column = {
        id: `col-${pad(++nc)}`, type: 'Column', level: base.level, tags: ['generated'],
        props: { at: [q(x), q(y)], profile: DEFAULT_COLUMN, kind: 'column', baseElevation: base.z, topElevation: q(top) },
      };
      out.push(col, footingFor(col, 1.0, 0.5));
    }
  }

  // Piers under the raised street-level floor, half way between column rows over the crawlspace.
  const sl = suspended.find((s) => s.level === 'SL' && s.props.rect && eq(s.props.topElevation, p.levels.find((l) => l.id === 'SL')!.elevation) && !s.tags.includes('lower-roof'));
  if (sl) {
    const rows = [...p.grid.y].sort((a, b) => a - b).filter((y) => y < p.site.cut.lineY + 1e-6);
    for (let i = 0; i + 1 < rows.length; i++) {
      const y = (rows[i]! + rows[i + 1]!) / 2;
      for (const x of p.grid.x) {
        if (!quadrants(x, y).some(([a, b]) => slabCovers(p, sl, a, b))) continue;
        const base = q(groundAt(p, x, y, zones) - 0.3);
        const pier: Column = {
          id: `pier-${pad(++np)}`, type: 'Column', level: 'SL', tags: ['generated'],
          props: { at: [q(x), q(y)], profile: DEFAULT_PIER, kind: 'pier', baseElevation: base, topElevation: q(sl.props.topElevation - sl.props.thickness) },
        };
        out.push(pier, footingFor(pier, 0.7, 0.3));
      }
    }
  }

  // Strip footings under the retaining walls.
  for (const w of p.elements) {
    if (w.type !== 'Wall' || w.props.wallType !== 'retaining') continue;
    const [sx, sy] = w.props.start, [ex, ey] = w.props.end;
    const half = 0.4;
    const lv = p.levels.find((l) => l.id === w.level)!;
    const top = q(lv.elevation - (ground?.props.thickness ?? 0.15));
    out.push({
      id: `footing-${pad(++nf)}`, type: 'Footing', level: w.level, tags: ['generated'],
      props: {
        kind: 'strip', carries: w.id, depth: 0.4, topElevation: top,
        rect: eq(sx, ex)
          ? { x0: q(sx - half), y0: q(Math.min(sy, ey) - half), x1: q(sx + half), y1: q(Math.max(sy, ey) + half) }
          : { x0: q(Math.min(sx, ex) - half), y0: q(sy - half), x1: q(Math.max(sx, ex) + half), y1: q(sy + half) },
      },
    });
  }
  return out;
}

/** The level whose floor structure sits at this height. */
function levelAt(p: Project, z: number): string {
  let best = p.levels[0]!.id, d = Infinity;
  for (const l of p.levels) {
    if (!l.plan && l.id !== 'roof') continue;
    const dd = Math.abs(l.elevation - z);
    if (dd < d) { d = dd; best = l.id; }
  }
  return best;
}

export const columnSize = (c: Column) => profile(c.props.profile);
