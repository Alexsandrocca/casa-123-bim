// P1, run once: rewrite the committed Casa 123 models with the lot in site.lot (the engines read only that now).
// npx tsx scripts/p1-migrate-files.ts
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { upgradeRaw } from '../src/model/migrate';
import { parseProject } from '../src/model/schema';

for (const dir of ['projects/casa-123/originals', 'projects/casa-123/versions']) {
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const path = `${dir}/${f}`;
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(raw.site?.lotPolygon)) { console.log(path, 'already P1'); continue; }
    const next = upgradeRaw(raw);
    parseProject(next); // valid; written as it was (only the site changes)
    writeFileSync(path, JSON.stringify(next, null, 1) + '\n');
    console.log(path, 'migrated');
  }
}
