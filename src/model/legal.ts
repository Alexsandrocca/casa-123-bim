// The legal notice every sheet and export carries (P0 §7), in both languages.
export const LEGAL = {
  'pt-BR': 'Estudo preliminar — deve ser revisado e assinado por profissional habilitado (ART/RRT).',
  en: 'Preliminary design — must be reviewed and signed by a licensed professional (ART/RRT).',
} as const;

/** Comment lines for the top of a text export (CSV). */
export const legalCsvLines = () => [`# ${LEGAL['pt-BR']}`, `# ${LEGAL.en}`];

/** File name start for exports: the project name as a slug (e.g. casa-123), then the version. */
export const exportName = (p: { meta: { project: string; versionId: string } }, what: string) =>
  `${p.meta.project.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project'}-${p.meta.versionId}-${what}`;
