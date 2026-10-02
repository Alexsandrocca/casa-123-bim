// P1 item 0.2 (Q20 b): shorter spans for Casa 123's BIM model. A column line at x 5.00 (in the front and rear walls,
// none at the veranda edge), one column under the rear overhang at x 3.20 (on the lower-level wall line), then the
// proposed sizes that fit the structure zone. Run once: npx tsx scripts/casa-123/q20.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { parseProject } from '../../src/model/schema';
import { withMep } from '../../src/model/commands';
import { applyProposedSizes, regenerate } from '../../src/model/eng/commands';
import { frame } from '../../src/model/eng/frame';
import { runChecks } from '../../src/model/checks';

const file = 'projects/casa-123/versions/bim.json';
const before = parseProject(JSON.parse(readFileSync(file, 'utf8')));
const grid = { ...before.grid, x: [0, 3.2, 5, 8.6], skip: [[5, 15]] as [number, number][], extra: [[3.2, 13.6]] as [number, number][] };
const framed = withMep(regenerate({ ...before, grid }));
const after = applyProposedSizes().apply(framed);
const red = (p: typeof after) => { const f = frame(p); return { beams: f.beams.filter((b) => b.check.status === 'red').length, footings: f.footings.filter((x) => x.check.status === 'red').length, steelKg: Math.round(f.quantities.steelKg) }; };
const fails = runChecks(after).filter((c) => c.status === 'fail').map((c) => c.id);
console.log('before', red(before), 'after', red(after), 'noRoute', after.mep?.noRoute.length, 'fails', fails);
writeFileSync(file, JSON.stringify(after, null, 1) + '\n');
