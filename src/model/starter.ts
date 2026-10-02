// A simple starting model for any lot: a single-storey house with a living room and kitchen, a bedroom and a bathroom,
// on a flat rectangular lot. P2 replaces it with the typology catalogue; P0 needs it for "New project" and to prove
// that nothing in the engines depends on Casa 123 (tests/fixtures/flat-lot).
import { boundarySegs, deriveInteriorSegs, q, segToWallEnds, WALL_THICKNESS, wallSeg } from './geometry';
import { generateStructure } from './structure';
import { parseProject, type Element, type Fixture, type Lot, type Opening, type Project, type Region, type Space, type Supply, type Wall } from './schema';
import { ccwLot, envelope } from './lot';
import { defaultLot, TYPICAL } from './cities';
import { deviceMaker, placeRoomPoints } from './electrical/place';
import type { Device } from './schema';
import { kindOf } from './plumbing/library';
import { withHosts } from './mep/hosting';
import { withPlumbing } from './plumbing/route';
import { withElectrical } from './electrical/design';
import { syncThickness } from './eng/commands';
import type { Compass } from './orientation';

/** P1: a project starts from its lot (the wizard) and the facts about its city. */
export interface StarterParams {
  project: string;
  address: string;
  region: Region;
  lot: Lot;
}

/** A rectangular lot on a flat site for tests and scripts: width along the street, depth, the side the street is on. */
export interface RectLotParams {
  city: string; state: string; lat: number; lon: number;
  lotWidth: number; lotDepth: number; street: Compass;
  setbacks?: { front: number; rear: number; sides: number };
  supply?: Supply;
  /** Whom to ask for the electricity supply (unknown: a generic name). */
  power?: string;
}

const BEARING: Record<Compass, number> = { N: 0, E: 90, S: 180, W: 270 };
/** House +x points 90° anticlockwise from the street side seen from above: x bearing = street bearing − 90. */
export const xBearingFor = (street: Compass) => (BEARING[street] + 270) % 360;

export function rectLot(r: RectLotParams): Lot {
  const lot = defaultLot(r.city, r.state, { lat: r.lat, lon: r.lon });
  const sb = r.setbacks ?? TYPICAL.setbacks;
  const tbc = (value: number) => ({ value, status: 'to-confirm' as const, source: 'Typical value (TO CONFIRM)', date: '2026-10-02' });
  return {
    ...lot,
    polygon: [[0, 0], [r.lotWidth, 0], [r.lotWidth, r.lotDepth], [0, r.lotDepth]],
    geo: { ...lot.geo, xBearing: xBearingFor(r.street) },
    rules: { ...lot.rules, setbacks: { front: tbc(sb.front), rear: tbc(sb.rear), left: tbc(sb.sides), right: tbc(sb.sides) } },
    services: {
      ...lot.services,
      sewer: { ...lot.services.sewer, depth: tbc(1.2), offset: 4 },
      water: { ...lot.services.water, depth: tbc(0.8) },
      power: { supply: { value: r.supply ?? TYPICAL.supply, status: 'to-confirm', source: '', date: '2026-10-02' }, ask: r.power ?? lot.services.power.ask },
    },
  };
}

const rect = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });

/** x range inside a convex polygon along the horizontal line y (empty: null). */
function across(poly: [number, number][], y: number): [number, number] | null {
  const xs: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i]!, [bx, by] = poly[(i + 1) % poly.length]!;
    if (ay === by) { if (Math.abs(y - ay) < 1e-9) xs.push(ax, bx); continue; }
    if (y < Math.min(ay, by) - 1e-9 || y > Math.max(ay, by) + 1e-9) continue;
    xs.push(ax + ((bx - ax) * (y - ay)) / (by - ay));
  }
  return xs.length >= 2 ? [Math.min(...xs), Math.max(...xs)] : null;
}

/** The largest house (up to 9 × 8 m, at least 6 × 6) that fits the envelope, as near the street as it can, centred across. */
export function fitHouse(env: [number, number][]): { x0: number; y0: number; W: number; D: number } {
  const ys = env.map((c) => c[1]), y00 = Math.min(...ys), y11 = Math.max(...ys);
  for (let D = 8; D >= 6 - 1e-9; D -= 0.5) {
    for (let y0 = y00; y0 + D <= y11 + 1e-9; y0 += 0.25) {
      let lo = -Infinity, hi = Infinity;
      for (let k = 0; k <= 4; k++) { const r = across(env, y0 + (D * k) / 4); if (!r) { lo = Infinity; break; } lo = Math.max(lo, r[0]); hi = Math.min(hi, r[1]); }
      const W = Math.min(9, Math.floor((hi - lo) * 20) / 20);
      if (W >= 6 - 1e-9) return { x0: q((lo + hi - W) / 2), y0: q(y0), W, D };
    }
  }
  // nothing fits: a 6 × 6 m house at the front of the lot, shown in red by the setback checks
  const r = across(env.length ? env : [[0, 0], [6, 0], [6, 6], [0, 6]], y00) ?? [0, 6];
  return { x0: q((r[0] + r[1] - 6) / 2), y0: q(y00), W: 6, D: 6 };
}

export function starterModel(sp: StarterParams): Project {
  const lot = ccwLot(sp.lot);
  const level = 'GF';
  const floor = 0.15, f2f = 3.0, clear = 2.7;
  // the house: 9 × 8 m, or what fits inside the buildable envelope
  const env = envelope(lot);
  const fit = fitHouse(env.length ? env : lot.polygon);
  const W = fit.W, D = fit.D;
  const xLiving = q(W * 0.55), yBed = q(D * 0.58);
  const spaces: Space[] = [
    { id: `${level}-space-01`, type: 'Space', level, tags: [], props: { name: 'Living and kitchen', zone: 'social', cells: [rect(0, 0, xLiving, D)], lock: false } },
    { id: `${level}-space-02`, type: 'Space', level, tags: [], props: { name: 'Bedroom', zone: 'private', cells: [rect(xLiving, 0, W, yBed)], lock: false } },
    { id: `${level}-space-03`, type: 'Space', level, tags: [], props: { name: 'Bathroom', zone: 'wet', cells: [rect(xLiving, yBed, W, D)], lock: false } },
  ];
  const walls: Wall[] = [];
  const outer = boundarySegs(spaces.flatMap((s) => s.props.cells)).map((x) => ({ ...x, wallType: 'exterior' as const }));
  for (const s of [...outer, ...deriveInteriorSegs(spaces)]) {
    const ext = s.wallType === 'exterior';
    walls.push({
      id: `${level}-wall-${String(walls.length + 1).padStart(2, '0')}`, type: 'Wall', level, tags: [],
      props: { ...segToWallEnds(s), thickness: WALL_THICKNESS[s.wallType], height: ext ? f2f : clear, wallType: s.wallType },
    });
  }
  const on = (o: 'v' | 'h', c: number, at: number) => {
    const w = walls.find((x) => { const g = wallSeg(x); return g.o === o && Math.abs(g.c - c) < 1e-6 && at > g.a && at < g.b; });
    if (!w) throw new Error(`starter: no wall at ${o} ${c} ${at}`);
    return w;
  };
  const openings: Opening[] = [];
  const add = (id: string, w: Wall, from: number, width: number, door: boolean, extra: Partial<Opening['props']> = {}) => openings.push({
    id, type: 'Opening', level, tags: [],
    props: door
      ? { host: w.id, role: 'door', kind: 'door', offset: q(from - wallSeg(w).a), width, height: 2.1, sill: 0, swing: 1, ...extra }
      : { host: w.id, role: 'window', kind: 'window', offset: q(from - wallSeg(w).a), width, height: 1.3, sill: 1.0, swing: 1, ...extra },
  });
  add(`${level}-door-01`, on('h', 0, 1.2), 0.8, 1.0, true, { swing: 1 });
  add(`${level}-door-02`, on('v', xLiving, yBed / 2), q(yBed / 2 - 0.4), 0.8, true, { swing: 1 });
  add(`${level}-door-03`, on('v', xLiving, (yBed + D) / 2), q((yBed + D) / 2 - 0.35), 0.7, true, { swing: 1 });
  add(`${level}-win-01`, on('h', 0, xLiving - 1.2), q(xLiving - 2.4), 1.6, false);
  add(`${level}-win-02`, on('h', D, xLiving / 2), q(xLiving / 2 - 1.0), 2.0, false, { kind: 'slider', height: 2.2, sill: 0 });
  add(`${level}-win-03`, on('h', 0, (xLiving + W) / 2), q((xLiving + W) / 2 - 0.75), 1.5, false);
  add(`${level}-win-04`, on('v', W, (yBed + D) / 2), q((yBed + D) / 2 - 0.3), 0.6, false, { high: true, height: 0.6, sill: 1.6 });

  const elements: Element[] = [
    ...spaces, ...walls, ...openings,
    { id: `${level}-slab-01`, type: 'Slab', level, tags: [], props: { name: 'Ground floor slab', rect: rect(0, 0, W, D), voidSpaces: [], topElevation: floor, thickness: 0.12, onGrade: true } },
    { id: 'roof-slab-01', type: 'Slab', level: 'roof', tags: [], props: { name: 'Flat roof', rect: rect(0, 0, W, D), voidSpaces: [], topElevation: q(floor + f2f), thickness: 0.12, parapet: 0.3, eaves: 0.5 } },
  ];
  const project: Project = {
    schema: 'casa123-bim/1',
    meta: { project: sp.project, version: 'Version 1', versionId: 'v1', units: 'm', source: 'Starter model (P0)', note: 'A simple single-storey starting point. P2 adds the house catalogue.' },
    site: {
      address: sp.address,
      lot,
      houseOrigin: { x: fit.x0, y: fit.y0 },
      cut: { lineY: D, gardenLevel: 0, retainingSouthToY: 0, retainingNorthToY: 0 },
      region: sp.region,
    },
    structure: { floorToFloor: f2f, clearHeight: clear, structureDepth: 0.3 },
    levels: [
      { id: level, name: `Ground floor +${floor.toFixed(2)}`, shortName: 'Ground floor', elevation: floor, plan: true, outline: rect(0, 0, W, D) },
      { id: 'roof', name: `Roof +${(floor + f2f).toFixed(2)}`, shortName: 'Roof', elevation: q(floor + f2f), plan: false, outline: rect(0, 0, W, D) },
    ],
    grid: { x: [0, xLiving, W], y: [0, yBed, D] },
    elements,
  };
  project.elements.push(...generateStructure(project));
  return withServices(parseProject(syncThickness(project)));
}

/** Kitchen sink and bathroom fixtures, the rule electrical points and a main panel; then hosting and routing. */
function withServices(p: Project): Project {
  const room = (zone: string) => p.elements.find((e): e is Space => e.type === 'Space' && e.props.zone === zone)!;
  const fx: Fixture[] = [];
  const addFx = (kind: string, at: [number, number]) => {
    const n = fx.filter((f) => f.props.kind === kind).length + 1;
    fx.push({ id: `fx-${kind}-${String(n).padStart(2, '0')}`, type: 'Fixture', level: 'GF', tags: [], props: { kind, name: kindOf(kind).label, at, z: p.levels[0]!.elevation } });
  };
  const bath = room('wet').props.cells[0]!, living = room('social').props.cells[0]!;
  addFx('toilet', [q(bath.x1 - 0.45), q(bath.y1 - 0.4)]);
  addFx('basin', [q(bath.x1 - 1.4), q(bath.y1 - 0.3)]);
  addFx('shower', [q(bath.x1 - 0.5), q(bath.y0 + 0.55)]);
  addFx('kitchen-sink', [q(living.x0 + 0.35), q(living.y1 - 1.5)]);
  const devs: Device[] = [];
  const add = deviceMaker(devs);
  placeRoomPoints(p, add);
  const lv = p.levels[0]!;
  add('panel', 'GF', [q(living.x0 + 0.08), q(living.y0 + 1.0)], lv.elevation + 1.5, { power: 0 }, 'Main electrical panel');
  const withAll: Project = { ...p, elements: [...p.elements, ...fx, ...devs] };
  return withElectrical(withPlumbing(withHosts(withAll, { fresh: true })));
}
