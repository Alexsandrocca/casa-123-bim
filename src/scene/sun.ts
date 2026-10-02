// Sun position (NOAA solar calculator) for the project's place (site.region: latitude, longitude, UTC offset, north).
import { enuToHouse } from '../model/orientation';
import type { Project } from '../model/schema';

const rad = Math.PI / 180;

export interface SunPos {
  /** Degrees above the horizon. */
  altitude: number;
  /** Degrees clockwise from north. */
  azimuth: number;
  /** Unit vector towards the sun in house coordinates (x, y as the house axes, z up). */
  dir: [number, number, number];
}

/** month 1–12, hour in local time (decimal). */
export function sunPosition(year: number, month: number, day: number, hour: number, p: Pick<Project, 'site'>): SunPos {
  const site = p.site.region;
  const utcHours = hour - site.utcOffset;
  const jd0 = Date.UTC(year, month - 1, day) / 86400000 + 2440587.5;
  const jd = jd0 + utcHours / 24;
  const t = (jd - 2451545) / 36525;
  const L0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const C = Math.sin(M * rad) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * M * rad) * (0.019993 - 0.000101 * t) + Math.sin(3 * M * rad) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * rad);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * rad);
  const decl = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad));
  const y = Math.tan((eps / 2) * rad) ** 2;
  const eqTime = 4 / rad * (y * Math.sin(2 * L0 * rad) - 2 * e * Math.sin(M * rad) + 4 * e * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad)
    - 0.5 * y * y * Math.sin(4 * L0 * rad) - 1.25 * e * e * Math.sin(2 * M * rad));
  const tst = (((utcHours * 60 + eqTime + 4 * site.lon) % 1440) + 1440) % 1440;
  const ha = (tst / 4 - 180) * rad;
  const lat = site.lat * rad;
  const cosZ = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZ)));
  const altitude = 90 - zen / rad;
  let azimuth = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) / rad + 180;
  azimuth = ((azimuth % 360) + 360) % 360;
  const alt = altitude * rad, az = azimuth * rad;
  const east = Math.sin(az) * Math.cos(alt), north = Math.cos(az) * Math.cos(alt), up = Math.sin(alt);
  return { altitude, azimuth, dir: enuToHouse(p, [east, north, up]) };
}

export const SUN_PRESETS = [
  { label: '21 Jun 9:00', month: 6, day: 21, hour: 9 },
  { label: '21 Jun 15:00', month: 6, day: 21, hour: 15 },
  { label: '21 Dec 9:00', month: 12, day: 21, hour: 9 },
  { label: '21 Dec 15:00', month: 12, day: 21, hour: 15 },
];
