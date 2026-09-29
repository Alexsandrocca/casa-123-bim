// Bring a model saved by an older version of the app up to date.
import type { Project } from './schema';

const EDITED = ['Space', 'Wall', 'Opening'];

/** Models from spec 01 have no structure: keep the family's room, wall and opening edits, take everything else from the base. */
export function migrate(p: Project, base: Project): Project {
  if (p.elements.some((e) => e.type === 'Column')) return p;
  return {
    ...base,
    elements: [...p.elements.filter((e) => EDITED.includes(e.type)), ...base.elements.filter((e) => !EDITED.includes(e.type))],
  };
}
