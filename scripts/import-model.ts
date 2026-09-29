// Regenerates model/casa-123.json (Version 2) and model/casa-123-v1.json (Version 1)
// from docs/reference. Run with: npm run import-model
import { readFileSync, writeFileSync } from 'node:fs';
import { V1_NOTE, V1_STAIRS, V2_NOTE, V2_STAIRS, extractBase1, importPlan, type SourceLevels, type SourcePlan } from '../src/model/importer';

const ref = (f: string) => readFileSync(new URL(`../docs/reference/${f}`, import.meta.url), 'utf8');
const out = (f: string, data: unknown) => writeFileSync(new URL(`../model/${f}`, import.meta.url), JSON.stringify(data, null, 1) + '\n');

const v2src = JSON.parse(ref('plan-v2.json')) as {
  plan: SourcePlan;
  meta: { levels: SourceLevels; structure: { steel_grid_x: number[]; floor_to_floor: number; clear_height: number; structure_depth: number } };
};
// Both versions share the levels and structure of plan-v2.json.
const common = {
  levels: v2src.meta.levels,
  structure: {
    floorToFloor: v2src.meta.structure.floor_to_floor,
    clearHeight: v2src.meta.structure.clear_height,
    structureDepth: v2src.meta.structure.structure_depth,
  },
};
const v2 = importPlan(v2src.plan, {
  versionId: 'v2', version: 'Version 2', note: V2_NOTE,
  source: 'docs/reference/plan-v2.json (Casa 123 studio export, 2026-09-29)',
  gridX: v2src.meta.structure.steel_grid_x, gridY: [0, 5, 8.2, 8.5, 12.6, 15],
  stairs: V2_STAIRS, ...common,
});
out('casa-123.json', v2);

const v1 = importPlan(extractBase1(ref('prototype-studio.html')), {
  versionId: 'v1', version: 'Version 1', note: V1_NOTE,
  source: 'docs/reference/prototype-studio.html (BASE1)',
  gridX: [0, 2.4, 5.4, 8.6], gridY: [0, 5, 8.5, 13.1, 15],
  stairs: V1_STAIRS, ...common,
});
out('casa-123-v1.json', v1);

for (const p of [v2, v1]) {
  const count = (t: string) => p.elements.filter((e) => e.type === t).length;
  console.log(`${p.meta.version}: ${count('Space')} spaces, ${count('Wall')} walls, ${count('Opening')} openings, ${count('Slab')} slabs, ${count('Stair')} stairs, ${count('Deck')} decks`);
}
