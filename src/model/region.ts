// The place facts of a project (site.region) as the checks quote them. Unknown values read TO CONFIRM.
import type { Project } from './schema';

/** The city's building and zoning code, or TO CONFIRM. */
export const cityCode = (p: Project) => p.site.region.rules.code ?? `${p.site.region.city || 'city'} building and zoning code (TO CONFIRM)`;
/** The sanitary code of the project's state, or TO CONFIRM (the room table is the São Paulo one until then). */
export const sanitary = (p: Project) => p.site.region.rules.sanitary ?? `sanitary code for ${p.site.region.city || 'the city'} TO CONFIRM (São Paulo values used)`;
/** The water and sewer company, or a generic name. */
export const waterCompany = (p: Project) => p.site.region.water ?? 'the water company';
