import { describe, expect, it } from 'vitest';
import { sunPosition } from '../src/scene/sun';

describe('sun position for Piracicaba', () => {
  it('winter noon: sun low in the north (about 44° up)', () => {
    let best = sunPosition(2026, 6, 21, 12);
    for (let h = 11; h <= 13.5; h += 0.05) { const s = sunPosition(2026, 6, 21, h); if (s.altitude > best.altitude) best = s; }
    expect(best.altitude).toBeCloseTo(90 - 22.72 - 23.44, 0);
    expect(Math.min(best.azimuth, 360 - best.azimuth)).toBeLessThan(3); // due north
    expect(best.dir[0]).toBeGreaterThan(0); // +x is north
  });

  it('summer noon: sun almost overhead, slightly south', () => {
    let best = sunPosition(2026, 12, 21, 12);
    for (let h = 11; h <= 13.5; h += 0.05) { const s = sunPosition(2026, 12, 21, h); if (s.altitude > best.altitude) best = s; }
    expect(best.altitude).toBeGreaterThan(88);
  });

  it('morning sun is in the east (the street side, −y), afternoon in the west (the garden, +y)', () => {
    const am = sunPosition(2026, 6, 21, 9), pm = sunPosition(2026, 6, 21, 15);
    expect(am.dir[1]).toBeLessThan(0);
    expect(pm.dir[1]).toBeGreaterThan(0);
    expect(am.azimuth).toBeGreaterThan(20);
    expect(am.azimuth).toBeLessThan(90);
    expect(sunPosition(2026, 6, 21, 3).altitude).toBeLessThan(0);
  });
});
