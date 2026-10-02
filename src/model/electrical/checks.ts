// Electrical checks (NBR 5410), solar and cameras.
import type { CheckResult } from '../checks';
import { spaceArea, spacesOn } from '../geometry';
import { planLevels, type Circuit, type Device, type Project } from '../schema';
import { bearingDir, compassOf } from '../orientation';
import { coverage, nvrDays, poeBudget } from './cameras';
import { mainPanel, phaseBalance, subPanel } from './design';
import { MAX_DROP, capacity, deviceType, minLightingVA, minOutlets } from './library';
import { roomKind, roomPerimeter } from './place';
import { energyEstimate, solarArray } from './solar';

const S5410 = 'NBR 5410 (low-voltage installations)';
const COMPASS_NAME = { N: 'north', E: 'east', S: 'south', W: 'west' } as const;

/** Devices whose position is inside a room. */
export function devicesIn(p: Project, spaceId: string): Device[] {
  const s = p.elements.find((e) => e.id === spaceId);
  if (s?.type !== 'Space') return [];
  return p.elements.filter((e): e is Device => e.type === 'Device' && e.level === s.level
    && s.props.cells.some((c) => e.props.at[0] >= c.x0 - 1e-6 && e.props.at[0] <= c.x1 + 1e-6 && e.props.at[1] >= c.y0 - 1e-6 && e.props.at[1] <= c.y1 + 1e-6));
}

export function electricalChecks(p: Project): CheckResult[] {
  const devices = p.elements.filter((e): e is Device => e.type === 'Device');
  if (devices.length < 3) return [];
  const out: CheckResult[] = [];

  /* minimum points per room (§9.5.2) */
  for (const L of planLevels(p)) {
    for (const s of spacesOn(p, L)) {
      const kind = roomKind(s);
      if (kind === 'none') continue;
      const area = spaceArea(s), per = roomPerimeter(s);
      const ds = devicesIn(p, s.id);
      const outlets = ds.filter((d) => deviceType(d.props.kind).group === 'outlet').length;
      const light = ds.filter((d) => deviceType(d.props.kind).group === 'light').reduce((a, d) => a + d.props.power, 0);
      const needO = minOutlets(kind, area, per), needL = minLightingVA(area);
      const ok = outlets >= needO && light >= needL;
      out.push({
        id: `points:${s.id}`, group: 'Electrical', level: L, elementIds: [s.id], title: `Points · ${s.props.name}`,
        status: ok ? 'pass' : 'fail',
        value: `outlets ${outlets} of ${needO} needed · lighting ${light} of ${needL} VA`,
        rule: kind === 'kitchen' || kind === 'service' ? 'Kitchens and service areas: 1 outlet per 3.5 m of perimeter; lighting 100 VA for 6 m² + 60 VA per 4 m²'
          : kind === 'bath' ? 'Bathrooms: 1 outlet near the basin; lighting 100 VA for 6 m² + 60 VA per 4 m²'
            : 'Rooms up to 6 m²: 1 outlet, larger: 1 per 5 m of perimeter; lighting 100 VA for 6 m² + 60 VA per 4 m²',
        source: `${S5410} §9.5.2`,
      });
    }
  }

  /* circuits */
  const circuits = p.elements.filter((e): e is Circuit => e.type === 'Circuit');
  if (circuits.length) {
    const unprotected = circuits.filter((c) => capacity(c.props.section) < c.props.breaker || c.props.breaker < c.props.current);
    out.push({
      id: 'elec:breakers', group: 'Electrical', elementIds: unprotected.map((c) => c.id), title: 'Breakers protect their cables',
      status: unprotected.length ? 'fail' : 'pass',
      value: unprotected.length ? `${unprotected[0]!.props.name}: ${unprotected[0]!.props.section} mm² carries ${capacity(unprotected[0]!.props.section)} A, breaker ${unprotected[0]!.props.breaker} A, load ${unprotected[0]!.props.current} A` : `${circuits.length} circuits: load ≤ breaker ≤ cable capacity`,
      rule: 'Design current ≤ breaker ≤ cable capacity (Ib ≤ In ≤ Iz)', source: `${S5410} §5.3.4`,
    });
    const worst = circuits.reduce((a, b) => (b.props.drop > a.props.drop ? b : a));
    const high = circuits.filter((c) => c.props.drop > MAX_DROP + 1e-9);
    out.push({
      id: 'elec:drop', group: 'Electrical', elementIds: high.map((c) => c.id), title: 'Voltage drop ≤ 4 %',
      status: high.length ? 'fail' : 'pass',
      value: `highest ${worst.props.drop.toFixed(2)} % on ${worst.props.name} (${worst.props.length.toFixed(1)} m, ${worst.props.section} mm²)`,
      rule: 'Voltage drop from the panel to the farthest point at most 4 %', source: `${S5410} §6.2.7`,
    });
    const minSec = circuits.filter((c) => (c.props.purpose === 'lighting' && c.props.section < 1.5) || (c.props.purpose !== 'lighting' && c.props.section < 2.5));
    out.push({
      id: 'elec:minsection', group: 'Electrical', elementIds: minSec.map((c) => c.id), title: 'Minimum cable sections',
      status: minSec.length ? 'fail' : 'pass', value: minSec.length ? `${minSec[0]!.props.name}: ${minSec[0]!.props.section} mm²` : 'lighting ≥ 1.5 mm², power ≥ 2.5 mm²',
      rule: 'Lighting circuits at least 1.5 mm², power circuits at least 2.5 mm²', source: `${S5410} §6.2.6`,
    });
    const devOf = (c: Circuit) => devices.filter((d) => d.props.circuit === c.id);
    const needRcd = circuits.filter((c) => c.props.purpose === 'outlets' || devOf(c).some((d) => deviceType(d.props.kind).rcd || /WC|Bath|veranda|garden|ramp|carport|front door/i.test(d.props.name)));
    const noRcd = needRcd.filter((c) => !c.props.rcd);
    out.push({
      id: 'elec:rcd', group: 'Electrical', elementIds: noRcd.map((c) => c.id), title: 'RCD 30 mA on outlets, wet areas and outdoors',
      status: noRcd.length ? 'fail' : 'pass', value: noRcd.length ? `${noRcd.length} circuit(s) without RCD, e.g. ${noRcd[0]!.props.name}` : `${needRcd.length} circuits behind 30 mA RCDs`,
      rule: 'Residual-current protection (30 mA) for outlets, bathrooms and outdoor points', source: `${S5410} §5.1.3.2.2`,
    });
    for (const panel of [mainPanel(p), subPanel(p)]) {
      if (!panel) continue;
      const b = phaseBalance(p, panel.id);
      out.push({
        id: `elec:phases:${panel.id}`, group: 'Electrical', elementIds: [panel.id], level: panel.level, title: `Phase balance · ${deviceType(panel.props.kind).label}`,
        status: b.imbalance <= 15 ? 'pass' : 'warn',
        value: `A ${(b.loads.A / 1000).toFixed(1)} kW · B ${(b.loads.B / 1000).toFixed(1)} kW · C ${(b.loads.C / 1000).toFixed(1)} kW — imbalance ${b.imbalance.toFixed(1)} %`,
        rule: 'Spread the circuits so the three phases carry similar loads (target ≤ 15 %)', source: `${S5410}; ${p.site.region.supply.utility ?? 'electricity company'} supply rules (to confirm)`,
      });
    }
    const unassigned = devices.filter((d) => ['outlet', 'light', 'dedicated'].includes(deviceType(d.props.kind).group) && !circuits.some((c) => c.id === d.props.circuit));
    out.push({
      id: 'elec:assigned', group: 'Electrical', elementIds: unassigned.map((d) => d.id), title: 'Every point is on a circuit',
      status: unassigned.length ? 'fail' : 'pass', value: unassigned.length ? `${unassigned.length} not on a circuit` : `${devices.filter((d) => d.props.circuit).length} points on ${circuits.length} circuits`,
      rule: 'Each outlet, light and appliance belongs to a protected circuit', source: S5410,
    });
  }

  /* solar */
  const arr = solarArray(p);
  const est = energyEstimate(p);
  if (arr && est) {
    out.push({
      id: 'solar:fit', group: 'Solar', elementIds: [arr.id], level: 'roof', title: 'Solar modules fit on the roof',
      status: est.placed >= arr.props.modules ? 'pass' : 'fail',
      value: `${est.placed} of ${arr.props.modules} modules, ${est.kwp.toFixed(1)} kWp, ${arr.props.tilt}° facing ${COMPASS_NAME[compassOf(p, ...bearingDir(p, arr.props.bearing))]}, ${arr.props.setback.toFixed(2)} m from the parapet`,
      rule: 'Rows spaced so they do not shade each other at winter noon; clear of tanks, pump and vents', source: 'Design rule (owner brief)',
    });
    out.push({
      id: 'solar:shade', group: 'Solar', elementIds: [arr.id], level: 'roof', title: 'Solar shading',
      status: est.loss <= 0.05 ? 'pass' : 'warn', value: `${(est.loss * 100).toFixed(1)} % of the sun lost to shade (sun model, solstices and equinoxes)`,
      rule: 'Shade losses at most 5 %', source: 'Sun model (spec 02)',
    });
    out.push({
      id: 'solar:inverter', group: 'Solar', elementIds: [arr.id], level: 'roof', title: 'Inverter sizing',
      status: est.dcAc >= 0.9 && est.dcAc <= 1.3 ? 'pass' : 'warn', value: `${est.kwp.toFixed(1)} kWp on a ${arr.props.inverterKw} kW hybrid inverter (DC/AC ${est.dcAc.toFixed(2)})${arr.props.batteryKwh ? ` + ${arr.props.batteryKwh} kWh battery` : ''}`,
      rule: 'DC/AC ratio between 0.9 and 1.3', source: 'Manufacturer practice',
    });
    out.push({
      id: 'solar:energy', group: 'Solar', elementIds: [arr.id], level: 'roof', title: 'Solar energy (estimate)',
      status: 'pass', value: `about ${Math.round(est.year / 12)} kWh per month, ${est.year} kWh per year — ESTIMATE`,
      rule: `Monthly yield for ${p.site.region.city || 'the site'} (${p.site.region.pvYield?.source ?? 'generic Brazilian value, TO CONFIRM for the city'})`, source: 'Estimate, to confirm with the installer',
    });
  }

  /* cameras */
  const cov = coverage(p);
  if (cov.total) {
    out.push({
      id: 'cam:coverage', group: 'Cameras', elementIds: [], title: 'Camera coverage of the lot',
      status: cov.pct >= 85 ? 'pass' : 'warn', value: `${cov.pct.toFixed(0)} % of the open lot seen; ${cov.blind.length * cov.cell * cov.cell} m² blind`,
      rule: 'Cameras see at least 85 % of the open lot (range and angle from the lens)', source: 'Owner requirement (brief)',
    });
    const poe = poeBudget(p), nvr = nvrDays(p);
    out.push({
      id: 'cam:poe', group: 'Cameras', elementIds: [], title: 'PoE switch budget',
      status: poe.ok ? 'pass' : 'fail', value: `${poe.used} of ${poe.ports} ports, ${poe.watts.toFixed(0)} W of ${poe.budgetW} W`,
      rule: 'Ports and PoE power within the 24-port switch', source: 'IEEE 802.3af/at',
    });
    out.push({
      id: 'cam:nvr', group: 'Cameras', elementIds: [], title: 'NVR recording',
      status: nvr.channelsOk && nvr.days >= 15 ? 'pass' : 'warn', value: `${nvr.cameras} cameras × 4 MP H.265 ≈ ${nvr.gbPerDay} GB/day → ${nvr.days.toFixed(0)} days on ${nvr.storageTB} TB`,
      rule: 'At least 15 days of continuous recording', source: 'Owner requirement (brief)',
    });
  }
  return out;
}
