// The Casa 123 building model. Every view, check and schedule reads this.
// Units are metres. House-local axes: x from the south wall (0) to the north,
// y from the front building line (0) to the rear, z up.
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
export const Device = later('Device');
export const Circuit = later('Circuit');
export const Furniture = later('Furniture');
export const Plant = later('Plant');
export const Material = later('Material');

export const Element = z.discriminatedUnion('type', [
  Space, Wall, Opening, Slab, Column, Beam, Footing, Stair, Deck, Carport,
  Fixture, PipeSegment, Device, Circuit, Furniture, Plant, Material,
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

export const Project = z.object({
  schema: z.literal('casa123-bim/1'),
  meta: z.object({
    project: z.string(),
    version: z.string(),
    versionId: z.enum(['v1', 'v2', 'v3']),
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
    /** Eaves limit not counted in site coverage (Piracicaba LC 474/2025). */
    eavesLimit: z.number().optional(),
    /** Public services in the street (spec 03). */
    utilities: z.object({
      /** Depth of the public sewer below the street (SEMAE to confirm). */
      sewerDepth: z.number(),
      /** Distance from the lot boundary to the sewer main in the street. */
      sewerOffset: z.number(),
      waterMainDepth: z.number(),
      /** 5-minute design rainfall, mm/h (to confirm for Piracicaba). */
      rainIntensity: z.number(),
    }).optional(),
    toConfirm: z.array(z.string()),
  }),
  structure: z.object({ floorToFloor: z.number(), clearHeight: z.number(), structureDepth: z.number() }),
  levels: z.array(Level).min(1),
  grid: z.object({ x: z.array(z.number()), y: z.array(z.number()) }),
  elements: z.array(Element),
});
export type Project = z.infer<typeof Project>;

export function parseProject(data: unknown): Project {
  return Project.parse(data);
}

export const PLAN_LEVELS = ['LL', 'SL', 'UF'] as const;
export type PlanLevel = (typeof PLAN_LEVELS)[number];
