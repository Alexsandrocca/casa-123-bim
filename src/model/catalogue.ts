// P0: the typed catalogue of the model's commands, and the dry run P3's AI will call.
// Each entry: a name, what it does, a zod schema for its arguments, a one-line human summary and the command it builds.
// A dry run applies a list of commands to a copy of the model and says, in plain words, what would change.
import { z } from 'zod';
import { runChecks, type CheckResult } from './checks';
import {
  CommandError, addDevice, addOpening, deleteDevice, deleteOpening, flipOpening, moveDevice, moveFixture, moveOpening, moveWall,
  nextDeviceId, nextOpeningId, renameSpace, resizeOpening, wallLimits, type Command,
} from './commands';
import { addFeature, setAssembly } from './eng/commands';
import { eq, getEl, lineHandles, openingSeg, spaceArea, spacesOn, wallSeg } from './geometry';
import { compassOf } from './orientation';
import { FeatureKind, type Element, type Opening, type Project, type Space, type Wall } from './schema';

export interface CatalogueEntry<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  args: S;
  /** One line a person understands, e.g. "Make Garage 2.0 m² smaller". */
  summary(a: z.infer<S>, p: Project): string;
  build(a: z.infer<S>, p: Project): Command;
}

const entry = <S extends z.ZodTypeAny>(e: CatalogueEntry<S>): CatalogueEntry => e as unknown as CatalogueEntry;

/** A room by id, or by name (and floor when two floors have the same name). */
const RoomRef = z.object({ room: z.string().min(1), level: z.string().optional() });
export function findRoom(p: Project, room: string, level?: string): Space {
  const all = p.elements.filter((e): e is Space => e.type === 'Space' && (!level || e.level === level));
  const s = all.find((x) => x.id === room) ?? all.find((x) => x.props.name.toLowerCase() === room.toLowerCase());
  if (!s) throw new CommandError(`There is no room “${room}”${level ? ` on ${level}` : ''}.`);
  return s;
}

const opening = (p: Project, id: string) => {
  const op = getEl(p, id);
  if (op?.type !== 'Opening') throw new CommandError(`There is no door or window ${id}.`);
  return op;
};

/** Resize a room by moving one of its inside walls: the first wall that can move far enough gives the area asked for. */
export function resizeRoom(room: string, deltaM2: number, level?: string): Command {
  return {
    label: 'Resize room',
    apply(p) {
      const s = findRoom(p, room, level);
      const target = spaceArea(s) + deltaM2;
      if (target < 1) throw new CommandError(`${s.props.name} would be smaller than 1 m².`);
      const handles = lineHandles(p, s.level).filter((h) => !h.locked && h.spaceIds.includes(s.id))
        .sort((a, b) => (b.b - b.a) - (a.b - a.a));
      for (const h of handles) {
        const len = h.b - h.a;
        // which side of the line the room is on decides the direction
        const inside = s.props.cells.some((c) => (h.o === 'v' ? eq(c.x0, h.c) : eq(c.y0, h.c)) && (h.o === 'v' ? c.y0 < h.b && c.y1 > h.a : c.x0 < h.b && c.x1 > h.a));
        const dir = inside ? -1 : 1;
        const to = h.c + (dir * deltaM2) / len;
        const at = (h.a + h.b) / 2;
        const lim = wallLimits(p, s.level, h.o, h.c, at);
        if (!lim || to < lim.lo - 1e-6 || to > lim.hi + 1e-6) continue;
        let next: Project;
        try { next = moveWall(s.level, h.o, h.c, at, to).apply(p); } catch { continue; }
        const after = next.elements.find((e): e is Space => e.type === 'Space' && e.id === s.id);
        if (after && Math.abs(spaceArea(after) - target) <= 0.05 + Math.abs(deltaM2) * 0.05) return next;
      }
      throw new CommandError(`No inside wall of ${s.props.name} can move far enough to change it by ${deltaM2.toFixed(1)} m².`);
    },
  };
}

/** Plan coordinate of a point given in metres from a room's first cell corner. */
const P2 = z.tuple([z.number(), z.number()]);

export const CATALOGUE: CatalogueEntry[] = [
  entry({
    name: 'resize_room', description: 'Make a room larger or smaller by a number of square metres (moves one of its inside walls).',
    args: RoomRef.extend({ deltaM2: z.number().refine((v) => v !== 0 && Math.abs(v) < 100) }),
    summary: (a) => `Make ${a.room} ${Math.abs(a.deltaM2).toFixed(1)} m² ${a.deltaM2 < 0 ? 'smaller' : 'larger'}`,
    build: (a) => resizeRoom(a.room, a.deltaM2, a.level),
  }),
  entry({
    name: 'rename_room', description: 'Give a room a new name.',
    args: RoomRef.extend({ name: z.string().min(1) }),
    summary: (a) => `Rename ${a.room} to ${a.name}`,
    build: (a, p) => renameSpace(findRoom(p, a.room, a.level).id, a.name),
  }),
  entry({
    name: 'move_wall', description: 'Move an inside wall (a line between rooms) to a new coordinate, in metres. o = v (runs along y, moves in x) or h (runs along x, moves in y).',
    args: z.object({ level: z.string(), o: z.enum(['v', 'h']), c: z.number(), at: z.number(), to: z.number() }),
    summary: (a) => `Move the wall at ${a.o === 'v' ? 'x' : 'y'} = ${a.c.toFixed(2)} to ${a.to.toFixed(2)}`,
    build: (a) => moveWall(a.level, a.o, a.c, a.at, a.to),
  }),
  entry({
    name: 'move_opening', description: 'Slide a door or window along its wall; start = absolute coordinate of its near edge.',
    args: z.object({ id: z.string(), start: z.number() }),
    summary: (a) => `Move ${a.id} along its wall`,
    build: (a) => moveOpening(a.id, a.start),
  }),
  entry({
    name: 'resize_opening', description: 'Change the width of a door or window, in metres.',
    args: z.object({ id: z.string(), width: z.number().positive() }),
    summary: (a) => `Make ${a.id} ${a.width.toFixed(2)} m wide`,
    build: (a) => resizeOpening(a.id, a.width),
  }),
  entry({
    name: 'flip_opening', description: 'Flip the swing of a door.',
    args: z.object({ id: z.string() }),
    summary: (a) => `Flip the swing of ${a.id}`,
    build: (a) => flipOpening(a.id),
  }),
  entry({
    name: 'add_opening', description: 'Add a door (0.80 m) or a window (1.20 m) on a wall, centred at a coordinate along the wall.',
    args: z.object({ wall: z.string(), center: z.number(), role: z.enum(['door', 'window']) }),
    summary: (a) => `Add a ${a.role} on ${a.wall}`,
    build: (a, p) => { const w = getEl(p, a.wall); if (w?.type !== 'Wall') throw new CommandError(`There is no wall ${a.wall}.`); return addOpening(nextOpeningId(p, w.level, a.role), a.wall, a.center, a.role); },
  }),
  entry({
    name: 'delete_opening', description: 'Remove a door or window.',
    args: z.object({ id: z.string() }),
    summary: (a) => `Remove ${a.id}`,
    build: (a, p) => { opening(p, a.id); return deleteOpening(a.id); },
  }),
  entry({
    name: 'set_assembly', description: 'Choose the build-up (assembly) of a wall or slab, by assembly id.',
    args: z.object({ id: z.string(), assembly: z.string() }),
    summary: (a) => `Build ${a.id} as ${a.assembly}`,
    build: (a) => setAssembly(a.id, a.assembly),
  }),
  entry({
    name: 'add_feature', description: 'Add an architectural feature (brise, pergola, cobogó, skylight, eave…) on an opening, wall, roof slab or a plan point.',
    args: z.object({ kind: FeatureKind, opening: z.string().optional(), wall: z.string().optional(), slab: z.string().optional(), level: z.string().optional(), at: P2.optional() }),
    summary: (a) => `Add a ${a.kind}${a.opening ?? a.wall ?? a.slab ? ` on ${a.opening ?? a.wall ?? a.slab}` : ''}`,
    build: (a) => addFeature(a.kind, { opening: a.opening, wall: a.wall, slab: a.slab, level: a.level, at: a.at } as Parameters<typeof addFeature>[1]),
  }),
  entry({
    name: 'move_fixture', description: 'Move a plumbing fixture (toilet, basin, shower…) to a plan point; it re-hosts on the nearest wall.',
    args: z.object({ id: z.string(), at: P2 }),
    summary: (a) => `Move ${a.id}`,
    build: (a) => moveFixture(a.id, a.at[0], a.at[1]),
  }),
  entry({
    name: 'move_device', description: 'Move an electrical device (outlet, switch, light…) to a plan point.',
    args: z.object({ id: z.string(), at: P2 }),
    summary: (a) => `Move ${a.id}`,
    build: (a) => moveDevice(a.id, a.at[0], a.at[1]),
  }),
  entry({
    name: 'add_device', description: 'Add an electrical device of a kind (outlet, switch, ceiling-light…) at a plan point on a level.',
    args: z.object({ kind: z.string(), level: z.string(), at: P2 }),
    summary: (a) => `Add a ${a.kind}`,
    build: (a, p) => addDevice(nextDeviceId(p, a.kind), a.kind, a.level, a.at),
  }),
  entry({
    name: 'delete_device', description: 'Remove an electrical device.',
    args: z.object({ id: z.string() }),
    summary: (a) => `Remove ${a.id}`,
    build: (a) => deleteDevice(a.id),
  }),
];

export const CommandCall = z.object({ name: z.string(), args: z.record(z.string(), z.unknown()).default({}) });
export type CommandCall = z.infer<typeof CommandCall>;

/** A command list as people (and P3's AI) write it: a JSON array of {name, args}. */
export function parseCalls(json: unknown): CommandCall[] {
  const arr = Array.isArray(json) ? json : [json];
  return arr.map((x) => CommandCall.parse(x));
}

/** One call → its command and summary, or why it cannot run. */
export function compile(p: Project, call: CommandCall): { cmd: Command; summary: string } {
  const e = CATALOGUE.find((x) => x.name === call.name);
  if (!e) throw new CommandError(`Unknown command “${call.name}”. Known: ${CATALOGUE.map((x) => x.name).join(', ')}.`);
  const parsed = e.args.safeParse(call.args);
  if (!parsed.success) throw new CommandError(`${call.name}: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'args'} ${i.message}`).join('; ')}`);
  return { cmd: e.build(parsed.data, p), summary: e.summary(parsed.data, p) };
}

/* ---------- the readable diff ---------- */

const COMPASS = { N: 'north', E: 'east', S: 'south', W: 'west' } as const;

/** The rooms a wall separates, for its name ("wall between Kitchen and Living"). */
function wallName(p: Project, w: Wall): string {
  const s = wallSeg(w);
  const touching = spacesOn(p, w.level).filter((sp) => sp.props.cells.some((c) =>
    s.o === 'v' ? (eq(c.x0, s.c) || eq(c.x1, s.c)) && c.y0 < s.b - 1e-6 && c.y1 > s.a + 1e-6 : (eq(c.y0, s.c) || eq(c.y1, s.c)) && c.x0 < s.b - 1e-6 && c.x1 > s.a + 1e-6));
  const names = [...new Set(touching.map((x) => x.props.name))];
  if (names.length >= 2) return `Wall between ${names.slice(0, 2).join(' and ')}`;
  if (names.length === 1) return `${names[0]} ${w.props.wallType === 'exterior' ? 'outside wall' : 'wall'}`;
  return `Wall ${w.id}`;
}

const label = (e: Element) => (e.type === 'Space' ? e.props.name : e.type === 'Opening' ? `${e.props.role === 'door' ? 'Door' : 'Window'} ${e.id}` : `${e.type} ${e.id}`);

export function describeDiff(before: Project, after: Project): string[] {
  const out: string[] = [];
  const A = new Map(before.elements.map((e) => [e.id, e])), B = new Map(after.elements.map((e) => [e.id, e]));
  // rooms
  for (const [id, b] of B) {
    if (b.type !== 'Space') continue;
    const a = A.get(id);
    if (!a || a.type !== 'Space') { out.push(`New room: ${b.props.name} (${spaceArea(b).toFixed(1)} m²)`); continue; }
    if (a.props.name !== b.props.name) out.push(`${a.props.name} renamed to ${b.props.name}`);
    const x = spaceArea(a), y = spaceArea(b);
    if (Math.abs(x - y) >= 0.05) out.push(`${b.props.name}: ${x.toFixed(1)} → ${y.toFixed(1)} m²`);
  }
  for (const [id, a] of A) if (a.type === 'Space' && !B.has(id)) out.push(`Room removed: ${a.props.name}`);
  // walls
  for (const [id, b] of B) {
    if (b.type !== 'Wall') continue;
    const a = A.get(id);
    if (!a || a.type !== 'Wall') { out.push(`New wall: ${wallName(after, b)}`); continue; }
    const sa = wallSeg(a), sb = wallSeg(b);
    if (sa.o === sb.o && !eq(sa.c, sb.c)) {
      const d = sb.c - sa.c;
      const dir = COMPASS[sa.o === 'v' ? compassOf(after, Math.sign(d), 0) : compassOf(after, 0, Math.sign(d))];
      out.push(`${wallName(before, a)} moved ${Math.abs(d).toFixed(2)} m ${dir}`);
    }
  }
  for (const [id, a] of A) if (a.type === 'Wall' && !B.has(id)) out.push(`Wall removed: ${wallName(before, a)}`);
  // doors and windows
  for (const [id, b] of B) {
    if (b.type !== 'Opening') continue;
    const a = A.get(id) as Opening | undefined;
    if (!a) { out.push(`New ${b.props.role}: ${b.id} (${b.props.width.toFixed(2)} m)`); continue; }
    if (!eq(a.props.width, b.props.width)) out.push(`${label(b)}: ${a.props.width.toFixed(2)} → ${b.props.width.toFixed(2)} m wide`);
    if (a.props.host === b.props.host && !eq(a.props.offset, b.props.offset)) {
      const wa = A.get(a.props.host), wb = B.get(b.props.host);
      if (wa?.type === 'Wall' && wb?.type === 'Wall') {
        const d = openingSeg(b, wb).a - openingSeg(a, wa).a;
        out.push(`${label(b)} moved ${Math.abs(d).toFixed(2)} m along its wall`);
      }
    }
    if (a.props.swing !== b.props.swing && b.props.role === 'door') out.push(`${label(b)} swings the other way`);
  }
  for (const [id, a] of A) if (a.type === 'Opening' && !B.has(id)) out.push(`Removed: ${label(a)}`);
  // everything else, counted by kind
  const counted = ['Space', 'Wall', 'Opening'];
  const kinds = new Map<string, number>();
  for (const [id, b] of B) if (!counted.includes(b.type) && JSON.stringify(A.get(id)) !== JSON.stringify(b)) kinds.set(b.type, (kinds.get(b.type) ?? 0) + 1);
  for (const [id, a] of A) if (!counted.includes(a.type) && !B.has(id)) kinds.set(a.type, (kinds.get(a.type) ?? 0) + 1);
  const NAMES: Record<string, string> = { PipeSegment: 'pipes', Conduit: 'conduits', Fixture: 'fixtures', Device: 'electrical points', Circuit: 'circuits', Feature: 'features', Slab: 'slabs', Beam: 'beams', Column: 'columns', Footing: 'footings' };
  for (const [k, n] of kinds) out.push(`${n} ${NAMES[k] ?? k} updated to follow`);
  if (JSON.stringify(before.assumptions ?? {}) !== JSON.stringify(after.assumptions ?? {})) out.push('Engineering assumptions changed');
  return out;
}

export interface CheckChange { id: string; title: string; before: CheckResult['status'] | 'none'; after: CheckResult['status'] | 'none' }

/** Checks whose status changes (new, gone, or a different status). */
export function checkChanges(before: CheckResult[], after: CheckResult[]): CheckChange[] {
  const a = new Map(before.map((c) => [c.id, c])), b = new Map(after.map((c) => [c.id, c]));
  const out: CheckChange[] = [];
  for (const [id, c] of b) { const o = a.get(id); if (!o || o.status !== c.status) out.push({ id, title: c.title, before: o?.status ?? 'none', after: c.status }); }
  for (const [id, c] of a) if (!b.has(id)) out.push({ id, title: c.title, before: c.status, after: 'none' });
  return out;
}

export interface DryRun {
  ok: boolean;
  steps: { summary: string; error?: string }[];
  diff: string[];
  checks: CheckChange[];
  /** The model after the commands (not applied anywhere until the caller runs `commands`). */
  result: Project;
  commands: Command[];
}

/** Apply a list of commands to a copy of the model. Nothing changes in the app until the caller applies `commands`. */
export function dryRun(p: Project, calls: CommandCall[], opt: { checks?: boolean } = {}): DryRun {
  let cur = p;
  const steps: DryRun['steps'] = [];
  const commands: Command[] = [];
  let ok = true;
  for (const call of calls) {
    try {
      const { cmd, summary } = compile(cur, call);
      cur = cmd.apply(cur);
      commands.push(cmd);
      steps.push({ summary });
    } catch (e) {
      ok = false;
      steps.push({ summary: call.name, error: e instanceof Error ? e.message : String(e) });
      break;
    }
  }
  const result = cur;
  // one undoable step that replays the calls on whatever model it is applied to
  const all: Command[] = ok && commands.length
    ? [{ label: steps.map((s) => s.summary).join(' · '), apply: (q: Project) => calls.reduce((m, c) => compile(m, c).cmd.apply(m), q) }]
    : [];
  return {
    ok, steps, diff: describeDiff(p, result), result, commands: all,
    checks: opt.checks === false ? [] : checkChanges(runChecks(p), runChecks(result)),
  };
}
