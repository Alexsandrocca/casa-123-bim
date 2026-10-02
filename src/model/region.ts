// The place facts of a project (site.region, and since P1 site.lot) as the checks quote them. Unknown values read TO CONFIRM.
import type { Project, Supply } from './schema';

/** The city's building and zoning code, or TO CONFIRM. */
export const cityCode = (p: Project) => p.site.region.rules.code ?? `${p.site.region.city || 'city'} building and zoning code (TO CONFIRM)`;
/** The sanitary code of the project's state, or TO CONFIRM (the room table is the São Paulo one until then). */
export const sanitary = (p: Project) => p.site.region.rules.sanitary ?? `sanitary code for ${p.site.region.city || 'the city'} TO CONFIRM (São Paulo values used)`;
/** The water and sewer company (P1: whom the lot says to ask). */
export const waterCompany = (p: Project) => p.site.lot.services.sewer.ask;
/** The electricity company (P1: whom the lot says to ask). */
export const powerCompany = (p: Project) => p.site.lot.services.power.ask;
/** The lot's electricity supply; while it is not known, the usual 127/220 V three-phase (TO CONFIRM). */
export const supplyOf = (p: Pick<Project, 'site'>): Supply => p.site.lot.services.power.supply.value ?? { phaseV: 127, lineV: 220, phases: 3 };
/** Has the electricity company confirmed the supply? */
export const supplyConfirmed = (p: Pick<Project, 'site'>) => p.site.lot.services.power.supply.status === 'confirmed';
