// Casa 123 only: converts the prototype's cell plans (plan-v2.json, BASE1) into the building model of each version.
// The app never imports this file; the results live in projects/casa-123/.
import { upgradeSite, type OldSite } from '../../src/model/migrate';
import { siteFrame } from '../../src/model/site';
import { WALL_THICKNESS, boundarySegs, deriveInteriorSegs, eq, fmtLevel, q, segToWallEnds, wallSeg, type Seg } from '../../src/model/geometry';
import { DECK_SLAB } from '../../src/model/profiles';
import { generateStructure } from '../../src/model/structure';
import { parseProject, type Deck, type Element, type Opening, type Project, type Slab, type Space, type Stair, type Wall, type WallType, type Zone } from '../../src/model/schema';

export interface SourceCell { room: string; zone: string; x0: number; y0: number; x1: number; y1: number; lock?: boolean; kind?: string }
export interface SourceDoor { o: 'h' | 'v'; c: number; p: number; w: number; s: number; k?: string }
export interface SourceWindow { o: 'h' | 'v'; c: number; a: number; b: number; k: string }
export interface SourceLevel {
  name: string;
  outline: [number, number, number, number];
  cells: SourceCell[];
  doors: SourceDoor[];
  windows: SourceWindow[];
  extras?: { x0: number; y0: number; x1: number; y1: number; label: string }[];
}
export type SourcePlan = Record<'LL' | 'SL' | 'UF', SourceLevel>;

export interface ImportOptions {
  versionId: 'v1' | 'v2' | 'v3';
  /** House origin x on the lot (distance of the south wall from the south boundary). */
  houseOriginX?: number;
  version: string;
  source: string;
  note: string;
  gridX: number[];
  gridY: number[];
  stairs: Stair['props'][];
  levels: SourceLevels;
  structure: Project['structure'];
}

/** The levels block of plan-v2.json. */
export interface SourceLevels {
  LL: { floor: number }; SL: { floor: number }; UF: { floor: number };
  roof: { top_of_slab: number; parapet_top: number };
  garage: { floor: number };
  garden: { level: number; from_house_y: number };
}

/** Where Casa 123 is: Piracicaba/SP, the street to the east (house +x is north). The pre-P1 shape; upgradeSite moves it into site.lot. */
const CASA_REGION: OldSite['region'] = {
  city: 'Piracicaba', state: 'SP', lat: -22.72, lon: -47.65, utcOffset: -3, xBearing: 0,
  supply: { utility: 'CPFL', phaseV: 127, lineV: 220, phases: 3, confirmed: false },
  water: 'SEMAE',
  rules: { code: 'Piracicaba LC 474/2025', sanitary: 'SP sanitary code, Decreto 12.342/78' },
  pvYield: { monthly: [130, 120, 128, 120, 112, 104, 114, 128, 124, 132, 130, 128], source: 'PVGIS-like values, 20° facing north' },
  solarHeaterShare: 0.7,
};
/** Casa 123 engineering values that are TO CONFIRM for Piracicaba (spec 08). */
export const CASA_ASSUMPTIONS = { zone: 2, v0: 40 };

const SITE_BEFORE_P1: OldSite = {
  address: 'Rua Alceu Maynardi Araújo, 123, Nova Piracicaba, Piracicaba/SP',
  // Assumption: the south boundary is square to the street; the extra metre at the rear widens the north side.
  lotPolygon: [[0, 0], [14, 0], [15, 25], [0, 25]],
  houseOrigin: { x: 1.92, y: 4 },
  fallStreetToRear: 2,
  setbacks: { front: 4, rear: 6, sides: 1.2 },
  cut: { lineY: 8.5, gardenLevel: -2.55, retainingSouthToY: 10.5, retainingNorthToY: 8.9 },
  ramp: { width: 4, slope: 0.125 },
  eavesLimit: 0.7,
  region: CASA_REGION,
  toConfirm: [
    'Topographic survey',
    'SPT soil borings',
    'SEMAE sewer depth',
    'Lot zone and height limit',
    'Climate zone (NBR 15220-3)',
    'Whether decks are allowed in the setbacks',
    'CPFL supply type',
    'Which side boundary takes the extra 1 m at the rear',
  ],
};
/** P1: the Casa 123 lot (site.lot), from the facts above. */
export const SITE: Project['site'] = upgradeSite(SITE_BEFORE_P1);


const DOOR_HEIGHT: Record<string, number> = { door: 2.1, slider: 2.2, garage: 2.4 };

function exteriorSegs(level: 'LL' | 'SL' | 'UF', [x0, y0, x1, y1]: SourceLevel['outline'], cut: Project['site']['cut']): (Seg & { wallType: WallType })[] {
  const out: (Seg & { wallType: WallType })[] = [];
  const buried = level === 'LL';
  out.push({ o: 'h', c: y0, a: x0, b: x1, wallType: buried ? 'retaining' : 'exterior' }); // front
  const side = (x: number, to: number) => {
    if (buried && to > y0 + 1e-6 && to < y1) {
      out.push({ o: 'v', c: x, a: y0, b: to, wallType: 'retaining' });
      out.push({ o: 'v', c: x, a: to, b: y1, wallType: 'exterior' });
    } else out.push({ o: 'v', c: x, a: y0, b: y1, wallType: 'exterior' });
  };
  side(x1, cut.retainingNorthToY); // north
  out.push({ o: 'h', c: y1, a: x0, b: x1, wallType: 'exterior' }); // rear
  side(x0, cut.retainingSouthToY); // south
  return out;
}

const fillsOutline = (src: SourceLevel) => {
  const [x0, y0, x1, y1] = src.outline;
  return Math.abs(src.cells.reduce((a, c) => a + (c.x1 - c.x0) * (c.y1 - c.y0), 0) - (x1 - x0) * (y1 - y0)) < 1e-6;
};

function findHost(walls: Wall[], o: 'h' | 'v', c: number, a: number, b: number): Wall {
  const onLine = walls.filter((w) => { const s = wallSeg(w); return s.o === o && eq(s.c, c); });
  const containing = onLine.find((w) => { const s = wallSeg(w); return a >= s.a - 1e-6 && b <= s.b + 1e-6; });
  if (containing) return containing;
  const mid = (a + b) / 2;
  const byMid = onLine.find((w) => { const s = wallSeg(w); return mid >= s.a && mid <= s.b; });
  if (byMid) return byMid;
  throw new Error(`No wall hosts the opening on ${o} ${c} from ${a} to ${b}`);
}

export function importPlan(plan: SourcePlan, opt: ImportOptions): Project {
  const LEVELS = { LL: opt.levels.LL.floor, SL: opt.levels.SL.floor, UF: opt.levels.UF.floor };
  const STRUCTURE = opt.structure;
  const site: Project['site'] = {
    ...SITE,
    cut: { ...SITE.cut, lineY: opt.levels.garden.from_house_y, gardenLevel: opt.levels.garden.level },
    houseOrigin: { ...SITE.houseOrigin, x: opt.houseOriginX ?? SITE.houseOrigin.x },
  };
  const hasGarage = Object.values(plan).some((l) => l.cells.some((c) => c.zone === 'garage'));
  const elements: Element[] = [];
  const slabs: Slab[] = [];
  const decks: Deck[] = [];

  for (const L of ['LL', 'SL', 'UF'] as const) {
    const src = plan[L];
    // Spaces: cells grouped by room, in order of first appearance.
    const spaces: Space[] = [];
    for (const c of src.cells) {
      let s = spaces.find((x) => x.props.name === c.room);
      if (!s) {
        const stairKind = c.zone === 'stair' ? ((c.kind as Space['props']['stairKind']) ?? 'u') : undefined;
        s = {
          id: `${L}-space-${String(spaces.length + 1).padStart(2, '0')}`,
          type: 'Space', level: L, tags: [],
          props: { name: c.room, zone: c.zone as Zone, cells: [], lock: false, ...(stairKind ? { stairKind } : {}) },
        };
        if (c.zone === 'garage') s.props.floorElevation = opt.levels.garage.floor;
        spaces.push(s);
      }
      s.props.cells.push({ x0: q(c.x0), y0: q(c.y0), x1: q(c.x1), y1: q(c.y1) });
      if (c.lock) s.props.lock = true;
    }

    // Walls: exterior/retaining on the outline, interior where the prototype draws them.
    const walls: Wall[] = [];
    const filled = fillsOutline(src);
    const outer = filled ? exteriorSegs(L, src.outline, site.cut) : boundarySegs(src.cells).map((x) => ({ ...x, wallType: 'exterior' as WallType }));
    const segs = [...outer, ...deriveInteriorSegs(spaces)];
    for (const s of segs) {
      const exterior = s.wallType === 'exterior' || s.wallType === 'retaining';
      walls.push({
        id: `${L}-wall-${String(walls.length + 1).padStart(2, '0')}`,
        type: 'Wall', level: L, tags: [],
        props: {
          ...segToWallEnds(s),
          thickness: WALL_THICKNESS[s.wallType],
          height: exterior ? STRUCTURE.floorToFloor : STRUCTURE.clearHeight,
          wallType: s.wallType,
        },
      });
    }

    // Openings hosted by walls.
    const openings: Opening[] = [];
    src.doors.forEach((d, i) => {
      const host = findHost(walls, d.o, d.c, d.p, d.p + d.w);
      const kind = d.k === 'garage' ? 'garage' : d.k === 'slider' ? 'slider' : 'door';
      openings.push({
        id: `${L}-door-${String(i + 1).padStart(2, '0')}`, type: 'Opening', level: L, tags: d.k === 'glazed' ? ['glazed'] : [],
        props: {
          host: host.id, role: 'door', kind, offset: q(d.p - wallSeg(host).a), width: q(d.w),
          height: DOOR_HEIGHT[kind]!, sill: 0, swing: d.s < 0 ? -1 : 1,
        },
      });
    });
    src.windows.forEach((w, i) => {
      const host = findHost(walls, w.o, w.c, w.a, w.b);
      const high = w.k === 'high', slider = w.k === 'slider';
      openings.push({
        id: `${L}-win-${String(i + 1).padStart(2, '0')}`, type: 'Opening', level: L, tags: [],
        props: {
          host: host.id, role: 'window', kind: slider ? 'slider' : 'window', ...(high ? { high: true } : {}),
          offset: q(w.a - wallSeg(host).a), width: q(w.b - w.a),
          height: slider ? 2.2 : high ? 0.6 : 1.3, sill: slider ? 0 : high ? 1.7 : 1.0, swing: 1,
        },
      });
    });

    // Floor slabs: the whole outline, minus the stair wells above the lowest level and the garage drop.
    const [x0, y0, x1, y1] = src.outline;
    const stairVoids = L === 'LL' ? [] : spaces.filter((s) => s.props.zone === 'stair').map((s) => s.id);
    const garage = spaces.filter((s) => s.props.zone === 'garage').map((s) => s.id);
    slabs.push({
      id: `${L}-slab-01`, type: 'Slab', level: L, tags: [],
      props: {
        name: L === 'LL' ? 'Lower level ground slab' : `${src.name} floor`,
        // A floor that does not fill its outline (Version 3 street level) follows its rooms.
        ...(filled ? { rect: { x0, y0, x1, y1 } } : { spaces: spaces.map((x) => x.id) }),
        voidSpaces: [...stairVoids, ...garage],
        topElevation: LEVELS[L], thickness: L === 'LL' ? 0.15 : DECK_SLAB, ...(L === 'LL' ? { onGrade: true } : {}),
      },
    });
    if (garage.length) {
      slabs.push({
        id: `${L}-slab-02`, type: 'Slab', level: L, tags: ['garage'],
        props: { name: 'Garage slab on grade', spaces: garage, voidSpaces: [], topElevation: opt.levels.garage.floor, thickness: 0.15, onGrade: true },
      });
    }
    if (L === 'UF') {
      slabs.push({
        id: 'roof-slab-01', type: 'Slab', level: 'roof', tags: [],
        props: {
          name: 'Flat roof', rect: { x0, y0, x1, y1 }, voidSpaces: [], topElevation: opt.levels.roof.top_of_slab, thickness: DECK_SLAB,
          parapet: q(opt.levels.roof.parapet_top - opt.levels.roof.top_of_slab), eaves: 0.4,
        },
      });
    }

    (src.extras ?? []).forEach((x, i) => {
      const garden = L === 'LL';
      decks.push({
        id: `${L}-deck-${String(i + 1).padStart(2, '0')}`, type: 'Deck', level: L, tags: [],
        props: {
          name: garden ? 'Garden' : 'Veranda', label: x.label,
          rect: { x0: x.x0, y0: x.y0, x1: x.x1, y1: x.y1 },
          elevation: garden ? site.cut.gardenLevel : LEVELS[L],
        },
      });
    });

    elements.push(...spaces, ...walls, ...openings);
  }

  // Roof of the lower level where the street level does not cover it (the veranda in Version 2).
  const [, , , llY1] = plan.LL.outline, [slX0, slY0, slX1, slY1] = plan.SL.outline, [, ufY0] = plan.UF.outline;
  if (llY1 > slY1 + 1e-6) {
    const veranda = decks.some((d) => d.level === 'SL');
    slabs.push({
      id: 'SL-slab-03', type: 'Slab', level: 'SL', tags: ['lower-roof'],
      props: {
        name: veranda ? 'Veranda slab (roof of the lower level)' : 'Roof of the lower level',
        rect: { x0: slX0, y0: slY1, x1: slX1, y1: llY1 }, voidSpaces: [], topElevation: LEVELS.SL, thickness: DECK_SLAB,
        ...(veranda ? {} : { parapet: 0.3 }),
      },
    });
  }
  // Roof over the front of the street level where the upper floor does not reach (garage and entry; entry only in Version 3).
  if (ufY0 > slY0 + 1e-6) {
    const front = plan.SL.cells.filter((c) => c.y0 < ufY0 - 1e-6).map((c) => ({ ...c, y1: Math.min(c.y1, ufY0) }));
    const r = { x0: Math.min(...front.map((c) => c.x0)), y0: Math.min(...front.map((c) => c.y0)), x1: Math.max(...front.map((c) => c.x1)), y1: ufY0 };
    slabs.push({
      id: 'UF-slab-02', type: 'Slab', level: 'UF', tags: ['garage-roof'],
      props: {
        name: hasGarage ? 'Garage roof' : 'Entry roof', rect: r, voidSpaces: [], topElevation: LEVELS.UF,
        thickness: DECK_SLAB, parapet: 0.3, eaves: 0,
      },
    });
  }

  const stairs: Stair[] = opt.stairs.map((props, i) => ({
    id: `stair-${String(i + 1).padStart(2, '0')}`, type: 'Stair', level: props.fromLevel, tags: [], props,
  }));
  elements.push(...slabs, ...stairs, ...decks);

  const outline = (L: 'LL' | 'SL' | 'UF') => {
    const [x0, y0, x1, y1] = plan[L].outline;
    return { x0, y0, x1, y1 };
  };
  const project: Project = {
    schema: 'casa123-bim/1',
    meta: { project: 'Casa 123', version: opt.version, versionId: opt.versionId, units: 'm', source: opt.source, note: opt.note },
    site,
    structure: STRUCTURE,
    levels: [
      { id: 'LL', name: plan.LL.name, shortName: `Lower ${fmtLevel(LEVELS.LL)}`, elevation: LEVELS.LL, plan: true, outline: outline('LL') },
      ...(hasGarage ? [{ id: 'garage', name: `Garage ${fmtLevel(opt.levels.garage.floor)}`, shortName: 'Garage', elevation: opt.levels.garage.floor, plan: false }] : []),
      { id: 'SL', name: plan.SL.name, shortName: `Street ${fmtLevel(LEVELS.SL)}`, elevation: LEVELS.SL, plan: true, outline: outline('SL') },
      { id: 'UF', name: plan.UF.name, shortName: `Upper ${fmtLevel(LEVELS.UF)}`, elevation: LEVELS.UF, plan: true, outline: outline('UF') },
      { id: 'roof', name: `Roof ${fmtLevel(opt.levels.roof.top_of_slab)} (parapet ${fmtLevel(opt.levels.roof.parapet_top)})`, shortName: 'Roof', elevation: opt.levels.roof.top_of_slab, plan: false, outline: outline('UF') },
    ],
    grid: { x: opt.gridX, y: opt.gridY },
    assumptions: { ...CASA_ASSUMPTIONS },
    elements,
  };
  project.elements.push(...generateStructure(project));
  addCrossingNotes(project);
  return parseProject(project);
}

/* ---------- the two versions ---------- */

const R = 0.182, T = 0.27;

/** Version 2: two straight flights side by side in the south band. */
export const V2_STAIRS: Stair['props'][] = [
  {
    name: 'Up flight SL → UF', fromLevel: 'SL', toLevel: 'UF', riser: R, tread: T, width: 1.5,
    flights: [{ x0: 0, x1: 1.5, yBottom: 8.2, yTop: q(8.2 + 16 * T), risers: 17 }], landings: [],
  },
  {
    name: 'Down flight LL → SL', fromLevel: 'LL', toLevel: 'SL', riser: R, tread: T, width: 1.5,
    flights: [{ x0: 1.7, x1: 3.2, yBottom: q(8.2 + 16 * T), yTop: 8.2, risers: 17 }], landings: [],
  },
];

/** Version 1: a U-stair in x 0–2.4 on every floor. You step on and off at the rear end (y 11.9); the landing is at the front. */
function uStair(name: string, from: string, to: string): Stair['props'] {
  const w = 1.15, top = 11.9;
  const turn = q(top - 7 * T); // second flight: 8 risers, 7 treads, arrives at the rear edge of the well
  return {
    name, fromLevel: from, toLevel: to, riser: R, tread: T, width: w,
    flights: [
      { x0: q(2.4 - w), x1: 2.4, yBottom: q(turn + 8 * T), yTop: turn, risers: 9 },
      { x0: 0, x1: w, yBottom: turn, yTop: top, risers: 8 },
    ],
    landings: [{ x0: 0, y0: 8.5, x1: 2.4, y1: turn }],
  };
}
export const V1_STAIRS: Stair['props'][] = [uStair('U-stair LL → SL', 'LL', 'SL'), uStair('U-stair SL → UF', 'SL', 'UF')];

export const V2_NOTE =
  'Version 2: one service spine along the south wall (entry, WC, storage, pantry, stairs, laundry), all living rooms along the north side for the best light, a 20 m² veranda shaded by the upper floor, and two straight stair flights side by side: down goes west straight to the garden door, up lands at the rear with the master bedroom next to it.';
export const V1_NOTE =
  'Version 1: U-stair in the middle of the south side, living room on the west (garden) side, three suites upstairs reached from the rear landing.';

/** Pull the BASE1 constant out of the prototype HTML. */
export function extractBase1(html: string): SourcePlan {
  const start = html.indexOf('const BASE1 =');
  const end = html.indexOf('const OVER1', start);
  if (start < 0 || end < 0) throw new Error('BASE1 not found in the prototype');
  const body = html.slice(start + 'const BASE1 ='.length, end).trim().replace(/;\s*(\/\/.*)?$/s, '').replace(/;\s*$/, '');
  const C = (room: string, zone: string, x0: number, y0: number, x1: number, y1: number, lock?: number) =>
    ({ room, zone, x0, y0, x1, y1, lock: !!lock });
  // The prototype is our own reference file; evaluating its literal is the simplest faithful parser.
  return new Function('C', `return (${body});`)(C) as SourcePlan;
}

/* ---------- Version 3 (spec 02b): garage out, patio and carport in front ---------- */

export const V3_NOTE =
  'Version 3: Version 2 without the garage. The street level starts 1 m further back (5 m from the street), the old garage area is an open front patio at +0.60 in front of the kitchen, and two cars park under a light carport in the front setback. South side passage 1.50 m.';

/** The street level of Version 3, derived from Version 2's plan. */
export function deriveV3(v2: SourcePlan): SourcePlan {
  const sl = v2.SL;
  const C = (room: string, zone: string, x0: number, y0: number, x1: number, y1: number): SourceCell => ({ room, zone, x0, y0, x1, y1, lock: false });
  const keep = sl.cells.filter((c) => ['Kitchen', 'Dining', 'Living', 'Stair'].includes(c.room));
  const keepWin = sl.windows.filter((w) => !(w.o === 'h' && eq(w.c, 0)) && !(w.o === 'v' && eq(w.c, 0) && w.b < 7.5));
  return {
    ...v2,
    SL: {
      name: sl.name,
      outline: [0, 1.0, 8.6, 12.6],
      cells: [
        C('Entry · hall', 'circ', 0, 1.0, 3.2, 2.6), C('Entry · hall', 'circ', 2.0, 2.6, 3.2, 7.0), C('Entry · hall', 'circ', 0, 7.0, 3.2, 8.2),
        C('WC', 'wet', 0, 2.6, 2.0, 4.2), C('Storage', 'service', 0, 4.2, 2.0, 5.2), C('Pantry', 'service', 0, 5.2, 2.0, 7.0),
        ...keep.filter((c) => c.room !== 'Stair'), ...keep.filter((c) => c.room === 'Stair'),
      ],
      doors: [
        { o: 'h', c: 1.0, p: 0.9, w: 1.0, s: 1 }, // front door
        { o: 'v', c: 2.0, p: 3.1, w: 0.7, s: -1 }, // WC
        { o: 'v', c: 2.0, p: 4.3, w: 0.8, s: -1 }, // storage
        { o: 'v', c: 2.0, p: 5.6, w: 0.8, s: -1 }, // pantry
        { o: 'h', c: 5.0, p: 3.5, w: 0.9, s: 1, k: 'glazed' }, // kitchen service door onto the patio
      ],
      windows: [
        { o: 'h', c: 1.0, a: 2.1, b: 2.9, k: 'win' }, // entry, front
        { o: 'v', c: 0, a: 3.0, b: 4.0, k: 'high' }, // WC, south
        { o: 'v', c: 0, a: 5.4, b: 6.6, k: 'high' }, // pantry, south
        ...keepWin,
        { o: 'h', c: 5.0, a: 5.6, b: 8.2, k: 'win' }, // kitchen onto the patio
        { o: 'v', c: 3.2, a: 3.2, b: 4.4, k: 'win' }, // passage onto the patio
      ],
      extras: sl.extras,
    },
  };
}

export const V3_CARPORT = { x0: 2.6, y0: -4.0, x1: 8.6, y1: 1.0 };

/** Patio, carport (with its own light frame and footings), EV charger and the main panel's new place. */
export function addV3Front(p: Project): Project {
  const sl = p.levels.find((l) => l.id === 'SL')!;
  const r = V3_CARPORT;
  const els: Element[] = [];
  const patio = { x0: 3.2, y0: 1.0, x1: 8.6, y1: 5.0 };
  els.push({
    id: 'SL-slab-04', type: 'Slab', level: 'SL', tags: ['patio'],
    props: { name: 'Front patio on compacted fill', rect: patio, voidSpaces: [], topElevation: sl.elevation, thickness: 1.2, onGrade: true },
  });
  els.push({
    id: 'SL-deck-02', type: 'Deck', level: 'SL', tags: ['patio'],
    props: {
      name: 'Front patio', label: 'Front patio +0.60 · open, not a room', rect: patio, elevation: sl.elevation,
      // spec 08 (Q8): the steps come down into the 0.80 m gap between the bays, so a parked car never blocks them
      // (the north end of the patio is about 1.25 m above the ramp there, so it cannot take the steps)
      planter: { x0: 7.9, y0: 1.0, x1: 8.6, y1: 5.0 }, steps: { x0: 5.1, y0: 1.0, x1: 5.9, y1: 1.6 },
    },
  });
  const pad = (n: number) => String(n).padStart(2, '0');
  const front = 2.7, slope = 0.05, colProfile = 'HSS 100×100×4', beamProfile = 'W150×13';
  const roofAt = (y: number) => front + slope * (y - r.y0);
  const sheet = 0.1; // insulated sandwich sheet
  const colX = [r.x0 + 0.05, r.x1 - 0.05], colY = [r.y0 + 0.15, r.y1 - 0.15];
  let n = 0;
  for (const y of colY) {
    const top = q(roofAt(y) - sheet);
    els.push({
      id: `carport-beam-${pad(colY.indexOf(y) + 1)}`, type: 'Beam', level: 'carport', tags: ['carport'],
      props: { start: [q(r.x0), q(y)], end: [q(r.x1), q(y)], profile: beamProfile, elevation: top },
    });
    for (const x of colX) {
      n++;
      const base = -0.4;
      const id = `carport-col-${pad(n)}`;
      els.push({ id, type: 'Column', level: 'carport', tags: ['carport'], props: { at: [q(x), q(y)], profile: colProfile, kind: 'column', baseElevation: base, topElevation: top } });
      els.push({
        id: `carport-footing-${pad(n)}`, type: 'Footing', level: 'carport', tags: ['carport'],
        props: { kind: 'pad', carries: id, depth: 0.4, topElevation: base, rect: { x0: q(x - 0.3), y0: q(y - 0.3), x1: q(x + 0.3), y1: q(y + 0.3) } },
      });
    }
  }
  els.push({
    id: 'carport-01', type: 'Carport', level: 'carport', tags: [],
    props: {
      name: 'Carport', rect: r, roofFront: front, slope, solarModules: 6,
      parking: [{ x0: 2.6, y0: r.y0, x1: 5.1, y1: r.y1 }, { x0: 5.9, y0: r.y0, x1: 8.4, y1: r.y1 }],
    },
  });
  els.push({
    id: 'dev-ev-01', type: 'Device', level: 'carport', tags: ['electrical'],
    props: { kind: 'ev-charger', name: 'EV charger 7 kW', power: 7000, at: [q(colX[1]! - 0.1), q(colY[1]!)], z: 1.3 },
  });
  els.push({
    id: 'dev-panel-01', type: 'Device', level: 'SL', tags: ['electrical'],
    props: { kind: 'panel', name: 'Main electrical panel', at: [0.12, 4.7], z: sl.elevation + 1.5, power: 0 },
  });
  return parseProject({ ...p, elements: [...p.elements, ...els] });
}

/** Where a stair flight passes over the cut line, note how the retaining wall is handled (manager's answer to Q4). */
function addCrossingNotes(p: Project) {
  const cut = p.site.cut.lineY;
  const wall = p.elements.find((e): e is Wall => e.type === 'Wall' && e.props.wallType === 'retaining' && eq(e.props.start[1], cut) && eq(e.props.end[1], cut));
  for (const st of p.elements) {
    if (st.type !== 'Stair' || !wall) continue;
    let z = p.levels.find((l) => l.id === st.props.fromLevel)?.elevation ?? 0;
    for (const f of st.props.flights) {
      const lo = Math.min(f.yBottom, f.yTop), hi = Math.max(f.yBottom, f.yTop);
      if (cut > lo && cut < hi) {
        const dir = Math.sign(f.yTop - f.yBottom) || 1;
        const tread = z + (Math.floor(((cut - f.yBottom) * dir) / st.props.tread) + 1) * st.props.riser;
        const wallTop = (p.levels.find((l) => l.id === wall.level)?.elevation ?? 0) + wall.props.height;
        if (tread >= wallTop) { z += f.risers * st.props.riser; continue; } // the flight is above the wall there
        const ground = siteFrame(p).natural(cut);
        const name = st.props.name.charAt(0).toLowerCase() + st.props.name.slice(1);
        const note = `Stair and retaining wall: the ${name} passes over the cut line (y ${cut.toFixed(2)}), x ${f.x0.toFixed(2)}–${f.x1.toFixed(2)}. `
          + `The ground there is at about ${ground.toFixed(2)}, so the retained soil stays well below the flight (tread about ${tread >= 0 ? '+' : ''}${tread.toFixed(2)} at y ${cut.toFixed(2)}). `
          + 'Under the stair opening the lower-level front wall stops under the flight soffit, with a lintel beam over it. To be detailed by the structural engineer.';
        wall.notes = [...(wall.notes ?? []), note];
        st.notes = [...(st.notes ?? []), note];
      }
      z += f.risers * st.props.riser;
    }
  }
}
