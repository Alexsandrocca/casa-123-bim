// Keeps walls and openings consistent with the room cells after an edit.
// Exterior and retaining walls follow the fixed level outline and never change here.
import {
  DOOR_MARGIN, E, WALL_THICKNESS, WINDOW_MARGIN, deriveInteriorSegs, eq, getEl, openingSeg, openingsOn, q,
  segToWallEnds, spacesOn, wallSeg, wallsOn, type Orient, type Seg,
} from './geometry';
import type { Element, Opening, Project, Wall } from './schema';

export interface LineMove { o: Orient; c: number; a: number; b: number; to: number }

const isInterior = (w: Wall) => w.props.wallType === 'interior' || w.props.wallType === 'wet';

export function nextId(p: Project, prefix: string): string {
  let n = 0;
  for (const e of p.elements) {
    if (e.id.startsWith(prefix + '-')) {
      const k = Number(e.id.slice(prefix.length + 1));
      if (Number.isFinite(k)) n = Math.max(n, k);
    }
  }
  return `${prefix}-${String(n + 1).padStart(2, '0')}`;
}

function movedSeg(s: Seg, m?: LineMove): Seg {
  if (m && s.o === m.o && eq(s.c, m.c) && s.a >= m.a - E && s.b <= m.b + E) return { ...s, c: m.to };
  return s;
}

/** Clamp an opening inside its host wall (margins as in the prototype). Returns new props. */
export function clampToHost(op: Opening, host: Wall): Opening['props'] {
  const len = wallSeg(host).b - wallSeg(host).a;
  const margin = op.props.role === 'door' ? DOOR_MARGIN : WINDOW_MARGIN;
  const width = q(Math.max(0.1, Math.min(op.props.width, len - 2 * margin)));
  const offset = q(Math.min(Math.max(op.props.offset, margin), len - width - margin));
  return { ...op.props, width, offset };
}

/**
 * Regenerate the interior walls of one level from its cells, keep ids of walls that
 * survived, and re-host every opening on the wall that now carries it.
 */
export function rebuildLevel(p: Project, level: string, move?: LineMove): Project {
  const oldWalls = wallsOn(p, level);
  const fixed = oldWalls.filter((w) => !isInterior(w));
  const oldInterior = oldWalls.filter(isInterior).map((w) => ({ w, s: movedSeg(wallSeg(w), move) }));

  // Where every opening is now, in absolute terms (following its wall if that wall moved).
  const opAbs = new Map<string, Seg>();
  for (const op of openingsOn(p, level)) {
    const host = getEl(p, op.props.host);
    if (!host || host.type !== 'Wall') continue;
    const s = openingSeg(op, host);
    const hs = wallSeg(host);
    const hm = movedSeg(hs, move);
    opAbs.set(op.id, { ...s, c: hm.c });
  }

  const used = new Set<string>();
  let draft: Project = { ...p, elements: p.elements.filter((e) => !(e.type === 'Wall' && e.level === level && isInterior(e))) };
  const newWalls: Wall[] = [];
  for (const s of deriveInteriorSegs(spacesOn(p, level))) {
    let best: Wall | undefined, bestOv = 0;
    for (const o of oldInterior) {
      if (used.has(o.w.id) || o.s.o !== s.o || !eq(o.s.c, s.c) || o.w.props.wallType !== s.wallType) continue;
      const ov = Math.min(o.s.b, s.b) - Math.max(o.s.a, s.a);
      if (ov > bestOv + E) { bestOv = ov; best = o.w; }
    }
    const id = best?.id ?? nextId({ ...draft, elements: [...draft.elements, ...newWalls] }, `${level}-wall`);
    if (best) used.add(best.id);
    newWalls.push({
      id, type: 'Wall', level, tags: best?.tags ?? [],
      props: {
        ...segToWallEnds(s),
        thickness: best?.props.thickness ?? WALL_THICKNESS[s.wallType],
        height: best?.props.height ?? p.structure.clearHeight,
        wallType: s.wallType,
      },
    });
  }
  const walls = [...fixed, ...newWalls];

  // Re-host openings.
  const elements: Element[] = [];
  for (const e of draft.elements) {
    if (e.type !== 'Opening' || e.level !== level) { elements.push(e); continue; }
    const s = opAbs.get(e.id);
    if (!s) continue; // lost its host before this edit: drop it
    const mid = (s.a + s.b) / 2;
    const onLine = walls.filter((w) => { const ws = wallSeg(w); return ws.o === s.o && eq(ws.c, s.c); });
    if (!onLine.length) continue; // no wall left on this line: the opening goes with it
    const dist = (w: Wall) => { const ws = wallSeg(w); return mid < ws.a ? ws.a - mid : mid > ws.b ? mid - ws.b : 0; };
    const host = onLine.reduce((a, b) => (dist(b) < dist(a) ? b : a));
    const op: Opening = { ...e, props: { ...e.props, host: host.id, offset: q(s.a - wallSeg(host).a) } };
    elements.push({ ...op, props: clampToHost(op, host) });
  }
  // Keep a stable order: walls of this level where the old ones were.
  const firstWallIdx = p.elements.findIndex((e) => e.type === 'Wall' && e.level === level);
  const others = elements.filter((e) => !(e.type === 'Wall' && e.level === level));
  const at = firstWallIdx < 0 ? others.length : Math.min(firstWallIdx, others.length);
  draft = { ...draft, elements: [...others.slice(0, at), ...walls, ...others.slice(at)] };
  return draft;
}
