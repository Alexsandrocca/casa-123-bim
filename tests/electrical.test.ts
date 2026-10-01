import { describe, expect, it } from 'vitest';
import { runChecks } from '../src/model/checks';
import { addDevice, deleteDevice, moveDevice, nextDeviceId, setCircuitSection, setDevice, setSolar } from '../src/model/commands';
import { coverage, nvrDays, poeBudget } from '../src/model/electrical/cameras';
import { devicesIn } from '../src/model/electrical/checks';
import { phaseBalance, mainPanel } from '../src/model/electrical/design';
import { capacity, minLightingVA, minOutlets, sectionFor } from '../src/model/electrical/library';
import { billOfMaterials, circuitRows, electricalCsv } from '../src/model/electrical/schedule';
import { energyEstimate, layoutModules, shadingLoss } from '../src/model/electrical/solar';
import { upgradeRaw } from '../src/model/migrate';
import type { Circuit, Device, Project } from '../src/model/schema';
import { load, space } from './helpers';

const v3 = load('casa-123-v3.json');
const devices = (p: Project) => p.elements.filter((e): e is Device => e.type === 'Device');
const circuits = (p: Project) => p.elements.filter((e): e is Circuit => e.type === 'Circuit');
const check = (p: Project, id: string) => runChecks(p).find((c) => c.id === id)!;

describe('electrical design (Version 3)', () => {
  it('places devices of every kind the spec lists, with Brazilian heights', () => {
    const kinds = new Set(devices(v3).map((d) => d.props.kind));
    for (const k of ['outlet', 'outlet-20', 'switch', 'ceiling-light', 'wall-light', 'led-strip', 'hob', 'oven', 'washer-dryer', 'heat-pump', 'ac-indoor', 'ac-outdoor',
      'ev-charger', 'pump-pressure', 'pump-lift', 'pump-sump', 'rack', 'network-outlet', 'camera', 'doorbell', 'smoke-detector', 'panel', 'sub-panel', 'inverter']) expect(kinds.has(k), k).toBe(true);
    const sw = devices(v3).find((d) => d.props.kind === 'switch' && d.level === 'SL')!;
    expect(sw.props.z).toBeCloseTo(0.6 + 1.1, 5);
    const o = devices(v3).find((d) => d.props.kind === 'outlet' && d.level === 'UF')!;
    expect(o.props.z).toBeCloseTo(3.7 + 0.3, 5);
    expect(devices(v3).filter((d) => d.props.kind === 'camera')).toHaveLength(16);
    expect(mainPanel(v3)!.level).toBe('SL');
  });

  it('meets the NBR 5410 minimum points in every room, and passes every electrical check', () => {
    const r = runChecks(v3).filter((c) => ['Electrical', 'Solar', 'Cameras'].includes(c.group));
    expect(r.filter((c) => c.status !== 'pass').map((c) => `${c.id}: ${c.value}`)).toEqual([]);
    expect(minOutlets('kitchen', 14, 16)).toBe(5);
    expect(minOutlets('other', 10.24, 12.8)).toBe(3);
    expect(minLightingVA(14)).toBe(220);
  });

  it('sizes cables for current and voltage drop', () => {
    expect(sectionFor('dedicated', 31.8, 15, 220)).toEqual({ section: 4, breaker: 32 });
    expect(sectionFor('outlets', 9, 60, 127).section).toBeGreaterThan(2.5); // long run: bigger cable for the drop
    for (const c of circuits(v3)) {
      expect(capacity(c.props.section)).toBeGreaterThanOrEqual(c.props.breaker);
      expect(c.props.drop).toBeLessThanOrEqual(4);
    }
    expect(phaseBalance(v3, mainPanel(v3)!.id).imbalance).toBeLessThan(15);
  });

  it('acceptance: adding an outlet to a bedroom updates the circuit load, the cable check and the schedule', () => {
    const bed = space(v3, 'UF', 'Bedroom 3');
    const before = circuits(v3);
    const id = nextDeviceId(v3, 'outlet');
    const p = addDevice(id, 'outlet', 'UF', [7.0, 6.0]).apply(v3);
    const d = devices(p).find((x) => x.id === id)!;
    expect(d.props.circuit).toBeTruthy();
    const c = circuits(p).find((x) => x.id === d.props.circuit)!;
    const old = before.find((x) => x.id === c.id);
    expect(old ? c.props.load > old.props.load : true).toBe(true);
    expect(c.props.length).toBeGreaterThan(0);
    // the cable checks run on the new load and still pass
    expect(check(p, 'elec:breakers').status).toBe('pass');
    expect(check(p, 'elec:drop').status).toBe('pass');
    expect(c.props.current).toBeCloseTo(c.props.load / 127, 1);
    expect(devicesIn(p, bed.id).filter((x) => x.props.kind === 'outlet').length).toBe(devicesIn(v3, bed.id).filter((x) => x.props.kind === 'outlet').length + 1);
    const rowsBefore = circuitRows(v3).find((r) => r.id === c.id), rowsAfter = circuitRows(p).find((r) => r.id === c.id)!;
    expect(rowsAfter.points).toBe((rowsBefore?.points ?? 0) + 1);
    expect(billOfMaterials(p).devices.find((x) => x.item === 'Outlet 10 A')!.count).toBe(billOfMaterials(v3).devices.find((x) => x.item === 'Outlet 10 A')!.count + 1);
    expect(() => addDevice(nextDeviceId(v3, 'outlet'), 'outlet', 'UF', [20, 6]).apply(v3)).toThrow();
  });

  it('acceptance: the kitchen minimum-points check fails if outlets are removed', () => {
    const k = space(v3, 'SL', 'Kitchen');
    expect(check(v3, `points:${k.id}`).status).toBe('pass');
    const outlet = devicesIn(v3, k.id).find((d) => d.props.kind.startsWith('outlet'))!;
    const p = deleteDevice(outlet.id).apply(v3);
    expect(check(p, `points:${k.id}`).status).toBe('fail');
    expect(check(p, `points:${k.id}`).value).toContain('of 5 needed');
  });

  it('flags a cable chosen too small by hand, and keeps devices put on a circuit by hand', () => {
    const ev = circuits(v3).find((c) => c.id === 'ckt-ded-dev-ev-01')!;
    const p = setCircuitSection(ev.id, 2.5).apply(v3);
    expect(check(p, 'elec:breakers').status).toBe('fail');
    const o = devices(v3).find((d) => d.props.kind === 'outlet' && d.level === 'UF')!;
    const other = circuits(v3).find((c) => c.props.purpose === 'outlets' && c.id !== o.props.circuit)!;
    const q = moveDevice(o.id, o.props.at[0], o.props.at[1] + 0.2).apply(setDevice(o.id, { circuit: other.id }).apply(v3));
    expect(devices(q).find((d) => d.id === o.id)!.props.circuit).toBe(other.id);
  });

  it('lays out 12 modules at 20° facing north with little shade, and estimates the energy', () => {
    const mods = layoutModules(v3);
    expect(mods).toHaveLength(12);
    expect(shadingLoss(v3, mods).loss).toBeLessThan(0.05);
    const e = energyEstimate(v3)!;
    expect(e.kwp).toBeCloseTo(6.6, 5);
    expect(e.year / 12).toBeGreaterThan(700);
    expect(e.year / 12).toBeLessThan(850);
    const b = setSolar({ batteryKwh: 10 }).apply(v3);
    expect(devices(b).some((d) => d.props.kind === 'battery')).toBe(true);
    expect(devices(b).some((d) => d.props.kind === 'essential-panel')).toBe(true);
    expect(devices(setSolar({ batteryKwh: 0 }).apply(b)).some((d) => d.props.kind === 'battery')).toBe(false);
  });

  it('checks camera coverage, the PoE budget and the NVR', () => {
    expect(coverage(v3).pct).toBeGreaterThan(85);
    const cam = devices(v3).find((d) => d.props.name.includes('Carport and patio'))!;
    const turned = setDevice(cam.id, { bearing: (cam.props.bearing! + 180) % 360 }).apply(v3);
    expect(coverage(turned).pct).toBeLessThan(coverage(v3).pct);
    expect(poeBudget(v3).ok).toBe(true);
    expect(nvrDays(v3).days).toBeGreaterThan(15);
  });

  it('exports the circuit schedule and bill of materials as CSV', () => {
    const csv = electricalCsv(v3);
    expect(csv.split('\n')[0]).toBe('Circuits');
    expect(csv).toContain('Section mm2,Metres');
    const b = billOfMaterials(v3);
    expect(b.cable.find((x) => x.section === 2.5)!.metres).toBeGreaterThan(50);
    expect(b.breakers.length).toBeGreaterThan(2);
  });

  it('upgrades devices saved by the spec 02b app', () => {
    const raw = { elements: [{ type: 'Device', id: 'dev-ev-01', props: { kind: 'ev-charger', name: 'EV', powerKw: 7, host: 'x', at: [1, 2, 1.3] } }] };
    const u = upgradeRaw(raw) as { elements: { props: Record<string, unknown> }[] };
    expect(u.elements[0]!.props).toMatchObject({ at: [1, 2], z: 1.3, power: 7000 });
  });
});
