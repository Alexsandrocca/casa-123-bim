// Every edit is a command: a named, pure function from one project to the next.
// The store keeps the history, so each command can be undone and redone.
import {
  E, MIN_ROOM_WIDTH, eq, findHandle, getEl, q, snap, spacesOn, wallSeg, type Orient,
} from './geometry';
import { Element as ElementSchema, isPlanLevel, planLevels, type Device, type Element, type NumFact, type Opening, type Project, type Rect, type SolarArray, type Wall } from './schema';
import { clampToHost, nextId, rebuildLevel } from './walls';
import { utilities, withPlumbing } from './plumbing/route';
import { withElectrical } from './electrical/design';
import { deviceType } from './electrical/library';
import { hostOne, withHosts } from './mep/hosting';

export interface Command {
  label: string;
  apply(p: Project): Project;
  /** A quick version for live dragging (no re-routing); the full `apply` runs when the drag ends. */
  preview?(p: Project): Project;
}

/** Spec 04b: after an edit, every fixture and device keeps (or re-finds) its host and the networks re-route. */
export function withMep(p: Project): Project {
  if (!p.elements.some((e) => e.type === 'Fixture' || e.type === 'Device')) return p;
  return withElectrical(withPlumbing(withHosts(p)));
}
/** Wrap a geometry command so the services follow it (full on apply, hosts only while dragging). */
const mep = (c: Command): Command => ({ label: c.label, apply: (p) => { const n = c.apply(p); return n === p ? p : withMep(n); }, preview: (p) => withHosts(c.apply(p)) });

export class CommandError extends Error {}

const replace = (p: Project, el: Element): Project => ({ ...p, elements: p.elements.map((e) => (e.id === el.id ? el : e)) });

function opening(p: Project, id: string): { op: Opening; host: Wall } {
  const op = getEl(p, id);
  if (!op || op.type !== 'Opening') throw new CommandError(`No door or window ${id}`);
  const host = getEl(p, op.props.host);
  if (!host || host.type !== 'Wall') throw new CommandError(`${id} has no host wall`);
  return { op, host };
}

/** Limits for moving a wall line: every cell touching it keeps at least 0.80 m. */
export function wallLimits(p: Project, level: string, o: Orient, c: number, at: number): { lo: number; hi: number; locked: boolean } | null {
  const h = findHandle(p, level, o, c, at);
  if (!h) return null;
  let lo = -1e9, hi = 1e9;
  for (const s of spacesOn(p, level)) {
    if (!h.spaceIds.includes(s.id)) continue;
    for (const cell of s.props.cells) {
      if (!inSpan(cell, o, h.a, h.b)) continue;
      if (o === 'v') {
        if (eq(cell.x1, c)) lo = Math.max(lo, cell.x0 + MIN_ROOM_WIDTH);
        if (eq(cell.x0, c)) hi = Math.min(hi, cell.x1 - MIN_ROOM_WIDTH);
      } else {
        if (eq(cell.y1, c)) lo = Math.max(lo, cell.y0 + MIN_ROOM_WIDTH);
        if (eq(cell.y0, c)) hi = Math.min(hi, cell.y1 - MIN_ROOM_WIDTH);
      }
    }
  }
  return { lo, hi, locked: h.locked };
}

const inSpan = (cell: Rect, o: Orient, a: number, b: number) =>
  o === 'v' ? cell.y0 >= a - E && cell.y1 <= b + E : cell.x0 >= a - E && cell.x1 <= b + E;

/**
 * Move an inside wall (a line between rooms) to a new position, resizing the rooms on both sides.
 * `at` is any point along the line, used to pick the right run when a line has several.
 */
export function moveWall(level: string, o: Orient, c: number, at: number, to: number): Command {
  return mep({
    label: 'Move wall',
    apply(p) {
      const h = findHandle(p, level, o, c, at);
      if (!h) throw new CommandError('There is no wall there.');
      if (h.locked) throw new CommandError('That wall belongs to the stair core, which stays fixed.');
      const lim = wallLimits(p, level, o, c, at)!;
      const nc = q(Math.min(Math.max(snap(to), lim.lo), lim.hi));
      if (eq(nc, c)) return p;
      const elements = p.elements.map((e) => {
        if (e.type !== 'Space' || e.level !== level || !h.spaceIds.includes(e.id)) return e;
        const cells = e.props.cells.map((cell) => {
          if (!inSpan(cell, o, h.a, h.b)) return cell;
          const n = { ...cell };
          if (o === 'v') { if (eq(n.x0, c)) n.x0 = nc; if (eq(n.x1, c)) n.x1 = nc; }
          else { if (eq(n.y0, c)) n.y0 = nc; if (eq(n.y1, c)) n.y1 = nc; }
          return n;
        });
        return { ...e, props: { ...e.props, cells } };
      });
      return rebuildLevel({ ...p, elements }, level, { o, c, a: h.a, b: h.b, to: nc });
    },
  });
}

/** Slide a door or window along its wall. `start` is the absolute coordinate of its near edge. */
export function moveOpening(id: string, start: number): Command {
  return mep({
    label: 'Move opening',
    apply(p) {
      const { op, host } = opening(p, id);
      const offset = snap(start) - wallSeg(host).a;
      if (eq(offset, op.props.offset)) return p;
      const moved = { ...op, props: { ...op.props, offset: q(offset) } };
      return replace(p, { ...moved, props: clampToHost(moved, host) });
    },
  });
}

export const DOOR_MIN = 0.6, WINDOW_MIN = 0.4;
export const doorMax = (op: Opening) => (op.props.kind === 'garage' ? 6 : 2.4);

/** Change the width. Doors keep 0.60–2.40 m (garage up to 6 m), windows at least 0.40 m. */
export function resizeOpening(id: string, width: number): Command {
  return mep({
    label: 'Resize opening',
    apply(p) {
      const { op, host } = opening(p, id);
      let w = q(width);
      if (op.props.role === 'door') w = Math.min(Math.max(w, DOOR_MIN), doorMax(op));
      else w = Math.max(w, WINDOW_MIN);
      const next = { ...op, props: { ...op.props, width: w } };
      return replace(p, { ...next, props: clampToHost(next, host) });
    },
  });
}

export function setOpeningSize(id: string, patch: { height?: number; sill?: number }): Command {
  return mep({
    label: 'Change opening',
    apply(p) {
      const { op } = opening(p, id);
      const height = patch.height !== undefined ? q(Math.min(Math.max(patch.height, 0.2), 3)) : op.props.height;
      const sill = patch.sill !== undefined ? q(Math.min(Math.max(patch.sill, 0), 2.5)) : op.props.sill;
      return replace(p, { ...op, props: { ...op.props, height, sill } });
    },
  });
}

export function flipOpening(id: string): Command {
  return mep({
    label: 'Flip door swing',
    apply(p) {
      const { op } = opening(p, id);
      return replace(p, { ...op, props: { ...op.props, swing: op.props.swing === 1 ? -1 : 1 } });
    },
  });
}

export function deleteOpening(id: string): Command {
  return mep({
    label: 'Delete opening',
    apply(p) {
      opening(p, id);
      return { ...p, elements: p.elements.filter((e) => e.id !== id) };
    },
  });
}

/** The id the next opening on this level will get. */
export const nextOpeningId = (p: Project, level: string, role: 'door' | 'window') =>
  nextId(p, `${level}-${role === 'door' ? 'door' : 'win'}`);

/** Add a door (0.80 m) or window (1.20 m) centred at `center` along a wall. */
export function addOpening(id: string, wallId: string, center: number, role: 'door' | 'window'): Command {
  return mep({
    label: role === 'door' ? 'Add door' : 'Add window',
    apply(p) {
      const host = getEl(p, wallId);
      if (!host || host.type !== 'Wall') throw new CommandError('Doors and windows go on a wall.');
      if (getEl(p, id)) throw new CommandError(`${id} already exists`);
      const s = wallSeg(host);
      const width = role === 'door' ? 0.8 : 1.2;
      const op: Opening = {
        id, type: 'Opening', level: host.level, tags: [],
        props: role === 'door'
          ? { host: wallId, role, kind: 'door', offset: q(snap(center - width / 2) - s.a), width, height: 2.1, sill: 0, swing: 1 }
          : { host: wallId, role, kind: 'window', offset: q(snap(center - width / 2) - s.a), width, height: 1.3, sill: 1.0, swing: 1 },
      };
      return { ...p, elements: [...p.elements, { ...op, props: clampToHost(op, host) }] };
    },
  });
}

export function renameSpace(id: string, name: string): Command {
  return {
    label: 'Rename room',
    apply(p) {
      const s = getEl(p, id);
      if (!s || s.type !== 'Space') throw new CommandError(`No room ${id}`);
      const n = name.trim();
      if (!n) throw new CommandError('A room needs a name.');
      if (n === s.props.name) return p;
      if (spacesOn(p, s.level).some((o) => o.id !== id && o.props.name.toLowerCase() === n.toLowerCase())) {
        throw new CommandError(`There is already a room called “${n}” on this floor.`);
      }
      return replace(p, { ...s, props: { ...s.props, name: n } });
    },
  };
}

export function setWallThickness(id: string, t: number): Command {
  return mep({
    label: 'Change wall thickness',
    apply(p) {
      const w = getEl(p, id);
      if (!w || w.type !== 'Wall') throw new CommandError(`No wall ${id}`);
      return replace(p, { ...w, props: { ...w.props, thickness: q(Math.min(Math.max(t, 0.05), 1)) } });
    },
  });
}

/** Put one floor back to the original version. Other floors keep their edits. */
export function resetLevel(level: string, original: Project): Command {
  return {
    label: 'Reset floor',
    apply(p) {
      const keep = p.elements.filter((e) => e.level !== level || !['Space', 'Wall', 'Opening'].includes(e.type));
      const back = original.elements.filter((e) => e.level === level && ['Space', 'Wall', 'Opening'].includes(e.type));
      return { ...p, elements: [...keep, ...back] };
    },
  };
}

/** P1: change the lot, the address or the city facts (the lot wizard). The checks re-run; the services re-route to the
 *  new street and supply. The house is never moved. */
export function setSite(patch: Partial<Pick<Project['site'], 'address' | 'lot' | 'region'>>): Command {
  return {
    label: 'Change the lot',
    apply(p) {
      const site = { ...p.site, ...patch };
      if (JSON.stringify(site) === JSON.stringify(p.site)) return p;
      return withMep({ ...p, site });
    },
  };
}

export function replaceProject(next: Project): Command {
  return { label: 'Open model', apply: () => next };
}

/** Change properties of any element; the result must still be a valid element. */
export function setElementProps(id: string, patch: Record<string, unknown>, label = 'Change properties'): Command {
  return {
    label,
    apply(p) {
      const e = getEl(p, id);
      if (!e) throw new CommandError(`No element ${id}`);
      const parsed = ElementSchema.safeParse({ ...e, props: { ...e.props, ...patch } });
      if (!parsed.success) throw new CommandError('That value is not allowed here.');
      return replace(p, parsed.data);
    },
  };
}

/** Delete a wall (spec 04b). Its doors and windows go with it; the items it hosted stay where they are and are
 *  flagged "unhosted" by the checks until they are moved onto another wall. */
export function deleteWall(id: string): Command {
  return {
    label: 'Delete wall',
    apply(p) {
      const w = getEl(p, id);
      if (!w || w.type !== 'Wall') throw new CommandError(`No wall ${id}`);
      return withMep({ ...p, elements: p.elements.filter((e) => e.id !== id && !(e.type === 'Opening' && e.props.host === id)) });
    },
  };
}

/** Change a shaft, plenum or roof zone (spec 04b): move or resize it, or change a lowered ceiling's depth. */
export function setServiceSpace(id: string, patch: { rect?: Rect; depth?: number }): Command {
  return {
    label: 'Change service space',
    apply(p) {
      const e = getEl(p, id);
      if (!e || e.type !== 'ServiceSpace') throw new CommandError(`No service space ${id}`);
      if (patch.depth !== undefined && (patch.depth < 0.1 || patch.depth > 0.8)) throw new CommandError('A lowered ceiling is 0.10–0.80 m deep.');
      if (patch.rect && (patch.rect.x1 - patch.rect.x0 < 0.15 || patch.rect.y1 - patch.rect.y0 < 0.15)) throw new CommandError('At least 0.15 m each way.');
      return withMep(replace(p, { ...e, props: { ...e.props, ...patch } }));
    },
  };
}

/* ---------- plumbing (spec 03) ---------- */

/** Move a fixture to a new plan position (5 cm steps); the pipes re-route. */
export function moveFixture(id: string, x: number, y: number): Command {
  return {
    label: 'Move fixture',
    apply(p) {
      const f = getEl(p, id);
      if (!f || f.type !== 'Fixture') throw new CommandError(`No fixture ${id}`);
      if (f.tags.includes('auto')) throw new CommandError('Inspection boxes are placed by the router. Move the pipes or fixtures instead.');
      // snap only what moved, so a fixture moved along one axis keeps its other coordinate
      const at: [number, number] = [eq(x, f.props.at[0]) ? f.props.at[0] : snap(x), eq(y, f.props.at[1]) ? f.props.at[1] : snap(y)];
      if (eq(at[0], f.props.at[0]) && eq(at[1], f.props.at[1])) return p;
      if (isPlanLevel(p, f.level) && LIBRARY_ROOM_KINDS.has(f.props.kind)
        && !spacesOn(p, f.level).some((s) => s.props.cells.some((c) => at[0] > c.x0 && at[0] < c.x1 && at[1] > c.y0 && at[1] < c.y1))) {
        throw new CommandError('A fixture has to stay inside a room.');
      }
      // it snaps to a wall face of its room (or the floor), then the pipes and conduits follow
      const moved = hostOne(p, { ...f, props: { ...f.props, at } }, true);
      return withElectrical(withPlumbing(replace(p, moved)));
    },
    preview(p) {
      const f = getEl(p, id);
      if (!f || f.type !== 'Fixture') return p;
      return replace(p, hostOne(p, { ...f, props: { ...f.props, at: [snap(x), snap(y)] } }, true));
    },
  };
}
const LIBRARY_ROOM_KINDS = new Set(['toilet', 'basin', 'shower', 'kitchen-sink', 'laundry-tank', 'washer', 'dishwasher', 'floor-drain', 'stack', 'lift-station', 'backflow-valve']);

/** Change a pipe's DN or material by hand; the router keeps it. */
export function setPipe(id: string, patch: { dn?: number; material?: 'PVC' | 'PPR' | 'CPVC' }): Command {
  return {
    label: 'Change pipe',
    apply(p) {
      const s = getEl(p, id);
      if (!s || s.type !== 'PipeSegment') throw new CommandError(`No pipe ${id}`);
      return replace(p, { ...s, props: { ...s.props, ...patch, manual: true } });
    },
  };
}

/** Street services: sewer depth (from the water company), rainfall intensity… The checks recompute; the pipes re-route. */
export function setUtilities(patch: Partial<{ sewerDepth: number; sewerOffset: number; waterMainDepth: number; rainIntensity: number }>): Command {
  return {
    label: 'Change street services',
    apply(p) {
      const u = { ...utilities(p), ...patch };
      if (u.sewerDepth < 0.5 || u.sewerDepth > 8) throw new CommandError('The sewer depth should be between 0.5 and 8 m.');
      if (u.rainIntensity < 50 || u.rainIntensity > 400) throw new CommandError('Rainfall intensity should be between 50 and 400 mm/h.');
      const sv = p.site.lot.services, today = new Date().toISOString().slice(0, 10);
      const set = (f: NumFact, v: number | undefined): NumFact => (v === undefined || v === f.value ? f : { ...f, value: v, date: today });
      const services = {
        ...sv,
        sewer: { ...sv.sewer, depth: set(sv.sewer.depth, patch.sewerDepth), offset: u.sewerOffset },
        water: { ...sv.water, depth: set(sv.water.depth, patch.waterMainDepth) },
      };
      return withPlumbing({ ...p, site: { ...p.site, lot: { ...p.site.lot, services }, region: { ...p.site.region, rainIntensity: u.rainIntensity } } });
    },
  };
}

/* ---------- electrical (spec 04) ---------- */

/** The id the next device of a kind will get. */
export const nextDeviceId = (p: Project, kind: string) => nextId(p, `dev-${kind}`);

/** Add an electrical device at a plan point on a floor; circuits, conduits and sizes update. */
export function addDevice(id: string, kind: string, level: string, at: [number, number], name?: string): Command {
  return {
    label: 'Add electrical point',
    apply(p) {
      if (getEl(p, id)) throw new CommandError(`${id} already exists`);
      const t = deviceType(kind);
      const floor = p.levels.find((l) => l.id === level)?.elevation ?? 0;
      const room = spacesOn(p, level).find((s) => s.props.cells.some((c) => at[0] >= c.x0 && at[0] <= c.x1 && at[1] >= c.y0 && at[1] <= c.y1));
      if (!room && isPlanLevel(p, level)) throw new CommandError('Put the point inside a room.');
      const d: Device = {
        id, type: 'Device', level, tags: [],
        props: { kind, name: name ?? `${t.label} · ${room?.props.name ?? level}`, at: [snap(at[0]), snap(at[1])], z: q(floor + t.height), power: t.power },
      };
      return withElectrical({ ...p, elements: [...p.elements, hostOne(p, d, true)] });
    },
  };
}

export function moveDevice(id: string, x: number, y: number): Command {
  return {
    label: 'Move electrical point',
    apply(p) {
      const d = getEl(p, id);
      if (!d || d.type !== 'Device') throw new CommandError(`No device ${id}`);
      const at: [number, number] = [eq(x, d.props.at[0]) ? d.props.at[0] : snap(x), eq(y, d.props.at[1]) ? d.props.at[1] : snap(y)];
      if (eq(at[0], d.props.at[0]) && eq(at[1], d.props.at[1])) return p;
      // a wall point snaps to the nearest legal place on a wall face of its room; then its circuit re-routes
      return withElectrical(replace(p, hostOne(p, { ...d, props: { ...d.props, at, hostWallId: undefined, hostId: d.props.hostId === 'post' ? 'post' : undefined } }, true)));
    },
    preview(p) {
      const d = getEl(p, id);
      if (!d || d.type !== 'Device') return p;
      return replace(p, hostOne(p, { ...d, props: { ...d.props, at: [snap(x), snap(y)], hostWallId: undefined } }, true));
    },
  };
}

export function deleteDevice(id: string): Command {
  return {
    label: 'Delete electrical point',
    apply(p) {
      const d = getEl(p, id);
      if (!d || d.type !== 'Device') throw new CommandError(`No device ${id}`);
      if (['panel', 'sub-panel'].includes(d.props.kind)) throw new CommandError('Panels cannot be deleted.');
      return withElectrical({ ...p, elements: p.elements.filter((e) => e.id !== id) });
    },
  };
}

/** Change a device's properties (power, camera bearing and lens, or its circuit by hand). */
export function setDevice(id: string, patch: Partial<Device['props']>): Command {
  return {
    label: 'Change electrical point',
    apply(p) {
      const d = getEl(p, id);
      if (!d || d.type !== 'Device') throw new CommandError(`No device ${id}`);
      const next = { ...d.props, ...patch };
      if (patch.circuit !== undefined) next.manualCircuit = true;
      if (next.power < 0) throw new CommandError('Power cannot be negative.');
      if (next.lensMm !== undefined && (next.lensMm < 1.5 || next.lensMm > 12)) throw new CommandError('Lens between 1.5 and 12 mm.');
      return withElectrical(replace(p, { ...d, props: next }));
    },
  };
}

/** Choose a cable section by hand (the checks then tell if it is enough). */
export function setCircuitSection(id: string, section: number): Command {
  return {
    label: 'Change cable section',
    apply(p) {
      const c = getEl(p, id);
      if (!c || c.type !== 'Circuit') throw new CommandError(`No circuit ${id}`);
      return withElectrical(replace(p, { ...c, props: { ...c.props, manualSection: section } }));
    },
  };
}

/** Solar options: battery (adds the battery and the essential-loads panel), inverter size, module count, tilt. */
export function setSolar(patch: Partial<Pick<SolarArray['props'], 'batteryKwh' | 'inverterKw' | 'modules' | 'tilt' | 'setback'>>): Command {
  return {
    label: 'Change solar',
    apply(p) {
      const a = p.elements.find((e): e is SolarArray => e.type === 'SolarArray');
      if (!a) throw new CommandError('This version has no solar array.');
      let next: Project = replace(p, { ...a, props: { ...a.props, ...patch } });
      const hasBattery = (patch.batteryKwh ?? a.props.batteryKwh) > 0;
      next = { ...next, elements: next.elements.filter((e) => !(e.type === 'Device' && ['battery', 'essential-panel'].includes(e.props.kind))) };
      if (hasBattery) {
        const sub = next.elements.find((e): e is Device => e.type === 'Device' && e.props.kind === 'sub-panel');
        const at: [number, number] = sub ? [sub.props.at[0], sub.props.at[1] - 0.6] : [0.12, 9.0];
        const level = sub?.level ?? planLevels(p)[0]!;
        const floor = next.levels.find((l) => l.id === level)?.elevation ?? 0;
        next = {
          ...next,
          elements: [...next.elements,
            { id: 'dev-battery-01', type: 'Device', level, tags: [], props: { kind: 'battery', name: `Battery ${patch.batteryKwh ?? a.props.batteryKwh} kWh LFP`, at: [at[0] + 0.15, at[1] - 0.6], z: floor + 0.5, power: 0 } },
            { id: 'dev-essential-panel-01', type: 'Device', level, tags: [], props: { kind: 'essential-panel', name: 'Essential-loads panel', at, z: floor + 1.5, power: 0 } }],
        };
      }
      return withElectrical(next);
    },
  };
}
