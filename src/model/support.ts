// "Nothing floats": every footing, column, beam, slab, wall, stair and deck must rest on something that is itself supported,
// all the way down to the ground.
import { eq, pointInRect, wallSeg } from './geometry';
import type { Beam, Column, Deck, Element, Footing, Project, Slab, Stair, Wall } from './schema';
import { groundAt, groundZones } from './site';
import { slabCovers, slabRect, slabVoids } from './structure';

export interface SupportResult { supported: Set<string>; unsupported: Element[]; reasons: Map<string, string> }

const TOL = 0.05;
type P = [number, number];

const onSegment = (pt: P, a: P, b: P, tol = TOL) => {
  const [x, y] = pt;
  if (eq(a[0], b[0])) return Math.abs(x - a[0]) <= tol && y >= Math.min(a[1], b[1]) - tol && y <= Math.max(a[1], b[1]) + tol;
  return Math.abs(y - a[1]) <= tol && x >= Math.min(a[0], b[0]) - tol && x <= Math.max(a[0], b[0]) + tol;
};

/** Crossing or touching point of two axis-aligned beams, if any. */
function contactPoint(a: Beam, b: Beam): P | null {
  const [a0, a1] = [a.props.start, a.props.end], [b0, b1] = [b.props.start, b.props.end];
  const av = eq(a0[0], a1[0]), bv = eq(b0[0], b1[0]);
  if (av !== bv) {
    const p: P = av ? [a0[0], b0[1]] : [b0[0], a0[1]];
    return onSegment(p, a0, a1) && onSegment(p, b0, b1) ? p : null;
  }
  // collinear and touching end to end
  for (const p of [b0, b1]) if (onSegment(p, a0, a1)) return p;
  for (const p of [a0, a1]) if (onSegment(p, b0, b1)) return p;
  return null;
}

export function checkSupport(p: Project): SupportResult {
  const zones = groundZones(p);
  const ground = (x: number, y: number) => groundAt(p, x, y, zones);
  const els = p.elements;
  const footings = els.filter((e): e is Footing => e.type === 'Footing');
  const columns = els.filter((e): e is Column => e.type === 'Column');
  const beams = els.filter((e): e is Beam => e.type === 'Beam');
  const slabs = els.filter((e): e is Slab => e.type === 'Slab');
  const walls = els.filter((e): e is Wall => e.type === 'Wall');
  const stairs = els.filter((e): e is Stair => e.type === 'Stair');
  const decks = els.filter((e): e is Deck => e.type === 'Deck');
  const ok = new Set<string>();
  const reasons = new Map<string, string>();
  const elev = (level: string) => p.levels.find((l) => l.id === level)?.elevation ?? 0;

  // 1. Footings bear on the soil: they must sit below the finished ground.
  for (const f of footings) {
    const r = f.props.rect;
    const g = ground((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2);
    if (f.props.topElevation - f.props.depth < g + 0.01) ok.add(f.id); else reasons.set(f.id, 'Footing above the ground');
  }
  // 2. Columns and piers stand on a footing.
  for (const c of columns) {
    const [x, y] = c.props.at;
    const f = footings.find((f) => ok.has(f.id) && pointInRect(x, y, f.props.rect) && Math.abs(f.props.topElevation - c.props.baseElevation) <= TOL);
    if (f) ok.add(c.id); else reasons.set(c.id, 'No footing under this column');
  }
  // 3. Beams: at least one supported contact below, and two contacts in all (no long cantilevers).
  const colContacts = (b: Beam) => columns.filter((c) => ok.has(c.id) && onSegment(c.props.at, b.props.start, b.props.end)
    && c.props.topElevation >= b.props.elevation - TOL && c.props.baseElevation < b.props.elevation);
  let changed = true;
  while (changed) {
    changed = false;
    for (const b of beams) {
      if (ok.has(b.id)) continue;
      const pts: { p: P; sup: boolean }[] = colContacts(b).map((c) => ({ p: c.props.at, sup: true }));
      for (const o of beams) {
        if (o.id === b.id || Math.abs(o.props.elevation - b.props.elevation) > TOL) continue;
        const cp = contactPoint(b, o);
        if (cp) pts.push({ p: cp, sup: ok.has(o.id) });
      }
      const distinct = pts.filter((u, i) => pts.findIndex((v) => Math.hypot(u.p[0] - v.p[0], u.p[1] - v.p[1]) < 0.1) === i);
      if (pts.some((u) => u.sup) && distinct.length >= 2) { ok.add(b.id); changed = true; }
    }
  }
  for (const b of beams) if (!ok.has(b.id)) reasons.set(b.id, 'Beam not carried by columns or other beams');

  // 4. Slabs: on the ground (with at most 1.2 m of compacted fill) or on two beams or more.
  for (const s of slabs) {
    const r = slabRect(p, s);
    const bottom = s.props.topElevation - s.props.thickness;
    if (s.props.onGrade) {
      const g = ground((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2);
      if (bottom <= g + 1.2 && s.props.topElevation >= g - 0.6) ok.add(s.id); else reasons.set(s.id, 'Slab on grade is not on the ground');
      continue;
    }
    const under = beams.filter((b) => ok.has(b.id) && Math.abs(b.props.elevation - bottom) <= TOL
      && pointInRect(b.props.start[0], b.props.start[1], r) && pointInRect(b.props.end[0], b.props.end[1], r));
    if (under.length >= 2) ok.add(s.id); else reasons.set(s.id, 'Slab not carried by beams');
  }

  // Something to stand on at (x, y, z): a supported slab or deck top, the ground, or a supported strip footing.
  const bearing = (x: number, y: number, z: number): boolean => {
    for (const s of slabs) {
      if (!ok.has(s.id) || Math.abs(s.props.topElevation - z) > TOL) continue;
      if (slabCovers(p, s, x, y, slabVoids(p, s))) return true;
    }
    if (Math.abs(ground(x, y) - z) <= TOL) return true;
    return false;
  };

  // 5. Walls: both ends and the middle rest on a slab, a beam, a strip footing or a wall below.
  const wallTop = (w: Wall) => elev(w.level) + w.props.height;
  for (const w of walls) {
    const s = wallSeg(w);
    const z = elev(w.level);
    const samples: P[] = [s.a + 0.05, (s.a + s.b) / 2, s.b - 0.05].map((t) => (s.o === 'v' ? [s.c, t] : [t, s.c]) as P);
    const good = samples.every(([x, y]) =>
      bearing(x, y, z)
      || beams.some((b) => ok.has(b.id) && onSegment([x, y], b.props.start, b.props.end, 0.15) && b.props.elevation <= z && b.props.elevation >= z - 0.5)
      || footings.some((f) => ok.has(f.id) && f.props.kind === 'strip' && pointInRect(x, y, f.props.rect) && f.props.topElevation <= z + TOL)
      || walls.some((o) => o.id !== w.id && ok.has(o.id) && Math.abs(wallTop(o) - z) <= 0.1 && (() => { const t = wallSeg(o); return t.o === s.o && eq(t.c, s.c) && (s.o === 'v' ? y : x) >= t.a - TOL && (s.o === 'v' ? y : x) <= t.b + TOL; })()));
    if (good) ok.add(w.id); else reasons.set(w.id, 'Wall has nothing under part of it');
  }
  // Walls standing on other walls: one more pass so upper walls can rest on lower ones.
  for (const w of walls) {
    if (ok.has(w.id)) continue;
    const s = wallSeg(w), z = elev(w.level);
    const below = walls.some((o) => ok.has(o.id) && Math.abs(wallTop(o) - z) <= 0.1 && (() => { const t = wallSeg(o); return t.o === s.o && eq(t.c, s.c) && t.a <= s.a + TOL && t.b >= s.b - TOL; })());
    if (below) { ok.add(w.id); reasons.delete(w.id); }
  }

  // 6. Stairs: the foot rests on the lower floor, the head on the upper floor.
  for (const st of stairs) {
    const f0 = st.props.flights[0]!, fl = st.props.flights[st.props.flights.length - 1]!;
    const foot = bearing((f0.x0 + f0.x1) / 2, f0.yBottom, elev(st.props.fromLevel));
    const rise = st.props.flights.reduce((n, f) => n + f.risers, 0) * st.props.riser;
    const reaches = Math.abs(elev(st.props.fromLevel) + rise - elev(st.props.toLevel)) <= 0.1;
    const head = reaches && bearing((fl.x0 + fl.x1) / 2, fl.yTop, elev(st.props.toLevel));
    if (foot && head) ok.add(st.id); else reasons.set(st.id, foot ? 'Stair does not reach the upper floor' : 'Stair does not start on a floor');
  }
  // 7. Decks rest on a slab or on the ground.
  for (const d of decks) {
    const r = d.props.rect;
    if (bearing((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, d.props.elevation)) ok.add(d.id); else reasons.set(d.id, 'Deck has nothing under it');
  }

  const checked = [...footings, ...columns, ...beams, ...slabs, ...walls, ...stairs, ...decks];
  return { supported: ok, unsupported: checked.filter((e) => !ok.has(e.id)), reasons };
}
