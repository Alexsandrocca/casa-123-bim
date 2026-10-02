// P1: "describe your lot in words". The local server asks Claude for these fields as JSON and checks them with zod;
// the wizard shows them as a preview (Use these values / Edit) and never applies them on its own.
import { z } from 'zod';
import { ccwLot } from './lot';
import type { Lot } from './schema';

export const COMPASS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type Compass8 = (typeof COMPASS8)[number];
export const COMPASS8_BEARING: Record<Compass8, number> = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

const len = z.number().positive().max(1000).nullable();
export const LotAiFields = z.object({
  /** rectangle; trapezoid (front and rear differ); corner (two streets); irregular. */
  shape: z.enum(['rectangle', 'trapezoid', 'corner', 'irregular']).nullable(),
  /** Width on the street and at the rear, m. */
  front: len,
  rear: len,
  /** Lengths of the left and right sides seen from the street (or the depth when only one is said), m. */
  left: len,
  right: len,
  /** Corner lot: which side is on the second street. */
  secondStreet: z.enum(['left', 'right']).nullable(),
  terrain: z.enum(['flat', 'down', 'up', 'side']).nullable(),
  /** The fall or rise in metres (positive). */
  fall: z.number().min(0).max(100).nullable(),
  /** terrain 'side': which side is lower, seen from the street. */
  lowerSide: z.enum(['left', 'right']).nullable(),
  /** The compass direction the street side of the lot faces ("the street is to the east" = E). */
  streetFaces: z.enum(COMPASS8).nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  /** State (UF), two letters. */
  state: z.string().max(2).nullable(),
  /** Anything else said that matters (in the family's words). */
  notes: z.array(z.string()),
});
export type LotAiFields = z.infer<typeof LotAiFields>;

export const LOT_AI_SYSTEM = `You read a Brazilian family's description of their building lot (usually in Portuguese) and return its facts as JSON.
Return ONLY one JSON object, no other text, with exactly these keys:
{"shape": "rectangle"|"trapezoid"|"corner"|"irregular"|null, "front": number|null, "rear": number|null, "left": number|null, "right": number|null,
 "secondStreet": "left"|"right"|null, "terrain": "flat"|"down"|"up"|"side"|null, "fall": number|null, "lowerSide": "left"|"right"|null,
 "streetFaces": "N"|"NE"|"E"|"SE"|"S"|"SW"|"W"|"NW"|null, "address": string|null, "city": string|null, "state": string|null, "notes": string[]}
Rules:
- Lengths in metres. "frente" = front (on the street), "fundo(s)" = rear, "lateral/laterais" = the sides (left and right seen from the street; one number for "laterais" fills both).
- shape: trapezoid when front and rear differ; rectangle when they are equal or only front and depth are given; corner for "esquina" (two streets; secondStreet if said); irregular otherwise.
- terrain: "cai para o fundo" / falls towards the rear = "down"; rises towards the rear = "up"; falls to one side = "side" with lowerSide; "plano" = "flat". fall = the metres said ("uns 2 metros" = 2).
- streetFaces: the compass side of the lot where the street is ("a rua fica a leste" = "E"; "frente para o norte" = "N").
- city and state: the city named; state as the two-letter UF when known (Piracicaba = SP).
- Never invent a number: use null for anything not said.`;

/** Read the model's answer: the first JSON object in it, checked against the schema. */
export function parseLotAi(text: string): LotAiFields {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('The answer has no JSON object.');
  return LotAiFields.parse(JSON.parse(text.slice(a, b + 1)));
}

/** The street-side compass point → the lot x axis bearing (x runs 90° anticlockwise from the street side). */
export const xBearingForStreet = (faces: number) => (faces + 270) % 360;

/** A trapezoid: front on the street, rear parallel to it, depth square to the street; the difference goes to one side (or half to each). */
export function trapezoid(front: number, rear: number, depth: number, extra: 'left' | 'right' | 'both' = 'right'): [number, number][] {
  const d = rear - front;
  const l = extra === 'left' ? -d : extra === 'both' ? -d / 2 : 0;
  return [[0, 0], [front, 0], [l + rear, depth], [l, depth]];
}

/** Apply the AI fields to a lot (only what was said). The caller shows the result as a preview first. */
export function lotFromAi(lot: Lot, f: LotAiFields): Lot {
  let next: Lot = { ...lot };
  const said = { status: 'given' as const, source: 'Family description (AI read)' };
  const depth = f.left ?? f.right;
  if (f.front && depth) {
    const rear = f.rear ?? f.front;
    if (f.shape === 'corner') {
      next = { ...next, polygon: [[0, 0], [f.front, 0], [f.front, depth], [0, depth]], streetEdges: f.secondStreet === 'left' ? [0, 3] : [0, 1], shape: said };
    } else {
      next = { ...next, polygon: rear === f.front ? [[0, 0], [f.front, 0], [f.front, depth], [0, depth]] : trapezoid(f.front, rear, depth), streetEdges: [0], shape: said };
    }
  }
  if (f.terrain) {
    const fall = f.terrain === 'flat' ? 0 : f.fall ?? 0;
    next = { ...next, terrain: { ...next.terrain, kind: f.terrain, fall: f.terrain === 'side' && f.lowerSide === 'left' ? -fall : fall, ...said } };
  }
  if (f.streetFaces) next = { ...next, geo: { ...next.geo, xBearing: xBearingForStreet(COMPASS8_BEARING[f.streetFaces]), ...said } };
  if (f.notes.length) next = { ...next, notes: [...next.notes, ...f.notes] };
  return ccwLot(next);
}
