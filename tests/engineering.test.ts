// Spec 08: architectural features and engineering estimates. Hand calculations are written out next to each check.
import { describe, expect, it } from 'vitest';
import { runChecks } from '../src/model/checks';
import { History } from '../src/model/history';
import { assemblyById, values } from '../src/model/eng/assemblies';
import { addFeature, moveGridLine, setAssumption, setDefaultAssembly } from '../src/model/eng/commands';
import { checkBeamSpan, frame, pickBeam, sizeFooting, type BeamSpan } from '../src/model/eng/frame';
import { costEstimate } from '../src/model/eng/cost';
import { sunOnGlass } from '../src/model/eng/environment';
import { makeFeature } from '../src/model/eng/features';
import { thermalRows } from '../src/model/eng/thermal';
import { section } from '../src/model/eng/steel';
import { inDoorSwing } from '../src/model/mep/hosting';
import type { Beam, Column, Element, Footing, Project, Slab, Wall } from '../src/model/schema';
import { load } from './helpers';

const v3 = load('casa-123-v3.json');

/** A one-bay test frame: a 6 × 4 m floor slab at +3.70 on four W250 edge beams and four W200 columns on 1 × 1 m pads. */
function oneBay(dy = 4): Project {
  const els: Element[] = [];
  const corners: [number, number][] = [[0, 0], [6, 0], [0, dy], [6, dy]];
  els.push({ id: 'slab', type: 'Slab', level: 'UF', tags: [], props: { name: 'Test floor', rect: { x0: 0, y0: 0, x1: 6, y1: dy }, voidSpaces: [], topElevation: 3.7, thickness: 0.14 } } as Slab);
  const beam = (id: string, s: [number, number], e: [number, number]): Beam => ({ id, type: 'Beam', level: 'UF', tags: ['generated'], props: { start: s, end: e, profile: 'W250×32.7', elevation: 3.56 } });
  els.push(beam('b1', [0, 0], [6, 0]), beam('b2', [0, dy], [6, dy]), beam('b3', [0, 0], [0, dy]), beam('b4', [6, 0], [6, dy]));
  corners.forEach(([x, y], i) => {
    els.push({ id: `c${i}`, type: 'Column', level: 'SL', tags: ['generated'], props: { at: [x, y], profile: 'W200×46.1', kind: 'column', baseElevation: 0, topElevation: 3.56 } } as Column);
    els.push({ id: `f${i}`, type: 'Footing', level: 'SL', tags: ['generated'], props: { kind: 'pad', carries: `c${i}`, rect: { x0: x - 0.5, y0: y - 0.5, x1: x + 0.5, y1: y + 0.5 }, topElevation: 0, depth: 0.5 } } as Footing);
  });
  return { ...v3, grid: { x: [0, 6], y: [0, dy] }, elements: els };
}

describe('spec 08: assemblies', () => {
  it('U-value, weight and thermal capacity against a hand calculation', () => {
    // Ceramic block 14 cm, rendered: R = Rsi 0.13 + 0.035/1.15 + 0.14/0.66 + 0.025/1.15 + Rse 0.04
    //   = 0.13 + 0.03043 + 0.21212 + 0.02174 + 0.04 = 0.43429 m²K/W → U = 2.303 W/m²K
    // mass = 1900·0.035 + 750·0.14 + 1900·0.025 = 66.5 + 105 + 47.5 = 219 kg/m² → 2.148 kN/m²
    // CT = 1900·1.0·0.035 + 750·0.92·0.14 + 1900·1.0·0.025 = 66.5 + 96.6 + 47.5 = 210.6 kJ/m²K
    const v = values(assemblyById('ext-ceramic-14')!);
    expect(v.thickness).toBeCloseTo(0.2, 6);
    expect(v.R).toBeCloseTo(0.43429, 4);
    expect(v.U).toBeCloseTo(2.303, 3);
    expect(v.mass).toBeCloseTo(219, 6);
    expect(v.weight).toBeCloseTo(2.148, 3);
    expect(v.CT).toBeCloseTo(210.6, 3);
    // LSF: R = 0.13 + 0.005/0.7 + 0.01/0.35 + 0.0005/0.2 + 0.011/0.13 + 0.09/0.055 + 0.0125/0.35 + 0.04
    //   = 0.13 + 0.00714 + 0.02857 + 0.0025 + 0.08462 + 1.63636 + 0.03571 + 0.04 = 1.96491 → U = 0.509
    const l = values(assemblyById('ext-lsf')!);
    expect(l.U).toBeCloseTo(0.509, 3);
    expect(l.thickness).toBeCloseTo(0.129, 6);
  });

  it('the default walls keep the drawn thicknesses (retaining walls 0.26 m with their membranes)', () => {
    const t = (type: string) => [...new Set(v3.elements.filter((e): e is Wall => e.type === 'Wall' && e.props.wallType === type).map((w) => w.props.thickness))];
    expect(t('exterior')).toEqual([0.2]);
    expect(t('interior')).toEqual([0.12]);
    expect(t('wet')).toEqual([0.15]);
    expect(t('retaining')).toEqual([0.26]);
  });
});

describe('spec 08: loads and pre-sizing (hand calculations)', () => {
  it('load takedown on a one-bay frame: deck span, column loads and footings', () => {
    const p = oneBay();
    const f = frame(p);
    const asm = values(assemblyById('floor-deck-14')!).weight; // 386 kg/m² → 3.787 kN/m²
    // service = assembly + finishes 1.0 + partitions 1.0 (no walls) + live 1.5 (dwelling)
    const service = asm + 1 + 1 + 1.5;
    expect(f.bays).toHaveLength(1);
    const bay = f.bays[0]!;
    expect(bay.service).toBeCloseTo(service, 6);
    // the deck spans the shorter way, 4.0 m between the long beams: more than 2.70 m without props → amber
    expect(bay.spanDir).toBe('y');
    expect(bay.span).toBeCloseTo(4, 6);
    expect(bay.deck!.status).toBe('amber');
    // each column carries a quarter of the 24 m² slab plus its own weight: 46.1 kg/m × 3.56 m × 9.81 = 1.61 kN
    const own = (46.1 * 3.56 * 9.81) / 1000;
    for (const c of f.columns) expect(c.N).toBeCloseTo(service * 6 + own, 6);
    // the long beams carry half the 4 m strip: w = service × 2 m; the short beams carry nothing from the deck
    const b1 = f.beams.find((b) => b.beam.id === 'b1')!;
    expect(b1.spans[0]!.w).toBeCloseTo(service * 2, 6);
    expect(f.beams.find((b) => b.beam.id === 'b3')!.spans[0]!.w).toBeCloseTo(0, 6);
    // footing: N·1.1 / 150 kPa
    const N = service * 6 + own;
    const fr = f.footings[0]!;
    expect(fr.B).toBeCloseTo(Math.max(0.6, Math.ceil(Math.sqrt((N * 1.1) / 150) / 0.05 - 1e-9) * 0.05), 6);
  });

  it('a deck span past the limits turns the bay amber (props) and then red', () => {
    expect(frame(oneBay(4.5)).bays[0]!.deck!.status).toBe('red');
    expect(frame(oneBay(4.5)).bays[0]!.deck!.reason).toMatch(/even with props/);
    expect(frame(oneBay(2.5)).bays[0]!.deck!.status).not.toBe('red');
    // in the house: moving the y grid line at 8.50 to 9.40 makes a 4.40 m deck span on the floors
    const h = new History(v3);
    h.run(moveGridLine('y', 2, 9.4));
    const red = frame(h.present).bays.filter((b) => b.deck?.status === 'red');
    expect(red.length).toBeGreaterThan(0);
    expect(red.some((b) => Math.abs(b.span - 4.4) < 1e-6)).toBe(true);
    expect(frame(v3).bays.some((b) => b.deck?.status === 'red')).toBe(false);
  });

  it('beam bending and deflection against a hand calculation', () => {
    // W250×32.7, 5 m simply supported, 10 kN/m + own weight 32.7 × 9.81/1000 = 0.3208 kN/m
    //   Md = 1.4 × 10.3208 × 5² / 8 = 45.15 kNm; MRd = Zx·fy/γ = 382.7 × 1.12 cm³ × 345 MPa / 1.1 = 134.43 kNm → 0.336
    //   δ = 5 × 10.3208 × 5⁴ / (384 × 200 GPa × 4937 cm⁴) = 8.506 mm; limit 5000/350 = 14.29 mm → 0.595 (governs)
    const sp: BeamSpan = { beamId: 't', a: 0, b: 5, o: 'h', c: 0, L: 5, primary: true, w: 10, parts: { slab: 10, walls: 0 }, depthRule: 0.25 };
    const r = checkBeamSpan(v3, sp, section('W250×32.7')!);
    expect(r.Md).toBeCloseTo(45.15, 2);
    expect(r.MRd).toBeCloseTo(134.43, 1);
    expect(r.defl * 1000).toBeCloseTo(8.506, 2);
    expect(r.util).toBeCloseTo(0.595, 3);
    expect(r.governing).toMatch(/deflection/);
  });

  it('picks the lightest W section that passes (hand-checked)', () => {
    // 5 m, 10 kN/m: deflection needs Ix ≥ 5 × 10.2 × 5³ × 350 / (384 × 2e8) ≈ 2,906 cm⁴.
    // Lighter sections all fall short (W150×13 635, W200×15 1,305, W250×17.9 2,291, W150×18 939, W200×19.3 1,686 cm⁴);
    // W310×21 (21 kg/m, Ix 3,776 cm⁴): δ = 11.0 mm ≤ 14.3 mm, Md 44.6 ≤ MRd 87.5 kNm → it is the one.
    const sp: BeamSpan = { beamId: 't', a: 0, b: 5, o: 'h', c: 0, L: 5, primary: true, w: 10, parts: { slab: 10, walls: 0 }, depthRule: 0.25 };
    expect(pickBeam(v3, [sp])!.name).toBe('W310×21');
  });

  it('footing sizing against a hand calculation', () => {
    // N = 300 kN service: area = 300 × 1.1 / 150 = 2.20 m² → side √2.2 = 1.483 → 1.50 m;
    // depth = (1.50 − 0.203) / 3 = 0.432 → 0.45 m (≥ 0.40)
    expect(sizeFooting(300, 150, 0.4, 0.203)).toEqual({ B: 1.5, h: 0.45 });
    // a light column: 40 kN → 0.54 m → the 0.60 m minimum, depth 0.40
    expect(sizeFooting(40, 150, 0.4, 0.1)).toEqual({ B: 0.6, h: 0.4 });
    // with a weaker soil (100 kPa) the same 300 kN needs 1.85 m
    expect(sizeFooting(300, 100, 0.4, 0.203).B).toBeCloseTo(1.85, 6);
  });

  it('acceptance: switching the exterior walls to LSF changes thickness, weight, U-value, column loads, footings and cost at once', () => {
    const h = new History(v3);
    const before = h.present, fb = frame(before), cb = costEstimate(before, fb.quantities);
    expect(h.run(setDefaultAssembly('exterior', 'ext-lsf'))).toBe(true);
    const after = h.present, fa = frame(after), ca = costEstimate(after, fa.quantities);
    const ext = (p: Project) => p.elements.find((e): e is Wall => e.type === 'Wall' && e.props.wallType === 'exterior' && e.level === 'UF')!;
    expect(ext(before).props.thickness).toBeCloseTo(0.2, 6);
    expect(ext(after).props.thickness).toBeCloseTo(0.13, 6);
    // weight and U of the walls
    const tb = thermalRows(before).find((r) => r.kind === 'wall')!, ta = thermalRows(after).find((r) => r.kind === 'wall')!;
    expect(tb.U).toBeCloseTo(2.303, 3);
    expect(ta.U).toBeCloseTo(0.509, 3);
    // columns carrying exterior walls get lighter, and some footings get smaller
    const nb = new Map(fb.columns.map((c) => [c.col.id, c.N])), na = new Map(fa.columns.map((c) => [c.col.id, c.N]));
    expect([...na].some(([id, n]) => n < nb.get(id)! - 5)).toBe(true);
    const bb = new Map(fb.footings.map((x) => [x.footing.id, x.B]));
    expect(fa.footings.some((x) => x.B < bb.get(x.footing.id)! - 1e-6)).toBe(true);
    expect(ca.total).not.toBeCloseTo(cb.total, 0);
    // undo puts everything back
    h.undo();
    expect(ext(h.present).props.thickness).toBeCloseTo(0.2, 6);
  });

  it('the pre-sizing rows say which members are over capacity, and the soil stays TO CONFIRM', () => {
    const r = runChecks(v3);
    expect(r.find((c) => c.id === 'eng:beams')!.value).toMatch(/over capacity/);
    expect(r.find((c) => c.id === 'eng:soil')!.status).toBe('confirm');
    // Q12: the heat-pump heater and the tanks are checked on their roofs
    expect(r.filter((c) => c.id.startsWith('eng:roof-equipment')).map((c) => c.value).join(' ')).toMatch(/Heat-pump water heater.*|Water tank/);
  });
});

describe('spec 08: thermal, environment, cost', () => {
  it('thermal: ceramic block passes the simplified method in zone 2; LSF fails its thermal capacity', () => {
    expect(thermalRows(v3).every((r) => r.status === 'pass')).toBe(true);
    const h = new History(v3);
    h.run(setDefaultAssembly('exterior', 'ext-lsf'));
    const w = thermalRows(h.present).find((r) => r.kind === 'wall')!;
    expect(w.status).toBe('fail');
    expect(w.why).toMatch(/CT \d+ < 130/);
  });

  it('acceptance: a brise on the west living window reduces its December sun hours', () => {
    const sun = (p: Project) => sunOnGlass(p).find((s) => s.op.id === 'SL-win-07')!;
    const before = sun(v3);
    expect(before.side).toBe('W');
    expect(before.status).toBe('warn');
    const h = new History(v3);
    expect(h.run(addFeature('brise', { opening: 'SL-win-07' }))).toBe(true);
    const after = sun(h.present);
    expect(after.dec).toBeLessThan(before.dec - 1);
    expect(after.shading).toEqual(['Brise-soleil']);
  });

  it('cost: both methods, and the CUB is never invented', () => {
    const c = costEstimate(v3, frame(v3).quantities);
    expect(c.total).toBeGreaterThan(0);
    expect(c.area.total).toBeGreaterThan(0);
    const h = new History(v3);
    h.run(setAssumption('cub', null));
    const e = costEstimate(h.present, frame(h.present).quantities);
    expect(e.area.cub).toBeNull();
    expect(e.area.total).toBeNull();
    expect(e.total).toBeCloseTo(c.total, 6);
  });
});

describe('spec 08: features and carry-overs', () => {
  it('features check their host, and an eave past 0.70 m fails the city limit', () => {
    expect(makeFeature(v3, 'brise', { opening: 'SL-door-01' })).toMatch(/window/);
    const eave = makeFeature(v3, 'eave', { slab: 'roof-slab-01', at: [8.5, 9] });
    expect(typeof eave).toBe('object');
    const h = new History(v3);
    h.run(addFeature('eave', { slab: 'roof-slab-01', at: [8.5, 9] }));
    const row = runChecks(h.present).find((c) => c.id.startsWith('eng:eave:'))!;
    expect(row.status).toBe('fail'); // 0.40 m eaves + 0.50 m = 0.90 m > 0.70 m
  });

  it('a door leaf only blocks points in the room it opens into (Q16)', () => {
    // Bath 3's basin outlet sits beside the basin; a bedroom door on the other side of the wall does not reach it
    const out = v3.elements.find((e) => e.id === 'dev-outlet-26')!;
    expect(out.type === 'Device' && out.props.hostWallId).toBe('UF-wall-13');
    expect(inDoorSwing(v3, 'UF', 3.325, 7.8)).toBeUndefined();
  });

  it('the patio steps come down in a 0.80 m gap between the parking bays (Q8)', () => {
    const c = v3.elements.find((e) => e.type === 'Carport')!;
    const d = v3.elements.find((e) => e.id === 'SL-deck-02')!;
    if (c.type !== 'Carport' || d.type !== 'Deck') throw new Error('missing');
    const [b1, b2] = c.props.parking;
    expect(b2!.x0 - b1!.x1).toBeCloseTo(0.8, 6);
    expect(d.props.steps!.x0).toBeCloseTo(b1!.x1, 6);
    expect(d.props.steps!.x1).toBeCloseTo(b2!.x0, 6);
    expect(runChecks(v3).find((r) => r.title === 'Parking')!.status).toBe('pass');
  });
});
