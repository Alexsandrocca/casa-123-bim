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
  }),
});
export type Slab = z.infer<typeof Slab>;

export const Column = z.object({
  ...base,
  type: z.literal('Column'),
  props: z.object({ at: Point, profile: z.string(), baseElevation: z.number(), topElevation: z.number() }),
});
export const Beam = z.object({
  ...base,
  type: z.literal('Beam'),
  props: z.object({ start: Point, end: Point, profile: z.string(), elevation: z.number() }),
});

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
  props: z.object({ name: z.string(), label: z.string(), rect: Rect, elevation: z.number() }),
});
export type Deck = z.infer<typeof Deck>;

/** Placeholders for later specs (plumbing, electrical, furniture, garden, materials). */
const later = (t: string) =>
  z.object({ ...base, type: z.literal(t), props: z.record(z.string(), z.unknown()) });
export const Fixture = later('Fixture');
export const PipeSegment = later('PipeSegment');
export const Device = later('Device');
export const Circuit = later('Circuit');
export const Furniture = later('Furniture');
export const Plant = later('Plant');
export const Material = later('Material');

export const Element = z.discriminatedUnion('type', [
  Space, Wall, Opening, Slab, Column, Beam, Stair, Deck,
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
    versionId: z.enum(['v1', 'v2']),
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
