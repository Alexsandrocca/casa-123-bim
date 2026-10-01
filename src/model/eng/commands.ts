// Spec 08 commands: assemblies, assumptions, the structural grid, proposed sizes, features and the cost snapshot.
// All undoable, like every other edit.
import { CommandError, withMep, type Command } from '../commands';
import { eq, getEl, q, snap } from '../geometry';
import type { Element, Feature, FeatureKind, Project, Slab, Wall } from '../schema';
import { Element as ElementSchema } from '../schema';
import { generateStructure } from '../structure';
import { assumption } from './assumptions';
import { assemblyById, assemblyOf, optionsFor, useOf, wallThicknessOf, type AssemblyUse } from './assemblies';
import { makeFeature, type PlaceTarget } from './features';
import { frame } from './frame';
import { costEstimate } from './cost';

const replaceAll = (p: Project, els: Map<string, Element>): Project => ({ ...p, elements: p.elements.map((e) => els.get(e.id) ?? e) });

/** Walls take the thickness of their assembly; slabs keep their structural depth. Only changed walls are replaced. */
export function syncThickness(p: Project): Project {
  const changed = new Map<string, Element>();
  for (const e of p.elements) {
    if (e.type !== 'Wall') continue;
    const t = q(wallThicknessOf(assemblyOf(p, e)));
    if (!eq(t, e.props.thickness)) changed.set(e.id, { ...e, props: { ...e.props, thickness: t } });
  }
  return changed.size ? replaceAll(p, changed) : p;
}

/** Change the assembly of one wall or slab. Walls change thickness, so the services re-route. */
export function setAssembly(id: string, assemblyId: string): Command {
  return {
    label: 'Change assembly',
    apply(p) {
      const e = getEl(p, id);
      if (!e || (e.type !== 'Wall' && e.type !== 'Slab')) throw new CommandError('Only walls, floors and roofs have an assembly.');
      const a = assemblyById(assemblyId);
      if (!a || !optionsFor(useOf(e)).includes(a)) throw new CommandError('That assembly does not suit this element.');
      if (assemblyOf(p, e).id === assemblyId && e.props.assemblyId === assemblyId) return p;
      const next = replaceAll(p, new Map([[id, { ...e, props: { ...e.props, assemblyId } } as Element]]));
      const synced = syncThickness(next);
      return synced === next ? next : withMep(synced);
    },
  };
}

/** Change the default assembly of a use (e.g. all exterior walls). Elements with their own assembly keep it. */
export function setDefaultAssembly(use: AssemblyUse, assemblyId: string): Command {
  return {
    label: 'Change default assembly',
    apply(p) {
      const a = assemblyById(assemblyId);
      if (!a || !optionsFor(use).includes(a)) throw new CommandError('That assembly does not suit this use.');
      if ((p.engineering?.assemblyDefaults?.[use] ?? '') === assemblyId) return p;
      const next: Project = { ...p, engineering: { ...p.engineering, assemblyDefaults: { ...p.engineering?.assemblyDefaults, [use]: assemblyId } } };
      const synced = syncThickness(next);
      return synced === next ? next : withMep(synced);
    },
  };
}

/** Change one engineering assumption (null leaves it empty: TO CONFIRM). Every estimate updates. */
export function setAssumption(key: string, value: number | null): Command {
  return {
    label: 'Change assumption',
    apply(p) {
      const a = assumption(key);
      if (!a) throw new CommandError(`Unknown assumption ${key}`);
      if (value !== null && (!Number.isFinite(value) || (a.min !== undefined && value < a.min) || (a.max !== undefined && value > a.max))) {
        throw new CommandError(`${a.label}: between ${a.min} and ${a.max} ${a.unit}.`);
      }
      if ((p.assumptions?.[key] ?? a.value) === value) return p;
      return { ...p, assumptions: { ...p.assumptions, [key]: value } };
    },
  };
}

/** Move an inside line of the structural grid. The frame is regenerated (sections kept where a member stays) and the services re-route. */
export function moveGridLine(axis: 'x' | 'y', index: number, to: number): Command {
  return {
    label: 'Move grid line',
    apply(p) {
      const g = [...p.grid[axis]];
      if (index <= 0 || index >= g.length - 1) throw new CommandError('The outer grid lines follow the building outline and stay fixed.');
      const v = q(snap(to));
      const lo = g[index - 1]! + 1.0, hi = g[index + 1]! - 1.0;
      if (v < lo - 1e-6 || v > hi + 1e-6) throw new CommandError(`Keep at least 1.00 m to the next grid lines (${lo.toFixed(2)}–${hi.toFixed(2)} m).`);
      if (eq(v, g[index]!)) return p;
      g[index] = v;
      return withMep(regenerate({ ...p, grid: { ...p.grid, [axis]: g } }));
    },
  };
}

/** Rebuild the generated frame from the grid, keeping the section of any member that stays in place. */
export function regenerate(p: Project): Project {
  const old = p.elements.filter((e) => e.tags.includes('generated') && ['Beam', 'Column', 'Footing'].includes(e.type));
  const fresh = generateStructure(p).map((e) => {
    if (e.type === 'Beam') {
      const o = old.find((x) => x.type === 'Beam' && eq(x.props.elevation, e.props.elevation) && eq(x.props.start[0], e.props.start[0]) && eq(x.props.start[1], e.props.start[1]) && eq(x.props.end[0], e.props.end[0]) && eq(x.props.end[1], e.props.end[1]));
      return o?.type === 'Beam' ? { ...e, props: { ...e.props, profile: o.props.profile } } : e;
    }
    if (e.type === 'Column') {
      const o = old.find((x) => x.type === 'Column' && x.props.kind === e.props.kind && eq(x.props.at[0], e.props.at[0]) && eq(x.props.at[1], e.props.at[1]));
      return o?.type === 'Column' ? { ...e, props: { ...e.props, profile: o.props.profile } } : e;
    }
    return e;
  });
  const keep = p.elements.filter((e) => !old.includes(e));
  return { ...p, elements: [...keep, ...fresh] };
}

/** Use the proposed sections and footing sizes everywhere (the services re-route around the new sizes). */
export function applyProposedSizes(): Command {
  return {
    label: 'Use the proposed sizes',
    apply(p) {
      const f = frame(p);
      const changed = new Map<string, Element>();
      for (const b of f.beams) if (b.proposed && b.proposed.name !== b.beam.props.profile) changed.set(b.beam.id, { ...b.beam, props: { ...b.beam.props, profile: b.proposed.name } });
      for (const c of f.columns) if (c.proposed && c.proposed.name !== c.col.props.profile) changed.set(c.col.id, { ...c.col, props: { ...c.col.props, profile: c.proposed.name } });
      for (const r of f.footings) {
        const e = r.footing, cx = (e.props.rect.x0 + e.props.rect.x1) / 2, cy = (e.props.rect.y0 + e.props.rect.y1) / 2;
        const rect = { x0: q(cx - r.B / 2), x1: q(cx + r.B / 2), y0: q(cy - r.B / 2), y1: q(cy + r.B / 2) };
        if (!eq(rect.x0, e.props.rect.x0) || !eq(rect.y0, e.props.rect.y0) || !eq(rect.x1, e.props.rect.x1) || !eq(r.h, e.props.depth)) changed.set(e.id, { ...e, props: { ...e.props, rect, depth: r.h } });
      }
      if (!changed.size) return p;
      return withMep(replaceAll(p, changed));
    },
  };
}

/** Place a feature. */
export function addFeature(kind: FeatureKind, target: PlaceTarget): Command {
  return {
    label: 'Add feature',
    apply(p) {
      const f = makeFeature(p, kind, target);
      if (typeof f === 'string') throw new CommandError(f);
      const parsed = ElementSchema.safeParse(f);
      if (!parsed.success) throw new CommandError('That feature cannot go there.');
      return { ...p, elements: [...p.elements, parsed.data] };
    },
  };
}

/** Change a feature's properties or parameters. */
export function setFeature(id: string, patch: Partial<Omit<Feature['props'], 'params'>> & { params?: Record<string, number | string | boolean> }): Command {
  return {
    label: 'Change feature',
    apply(p) {
      const f = getEl(p, id);
      if (!f || f.type !== 'Feature') throw new CommandError(`No feature ${id}`);
      const next = { ...f, props: { ...f.props, ...patch, params: { ...f.props.params, ...patch.params } } };
      for (const [k, v] of Object.entries(next.props.params)) if (typeof v === 'number' && (!Number.isFinite(v) || v < 0)) throw new CommandError(`${k} cannot be negative.`);
      const parsed = ElementSchema.safeParse(next);
      if (!parsed.success) throw new CommandError('That value is not allowed here.');
      return { ...p, elements: p.elements.map((e) => (e.id === id ? parsed.data : e)) };
    },
  };
}

export function deleteFeature(id: string): Command {
  return {
    label: 'Delete feature',
    apply(p) {
      if (getEl(p, id)?.type !== 'Feature') throw new CommandError(`No feature ${id}`);
      return { ...p, elements: p.elements.filter((e) => e.id !== id) };
    },
  };
}

/** Keep today's cost estimate to compare the next options against. */
export function saveCostSnapshot(label: string, date: string): Command {
  return {
    label: 'Save cost snapshot',
    apply(p) {
      const c = costEstimate(p, frame(p).quantities);
      const items: Record<string, number> = {};
      for (const i of c.items) items[i.label] = Math.round(i.value);
      return { ...p, engineering: { ...p.engineering, snapshot: { date, label, total: Math.round(c.total), items } } };
    },
  };
}

export type { Slab, Wall };
