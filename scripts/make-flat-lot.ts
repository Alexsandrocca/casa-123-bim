// Writes tests/fixtures/flat-lot (P0): a flat 12 × 30 m lot with the street to the west (north to the left seen from the
// street), a single-storey house with 3 rooms. Run: npx tsx scripts/make-flat-lot.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { rectLot, starterModel } from '../src/model/starter';
import { regionFor } from '../src/model/cities';
import type { ProjectFile } from '../src/model/project-file';
import { lotSummary } from '../src/store';

const dir = new URL('../tests/fixtures/flat-lot/', import.meta.url);
const model = starterModel({
  project: 'Flat lot test', address: 'Rua de Teste, 10, Florianópolis/SC', region: regionFor('Florianópolis', 'SC'),
  lot: rectLot({ city: 'Florianópolis', state: 'SC', lat: -27.59, lon: -48.55, lotWidth: 12, lotDepth: 30, street: 'W', supply: { phaseV: 220, lineV: 380, phases: 3 } }),
});
const now = '2026-10-02T00:00:00.000Z';
const info: ProjectFile = {
  schema: 'casabim-project/1', id: 'flat-lot', name: 'Flat lot test', address: model.site.address, lot: lotSummary(model),
  program: {}, style: {}, versions: [{ id: 'v1', name: 'Version 1', kind: 'design', file: 'versions/v1.json', original: 'originals/v1.json', edits: 0 }],
  designVersionId: 'v1', approvedVersionId: null, stage: 'plans', language: 'pt-BR', includeInGit: false, created: now, updated: now,
};
for (const d of ['versions', 'originals']) mkdirSync(new URL(d, dir), { recursive: true });
const json = (x: unknown) => JSON.stringify(x, null, 1) + '\n';
writeFileSync(new URL('project.json', dir), json(info));
writeFileSync(new URL('versions/v1.json', dir), json(model));
writeFileSync(new URL('originals/v1.json', dir), json(model));
const count = (t: string) => model.elements.filter((e) => e.type === t).length;
console.log(`flat-lot: ${count('Space')} rooms, ${count('Wall')} walls, ${count('Opening')} openings, ${count('Column')} columns, ${count('Fixture')} fixtures, ${count('PipeSegment')} pipes, ${count('Device')} devices, ${count('Circuit')} circuits; no route: ${model.mep?.noRoute.length ?? 0}`);
