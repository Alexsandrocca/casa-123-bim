// P1: the lot drawn to scale, street at the bottom. Corners can be dragged (5 cm steps) on the shape step; the other
// steps add north and the sun, the ground heights, the buildable envelope and the window line, and the street services.
import { useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { ccwLot, cornerHeights, envelope, lotBox, lotFigures, naturalAt, windowLines, type P2 } from '../model/lot';
import { sunDay, SUN_DAYS, type SunSite } from '../model/lot-sun';
import { bearingDir, compassOf } from '../model/orientation';
import type { Lot, Region } from '../model/schema';
import { useT } from '../i18n/useT';

export type CanvasLayer = 'shape' | 'north' | 'terrain' | 'rules' | 'services' | 'summary';

const snap5 = (v: number) => Math.round(v * 20) / 20;
const ROLE_WORD = { street: 'street', rear: 'rear', left: 'left side', right: 'right side' } as const;

export function LotCanvas({ lot, region, layer, house, onChange }: {
  lot: Lot;
  region: Pick<Region, 'utcOffset'>;
  layer: CanvasLayer;
  /** The house footprint in lot coordinates (existing projects), drawn red when it is outside the envelope. */
  house?: P2[][];
  onChange?: (lot: Lot) => void;
}) {
  const t = useT();
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const l = useMemo(() => ccwLot(lot), [lot]);
  const fig = useMemo(() => lotFigures(l), [l]);
  const site: SunSite = { site: { lot: l, region } };
  const showSun = layer === 'north' || layer === 'summary';
  const days = useMemo(() => (showSun ? SUN_DAYS.map((d) => sunDay(site, d.month, d.day)) : []), [showSun, l.geo.lat, l.geo.lon, l.geo.xBearing, region.utcOffset]);

  const bx = lotBox(l.polygon);
  const cx = (bx.x0 + bx.x1) / 2, cy = (bx.y0 + bx.y1) / 2;
  const R = Math.max(bx.x1 - bx.x0, bx.y1 - bx.y0) * 0.62;
  const pad = showSun ? Math.max(4, R - Math.min(bx.x1 - bx.x0, bx.y1 - bx.y0) / 2 + 2.5) : 4;
  const X0 = bx.x0 - pad, X1 = bx.x1 + pad, Y0 = bx.y0 - pad - 2, Y1 = bx.y1 + pad;
  const px = (x: number) => x - X0;
  const py = (y: number) => Y1 - y;
  const W = X1 - X0, H = Y1 - Y0;
  const fs = Math.max(0.42, Math.min(W, H) / 38);
  const pts = (ps: P2[]) => ps.map(([x, y]) => `${px(x).toFixed(3)},${py(y).toFixed(3)}`).join(' ');

  const toLot = (ev: { clientX: number; clientY: number }): P2 => {
    const s = svg.current!, p = s.createSVGPoint();
    p.x = ev.clientX; p.y = ev.clientY;
    const q = p.matrixTransform(s.getScreenCTM()!.inverse());
    return [q.x + X0, Y1 - q.y];
  };
  const move = (ev: RPointerEvent<SVGSVGElement>) => {
    if (drag === null || !onChange) return;
    const [x, y] = toLot(ev);
    const poly = l.polygon.map((c, i) => (i === drag ? [snap5(x), snap5(y)] as P2 : c));
    onChange({ ...l, polygon: poly, shape: { status: 'given', source: 'Drawn by the family' } });
  };

  const out: ReactNode[] = [];
  const n = l.polygon.length;
  // the street beyond each street side
  l.polygon.forEach((a, i) => {
    if (!l.streetEdges.includes(i)) return;
    const b = l.polygon[(i + 1) % n]!, len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = (b[1] - a[1]) / len, ny = -(b[0] - a[0]) / len, w = 3;
    out.push(<polygon key={`st${i}`} points={pts([a, b, [b[0] + nx * w, b[1] + ny * w], [a[0] + nx * w, a[1] + ny * w]])} className="lc-street" />);
    out.push(<text key={`stt${i}`} x={px((a[0] + b[0]) / 2 + nx * 1.6)} y={py((a[1] + b[1]) / 2 + ny * 1.6)} className="lc-streett" style={{ fontSize: fs * 1.1 }} textAnchor="middle" dominantBaseline="middle">{t('STREET')}</text>);
  });
  out.push(<polygon key="lot" points={pts(l.polygon)} className="lc-lot" data-testid="lc-lot" />);

  // ground: heights at the corners and the direction it falls
  if (layer === 'terrain' || layer === 'summary') {
    const [a, b, c, d] = cornerHeights(l);
    const corners: [P2, number][] = [[[bx.x0, bx.y0], a], [[bx.x1, bx.y0], b], [[bx.x1, bx.y1], c], [[bx.x0, bx.y1], d]];
    for (let k = 0; k < 6; k++) for (let j = 0; j < 6; j++) {
      const x = bx.x0 + ((k + 0.5) * (bx.x1 - bx.x0)) / 6, y = bx.y0 + ((j + 0.5) * (bx.y1 - bx.y0)) / 6;
      const z = naturalAt(l, x, y), lo = Math.min(a, b, c, d), hi = Math.max(a, b, c, d);
      const tt = hi - lo > 1e-6 ? (z - lo) / (hi - lo) : 0.5;
      out.push(<rect key={`g${k}${j}`} x={px(x - (bx.x1 - bx.x0) / 12)} y={py(y + (bx.y1 - bx.y0) / 12)} width={(bx.x1 - bx.x0) / 6} height={(bx.y1 - bx.y0) / 6} className="lc-ground" style={{ opacity: 0.12 + 0.4 * tt }} />);
    }
    corners.forEach(([[x, y], z], i) => out.push(<text key={`h${i}`} x={px(x)} y={py(y) + (i < 2 ? fs * 1.6 : -fs * 0.7)} className="lc-h" style={{ fontSize: fs }} textAnchor={i === 0 || i === 3 ? 'start' : 'end'}>{`${z >= 0 ? '+' : '−'}${t.n(Math.abs(z), 2)} m`}</text>));
  }

  // envelope and window line
  if (layer === 'rules' || layer === 'summary') {
    const env = envelope(l);
    if (env.length) out.push(<polygon key="env" points={pts(env)} className="lc-env" data-testid="lc-envelope" />);
    windowLines(l).forEach(([a, b], i) => out.push(<line key={`wl${i}`} x1={px(a[0])} y1={py(a[1])} x2={px(b[0])} y2={py(b[1])} className="lc-win" />));
  }

  // the house (an existing design), red if any corner is outside the envelope
  if (house?.length) {
    const env = envelope(l);
    const inside = (p: P2) => env.length >= 3 && env.every((a, i) => { const b = env[(i + 1) % env.length]!; return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -1e-6; });
    const out1 = house.some((poly) => poly.some((p) => !inside(p)));
    house.forEach((poly, i) => out.push(<polygon key={`house${i}`} points={pts(poly)} className={'lc-house' + (out1 ? ' outside' : '')} data-testid={i === 0 ? 'lc-house' : undefined} data-outside={out1 ? '1' : '0'} />));
  }

  // side lengths and roles
  l.polygon.forEach((a, i) => {
    const b = l.polygon[(i + 1) % n]!, len = fig.sides[i]!;
    const nx = (b[1] - a[1]) / (len || 1), ny = -(b[0] - a[0]) / (len || 1);
    const off = l.streetEdges.includes(i) ? -0.9 : 1.1;
    const ang = (Math.atan2(-(b[1] - a[1]), b[0] - a[0]) * 180) / Math.PI;
    const up = ang > 90 || ang < -90 ? ang + 180 : ang;
    const mx = px((a[0] + b[0]) / 2 + nx * off), my = py((a[1] + b[1]) / 2 + ny * off);
    out.push(<text key={`len${i}`} x={mx} y={my} className="lc-len" style={{ fontSize: fs }} textAnchor="middle" dominantBaseline="middle" transform={`rotate(${up.toFixed(1)} ${mx.toFixed(2)} ${my.toFixed(2)})`} data-testid={`lc-side-${i}`}>
      {`${t.n(len, 2)} m · ${t(ROLE_WORD[fig.roles[i]!])}`}
    </text>);
  });

  // sun paths (a polar sun chart centred on the lot: the further from the centre, the lower the sun)
  if (showSun) {
    out.push(<circle key="sunr" cx={px(cx)} cy={py(cy)} r={R} className="lc-sunring" />);
    days.forEach((d, k) => {
      const at = (s: { altitude: number; dir: P2 }): P2 => [cx + s.dir[0] * R * (1 - s.altitude / 90), cy + s.dir[1] * R * (1 - s.altitude / 90)];
      const cls = d.month === 6 ? 'lc-sun jun' : 'lc-sun dec';
      out.push(<polyline key={`sp${k}`} points={pts(d.samples.map(at))} className={cls} data-testid={`lc-sunpath-${d.month}`} />);
      for (const s of d.samples) {
        if (Math.abs(s.hour - Math.round(s.hour)) > 0.01 || Math.round(s.hour) % 3) continue;
        const [x, y] = at(s);
        out.push(<circle key={`sd${k}${s.hour}`} cx={px(x)} cy={py(y)} r={fs * 0.25} className={cls + ' dot'} />);
        out.push(<text key={`st${k}${s.hour}`} x={px(x)} y={py(y) - fs * 0.5} className="lc-hour" style={{ fontSize: fs * 0.8 }} textAnchor="middle">{`${Math.round(s.hour)}h`}</text>);
      }
      for (const [s, word] of [[d.sunrise, t('sunrise')], [d.sunset, t('sunset')]] as const) {
        if (!s) continue;
        const [x, y] = [cx + s.dir[0] * (R + 1.2), cy + s.dir[1] * (R + 1.2)];
        const hh = Math.floor(s.hour), mm = Math.round((s.hour - hh) * 60);
        out.push(<line key={`ra${k}${word}`} x1={px(cx + s.dir[0] * R)} y1={py(cy + s.dir[1] * R)} x2={px(x)} y2={py(y)} className={cls + ' arrow'} />);
        out.push(<text key={`rt${k}${word}`} x={px(x + s.dir[0] * 0.6)} y={py(y + s.dir[1] * 0.6) + (d.month === 6 ? fs : -fs * 0.4)} className="lc-hour" style={{ fontSize: fs * 0.8 }} textAnchor={s.dir[0] >= 0 ? 'start' : 'end'}>
          {`${word} ${d.day}/${d.month} ${hh}:${String(mm).padStart(2, '0')}`}
        </text>);
      }
    });
  }

  // north arrow
  const north = bearingDir(site as never, 0);
  const nax = X1 - pad * 0.45, nay = Y1 - pad * 0.55 - (showSun ? 0 : 0);
  out.push(
    <g key="north" className="lc-north" data-testid="lc-north" data-north={`${north[0].toFixed(3)},${north[1].toFixed(3)}`}>
      <line x1={px(nax - north[0] * 1.3)} y1={py(nay - north[1] * 1.3)} x2={px(nax + north[0] * 1.3)} y2={py(nay + north[1] * 1.3)} />
      <circle cx={px(nax + north[0] * 1.3)} cy={py(nay + north[1] * 1.3)} r={fs * 0.35} />
      <text x={px(nax + north[0] * 2.2)} y={py(nay + north[1] * 2.2)} style={{ fontSize: fs * 1.1 }} textAnchor="middle" dominantBaseline="middle">N</text>
    </g>,
  );

  // street services along the first street side
  if (layer === 'services' || layer === 'summary') {
    const i = l.streetEdges[0] ?? 0, a = l.polygon[i]!, b = l.polygon[(i + 1) % n]!;
    const s = l.services;
    const items = [
      `${t('Sewer')}: ${s.sewer.exists.value === false ? t('none') : s.sewer.depth.value === null ? t('depth to confirm') : `−${t.n(s.sewer.depth.value, 2)} m`}`,
      `${t('Water')}: ${s.water.depth.value === null ? t('depth to confirm') : `−${t.n(s.water.depth.value, 2)} m`}`,
      `${t('Power')}: ${s.power.supply.value ? `${s.power.supply.value.phaseV}/${s.power.supply.value.lineV} V ${s.power.supply.value.phases}φ` : t('to confirm')}`,
    ];
    items.forEach((txt, k) => out.push(<text key={`sv${k}`} x={px(a[0] + ((b[0] - a[0]) * (k + 0.5)) / 3)} y={py((a[1] + b[1]) / 2) + fs * 3.2} className="lc-svc" style={{ fontSize: fs * 0.85 }} textAnchor="middle">{txt}</text>));
  }

  // draggable corners
  if (layer === 'shape' && onChange) {
    l.polygon.forEach(([x, y], i) => out.push(
      <circle key={`c${i}`} cx={px(x)} cy={py(y)} r={fs * 0.55} className={'lc-corner' + (drag === i ? ' on' : '')} data-corner={i}
        onPointerDown={(e) => { e.preventDefault(); (e.target as Element).setPointerCapture?.(e.pointerId); setDrag(i); }} />,
    ));
  }

  // scale bar: 5 m
  out.push(<g key="scale" className="lc-scale"><line x1={px(X0 + 1)} y1={py(Y0 + 1)} x2={px(X0 + 6)} y2={py(Y0 + 1)} /><text x={px(X0 + 3.5)} y={py(Y0 + 1) - fs * 0.4} style={{ fontSize: fs * 0.8 }} textAnchor="middle">5 m</text></g>);

  const compass = compassOf(site as never, 0, -1);
  return (
    <svg ref={svg} className="lotcanvas" viewBox={`0 0 ${W.toFixed(2)} ${H.toFixed(2)}`} role="img" data-testid="lot-canvas"
      aria-label={t('The lot to scale, the street at the bottom (facing {dir})', { dir: t(({ N: 'north', E: 'east', S: 'south', W: 'west' } as const)[compass]) })}
      onPointerMove={move} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}>
      {out}
    </svg>
  );
}
