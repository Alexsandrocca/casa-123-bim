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
  const missing = ['Fixture', 'PipeSegment'].filter((t) => !p.elements.some((e) => e.type === t) && base.elements.some((e) => e.type === t));
  if (missing.length || (!p.site.utilities && base.site.utilities)) {
    p = {
      ...p,
      site: { ...p.site, utilities: p.site.utilities ?? base.site.utilities },
      elements: [...p.elements, ...base.elements.filter((e) => missing.includes(e.type))],
    };
  }
  return p;
}
