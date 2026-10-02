// P1: what the engines produce for a model, in a comparable form. The P1 regression test compares it before and after
// the site facts moved into site.lot (tests/fixtures/p1-regression/before.json was written by the code before P1).
import { createHash } from 'node:crypto';
import { runChecks } from '../src/model/checks';
import { costOf, energyOf, envOf, frameOf, thermalOf } from '../src/model/eng';
import { mepReport } from '../src/model/mep/analysis';
import { mepContext } from '../src/model/mep/spaces';
import { routePlumbing } from '../src/model/plumbing/route';
import { withElectrical } from '../src/model/electrical/design';
import type { Project } from '../src/model/schema';
import { groundAt, groundZones, siteFrame } from '../src/model/site';
import { buildScene } from '../src/scene/build3d';
import { viewFrame } from '../src/scene/frame';
import { sunPosition } from '../src/scene/sun';

const round = (_k: string, v: unknown) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v instanceof Map ? [...v.entries()] : v instanceof Set ? [...v] : v);
const json = (x: unknown) => JSON.stringify(x, round);
const hash = (x: unknown) => createHash('sha1').update(json(x)).digest('hex').slice(0, 16);

export function digest(p: Project) {
  const f = siteFrame(p);
  const ys = [f.yStreet, f.yStreet + 3.3, (f.yStreet + f.yRear) / 2, f.yRear - 1];
  const zones = groundZones(p);
  const ground: number[] = [];
  for (let x = f.xSouth - 1; x < f.xSouth + 17; x += 1.7) for (let y = f.yStreet - 1; y < f.yRear + 1; y += 2.3) ground.push(groundAt(p, x, y, zones));
  const sun = [[6, 21, 9], [6, 21, 12], [12, 21, 15], [3, 21, 7.5]].map(([m, d, h]) => sunPosition(2026, m!, d!, h!, p));
  const checks = runChecks(p).map((c) => ({ id: c.id, status: c.status, title: c.title, value: c.value, rule: c.rule, source: c.source }));
  const scene = buildScene(p, { doorsOpen: false, conduits: true, cones: true, physics: true, structure: true });
  const ctx = mepContext(p);
  return JSON.parse(json({
    site: { lot: f.lot, yStreet: f.yStreet, yRear: f.yRear, xSouth: f.xSouth, xNorth: ys.map(f.xNorth), natural: ys.map(f.natural), garden: f.garden, rampEndY: f.rampEndY, passageEndY: f.passageEndY, cutY: f.cutY, house: f.house },
    zones: hash(zones), ground: hash(ground), sun, view: hash(viewFrame(p)),
    checks,
    scene: hash(scene.parts), surfaces: hash(scene.surfaces), design: hash(buildScene(p, { doorsOpen: false, style: 'design' }).parts),
    mepContext: hash({ ...ctx, p: undefined }),
    plumbing: hash(routePlumbing(p)), electrical: hash(withElectrical(p).elements.filter((e) => e.type === 'Circuit' || e.type === 'Conduit')),
    mep: hash(mepReport(p)),
    frame: hash(frameOf(p)), thermal: hash(thermalOf(p)), env: hash(envOf(p)), energy: hash(energyOf(p)), cost: hash(costOf(p)),
  })) as Record<string, unknown>;
}
