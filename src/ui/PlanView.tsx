// The 2D plan: draws one floor of the model and turns pointer gestures into commands.
import { useMemo, useRef, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { minArea } from '../model/checks';
import { addDevice, addOpening, moveDevice, moveFixture, moveOpening, moveWall, nextDeviceId, nextOpeningId, wallLimits } from '../model/commands';
import { cameraFov, cameraRange, deviceType } from '../model/electrical/library';
import { nearestWallPoint } from '../model/electrical/place';
import { kindOf } from '../model/plumbing/library';
import {
  byLevel, lineHandles, mainCell, openingSeg, snap, spaceArea, wallSeg, type Handle, type Seg,
} from '../model/geometry';
import type { Carport, Opening, Rect, Space, Wall } from '../model/schema';
import { useApp, useProject } from '../store';

const S = 40; // px per metre, same drawing scale as the prototype

export const ZONE_COLOR: Record<string, string> = {
  social: 'var(--soc)', private: 'var(--pri)', wet: 'var(--wet)', service: 'var(--svc)',
  circ: 'var(--cir)', work: 'var(--wrk)', stair: 'var(--str)', garage: 'var(--gar)',
};

interface Frame { XMIN: number; XMAX: number; YMIN: number; YMAX: number }
const f1 = (v: number) => +v.toFixed(1);

type Drag =
  | { kind: 'wall'; h: Handle; at: number; x0: number; y0: number; moved: boolean }
  | { kind: 'opening'; id: string; o: 'v' | 'h'; off: number; x0: number; y0: number; moved: boolean }
  | { kind: 'fixture'; id: string; dx: number; dy: number; x0: number; y0: number; moved: boolean }
  | { kind: 'device'; id: string; dx: number; dy: number; x0: number; y0: number; moved: boolean };

/** Fixtures and pipes shown on a floor plan: those of the floor, plus site items on the street level and roof items on the upper floor. */
export const onPlan = (elLevel: string, level: string) => elLevel === level || (level === 'SL' && elLevel === 'site') || (level === 'UF' && elLevel === 'roof');

export function PlanView() {
  const p = useProject();
  const level = useApp((s) => s.level);
  const selection = useApp((s) => s.selection);
  const tool = useApp((s) => s.tool);
  const plumbing2d = useApp((s) => s.plumbing2d);
  const elec2d = useApp((s) => s.elec2d);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const infoRef = useRef<HTMLDivElement>(null);

  const lv = p.levels.find((l) => l.id === level)!;
  const outline = lv.outline!;
  const spaces = byLevel(p, level, 'Space');
  const walls = byLevel(p, level, 'Wall');
  const openings = byLevel(p, level, 'Opening');
  const decks = byLevel(p, level, 'Deck');
  const handles = useMemo(() => lineHandles(p, level), [p, level]);

  // Each floor fills the view, as in the prototype.
  // The carport sits in front of the street level: draw it there.
  const carports = level === 'SL' ? p.elements.filter((e): e is Carport => e.type === 'Carport') : [];
  const front = Math.min(outline.y0, ...carports.map((c) => c.props.rect.y0));
  const fr: Frame = {
    XMIN: outline.x0 - 1.3, XMAX: outline.x1 + 1.0, YMIN: front - 1.5,
    YMAX: Math.max(outline.y1, ...decks.map((d) => d.props.rect.y1), ...(plumbing2d ? p.elements.flatMap((e) => (e.type === 'Fixture' && onPlan(e.level, level) ? [e.props.at[1] + 0.6] : [])) : [])) + 0.5,
  };
  const px = (x: number) => f1((x - fr.XMIN) * S);
  const py = (y: number) => f1((fr.YMAX - y) * S);
  const W = (fr.XMAX - fr.XMIN) * S, H = (fr.YMAX - fr.YMIN) * S;

  const line = (x0: number, y0: number, x1: number, y1: number, cls: string, key?: string | number, extra: object = {}) =>
    <line key={key} x1={px(x0)} y1={py(y0)} x2={px(x1)} y2={py(y1)} className={cls} {...extra} />;
  const rect = (r: Rect, cls: string, key?: string | number, extra: object = {}) =>
    <rect key={key} x={px(Math.min(r.x0, r.x1))} y={py(Math.max(r.y0, r.y1))} width={f1(Math.abs(r.x1 - r.x0) * S)} height={f1(Math.abs(r.y1 - r.y0) * S)} className={cls} {...extra} />;
  const segLine = (s: Seg, cls: string, key?: string | number, extra: object = {}) =>
    s.o === 'v' ? line(s.c, s.a, s.c, s.b, cls, key, extra) : line(s.a, s.c, s.b, s.c, cls, key, extra);

  /* ---------- pointer → plan coordinates ---------- */
  const toPlan = (ev: { clientX: number; clientY: number }): [number, number] => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    const q = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return [q.x / S + fr.XMIN, fr.YMAX - q.y / S];
  };

  const nearestWall = (x: number, y: number, maxDist: number): Wall | undefined => {
    let best: Wall | undefined, bd = maxDist;
    for (const w of walls) {
      const s = wallSeg(w);
      const along = s.o === 'v' ? y : x, d = Math.abs((s.o === 'v' ? x : y) - s.c);
      if (along < s.a || along > s.b) continue;
      if (d < bd) { bd = d; best = w; }
    }
    return best;
  };

  const addAt = (x: number, y: number, want?: 'door' | 'window') => {
    const st = useApp.getState();
    const w = nearestWall(x, y, 0.4);
    if (!w) { st.flash('Click on a wall to add a door or window.'); return; }
    const exterior = w.props.wallType === 'exterior' || w.props.wallType === 'retaining';
    const role = want ?? (exterior ? 'window' : 'door');
    if (role === 'window' && !exterior) { st.flash('Windows go on outside walls. Use a door for an inside wall.'); return; }
    if (w.props.wallType === 'retaining') { st.flash('That wall holds back the ground (retaining wall), so it cannot have openings.'); return; }
    const s = wallSeg(w);
    const id = nextOpeningId(st.versions[st.active].present, level, role);
    if (st.run(addOpening(id, w.id, s.o === 'v' ? y : x, role))) st.select(id);
  };

  const onPointerDown = (ev: RPointerEvent<SVGSVGElement>) => {
    if (ev.button !== 0) return;
    const st = useApp.getState();
    const [x, y] = toPlan(ev);
    if (tool === 'outlet') {
      const room = spaces.find((sp) => sp.props.cells.some((c) => x > c.x0 && x < c.x1 && y > c.y0 && y < c.y1));
      if (!room) { st.flash('Click inside a room to add an outlet on its nearest wall.'); return; }
      const at = nearestWallPoint(room, [x, y]);
      const id = nextDeviceId(st.versions[st.active].present, 'outlet');
      if (st.run(addDevice(id, 'outlet', level, at, `Outlet · ${room.props.name}`))) { st.select(id); st.flash(`Outlet added to ${room.props.name}; its circuit, cable and schedule are updated.`); }
      return;
    }
    if (tool !== 'select') { addAt(x, y, tool); return; }
    const t = ev.target as Element;
    const dg = elec2d ? t.closest('[data-device]') : null;
    if (dg) {
      const id = dg.getAttribute('data-device')!;
      const dv = p.elements.find((e) => e.id === id);
      st.select(id);
      if (dv?.type === 'Device') {
        drag.current = { kind: 'device', id, dx: x - dv.props.at[0], dy: y - dv.props.at[1], x0: x, y0: y, moved: false };
        svgRef.current!.setPointerCapture(ev.pointerId);
        ev.preventDefault();
      }
      return;
    }
    const fg = plumbing2d ? t.closest('[data-fixture]') : null;
    if (fg) {
      const id = fg.getAttribute('data-fixture')!;
      const fx = p.elements.find((e) => e.id === id);
      st.select(id);
      if (fx?.type === 'Fixture' && !fx.tags.includes('auto')) {
        drag.current = { kind: 'fixture', id, dx: x - fx.props.at[0], dy: y - fx.props.at[1], x0: x, y0: y, moved: false };
        svgRef.current!.setPointerCapture(ev.pointerId);
        ev.preventDefault();
      }
      return;
    }
    const og = t.closest('[data-opening]'), hg = t.closest('[data-handle]'), wg = t.closest('[data-wall]'), sg = t.closest('[data-space]');
    if (og) {
      const id = og.getAttribute('data-opening')!;
      const op = openings.find((o) => o.id === id)!;
      const host = walls.find((w) => w.id === op.props.host)!;
      const s = openingSeg(op, host);
      st.select(id);
      drag.current = { kind: 'opening', id, o: s.o, off: (s.o === 'h' ? x : y) - s.a, x0: x, y0: y, moved: false };
    } else if (hg) {
      const h = handles[Number(hg.getAttribute('data-handle'))]!;
      const at = h.o === 'v' ? y : x;
      const w = nearestWall(x, y, 0.5);
      st.select(w && wallSeg(w).o === h.o ? w.id : null);
      if (h.locked) { st.flash('That wall belongs to the stair core, which stays fixed.'); return; }
      drag.current = { kind: 'wall', h, at, x0: x, y0: y, moved: false };
    } else if (wg) {
      st.select(wg.getAttribute('data-wall'));
      st.flash('The outer walls stay fixed. Drag an inside wall to resize rooms.');
      return;
    } else if (t.closest('[data-el]')) {
      st.select(t.closest('[data-el]')!.getAttribute('data-el'));
      return;
    } else if (sg) {
      st.select(sg.getAttribute('data-space'));
      return;
    } else { st.select(null); return; }
    svgRef.current!.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  };

  const onPointerMove = (ev: RPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const [x, y] = toPlan(ev);
    if (!d.moved && Math.hypot(x - d.x0, y - d.y0) < 0.04) return;
    d.moved = true;
    const st = useApp.getState();
    if (d.kind === 'wall') {
      const to = d.h.o === 'v' ? x : y;
      st.previewCmd(moveWall(level, d.h.o, d.h.c, d.at, to));
      const lim = wallLimits(st.versions[st.active].present, level, d.h.o, d.h.c, d.at);
      if (infoRef.current && lim) {
        const at = Math.min(Math.max(snap(to), lim.lo), lim.hi);
        const edge = at === lim.lo || at === lim.hi ? ' · rooms keep at least 0.80 m' : '';
        infoRef.current.textContent = `Wall at ${at.toFixed(2)} m${edge}`;
      }
    } else if (d.kind === 'device') {
      st.previewCmd(moveDevice(d.id, x - d.dx, y - d.dy));
      const dv = useApp.getState().preview?.elements.find((e) => e.id === d.id);
      if (infoRef.current && dv?.type === 'Device') infoRef.current.textContent = `${dv.props.name} at x ${dv.props.at[0].toFixed(2)}, y ${dv.props.at[1].toFixed(2)} · circuit re-routed`;
    } else if (d.kind === 'fixture') {
      st.previewCmd(moveFixture(d.id, x - d.dx, y - d.dy));
      const f = useApp.getState().preview?.elements.find((e) => e.id === d.id);
      if (infoRef.current && f?.type === 'Fixture') infoRef.current.textContent = `${f.props.name} at x ${f.props.at[0].toFixed(2)}, y ${f.props.at[1].toFixed(2)} · pipes re-routed`;
    } else {
      st.previewCmd(moveOpening(d.id, (d.o === 'h' ? x : y) - d.off));
    }
  };

  const endDrag = () => {
    const d = drag.current;
    drag.current = null;
    if (infoRef.current) infoRef.current.textContent = '';
    if (!d) return;
    const st = useApp.getState();
    if (d.moved) st.commitPreview(); else st.cancelPreview();
  };

  const onDoubleClick = (ev: React.MouseEvent<SVGSVGElement>) => {
    if (tool !== 'select') return;
    const [x, y] = toPlan(ev);
    addAt(x, y);
  };

  /* ---------- drawing ---------- */
  const out: ReactNode[] = [];
  out.push(rect(outline, 'floor', 'floor'));
  decks.forEach((d) => {
    const r = d.props.rect;
    out.push(rect(r, 'deck', d.id, { 'data-el': d.id }));
    if (d.props.planter) out.push(rect(d.props.planter, 'planter', d.id + 'p'));
    if (d.props.steps) {
      const st = d.props.steps;
      out.push(rect(st, 'stepsbg', d.id + 's'));
      for (let y = st.y0 + 0.3; y < st.y1 - 0.01; y += 0.3) out.push(line(st.x0, y, st.x1, y, 'tread', `${d.id}st${y.toFixed(2)}`));
      out.push(line((st.x0 + st.x1) / 2, st.y1 - 0.1, (st.x0 + st.x1) / 2, st.y0 + 0.1, 'sarrow', d.id + 'sa'));
    }
    out.push(<text key={d.id + 't'} x={px((r.x0 + r.x1) / 2)} y={py((r.y0 + r.y1) / 2 - 0.05)} className="deckt" textAnchor="middle">{d.props.label}</text>);
  });
  for (const c of carports) {
    const r = c.props.rect;
    out.push(rect(r, 'carport' + (selection === c.id ? ' sel' : ''), c.id, { 'data-el': c.id }));
    c.props.parking.forEach((b, i) => {
      out.push(rect(b, 'bay', `${c.id}b${i}`));
      out.push(<text key={`${c.id}bt${i}`} x={px((b.x0 + b.x1) / 2)} y={py((b.y0 + b.y1) / 2)} className="deckt" textAnchor="middle">{`car ${i + 1} · 2.50 × 5.00`}</text>);
    });
    for (const col of p.elements) {
      if (col.type !== 'Column' || !col.tags.includes('carport')) continue;
      const [x, y] = col.props.at;
      out.push(rect({ x0: x - 0.08, y0: y - 0.08, x1: x + 0.08, y1: y + 0.08 }, 'ccol', col.id, { 'data-el': col.id }));
    }
    for (const d of p.elements) {
      if (d.type !== 'Device' || d.level !== 'carport') continue;
      const at = d.props.at as number[];
      out.push(rect({ x0: at[0]! - 0.12, y0: at[1]! - 0.12, x1: at[0]! + 0.12, y1: at[1]! + 0.12 }, 'ebx', d.id, { 'data-el': d.id }));
      out.push(<text key={d.id + 't'} x={px(at[0]! - 0.3)} y={py(at[1]! + 0.25)} className="deckt" textAnchor="end">EV 7 kW</text>);
    }
    out.push(<text key={c.id + 't'} x={px((r.x0 + r.x1) / 2)} y={py(r.y0 + 0.35)} className="deckt strong" textAnchor="middle">{`${c.props.name} · roof +${c.props.roofFront.toFixed(2)} → +${(c.props.roofFront + c.props.slope * (r.y1 - r.y0)).toFixed(2)} · ${c.props.solarModules} solar modules`}</text>);
  }
  for (const s of spaces) {
    if (s.props.zone === 'stair') continue;
    s.props.cells.forEach((c, i) => out.push(rect(c, 'cell', `${s.id}:${i}`, { style: { fill: ZONE_COLOR[s.props.zone] }, 'data-space': s.id })));
  }
  for (const s of spaces) if (s.props.zone === 'stair') out.push(<Stair key={s.id} s={s} level={level} rect={rect} line={line} px={px} py={py} />);
  const sel = selection ? p.elements.find((e) => e.id === selection) : undefined;
  if (sel?.type === 'Space' && sel.level === level) sel.props.cells.forEach((c, i) => out.push(rect(c, 'selcell', `sel${i}`)));

  // Room boundaries without a wall (open plan) are shown faintly so they can be found and dragged.
  handles.forEach((h, i) => out.push(segLine(h, 'bound', `b${i}`)));
  for (const w of walls) {
    const s = wallSeg(w);
    const cls = w.props.wallType === 'retaining' ? 'retwall' : w.props.wallType === 'exterior' ? 'extwall' : w.props.wallType === 'wet' ? 'wall wet' : 'wall';
    out.push(segLine(s, cls, w.id));
  }
  if (sel?.type === 'Wall' && sel.level === level) out.push(segLine(wallSeg(sel), 'selwall', 'selwall'));
  // Hit areas: outer walls (select only), then inside-wall handles (drag).
  for (const w of walls) {
    if (w.props.wallType !== 'exterior' && w.props.wallType !== 'retaining') continue;
    out.push(segLine(wallSeg(w), 'wallhit', `hit${w.id}`, { 'data-wall': w.id }));
  }
  handles.forEach((h, i) => {
    const inset = Math.min(0.15, (h.b - h.a) / 4);
    const s = { ...h, a: h.a + inset, b: h.b - inset };
    out.push(segLine(s, 'handle' + (h.locked ? ' locked' : ''), `h${i}`, { 'data-handle': i, 'data-line': `${h.o}:${h.c.toFixed(2)}:${h.a.toFixed(2)}` }));
  });
  for (const op of openings) {
    const host = walls.find((w) => w.id === op.props.host);
    if (host) out.push(<OpeningGlyph key={op.id} op={op} s={openingSeg(op, host)} selected={selection === op.id} line={line} rect={rect} px={px} py={py} />);
  }

  if (elec2d) out.push(<ElectricalOverlay key="elec" p={p} level={level} selection={selection} line={line} rect={rect} px={px} py={py} />);
  if (plumbing2d) out.push(<PlumbingOverlay key="plumbing" p={p} level={level} selection={selection} line={line} rect={rect} px={px} py={py} />);

  // Room names and areas.
  for (const s of spaces) {
    if (s.props.zone === 'stair') continue;
    const c = mainCell(s);
    const a = spaceArea(s), m = minArea(s), bad = m > 0 && a < m - 0.005;
    const cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2;
    out.push(<text key={s.id + 'n'} x={px(cx)} y={py(cy + 0.1)} className={c.x1 - c.x0 < 2.2 ? 'rn2' : 'rn'} textAnchor="middle">{s.props.name}</text>);
    out.push(<text key={s.id + 'a'} x={px(cx)} y={py(cy) + 14} className={'ra' + (bad ? ' bad' : '')} textAnchor="middle" data-room={s.props.name}>{`${a.toFixed(1)} m²${bad ? ' · min ' + m : ''}`}</text>);
  }

  // Live dimension strings along the front and the south side.
  const xs = [...new Set(spaces.flatMap((s) => s.props.cells.flatMap((c) => [c.x0, c.x1])).map((v) => +v.toFixed(2)))].sort((a, b) => a - b);
  const ys = [...new Set(spaces.flatMap((s) => s.props.cells.flatMap((c) => [c.y0, c.y1])).map((v) => +v.toFixed(2)))].sort((a, b) => a - b);
  const yd = front - 0.75, xd = outline.x0 - 0.75;
  out.push(line(xs[0]!, yd, xs[xs.length - 1]!, yd, 'dim', 'dx'));
  xs.forEach((v, i) => {
    out.push(line(v, yd - 0.12, v, yd + 0.12, 'dim', `dx${i}`));
    if (i) out.push(<text key={`dxt${i}`} x={px((v + xs[i - 1]!) / 2)} y={py(yd) - 4} className="dt" textAnchor="middle">{(v - xs[i - 1]!).toFixed(2)}</text>);
  });
  out.push(line(xd, ys[0]!, xd, ys[ys.length - 1]!, 'dim', 'dy'));
  ys.forEach((v, i) => {
    out.push(line(xd - 0.12, v, xd + 0.12, v, 'dim', `dy${i}`));
    if (i && v - ys[i - 1]! > 0.5) {
      const m = (v + ys[i - 1]!) / 2, tx = px(xd) - 5, ty = py(m);
      out.push(<text key={`dyt${i}`} x={tx} y={ty} className="dt" textAnchor="middle" transform={`rotate(-90 ${tx} ${ty})`}>{(v - ys[i - 1]!).toFixed(2)}</text>);
    }
  });
  out.push(<text key="street" x={px((outline.x0 + outline.x1) / 2)} y={py(front - 1.25)} className="street" textAnchor="middle">STREET · EAST ↓ · NORTH →</text>);

  return (
    <div className="planwrap">
      <svg
        ref={svgRef} className={'plan tool-' + tool} viewBox={`0 0 ${W.toFixed(0)} ${H.toFixed(0)}`}
        role="img" aria-label={`Editable floor plan, ${lv.name}`}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
        onDoubleClick={onDoubleClick}
      >
        {out}
      </svg>
      <div ref={infoRef} className="draginfo" aria-live="polite" />
    </div>
  );
}

/* ---------- glyphs ---------- */

type LineFn = (x0: number, y0: number, x1: number, y1: number, cls: string, key?: string | number, extra?: object) => ReactNode;
type RectFn = (r: Rect, cls: string, key?: string | number, extra?: object) => ReactNode;
interface Draw { line: LineFn; rect: RectFn; px: (x: number) => number; py: (y: number) => number }

function OpeningGlyph({ op, s, selected, line, rect, px, py }: { op: Opening; s: Seg; selected: boolean } & Draw) {
  const parts: ReactNode[] = [];
  const L = (cls: string, k: string) => (s.o === 'h' ? line(s.a, s.c, s.b, s.c, cls, k) : line(s.c, s.a, s.c, s.b, cls, k));
  parts.push(L('gap', 'g'));
  const { kind, role, swing } = op.props;
  if (role === 'window') parts.push(L(op.props.high ? 'glassh' : 'glass', 'w'));
  else if (kind === 'garage') parts.push(L('gdoor', 'gd'));
  else if (kind === 'slider') parts.push(L('glass', 'sl'));
  else {
    const w = s.b - s.a;
    if (s.o === 'h') {
      const lx = s.a, ly = s.c + swing * w;
      parts.push(line(s.a, s.c, lx, ly, 'leaf', 'leaf'));
      parts.push(<path key="sw" d={`M${px(s.a + w)},${py(s.c)} A${w * 40},${w * 40} 0 0 ${swing > 0 ? 1 : 0} ${px(lx)},${py(ly)}`} className="swing" />);
    } else {
      const lx = s.c + swing * w, ly = s.a;
      parts.push(line(s.c, s.a, lx, ly, 'leaf', 'leaf'));
      parts.push(<path key="sw" d={`M${px(s.c)},${py(s.a + w)} A${w * 40},${w * 40} 0 0 ${swing > 0 ? 0 : 1} ${px(lx)},${py(ly)}`} className="swing" />);
    }
  }
  const pad = role === 'door' ? 0.25 : 0.22;
  const hit = s.o === 'h' ? { x0: s.a, y0: s.c - pad, x1: s.b, y1: s.c + pad } : { x0: s.c - pad, y0: s.a, x1: s.c + pad, y1: s.b };
  parts.push(rect(hit, 'hit ' + (role === 'door' ? 'door' : 'win') + (selected ? ' sel' : ''), 'hit'));
  return <g data-opening={op.id}>{parts}</g>;
}

function Stair({ s, level, rect, line, px, py }: { s: Space; level: string } & Draw) {
  const c = s.props.cells[0]!;
  const o: ReactNode[] = [rect(c, 'stairbg', 'bg', { 'data-space': s.id })];
  const chev = (x: number, y: number, k: string) =>
    <path key={k} d={`M${px(x - 0.2)},${py(y - 0.28)} L${px(x)},${py(y)} L${px(x + 0.2)},${py(y - 0.28)}`} className="sarrow" />;
  const lane = (x0: number, x1: number, y0: number, y1: number, label: string, faint: boolean, k: string) => {
    const r: ReactNode[] = [];
    let i = 0;
    for (let t = y0 + 0.27; t < y1 - 0.05; t += 0.27) r.push(line(x0, t, x1, t, faint ? 'tread faint' : 'tread', `${k}t${i++}`));
    const cx = (x0 + x1) / 2;
    r.push(line(cx, y0 + 0.25, cx, y1 - 0.15, 'sarrow', `${k}a`), chev(cx, y1 - 0.15, `${k}c`));
    r.push(<text key={`${k}l`} x={px(cx)} y={py(y0 + 0.12)} className="stxt" textAnchor="middle">{label}</text>);
    return r;
  };
  const note = (y: number, label: string) =>
    <text key="note" x={px((c.x0 + c.x1) / 2)} y={py(y)} className="stxt" textAnchor="middle">{label}</text>;
  const kind = s.props.stairKind;
  if (kind === 'dual') {
    const m = (c.x0 + c.x1) / 2;
    o.push(...lane(c.x0, m - 0.08, c.y0, c.y1, 'UP', false, 'u'), ...lane(m + 0.08, c.x1, c.y0, c.y1, 'DOWN', false, 'd'));
    o.push(rect({ x0: m - 0.08, y0: c.y0 + 0.3, x1: m + 0.08, y1: c.y1 }, 'cwall', 'cw'), line(c.x1, c.y0 + 0.3, c.x1, c.y1, 'rail', 'rail'));
  } else if (kind === 'lane') {
    o.push(...lane(c.x0, c.x1, c.y0, c.y1, 'from street', false, 'l'), note(c.y1 + 0.5, 'garden ↑'));
  } else if (kind === 'void') {
    o.push(...lane(c.x0, c.x1, c.y0, c.y1, 'UP', true, 'v'), line(c.x1, c.y0, c.x1, c.y1, 'rail', 'rail'), note(c.y1 + 0.45, 'arrive'));
  } else {
    // U-stair open to the rear; the landing is at the front end.
    const mid = (c.x0 + c.x1) / 2, land = 1.1;
    let i = 0;
    for (let t = c.y1 - 0.28; t > c.y0 + land + 0.01; t -= 0.28) {
      o.push(line(c.x0, t, mid - 0.05, t, 'tread', `ta${i}`), line(mid + 0.05, t, c.x1, t, 'tread', `tb${i}`));
      i++;
    }
    o.push(line(c.x0, c.y0 + land, c.x1, c.y0 + land, 'tread', 'land'), rect({ x0: mid - 0.05, y0: c.y0 + land, x1: mid + 0.05, y1: c.y1 }, 'cwall', 'cw'));
    const ax = c.x0 + 0.6, bx = c.x1 - 0.6;
    o.push(<path key="arr" d={`M${px(bx)},${py(c.y1 - 0.2)} L${px(bx)},${py(c.y0 + 0.55)} L${px(ax)},${py(c.y0 + 0.55)} L${px(ax)},${py(c.y1 - 0.25)}`} className="sarrow" />);
    if (level === 'LL') o.push(note(c.y1 + 0.45, 'to garden ↑'));
  }
  return <g>{o}</g>;
}


/* ---------- plumbing overlay (spec 03) ---------- */

function PlumbingOverlay({ p, level, selection, line, rect, px, py }: { p: import('../model/schema').Project; level: string; selection: string | null } & Draw) {
  const elev = (l: string) => p.levels.find((x) => x.id === l)?.elevation ?? 0;
  const order = ['LL', 'SL', 'UF', 'roof'];
  const i = order.indexOf(level);
  const lo = i <= 0 ? -Infinity : elev(level) - 0.7, hi = i + 1 < order.length ? elev(order[i + 1]!) - 0.5 : Infinity;
  const o: ReactNode[] = [];
  for (const e of p.elements) {
    if (e.type !== 'PipeSegment') continue;
    const [a, b] = [e.props.start, e.props.end];
    const vertical = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) < 0.01;
    const sel = selection === e.id ? ' sel' : '';
    const gravity = !e.props.pressure && (e.props.system === 'sewage' || e.props.system === 'rain');
    if (vertical) {
      const z0 = Math.min(a[2], b[2]), z1 = Math.max(a[2], b[2]);
      if (z1 < lo || z0 > hi) continue;
      o.push(<circle key={e.id} cx={px(a[0])} cy={py(a[1])} r={3.2} className={`pipe2d riser s-${e.props.system}${sel}`} data-el={e.id} />);
    } else if (onPlan(e.level, level)) {
      o.push(line(a[0], a[1], b[0], b[1], `pipe2d s-${e.props.system}${gravity ? ' below' : ''}${sel}`, e.id, { 'data-el': e.id }));
    }
  }
  for (const e of p.elements) {
    if (e.type !== 'Fixture' || !onPlan(e.level, level)) continue;
    const t = kindOf(e.props.kind);
    const [x, y] = e.props.at;
    const sel = selection === e.id ? ' sel' : '';
    const big = t.group !== 'fixture';
    o.push(
      <g key={e.id} data-fixture={e.id} className={`fx2d g-${t.group}${sel}${e.tags.includes('auto') ? ' auto' : ''}`}>
        {big ? rect({ x0: x - Math.max(0.18, t.size[0] / 2), y0: y - Math.max(0.18, t.size[1] / 2), x1: x + Math.max(0.18, t.size[0] / 2), y1: y + Math.max(0.18, t.size[1] / 2) }, 'fxbox', 'b')
          : <circle cx={px(x)} cy={py(y)} r={7} className="fxdot" />}
        <text x={px(x)} y={py(y) - 10} className="fxt" textAnchor="middle">{t.short}</text>
      </g>,
    );
  }
  return <g className="plumbing">{o}</g>;
}

/* ---------- electrical overlay (spec 04) ---------- */

function ElectricalOverlay({ p, level, selection, line, rect, px, py }: { p: import('../model/schema').Project; level: string; selection: string | null } & Draw) {
  const elev = (l: string) => p.levels.find((x) => x.id === l)?.elevation ?? 0;
  const order = ['LL', 'SL', 'UF', 'roof'];
  const i = order.indexOf(level);
  const lo = i <= 0 ? -Infinity : elev(level) - 0.35, hi = i + 1 < order.length ? elev(order[i + 1]!) - 0.35 : Infinity;
  const o: ReactNode[] = [];
  const selCircuit = (() => { const e = selection ? p.elements.find((x) => x.id === selection) : undefined; return e?.type === 'Circuit' ? e.id : e?.type === 'Device' ? e.props.circuit : undefined; })();
  for (const c of p.elements) {
    if (c.type !== 'Conduit') continue;
    const [a, b] = [c.props.start, c.props.end];
    if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) < 0.01) continue;
    const z = (a[2] + b[2]) / 2;
    if (z < lo || z >= hi) continue;
    o.push(line(a[0], a[1], b[0], b[1], 'conduit2d' + (selCircuit === c.props.circuit ? ' sel' : ''), c.id));
  }
  const devOn = (l: string) => l === level || (level === 'SL' && (l === 'site' || l === 'carport')) || (level === 'UF' && l === 'roof');
  for (const d of p.elements) {
    if (d.type !== 'Device' || !devOn(d.level)) continue;
    const t = deviceType(d.props.kind);
    const [x, y] = d.props.at;
    const sel = selection === d.id || (selCircuit && d.props.circuit === selCircuit) ? ' sel' : '';
    const parts: ReactNode[] = [];
    if (t.group === 'camera') {
      const b = ((d.props.bearing ?? 0) * Math.PI) / 180, half = ((cameraFov(d.props.lensMm ?? 2.8) / 2) * Math.PI) / 180, r = cameraRange(d.props.lensMm ?? 2.8);
      const pt = (ang: number) => [x + Math.cos(ang) * r, y - Math.sin(ang) * r] as const;
      const [ax, ay] = pt(b - half), [bx, by] = pt(b + half);
      parts.push(<path key="fov" d={`M${px(x)},${py(y)} L${px(ax)},${py(ay)} A${r * 40},${r * 40} 0 0 0 ${px(bx)},${py(by)} Z`} className="fov2d" />);
      parts.push(<circle key="c" cx={px(x)} cy={py(y)} r={5} className="cam2d" />);
    } else if (t.group === 'light') {
      parts.push(<circle key="c" cx={px(x)} cy={py(y)} r={6} className="lamp2d" />, <path key="x" d={`M${px(x) - 4},${py(y) - 4} L${px(x) + 4},${py(y) + 4} M${px(x) + 4},${py(y) - 4} L${px(x) - 4},${py(y) + 4}`} className="lampx2d" />);
    } else if (t.group === 'outlet') {
      parts.push(<path key="o" d={`M${px(x) - 5},${py(y)} A5,5 0 0 1 ${px(x) + 5},${py(y)} Z`} className={'out2d' + (d.props.kind === 'outlet-20' ? ' big' : '')} />);
    } else if (t.group === 'panel' || t.group === 'solar') {
      parts.push(rect({ x0: x - 0.2, y0: y - 0.12, x1: x + 0.2, y1: y + 0.12 }, 'panel2d', 'p'));
    } else {
      parts.push(rect({ x0: x - 0.1, y0: y - 0.1, x1: x + 0.1, y1: y + 0.1 }, t.group === 'dedicated' ? 'ded2d' : 'lv2d', 'b'));
    }
    parts.push(<rect key="hit" x={px(x) - 8} y={py(y) - 8} width={16} height={16} className="devhit" />);
    o.push(<g key={d.id} data-device={d.id} className={'dev2d g-' + t.group + sel}><title>{d.props.name}</title>{parts}<text x={px(x)} y={py(y) - 9} className="devt" textAnchor="middle">{t.short}</text></g>);
  }
  return <g className="electrical">{o}</g>;
}
