// Camera framing read from the project (house size, lot, ramp), so any project gets sensible views.
import type { Project } from '../model/schema';
import { houseRect, siteFrame } from '../model/site';
import type { V3 } from './build3d';

export type Preset = 'street' | 'garden' | 'ramp' | 'top';

export function viewFrame(p: Project) {
  const h = houseRect(p), f = siteFrame(p);
  const cx = (h.x0 + h.x1) / 2, cy = (h.y0 + h.y1) / 2;
  const w = h.x1 - h.x0, d = h.y1 - h.y0;
  const size = Math.max(w, d, 6);
  const garden = Number.isFinite(f.garden) ? f.garden : 0;
  const presets: Partial<Record<Preset, { pos: V3; target: V3 }>> = {
    street: { pos: [cx, f.yStreet - 11.5, 3.4], target: [cx, h.y0 + 5, 2.0] },
    garden: { pos: [cx + 0.3, h.y1 + 11.5, 2.4], target: [cx, h.y1 - 2, garden + 2.35] },
    top: { pos: [cx, cy - 0.5, size * 2.8], target: [cx, cy, 0] },
  };
  if (p.site.ramp) presets.ramp = { pos: [h.x1 + 2.8, f.yStreet + 0.8, 1.8], target: [h.x1 + 1, h.y1 - 3, garden + 1.15] };
  return {
    center: [cx, cy, 0] as V3,
    presets,
    /** Overview from the front corner on the +x side, where the systems show. */
    overview: (z = 0.5) => ({ pos: [h.x1 + 8.4, h.y0 - 10, 11] as V3, target: [cx, cy, z] as V3 }),
    /** Section planes: across (constant y) spans x; along (constant x) spans y. */
    across: { from: h.x0 - 3, to: h.x1 + 4.4, mid: cy - 1.5 },
    along: { from: f.yStreet - 1, to: f.yRear + 1, mid: h.x0 + w * 0.285 },
  };
}
