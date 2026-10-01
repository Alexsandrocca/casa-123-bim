// Bring a model saved by an older version of the app up to date.
import type { Project } from './schema';

const EDITED = ['Space', 'Wall', 'Opening'];

/**
 * Models from spec 01 have no structure: keep the family's room, wall and opening edits, take everything else from the base.
 * Models from before spec 03 have no plumbing: add the base's fixtures and pipes and the street utilities.
 */
export function migrate(p: Project, base: Project): Project {
  if (!p.elements.some((e) => e.type === 'Column')) {
    p = {
      ...base,
      elements: [...p.elements.filter((e) => EDITED.includes(e.type)), ...base.elements.filter((e) => !EDITED.includes(e.type))],
    };
  }
  const missing = ['Fixture', 'PipeSegment', 'Device', 'Circuit', 'Conduit', 'SolarArray'].filter((t) => !p.elements.some((e) => e.type === t) && base.elements.some((e) => e.type === t));
  // Spec 04 regenerated the 02b devices: if the saved model has only those two, take the base's devices.
  const onlyOldDevices = p.elements.filter((e) => e.type === 'Device').length <= 2 && base.elements.filter((e) => e.type === 'Device').length > 2;
  if (onlyOldDevices && !missing.includes('Device')) missing.push('Device');
  if (missing.length || (!p.site.utilities && base.site.utilities)) {
    p = {
      ...p,
      site: { ...p.site, utilities: p.site.utilities ?? base.site.utilities },
      elements: [...p.elements.filter((e) => !missing.includes(e.type)), ...base.elements.filter((e) => missing.includes(e.type))],
    };
  }
  return p;
}

/** Before validation: reshape data saved by older versions of the app (spec 02b devices had at = [x, y, z]). */
export function upgradeRaw(data: unknown): unknown {
  const d = data as { elements?: { type?: string; props?: Record<string, unknown> }[] };
  if (!d || !Array.isArray(d.elements)) return data;
  return {
    ...d,
    elements: d.elements.map((e) => {
      if (e.type !== 'Device' || !e.props || !Array.isArray(e.props.at) || e.props.at.length !== 3) return e;
      const [x, y, z] = e.props.at as number[];
      const power = typeof e.props.powerKw === 'number' ? e.props.powerKw * 1000 : 0;
      const { powerKw: _k, host: _h, space: _s, ...rest } = e.props;
      return { ...e, props: { ...rest, at: [x, y], z, power } };
    }),
  };
}
