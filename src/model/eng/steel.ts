// Steel sections for the pre-sizing (spec 08). W: Brazilian rolled profiles (Gerdau W150–W410 table, values to verify
// against the current catalogue). HSS: square hollow sections, properties computed from the geometry.
export interface Section {
  name: string;
  kind: 'W' | 'HSS';
  /** kg per metre */
  kg: number;
  /** depth and flange width, m */
  d: number;
  bf: number;
  /** area m², second moment m⁴, elastic and plastic moduli m³ (strong axis), radii of gyration m */
  A: number; Ix: number; Wx: number; Zx: number; rx: number; ry: number;
  /** H-shaped W (flange ≈ depth): good as columns */
  h?: boolean;
}

/** [kg/m, d mm, bf mm, A cm², Ix cm⁴, Wx cm³, ry cm] — Gerdau W table (Açominas), to verify. */
const W: [number, number, number, number, number, number, number][] = [
  [13, 148, 100, 16.6, 635, 85.8, 2.22], [18, 153, 102, 23.4, 939, 122.8, 2.32], [22.5, 152, 152, 29.0, 1229, 161.7, 3.65],
  [24, 160, 102, 31.5, 1384, 173.0, 2.37], [29.8, 157, 153, 38.5, 1739, 221.5, 3.71], [37.1, 162, 154, 47.8, 2244, 277.0, 3.84],
  [15, 200, 100, 19.4, 1305, 130.5, 2.12], [19.3, 203, 102, 25.1, 1686, 166.1, 2.22], [22.5, 206, 102, 29.0, 2029, 197.0, 2.29],
  [26.6, 207, 133, 34.2, 2611, 252.3, 3.10], [31.3, 210, 134, 40.3, 3168, 301.7, 3.19], [35.9, 201, 165, 45.7, 3437, 342.0, 4.11],
  [46.1, 203, 203, 58.6, 4543, 447.6, 5.13], [52, 206, 204, 66.9, 5298, 514.4, 5.16],
  [17.9, 251, 101, 23.1, 2291, 182.6, 1.99], [22.3, 254, 102, 28.9, 2939, 231.4, 2.06], [25.3, 257, 102, 32.6, 3473, 270.2, 2.14],
  [28.4, 260, 102, 36.6, 4046, 311.2, 2.18], [32.7, 258, 146, 42.1, 4937, 382.7, 3.35], [38.5, 262, 147, 49.6, 6057, 462.4, 3.49],
  [44.8, 266, 148, 57.6, 7158, 538.2, 3.52], [62, 246, 256, 79.6, 8728, 709.6, 6.43], [73, 253, 254, 92.7, 11257, 889.9, 6.46],
  [21, 303, 101, 27.2, 3776, 249.2, 1.90], [23.8, 305, 101, 30.7, 4346, 285.0, 1.94], [28.3, 309, 102, 36.5, 5500, 356.0, 2.08],
  [32.7, 313, 102, 42.1, 6570, 419.8, 2.13], [38.7, 310, 165, 49.7, 8581, 553.6, 3.82], [44.5, 313, 166, 57.2, 9997, 638.8, 3.87],
  [52, 317, 167, 67.0, 11909, 751.4, 3.91],
  [32.9, 349, 127, 42.1, 8358, 479.0, 2.63], [39, 353, 128, 50.2, 10331, 585.3, 2.67], [44, 352, 171, 57.7, 12258, 696.5, 3.77],
  [51, 355, 171, 64.8, 14222, 801.2, 3.87],
  [38.8, 399, 140, 50.3, 12777, 640.5, 2.83], [46.1, 403, 140, 59.2, 15690, 778.7, 2.95], [53, 403, 177, 68.4, 18734, 929.7, 3.95],
];

const fmt = (v: number) => String(+v.toFixed(1));

export const W_SECTIONS: Section[] = W.map(([kg, d, bf, A, Ix, Wx, ry]) => ({
  name: `W${d < 175 ? 150 : d < 230 ? 200 : d < 280 ? 250 : d < 330 ? 310 : d < 380 ? 360 : 410}×${fmt(kg)}`,
  kind: 'W', kg, d: d / 1000, bf: bf / 1000, A: A / 1e4, Ix: Ix / 1e8, Wx: Wx / 1e6,
  // plastic modulus of a rolled I section ≈ 1.12 × elastic (to verify per section)
  Zx: (Wx * 1.12) / 1e6, rx: Math.sqrt(Ix / A) / 100, ry: ry / 100, h: bf / d > 0.9,
}));

/** Square hollow section b × b × t (mm), properties from the geometry (sharp corners). */
function hss(b: number, t: number): Section {
  const B = b / 1000, T = t / 1000, i = B - 2 * T;
  const A = B * B - i * i, I = (B ** 4 - i ** 4) / 12, W = I / (B / 2), Z = (B ** 3 - i ** 3) / 4;
  const r = Math.sqrt(I / A);
  return { name: `HSS ${b}×${b}×${fmt(t)}`, kind: 'HSS', kg: A * 7850, d: B, bf: B, A, Ix: I, Wx: W, Zx: Z, rx: r, ry: r };
}
export const HSS_SECTIONS: Section[] = [hss(100, 4), hss(120, 5), hss(150, 5), hss(150, 6.4), hss(180, 6.4), hss(200, 8), hss(250, 8)];

export const ALL_SECTIONS = [...W_SECTIONS, ...HSS_SECTIONS];
export const section = (name: string) => ALL_SECTIONS.find((s) => s.name === name);

/** Lightest first. */
export const BEAM_CANDIDATES = [...W_SECTIONS].sort((a, b) => a.kg - b.kg);
export const COLUMN_CANDIDATES = [...W_SECTIONS.filter((s) => s.h), ...HSS_SECTIONS].sort((a, b) => a.kg - b.kg);
