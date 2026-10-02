// The building model of one version of a project. Every view, check and schedule reads this.
// Units are metres. House-local axes: y from the front building line (0) to the rear (away from the street),
// x to the right when standing in the street looking at the lot, z up. Compass directions come from site.region.xBearing.
import { z } from 'zod';

export const LevelId = z.string().min(1);

export const Rect = z.object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() });
export type Rect = z.infer<typeof Rect>;

const Point = z.tuple([z.number(), z.number()]);
export type Point = z.infer<typeof Point>;

export const Zone = z.enum(['social', 'private', 'wet', 'service', 'circ', 'work', 'stair', 'garage']);
export type Zone = z.infer<typeof Zone>;

const base = {
  id: z.string().min(1),
  level: LevelId,
  tags: z.array(z.string()),
  /** Notes for the architect and engineers (shown in the properties panel). */
  notes: z.array(z.string()).optional(),
};

/** A room or zone: a polygon made of axis-aligned cells. */
export const Space = z.object({
  ...base,
  type: z.literal('Space'),
  props: z.object({
    name: z.string().min(1),
    zone: Zone,
    cells: z.array(Rect).min(1),
    /** Locked spaces (the stair core) cannot be resized by dragging walls. */
    lock: z.boolean(),
    /** How a stair space is drawn: lane (bottom of a flight), dual (two flights), void (well above a flight), u (U-stair). */
    stairKind: z.enum(['lane', 'dual', 'void', 'u']).optional(),
    /** Floor elevation when it differs from the level (the garage). */
    floorElevation: z.number().optional(),
  }),
});
export type Space = z.infer<typeof Space>;

export const WallType = z.enum(['exterior', 'interior', 'wet', 'retaining']);
export type WallType = z.infer<typeof WallType>;

/** Walls run along one axis. start < end along that axis. The centreline sits on the cell edge. */
export const Wall = z.object({
  ...base,
  type: z.literal('Wall'),
  props: z.object({
    start: Point,
    end: Point,
    thickness: z.number().positive(),
    height: z.number().positive(),
    wallType: WallType,
    /** Spec 08: its build-up (eng/library.ts). Without one, the default for its wall type. Its thickness follows the assembly. */
    assemblyId: z.string().optional(),
  }),
});
export type Wall = z.infer<typeof Wall>;

export const OpeningKind = z.enum(['door', 'window', 'slider', 'garage']);
export type OpeningKind = z.infer<typeof OpeningKind>;

/** A door or window hosted by a wall. offset = distance from the wall start to the near edge. */
export const Opening = z.object({
  ...base,
  type: z.literal('Opening'),
  props: z.object({
    host: z.string().min(1),
    /** door = passage (not counted as window light); window = counted in the window ratio. */
    role: z.enum(['door', 'window']),
    kind: OpeningKind,
    /** High (clerestory) window. */
    high: z.boolean().optional(),
    offset: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
    sill: z.number().min(0),
    /** Swing side: +1 towards +x/+y from the wall line, -1 towards -x/-y. Doors only. */
    swing: z.union([z.literal(1), z.literal(-1)]),
  }),
});
export type Opening = z.infer<typeof Opening>;

export const Slab = z.object({
  ...base,
  type: z.literal('Slab'),
  props: z.object({
    name: z.string(),
    /** Slab extent. Either a rectangle or the cells of the referenced spaces. */
    rect: Rect.optional(),
    spaces: z.array(z.string()).optional(),
    /** Spaces cut out of the slab (stair wells, drops). */
    voidSpaces: z.array(z.string()),
    topElevation: z.number(),
    thickness: z.number().positive(),
    /** Resting on the ground (or compacted fill) instead of on beams. */
    onGrade: z.boolean().optional(),
    /** Roofs: parapet height above the top of the slab, and how far the slab overhangs the walls. */
    parapet: z.number().min(0).optional(),
    eaves: z.number().min(0).optional(),
    /** Spec 08: its build-up. The drawn thickness stays the structural deck, so the levels and the frame do not move. */
    assemblyId: z.string().optional(),
  }),
});
export type Slab = z.infer<typeof Slab>;

export const Column = z.object({
  ...base,
  type: z.literal('Column'),
  props: z.object({
    at: Point,
    /** Steel section or pier size, see profiles.ts. */
    profile: z.string(),
    /** column = steel frame column; pier = short support under the raised street-level floor. */
    kind: z.enum(['column', 'pier']),
    baseElevation: z.number(),
    topElevation: z.number(),
  }),
});
export type Column = z.infer<typeof Column>;
export const Beam = z.object({
  ...base,
  type: z.literal('Beam'),
  /** elevation = top of steel (underside of the slab it carries). */
  props: z.object({ start: Point, end: Point, profile: z.string(), elevation: z.number() }),
});
export type Beam = z.infer<typeof Beam>;

/** Concrete footing: a pad under a column or pier, or a strip under a retaining wall. */
export const Footing = z.object({
  ...base,
  type: z.literal('Footing'),
  props: z.object({
    kind: z.enum(['pad', 'strip']),
    rect: Rect,
    topElevation: z.number(),
    depth: z.number().positive(),
    /** What it carries (column, pier or wall id). */
    carries: z.string().optional(),
  }),
});
export type Footing = z.infer<typeof Footing>;

export const Flight = z.object({
  x0: z.number(),
  x1: z.number(),
  /** y of the first riser (bottom) and y of the top nosing line. */
  yBottom: z.number(),
  yTop: z.number(),
  risers: z.number().int().positive(),
});
export type Flight = z.infer<typeof Flight>;

export const Stair = z.object({
  ...base,
  type: z.literal('Stair'),
  props: z.object({
    name: z.string(),
    fromLevel: LevelId,
    toLevel: LevelId,
    riser: z.number().positive(),
    tread: z.number().positive(),
    width: z.number().positive(),
    flights: z.array(Flight).min(1),
    landings: z.array(Rect),
  }),
});
export type Stair = z.infer<typeof Stair>;

export const Deck = z.object({
  ...base,
  type: z.literal('Deck'),
  props: z.object({
    name: z.string(), label: z.string(), rect: Rect, elevation: z.number(),
    /** A raised planter strip on the deck. */
    planter: Rect.optional(),
    /** Steps cut into the deck, going down towards its front edge (y0). */
    steps: Rect.optional(),
  }),
});
export type Deck = z.infer<typeof Deck>;

/** Covered parking in the front setback, independent from the house. Its columns, beams and footings are separate elements tagged 'carport'. */
export const Carport = z.object({
  ...base,
  type: z.literal('Carport'),
  props: z.object({
    name: z.string(),
    rect: Rect,
    /** Top of the roof sheet at the front (street) edge; it rises towards the house by `slope`. */
    roofFront: z.number(),
    slope: z.number().min(0),
    /** Parking bays drawn on the paving. */
    parking: z.array(Rect),
    /** Solar modules reserved on the roof (shown as a ghost array). */
    solarModules: z.number().int().min(0),
  }),
});
export type Carport = z.infer<typeof Carport>;

/** Placeholders for later specs (plumbing, electrical, furniture, garden, materials). */
const later = <T extends string>(t: T) =>
  z.object({ ...base, type: z.literal(t), props: z.record(z.string(), z.unknown()) });
export const V3pt = z.tuple([z.number(), z.number(), z.number()]);

/** Plumbing fixture or equipment. Its kind is a key of the plumbing library (plumbing/library.ts). */
export const Fixture = z.object({
  ...base,
  type: z.literal('Fixture'),
  props: z.object({
    kind: z.string().min(1),
    name: z.string(),
    /** Plan position (house coordinates). */
    at: Point,
    /** Floor or ground it stands on; equipment on roofs or underground uses its own elevation. */
    z: z.number(),
    /** Roof drains: the roof area they collect, m². */
    area: z.number().optional(),
    /** Spec 04b hosting: the wall it is fixed to, which side (+1 towards +x/+y), distance from the wall start, height above the floor. */
    hostWallId: z.string().optional(),
    face: z.union([z.literal(1), z.literal(-1)]).optional(),
    offset: z.number().optional(),
    height: z.number().optional(),
    /** Ceiling, floor and equipment items: the slab, service space, carport or 'ground' they stand on or hang from. */
    hostId: z.string().optional(),
    /** Distance of the item centre from the wall face (fixtures stand out from the wall). */
    standoff: z.number().optional(),
  }),
});
export type Fixture = z.infer<typeof Fixture>;

export const PipeSystem = z.enum(['cold', 'hot', 'sewage', 'vent', 'rain']);
export type PipeSystem = z.infer<typeof PipeSystem>;

/** One straight pipe. Water flows from start to end. Generated by the router unless `manual`. */
export const PipeSegment = z.object({
  ...base,
  type: z.literal('PipeSegment'),
  props: z.object({
    system: PipeSystem,
    dn: z.number().positive(),
    material: z.enum(['PVC', 'PPR', 'CPVC']),
    start: V3pt,
    end: V3pt,
    /** Under pressure (pump or water supply) instead of gravity. */
    pressure: z.boolean(),
    /** Which network it belongs to, for schedules and diagrams. */
    network: z.string(),
    /** Load carried: sewage fixture units (UHC), water weights (ΣP), rain area (m²). */
    load: z.number(),
    /** Fixtures upstream (sewage, rain) or downstream (water) of this pipe. */
    serves: z.array(z.string()),
    /** Edited by hand: the router keeps its DN and material. */
    manual: z.boolean().optional(),
  }),
});
export type PipeSegment = z.infer<typeof PipeSegment>;
/** Electrical device (spec 04). Its kind is a key of electrical/library.ts. */
export const Device = z.object({
  ...base,
  type: z.literal('Device'),
  props: z.object({
    kind: z.string().min(1),
    name: z.string(),
    at: Point,
    /** Height of the device centre (absolute elevation). */
    z: z.number(),
    /** Design power: VA for outlets and lights, W for appliances. */
    power: z.number().min(0),
    /** Circuit it is on (none for low-voltage devices: network, cameras, sensors). */
    circuit: z.string().optional(),
    /** Chosen by hand: the automatic circuit grouping leaves it alone. */
    manualCircuit: z.boolean().optional(),
    /** Cameras: compass bearing (0 north, 90 east = street), downward tilt, lens. */
    bearing: z.number().optional(),
    tilt: z.number().optional(),
    lensMm: z.number().optional(),
    /** On the essential-loads panel when the battery is installed. */
    essential: z.boolean().optional(),
    size: V3pt.optional(),
    /** Spec 04b hosting: the wall it is fixed to, which side (+1 towards +x/+y), distance from the wall start, height above the floor. */
    hostWallId: z.string().optional(),
    face: z.union([z.literal(1), z.literal(-1)]).optional(),
    offset: z.number().optional(),
    height: z.number().optional(),
    /** Ceiling, floor and equipment items: the slab, service space, carport or 'ground' they stand on or hang from. */
    hostId: z.string().optional(),
    /** Distance of the item centre from the wall face (fixtures stand out from the wall). */
    standoff: z.number().optional(),
  }),
});
export type Device = z.infer<typeof Device>;

/** A circuit and its design results (recomputed by the electrical designer). */
export const Circuit = z.object({
  ...base,
  type: z.literal('Circuit'),
  props: z.object({
    name: z.string(),
    panel: z.string(),
    purpose: z.enum(['lighting', 'outlets', 'dedicated', 'feeder']),
    /** Phase-to-neutral or phase-to-phase voltage of the project's supply (site.region.supply). */
    voltage: z.number().positive(),
    phases: z.array(z.enum(['A', 'B', 'C'])),
    load: z.number(),
    current: z.number(),
    section: z.number(),
    breaker: z.number(),
    rcd: z.boolean(),
    length: z.number(),
    drop: z.number(),
    /** Section chosen by hand (kept when the circuit is resized). */
    manualSection: z.number().optional(),
  }),
});
export type Circuit = z.infer<typeof Circuit>;

/** Electrical conduit run, generated from the circuits. */
export const Conduit = z.object({
  ...base,
  type: z.literal('Conduit'),
  props: z.object({ circuit: z.string(), start: V3pt, end: V3pt, dn: z.number() }),
});
export type Conduit = z.infer<typeof Conduit>;

/** Photovoltaic array (spec 04). */
export const SolarArray = z.object({
  ...base,
  type: z.literal('SolarArray'),
  props: z.object({
    name: z.string(),
    modules: z.number().int().min(0),
    moduleW: z.number(),
    /** Module size (long × short side), m. */
    moduleSize: z.tuple([z.number(), z.number()]),
    tilt: z.number(),
    /** Compass bearing the modules face (0 = north). */
    bearing: z.number(),
    /** Roof area it is laid out on, and the setback from the parapet. */
    area: Rect,
    setback: z.number(),
    roofTop: z.number(),
    inverterKw: z.number(),
    batteryKwh: z.number(),
  }),
});
export type SolarArray = z.infer<typeof SolarArray>;
/** Spec 04b: a space that can carry pipes and conduits (shaft, ceiling plenum) or hold equipment (roof zone).
 * Wall cavities, floor screed, the crawlspace and the ground are derived from the walls, slabs and site (mep/spaces.ts). */
export const ServiceSpace = z.object({
  ...base,
  type: z.literal('ServiceSpace'),
  props: z.object({
    kind: z.enum(['shaft', 'plenum', 'roof-zone']),
    name: z.string(),
    rect: Rect,
    /** Shafts: bottom and top elevation. Roof zones: the surface the equipment stands on. */
    z0: z.number().optional(),
    z1: z.number().optional(),
    /** Plenums: depth of the lowered ceiling below the slab soffit (reduces the clear height). */
    depth: z.number().positive().optional(),
    /** Shafts: the face with the access panel. */
    accessFace: z.enum(['N', 'S', 'E', 'W']).optional(),
    /** Roof zones: how people reach it for maintenance, and what it is for. */
    access: z.string().optional(),
    purpose: z.enum(['tanks', 'equipment', 'pv']).optional(),
  }),
});
export type ServiceSpace = z.infer<typeof ServiceSpace>;
/** Spec 08: architectural features placed as real elements, each with its own estimate (eng/features.ts). */
export const FeatureKind = z.enum(['brise', 'pergola', 'cobogo', 'skylight', 'eave', 'green-roof', 'planter', 'gutter', 'shutters', 'awning', 'solar-heater']);
export type FeatureKind = z.infer<typeof FeatureKind>;
export const Feature = z.object({
  ...base,
  type: z.literal('Feature'),
  props: z.object({
    kind: FeatureKind,
    name: z.string(),
    /** The opening (brise, shutters, awning), wall (cobogó, planter) or roof slab (eave, gutter) it belongs to. */
    host: z.string().optional(),
    /** Plan footprint (pergola, skylight, green roof, solar heater). */
    rect: Rect.optional(),
    /** Eave and gutter: which edge of the roof (N, S, E = street, W = garden). */
    side: z.enum(['N', 'S', 'E', 'W']).optional(),
    /** Wall-hosted panels: distance from the wall start, width, height and sill. */
    offset: z.number().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    sill: z.number().min(0).optional(),
    /** Absolute height of its base (pergola, skylight, roof items). */
    z: z.number().optional(),
    params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
  }),
});
export type Feature = z.infer<typeof Feature>;
export const Furniture = later('Furniture');
export const Plant = later('Plant');
export const Material = later('Material');

export const Element = z.discriminatedUnion('type', [
  Space, Wall, Opening, Slab, Column, Beam, Footing, Stair, Deck, Carport, Conduit, SolarArray,
  Fixture, PipeSegment, Device, Circuit, ServiceSpace, Feature, Furniture, Plant, Material,
]);
export type Element = z.infer<typeof Element>;
export type ElementType = Element['type'];

export const Level = z.object({
  id: LevelId,
  name: z.string(),
  shortName: z.string(),
  elevation: z.number(),
  /** Plan levels are edited in 2D and have an outline. */
  plan: z.boolean(),
  outline: Rect.optional(),
});
export type Level = z.infer<typeof Level>;

/** The place facts every engine reads (P0: nothing about the place is hard-coded). null = not known yet, TO CONFIRM. */
export const Region = z.object({
  city: z.string(),
  /** State (UF). */
  state: z.string(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  /** Hours from UTC (Brazil has no daylight saving). */
  utcOffset: z.number(),
  /** Compass bearing of the house +x axis (0 = north, 90 = east). The street side (−y) is 90° clockwise from it. */
  xBearing: z.number(),
  supply: z.object({
    /** Electricity company, if known. */
    utility: z.string().nullable(),
    /** Phase-to-neutral and phase-to-phase voltages, e.g. 127/220 or 220/380. */
    phaseV: z.number().positive(),
    lineV: z.number().positive(),
    phases: z.number().int().min(1).max(3),
    confirmed: z.boolean(),
  }),
  /** Water and sewer company, if known. */
  water: z.string().nullable(),
  /** City rules we know: the code that sets the eaves limit and the zoning. null = TO CONFIRM. */
  rules: z.object({ code: z.string().nullable(), sanitary: z.string().nullable() }),
  /** PV specific yield for the place, kWh per kWp per month (12 values), with its source. null = TO CONFIRM. */
  pvYield: z.object({ monthly: z.array(z.number()).length(12), source: z.string() }).nullable(),
  /** Share of the year's hot water a solar heater covers here (0–1). null = TO CONFIRM. */
  solarHeaterShare: z.number().min(0).max(1).nullable(),
});
export type Region = z.infer<typeof Region>;

export const Project = z.object({
  schema: z.literal('casa123-bim/1'),
  meta: z.object({
    project: z.string(),
    version: z.string(),
    versionId: z.string().min(1),
    units: z.literal('m'),
    source: z.string(),
    note: z.string(),
  }),
  site: z.object({
    address: z.string(),
    lot: z.object({ front: z.number(), rear: z.number(), sides: z.number() }),
    /** Lot corners in lot coordinates (x from the south boundary, y from the street), counter-clockwise from the street/south corner. */
    lotPolygon: z.array(Point).min(3),
    /** Where house (0,0) sits in lot coordinates. */
    houseOrigin: z.object({ x: z.number(), y: z.number() }),
    fallStreetToRear: z.number(),
    setbacks: z.object({ front: z.number(), rear: z.number(), sides: z.number() }),
    cut: z.object({
      lineY: z.number(),
      gardenLevel: z.number(),
      retainingSouthToY: z.number(),
      retainingNorthToY: z.number(),
    }),
    /** North side walking ramp from the street down to the garden. */
    ramp: z.object({ width: z.number(), slope: z.number() }).optional(),
    /** Eaves limit not counted in site coverage (from the city rules in region.rules). */
    eavesLimit: z.number().optional(),
    /** Where the lot is: city, coordinates, orientation, electricity supply and the city rules we know. */
    region: Region,
    /** Public services in the street (spec 03). */
    utilities: z.object({
      /** Depth of the public sewer below the street (water company to confirm). */
      sewerDepth: z.number(),
      /** Distance from the lot boundary to the sewer main in the street. */
      sewerOffset: z.number(),
      waterMainDepth: z.number(),
      /** 5-minute design rainfall, mm/h (to confirm for the city). */
      rainIntensity: z.number(),
    }).optional(),
    toConfirm: z.array(z.string()),
  }),
  structure: z.object({ floorToFloor: z.number(), clearHeight: z.number(), structureDepth: z.number() }),
  levels: z.array(Level).min(1),
  grid: z.object({ x: z.array(z.number()), y: z.array(z.number()) }),
  /** Spec 04b: what the routers could not place, and what they changed on their own (e.g. a shaft made larger). */
  mep: z.object({
    noRoute: z.array(z.object({ system: z.string(), network: z.string(), item: z.string(), reason: z.string() })),
    notes: z.array(z.string()),
  }).optional(),
  /** Spec 08: values the family changed in the Engineering assumptions panel (key → value; null = left empty, TO CONFIRM). */
  assumptions: z.record(z.string(), z.number().nullable()).optional(),
  /** Spec 08: default assembly per use, and the saved cost snapshot. */
  engineering: z.object({
    assemblyDefaults: z.record(z.string(), z.string()).optional(),
    snapshot: z.object({ date: z.string(), label: z.string(), total: z.number(), items: z.record(z.string(), z.number()) }).optional(),
  }).optional(),
  elements: z.array(Element),
});
export type Project = z.infer<typeof Project>;

export function parseProject(data: unknown): Project {
  return Project.parse(data);
}

/** Level ids are the project's own. By convention LL is below the entry level, SL the entry level, UF above it, roof the roof. */
export type PlanLevel = string;
/** The levels edited in plan, from the lowest up. */
export const planLevels = (p: Pick<Project, 'levels'>): string[] =>
  p.levels.filter((l) => l.plan).sort((a, b) => a.elevation - b.elevation).map((l) => l.id);
export const isPlanLevel = (p: Pick<Project, 'levels'>, id: string) => p.levels.some((l) => l.plan && l.id === id);
/** The plan level people enter from the street: the one closest to the street level (0.00). */
export const entryLevel = (p: Pick<Project, 'levels'>): string => {
  const ls = p.levels.filter((l) => l.plan);
  return [...ls].sort((a, b) => Math.abs(a.elevation) - Math.abs(b.elevation))[0]?.id ?? ls[0]?.id ?? '';
};
/** The highest plan level (its plan also shows the roof equipment). */
export const topLevel = (p: Pick<Project, 'levels'>): string => planLevels(p).at(-1) ?? '';
