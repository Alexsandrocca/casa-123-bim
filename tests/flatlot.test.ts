// P0: a second project (tests/fixtures/flat-lot) runs through every engine without errors and without Casa 123 facts.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runChecks } from '../src/model/checks';
import { dryRun } from '../src/model/catalogue';
import { coverage } from '../src/model/electrical/cameras';
import { withElectrical } from '../src/model/electrical/design';
import { costOf, energyOf, envOf, frameOf, thermalOf } from '../src/model/eng';
import { sunOnGlass } from '../src/model/eng/environment';
import { mepReport } from '../src/model/mep/analysis';
import { bearingDir, streetSide } from '../src/model/orientation';
import { routePlumbing } from '../src/model/plumbing/route';
import { ProjectFile } from '../src/model/project-file';
import { entryLevel, parseProject, planLevels } from '../src/model/schema';
import { groundZones, siteFrame } from '../src/model/site';
import { generateStructure } from '../src/model/structure';
import { buildScene } from '../src/scene/build3d';
import { viewFrame } from '../src/scene/frame';
import { sunPosition } from '../src/scene/sun';
import { walkWorld } from '../src/scene/walk';

const read = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/flat-lot/${f}`, import.meta.url), 'utf8'));
const p = parseProject(read('versions/v1.json'));

/** Anything that would show Casa 123 leaking into another project. */
const CASA = ['Casa 123', 'Piracicaba', 'Alceu', 'CPFL', 'SEMAE', 'LC 474', '-22.72', '22.72', '-47.65', '127/220', 'north ramp', 'South passage'];

describe('flat-lot fixture (P0)', () => {
  it('is a 12 × 30 m flat lot, street to the west, north to the left, one storey, 3 rooms', () => {
    expect(ProjectFile.parse(read('project.json')).id).toBe('flat-lot');
    expect(p.site.lot.polygon).toEqual([[0, 0], [12, 0], [12, 30], [0, 30]]);
    expect(p.site.lot.terrain.kind).toBe('flat');
    expect(streetSide(p)).toBe('W');
    // standing in the street looking at the lot (east), north is to the left: the house −x side
    const [nx, ny] = bearingDir(p, 0);
    expect(nx).toBeCloseTo(-1, 6); expect(ny).toBeCloseTo(0, 6);
    expect(planLevels(p)).toEqual(['GF']);
    expect(entryLevel(p)).toBe('GF');
    expect(p.elements.filter((e) => e.type === 'Space')).toHaveLength(3);
  });

  it('the sun is right for Florianópolis (−27.59°): winter noon about 39° up, due north; morning sun on the rear (east)', () => {
    let best = sunPosition(2026, 6, 21, 12, p);
    for (let h = 11; h <= 13.5; h += 0.05) { const s = sunPosition(2026, 6, 21, h, p); if (s.altitude > best.altitude) best = s; }
    expect(best.altitude).toBeCloseTo(90 - 27.59 - 23.44, 0);
    expect(best.dir[0]).toBeLessThan(-0.7); // north is −x here
    expect(sunPosition(2026, 6, 21, 9, p).dir[1]).toBeGreaterThan(0); // east is the rear (+y)
  });

  it('site, 3D, structure, systems, estimates and every check run without errors', () => {
    const results: unknown[] = [];
    results.push(siteFrame(p), groundZones(p), generateStructure(p), viewFrame(p));
    const scene = buildScene(p, { doorsOpen: false, conduits: true, cones: true, physics: true, structure: true, selection: p.elements[0]!.id });
    expect(scene.parts.length).toBeGreaterThan(50);
    results.push(buildScene(p, { doorsOpen: false, style: 'design' }).parts.length, walkWorld(scene));
    results.push(routePlumbing(p), withElectrical(p).elements.filter((e) => e.type === 'Circuit'), mepReport(p).items.size);
    results.push(frameOf(p), thermalOf(p), envOf(p), energyOf(p), costOf(p), sunOnGlass(p), coverage(p));
    const checks = runChecks(p);
    results.push(checks);
    expect(checks.length).toBeGreaterThan(20);
    // unknown city: its rules are TO CONFIRM, never Piracicaba's
    expect(checks.find((c) => c.id === 'site:city-rules')!.status).toBe('confirm');
    expect(checks.find((c) => c.id === 'eaves:roof-slab-01')!.status).toBe('confirm');
    expect(checks.filter((c) => c.group === 'Thermal').every((c) => c.status === 'confirm')).toBe(true);
    // the plumbing says what it cannot do instead of drawing nothing quietly
    expect(p.mep!.noRoute.some((n) => /no soil stack/.test(n.reason))).toBe(true);
    // 220/380 V supply: ordinary circuits on 220 V, no 127 V anywhere
    const circuits = p.elements.filter((e) => e.type === 'Circuit');
    expect(circuits.length).toBeGreaterThan(0);
    expect(circuits.every((c) => c.type === 'Circuit' && c.props.voltage === 220)).toBe(true);
    const text = JSON.stringify([p, results]);
    for (const w of CASA) expect(text, `found “${w}”`).not.toContain(w);
  });

  it('a dry run on the flat lot resizes a room and leaves the model alone', () => {
    const before = JSON.stringify(p);
    const r = dryRun(p, [{ name: 'resize_room', args: { room: 'Bedroom', deltaM2: -2 } }]);
    expect(r.ok).toBe(true);
    expect(r.diff.some((d) => /^Bedroom: [\d.]+ → [\d.]+ m²$/.test(d))).toBe(true);
    expect(JSON.stringify(p)).toBe(before);
  });
});
