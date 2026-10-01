// Regenerates model/casa-123.json (Version 2) and model/casa-123-v1.json (Version 1)
// from docs/reference. Run with: npm run import-model
import { readFileSync, writeFileSync } from 'node:fs';
import { placeV3Plumbing } from '../src/model/plumbing/place';
import { addSolar, placeV3Electrical } from '../src/model/electrical/place';
import { withElectrical } from '../src/model/electrical/design';
import { withPlumbing } from '../src/model/plumbing/route';
import { addServiceSpaces, hostV3 } from '../src/model/mep/defaults';
import { syncThickness } from '../src/model/eng/commands';
import { V1_NOTE, V1_STAIRS, V2_NOTE, V2_STAIRS, V3_NOTE, addV3Front, deriveV3, extractBase1, importPlan, type SourceLevels, type SourcePlan } from '../src/model/importer';

const ref = (f: string) => readFileSync(new URL(`../docs/reference/${f}`, import.meta.url), 'utf8');
const out = (f: string, data: unknown) => writeFileSync(new URL(`../model/${f}`, import.meta.url), JSON.stringify(data, null, 1) + '\n');

const v2src = JSON.parse(ref('plan-v2.json')) as {
  plan: SourcePlan;
  overlays: Record<string, { plumb: [string, number, number, string][]; elec: (string | number)[][] }>;
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
// Spec 08: every wall takes the thickness of its assembly (the retaining walls become 0.26 m: 25 cm concrete + membranes)
const v2 = syncThickness(importPlan(v2src.plan, {
  versionId: 'v2', version: 'Version 2', note: V2_NOTE,
  source: 'docs/reference/plan-v2.json (Casa 123 studio export, 2026-09-29)',
  gridX: v2src.meta.structure.steel_grid_x, gridY: [0, 5, 8.5, 12.6, 15],
  stairs: V2_STAIRS, ...common,
}));
out('casa-123.json', v2);

const v1 = syncThickness(importPlan(extractBase1(ref('prototype-studio.html')), {
  versionId: 'v1', version: 'Version 1', note: V1_NOTE,
  source: 'docs/reference/prototype-studio.html (BASE1)',
  gridX: [0, 2.4, 5.4, 8.6], gridY: [0, 5, 8.5, 13.1, 15],
  stairs: V1_STAIRS, ...common,
}));
out('casa-123-v1.json', v1);

const v2overlays = v2src.overlays;
// Version 3 (spec 02b): garage out, carport in front, south passage 1.50 m.
// Spec 04b: service spaces first, then every fixture and device on its host, then the routers (plumbing before electrical).
const v3base = addServiceSpaces(syncThickness(addV3Front(importPlan(deriveV3(v2src.plan), {
  versionId: 'v3', version: 'Version 3', note: V3_NOTE,
  source: 'Version 2 (docs/reference/plan-v2.json) with spec 02b: garage out, carport in front',
  gridX: v2src.meta.structure.steel_grid_x, gridY: [1, 5, 8.5, 12.6, 15],
  stairs: V2_STAIRS, houseOriginX: 1.5, ...common,
}))));
const t0 = Date.now();
const v3 = withElectrical(withPlumbing(addSolar(hostV3(placeV3Electrical(placeV3Plumbing(v3base, v2overlays), v2overlays as never)))));
console.log(`Version 3 routed in ${Date.now() - t0} ms`);
out('casa-123-v3.json', v3);

for (const p of [v2, v1, v3]) {
  const count = (t: string) => p.elements.filter((e) => e.type === t).length;
  if (p.mep) console.log(`  no route: ${p.mep.noRoute.length}; notes: ${p.mep.notes.join(' | ')}`);
  console.log(`${p.meta.version}: ${count('ServiceSpace')} service spaces, ${count('Space')} spaces, ${count('Wall')} walls, ${count('Opening')} openings, ${count('Slab')} slabs, ${count('Stair')} stairs, ${count('Deck')} decks, ${count('Column')} columns/piers, ${count('Beam')} beams, ${count('Footing')} footings, ${count('Fixture')} fixtures, ${count('PipeSegment')} pipes, ${count('Device')} devices, ${count('Circuit')} circuits, ${count('Conduit')} conduits`);
}
