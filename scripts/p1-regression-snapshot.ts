// Writes tests/fixtures/p1-regression: the old site of each test model and what the engines produced for it before P1.
// Run once, with the code from before P1: npx tsx scripts/p1-regression-snapshot.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { parseProject } from '../src/model/schema';
import { digest } from '../tests/regression-digest';

const MODELS = { 'casa-v1': 'projects/casa-123/originals/v1.json', 'casa-v2': 'projects/casa-123/originals/v2.json', 'casa-v3': 'projects/casa-123/originals/v3.json', 'flat-lot': 'tests/fixtures/flat-lot/originals/v1.json' };
const out: Record<string, unknown> = {}, sites: Record<string, unknown> = {};
for (const [k, f] of Object.entries(MODELS)) {
  const raw = JSON.parse(readFileSync(f, 'utf8'));
  sites[k] = raw.site;
  out[k] = digest(parseProject(raw));
  console.log(k, 'done');
}
writeFileSync('tests/fixtures/p1-regression/sites-before.json', JSON.stringify(sites, null, 1) + '\n');
writeFileSync('tests/fixtures/p1-regression/before.json', JSON.stringify(out, null, 1) + '\n');
