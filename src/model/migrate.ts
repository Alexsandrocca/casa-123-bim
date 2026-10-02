// Bring a model saved by an older version of the app up to date.
import type { Lot, Project, Region, Who } from './schema';
import { withMep } from './commands';
import { syncThickness } from './eng/commands';

const EDITED = ['Space', 'Wall', 'Opening'];

/**
 * Models from spec 01 have no structure: keep the family's room, wall and opening edits, take everything else from the base.
 * Models from before spec 03 have no plumbing: add the base's fixtures and pipes and the street utilities.
 */
export function migrate(p: Project, base: Project): Project {
  if (!p.elements.some((e) => e.type === 'Column')) {
    p = {
      ...base,
      elements: [...p.elements.filter((e) => EDITED.includes(e.type)), ...base.elements.filter((e) => !EDITED.includes(e.type))],
    };
  }
  const missing = ['Fixture', 'PipeSegment', 'Device', 'Circuit', 'Conduit', 'SolarArray'].filter((t) => !p.elements.some((e) => e.type === t) && base.elements.some((e) => e.type === t));
  // Spec 04 regenerated the 02b devices: if the saved model has only those two, take the base's devices.
  const onlyOldDevices = p.elements.filter((e) => e.type === 'Device').length <= 2 && base.elements.filter((e) => e.type === 'Device').length > 2;
  if (onlyOldDevices && !missing.includes('Device')) missing.push('Device');
  if (missing.length) {
    p = { ...p, elements: [...p.elements.filter((e) => !missing.includes(e.type)), ...base.elements.filter((e) => missing.includes(e.type))] };
  }
  // Spec 04b rebuilt the services on hosts, shafts and plenums: a model saved before it takes the new services from the
  // base (keeping the family's room edits), and they are re-hosted and re-routed to fit those edits.
  if (!p.elements.some((e) => e.type === 'ServiceSpace') && base.elements.some((e) => e.type === 'ServiceSpace')) {
    const MEP = ['Fixture', 'PipeSegment', 'Device', 'Circuit', 'Conduit', 'SolarArray', 'ServiceSpace'];
    p = withMep({ ...p, elements: [...p.elements.filter((e) => !MEP.includes(e.type)), ...base.elements.filter((e) => MEP.includes(e.type))] });
  }
  // Spec 08: walls take the thickness of their assembly (only the retaining walls change, 0.25 → 0.26 m)
  const synced = syncThickness(p);
  if (synced !== p) p = p.elements.some((e) => e.type === 'Fixture' || e.type === 'Device') ? withMep(synced) : synced;
  return p;
}

/** Before validation: reshape data saved by older versions of the app (spec 02b devices had at = [x, y, z];
 *  before P0 the place facts were in the code: a model without site.region takes the base model's;
 *  before P1 the lot facts were spread over site and site.region: they move into site.lot). */
export function upgradeRaw(data: unknown, base?: Project): unknown {
  const d = data as { site?: Record<string, unknown>; assumptions?: Record<string, unknown>; elements?: { type?: string; props?: Record<string, unknown> }[] };
  if (!d || !Array.isArray(d.elements)) return data;
  const before = d.site && !d.site.region && base ? { ...d.site, region: { ...base.site.region, ...oldRegionOf(base) } } : d.site;
  const site = before && Array.isArray(before.lotPolygon) ? upgradeSite(before as unknown as OldSite, base) : before;
  // before P0 the zone and V0 had code defaults; an old model keeps the values it was computed with
  const assumptions = d.site && !d.site.region && base?.assumptions ? { ...base.assumptions, ...(d.assumptions ?? {}) } : d.assumptions;
  return {
    ...d,
    ...(site ? { site } : {}),
    ...(assumptions ? { assumptions } : {}),
    elements: d.elements.map((e) => {
      if (e.type !== 'Device' || !e.props || !Array.isArray(e.props.at) || e.props.at.length !== 3) return e;
      const [x, y, z] = e.props.at as number[];
      const power = typeof e.props.powerKw === 'number' ? e.props.powerKw * 1000 : 0;
      const { powerKw: _k, host: _h, space: _s, ...rest } = e.props;
      return { ...e, props: { ...rest, at: [x, y], z, power } };
    }),
  };
}

/** The site as saved before P1. */
export interface OldSite {
  address: string;
  lotPolygon: [number, number][];
  houseOrigin: { x: number; y: number };
  fallStreetToRear: number;
  setbacks: { front: number; rear: number; sides: number };
  cut: Project['site']['cut'];
  ramp?: { width: number; slope: number };
  eavesLimit?: number;
  region: Omit<Region, 'rainIntensity'> & {
    lat: number; lon: number; xBearing: number;
    supply: { utility: string | null; phaseV: number; lineV: number; phases: number; confirmed: boolean };
    water: string | null;
  };
  utilities?: { sewerDepth: number; sewerOffset: number; waterMainDepth: number; rainIntensity: number };
  toConfirm: string[];
}

/** A P1 model's place facts in the pre-P1 region shape (for an even older model that had no region). */
function oldRegionOf(p: Project) {
  const l = p.site.lot, s = l.services.power.supply.value ?? { phaseV: 127, lineV: 220, phases: 3 };
  return {
    lat: l.geo.lat, lon: l.geo.lon, xBearing: l.geo.xBearing, water: l.services.sewer.ask,
    supply: { utility: l.services.power.ask, ...s, confirmed: l.services.power.supply.status === 'confirmed' },
  };
}

const DATE = '2026-10-02';
/** Pre-P1 "to confirm" lines that the lot now keeps as its own fields are dropped; the others keep their text, with whom to ask. */
function confirmWho(text: string): Who | null {
  if (/survey|topograph|sewer|zone and height|zoning|supply|electric|CPFL/i.test(text)) return null;
  if (/soil|SPT|boring/i.test(text)) return 'soil';
  if (/climate/i.test(text)) return 'engineer';
  if (/deck|setback|Prefeitura|carport/i.test(text)) return 'prefeitura';
  if (/boundary|side/i.test(text)) return 'surveyor';
  return 'engineer';
}

/** Move the pre-P1 site facts into site.lot. The values the engines read stay exactly as they were. */
export function upgradeSite(o: OldSite, base?: Project): Project['site'] {
  const known = !!o.region.rules.code;
  const given = (v: number, source: string) => ({ value: v, status: known ? 'given' as const : 'to-confirm' as const, source, date: DATE });
  const tbc = <T>(v: T | null, source = '') => ({ value: v, status: 'to-confirm' as const, source, date: DATE });
  const survey = o.toConfirm.some((t) => /survey|topograph/i.test(t));
  const u = o.utilities;
  const services: Lot['services'] = !u && base ? base.site.lot.services : {
    sewer: {
      exists: { value: true, status: o.region.water ? 'given' : 'to-confirm', source: o.region.water ? 'Owner' : '', date: DATE },
      depth: u ? tbc(u.sewerDepth, `Estimate, ${o.region.water ?? 'water company'} to confirm`) : tbc<number>(null),
      offset: u?.sewerOffset ?? 5,
      ask: o.region.water ?? 'the water company',
    },
    water: { depth: u ? tbc(u.waterMainDepth, 'Estimate') : tbc<number>(null), ask: o.region.water ?? 'the water company' },
    power: {
      supply: { value: { phaseV: o.region.supply.phaseV, lineV: o.region.supply.lineV, phases: o.region.supply.phases }, status: o.region.supply.confirmed ? 'confirmed' : 'to-confirm', source: 'Owner', date: DATE },
      ask: o.region.supply.utility ?? 'electricity company',
    },
    storm: { kind: { value: 'gutter', status: o.region.water ? 'given' : 'to-confirm', source: o.region.water ? 'Owner: overflow to the street gutter' : '', date: DATE }, ask: 'Prefeitura' },
    gas: { exists: tbc<boolean>(null), wanted: false, ask: 'the gas company' },
  };
  const lot: Lot = {
    polygon: o.lotPolygon,
    shape: { status: known ? 'given' : 'to-confirm', source: known ? 'Owner' : '' },
    streetEdges: [0],
    geo: { lat: o.region.lat, lon: o.region.lon, xBearing: o.region.xBearing, status: known ? 'given' : 'to-confirm', source: known ? 'Owner: the side the street faces; city coordinates' : '' },
    terrain: { kind: o.fallStreetToRear > 0 ? 'down' : o.fallStreetToRear < 0 ? 'up' : 'flat', fall: Math.abs(o.fallStreetToRear), spots: [], status: survey || !known ? 'to-confirm' : 'given', source: survey ? 'Estimate (no topographic survey yet)' : '' },
    rules: {
      zone: tbc<string>(null, `${o.region.rules.code ?? 'City rules'} (TO CONFIRM)`),
      setbacks: {
        front: given(o.setbacks.front, 'Owner'), rear: given(o.setbacks.rear, 'Owner'),
        left: given(o.setbacks.sides, 'Owner'), right: given(o.setbacks.sides, 'Owner'),
      },
      coverage: tbc<number>(null), permeability: tbc<number>(null), far: tbc<number>(null), height: tbc<number>(null), floors: tbc<number>(null),
      eaves: o.eavesLimit === undefined ? tbc<number>(null) : { value: o.eavesLimit, status: 'given', source: o.region.rules.code ?? 'City rules', date: DATE },
      notes: '',
    },
    services,
    notes: [],
    confirm: o.toConfirm.flatMap((text) => { const who = confirmWho(text); return who ? [{ text, who }] : []; }),
  };
  const { lat: _a, lon: _b, xBearing: _c, supply: _d, water: _e, ...region } = o.region;
  return {
    address: o.address, lot, houseOrigin: o.houseOrigin, cut: o.cut, ...(o.ramp ? { ramp: o.ramp } : {}),
    region: { ...region, rainIntensity: u?.rainIntensity ?? (base ? base.site.region.rainIntensity : 150) },
  };
}
