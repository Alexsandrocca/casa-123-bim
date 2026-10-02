// P1: the sun over a lot, for the wizard: the sun path on 21 Jun and 21 Dec, sunrise and sunset directions,
// and how many hours of sun each side of the lot gets on those days. Same sun as the 3D view (scene/sun.ts).
import { sunPosition } from '../scene/sun';
import { ccwLot, edgeRoles, type EdgeRole, type P2 } from './lot';
import type { Lot, Region } from './schema';

/** The part of a project the sun needs. */
export interface SunSite { site: { lot: Lot; region: Pick<Region, 'utcOffset'> } }

export interface SunSample { hour: number; altitude: number; azimuth: number; /** horizontal unit direction towards the sun, lot axes */ dir: P2 }
export interface SunDay { month: number; day: number; samples: SunSample[]; sunrise: SunSample | null; sunset: SunSample | null }

export const SUN_DAYS = [{ month: 6, day: 21 }, { month: 12, day: 21 }] as const;
const YEAR = 2026;

function sample(s: SunSite, month: number, day: number, hour: number): SunSample {
  const p = sunPosition(YEAR, month, day, hour, s as Parameters<typeof sunPosition>[4]);
  const h = Math.hypot(p.dir[0], p.dir[1]) || 1;
  return { hour, altitude: p.altitude, azimuth: p.azimuth, dir: [p.dir[0] / h, p.dir[1] / h] };
}

/** The sun every 10 minutes while it is up, with sunrise and sunset found to the minute. */
export function sunDay(s: SunSite, month: number, day: number): SunDay {
  const samples: SunSample[] = [];
  for (let h = 4; h <= 20.001; h += 1 / 6) { const x = sample(s, month, day, h); if (x.altitude > 0) samples.push(x); }
  const edge = (from: number, step: number) => {
    let h = from;
    for (let i = 0; i < 120; i++, h += step) if (sample(s, month, day, h).altitude > 0) return sample(s, month, day, h);
    return null;
  };
  return {
    month, day, samples,
    sunrise: samples.length ? edge(samples[0]!.hour - 1 / 6, 1 / 60) : null,
    sunset: samples.length ? edge(samples[samples.length - 1]!.hour + 1 / 6, -1 / 60) : null,
  };
}

export interface SideSun { edge: number; role: EdgeRole; /** outward normal, lot axes */ normal: P2; hours: number[] }

/** Hours of direct sun on each side of the lot (the sun up and in front of that side), for each of the days. */
export function sunPerSide(s: SunSite, days: SunDay[]): SideSun[] {
  const lot = ccwLot(s.site.lot), roles = edgeRoles(lot), n = lot.polygon.length;
  return lot.polygon.map((a, i) => {
    const b = lot.polygon[(i + 1) % n]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const normal: P2 = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
    const hours = days.map((d) => d.samples.filter((x) => x.dir[0] * normal[0] + x.dir[1] * normal[1] > 0).length / 6);
    return { edge: i, role: roles[i]!, normal, hours };
  });
}
