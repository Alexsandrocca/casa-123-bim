// A project on disk: projects/<id>/project.json plus one model file per version (versions/<id>.json).
// The building model of each version is schema.ts; this file is the envelope around them.
import { z } from 'zod';

export const STAGES = ['lot', 'start', 'plans', '3d', 'approve', 'bim', 'outputs'] as const;
export type Stage = (typeof STAGES)[number];

export const VersionEntry = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  /** design = edited in the DESIGN tab; approved = a frozen snapshot; bim = the BIM tab's working copy of the approved one. */
  kind: z.enum(['design', 'approved', 'bim']),
  /** Model file, relative to the project folder. */
  file: z.string(),
  /** The model as it was created (Reset floor goes back to it). */
  original: z.string().optional(),
  /** Approved snapshots: the design version they froze, when, and that version's edit count at that moment. */
  from: z.string().optional(),
  date: z.string().optional(),
  fromEdits: z.number().int().optional(),
  /** Design versions: net number of edits (an edit adds one, an undo takes one away). */
  edits: z.number().int().optional(),
});
export type VersionEntry = z.infer<typeof VersionEntry>;

export const ProjectFile = z.object({
  schema: z.literal('casabim-project/1'),
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  address: z.string(),
  /** Summary of the lot (city, size), copied from the design model's site when it is saved. P1 makes it editable. */
  lot: z.object({ city: z.string(), state: z.string(), front: z.number(), depth: z.number(), area: z.number() }),
  /** The family program (P2) and the chosen style (P2/P4). Empty for now. */
  program: z.record(z.string(), z.unknown()),
  style: z.record(z.string(), z.unknown()),
  versions: z.array(VersionEntry).min(1),
  /** The design version the DESIGN tab edits. */
  designVersionId: z.string(),
  approvedVersionId: z.string().nullable(),
  stage: z.enum(STAGES),
  /** UI language for this project. */
  language: z.enum(['pt-BR', 'en']),
  /** Commit this project to git (family data stays out of git unless this is on). */
  includeInGit: z.boolean(),
  created: z.string(),
  updated: z.string(),
  /** Small plan for the project list: the lot outline and the entry floor's rooms, in lot coordinates. */
  thumb: z.object({
    lot: z.array(z.tuple([z.number(), z.number()])),
    rooms: z.array(z.tuple([z.number(), z.number(), z.number(), z.number(), z.string()])),
  }).optional(),
});
export type ProjectFile = z.infer<typeof ProjectFile>;

/** Ids are folder names: lower case letters, digits and hyphens. */
export const slugify = (name: string) =>
  name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';

/** Global settings (projects/settings.json): AI prices, exchange rate, monthly budget. */
export const Settings = z.object({
  ai: z.object({
    /** US$ per million tokens, input and output, for the model in use. */
    priceInPerMTok: z.number().min(0),
    priceOutPerMTok: z.number().min(0),
    usdToBrl: z.number().positive(),
    /** Monthly budget in US$ (0 = no budget). Warns at 80 %, blocks at 100 % unless overridden. */
    monthlyBudgetUsd: z.number().min(0),
    allowOverBudget: z.boolean(),
  }),
});
export type Settings = z.infer<typeof Settings>;

/** The list thumbnail of a design model: lot outline and the entry floor's room cells, in lot coordinates. */
export function thumbOf(p: { site: { lot: { polygon: [number, number][] }; houseOrigin: { x: number; y: number } }; levels: { id: string; plan: boolean; elevation: number }[]; elements: { type: string; level: string; props: unknown }[] }): NonNullable<ProjectFile['thumb']> {
  const plan = p.levels.filter((l) => l.plan);
  const entry = [...plan].sort((a, b) => Math.abs(a.elevation) - Math.abs(b.elevation))[0]?.id;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const rooms: [number, number, number, number, string][] = [];
  for (const e of p.elements) {
    if (e.type !== 'Space' || e.level !== entry) continue;
    const sp = e.props as { zone: string; cells: { x0: number; y0: number; x1: number; y1: number }[] };
    for (const c of sp.cells) rooms.push([r2(c.x0 + p.site.houseOrigin.x), r2(c.y0 + p.site.houseOrigin.y), r2(c.x1 + p.site.houseOrigin.x), r2(c.y1 + p.site.houseOrigin.y), sp.zone]);
  }
  return { lot: p.site.lot.polygon.map(([x, y]) => [r2(x), r2(y)]), rooms };
}
