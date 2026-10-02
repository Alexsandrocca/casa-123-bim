// Plumbing window: riser diagram, sewer section, schedules and street services. Everything is read from the model.
import { waterCompany } from '../model/region';
import { exportName } from '../model/legal';
import { useEffect, useState, type ReactNode } from 'react';
import { setUtilities } from '../model/commands';
import { pointInRect } from '../model/geometry';
import { llGravity, networkLabel } from '../model/plumbing/checks';
import { kindOf } from '../model/plumbing/library';
import { utilities } from '../model/plumbing/route';
import { schedule, scheduleCsv } from '../model/plumbing/schedule';
import type { Fixture, PipeSegment, PipeSystem, Project } from '../model/schema';
import { groundAt, groundZones } from '../model/site';
import { useApp, useProject } from '../store';
import { useT } from '../i18n/useT';

export const SYSTEM_COLOR: Record<PipeSystem, string> = { cold: '#2F7FB5', hot: '#C8412E', sewage: '#8A5A2B', vent: '#8C9399', rain: '#25A3A3' };
const SYSTEM_NAME: Record<PipeSystem, string> = { cold: 'Cold water', hot: 'Hot water', sewage: 'Sewage', vent: 'Vent', rain: 'Rainwater' };
type Tab = 'riser' | 'section' | 'schedule' | 'services';

export function PlumbingDialog() {
  const open = useApp((s) => s.plumbingOpen);
  const set3d = useApp((s) => s.set3d);
  const p = useProject();
  const [tab, setTab] = useState<Tab>('riser');
  const t = useT();
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') set3d({ plumbingOpen: false }); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, set3d]);
  if (!open) return null;
  const has = p.elements.some((e) => e.type === 'PipeSegment');
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="pl-title" onClick={() => set3d({ plumbingOpen: false })}>
      <div className="box wide" onClick={(e) => e.stopPropagation()}>
        <div className="phead">
          <h2 id="pl-title">{t('Plumbing')} · {p.meta.version}</h2>
          <button className="ghost" onClick={() => set3d({ plumbingOpen: false })} aria-label={t('Close')}>✕</button>
        </div>
        {!has ? <p>{t('This version has no plumbing yet. The plumbing is designed on Version 3.')}</p> : (
          <>
            <div className="seg" role="tablist">
              {([['riser', 'Riser diagram'], ['section', 'Sewer section'], ['schedule', 'Schedule'], ['services', 'Street services']] as [Tab, string][]).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>{t(l)}</button>
              ))}
            </div>
            {tab === 'riser' && <Riser p={p} />}
            {tab === 'section' && <SewerSection p={p} />}
            {tab === 'schedule' && <Schedule p={p} />}
            {tab === 'services' && <Services p={p} />}
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- isometric riser diagram ---------- */

function Riser({ p }: { p: Project }) {
  const [show, setShow] = useState<Record<PipeSystem, boolean>>({ sewage: true, vent: true, cold: true, hot: true, rain: true });
  const pipes = p.elements.filter((e): e is PipeSegment => e.type === 'PipeSegment' && show[e.props.system]);
  const fixtures = p.elements.filter((e): e is Fixture => e.type === 'Fixture');
  const t = useT();
  const c30 = Math.cos(Math.PI / 6), s30 = 0.5, Z = 1.6; // heights a little exaggerated so the floors read
  const iso = (x: number, y: number, z: number): [number, number] => [(x + y) * c30, (x - y) * s30 - z * Z];
  const pts = pipes.flatMap((s) => [iso(...s.props.start), iso(...s.props.end)]);
  if (!pts.length) return <p>{t('No pipes shown.')}</p>;
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const pad = 2, minX = Math.min(...xs) - pad, minY = Math.min(...ys) - pad, w = Math.max(...xs) - minX + pad, h = Math.max(...ys) - minY + pad;
  const S = Math.min(1000 / w, 560 / h);
  const P = (x: number, y: number, z: number) => { const [u, v] = iso(x, y, z); return [(u - minX) * S, (v - minY) * S] as const; };
  const levels = p.levels.filter((l) => l.plan || l.id === 'roof');
  return (
    <div className="pl-tab">
      <div className="ctlrow">
        {(Object.keys(show) as PipeSystem[]).map((k) => (
          <label key={k} className="check"><input type="checkbox" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} />
            <i className="swatch" style={{ background: SYSTEM_COLOR[k] }} />{t(SYSTEM_NAME[k])}</label>
        ))}
      </div>
      <svg viewBox={`0 0 ${(w * S).toFixed(0)} ${(h * S).toFixed(0)}`} className="iso" role="img" aria-label={t('Isometric riser diagram')} data-testid="riser">
        {levels.map((l) => {
          const o = l.outline!;
          const c = [P(o.x0, o.y0, l.elevation), P(o.x1, o.y0, l.elevation), P(o.x1, o.y1, l.elevation), P(o.x0, o.y1, l.elevation)];
          return (
            <g key={l.id}>
              <polygon points={c.map((q) => q.join(',')).join(' ')} className="isofloor" />
              <text x={c[0]![0] - 6} y={c[0]![1]} className="isolab" textAnchor="end">{l.shortName}</text>
            </g>
          );
        })}
        {pipes.map((s) => {
          const [a, b] = [P(...s.props.start), P(...s.props.end)];
          return <line key={s.id} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={SYSTEM_COLOR[s.props.system]} strokeWidth={Math.max(1.2, s.props.dn / 40)} strokeDasharray={s.props.pressure && s.props.system === 'sewage' ? '5 3' : undefined} />;
        })}
        {fixtures.map((f) => {
          const k = kindOf(f.props.kind);
          const [x, y] = P(f.props.at[0], f.props.at[1], f.props.z);
          return <g key={f.id}><circle cx={x} cy={y} r={2.6} className="isofx" /><text x={x + 4} y={y - 3} className="isot">{k.short}</text></g>;
        })}
      </svg>
      <p className="hint">{t("Isometric view of every pipe (heights ×{z}). Dashed brown: the lower level's pumped line.", { z: t.n(Z, 1) })}</p>
    </div>
  );
}

/* ---------- longitudinal section of the sewage run to the street ---------- */

function SewerSection({ p }: { p: Project }) {
  const run = p.elements.filter((e): e is PipeSegment => e.type === 'PipeSegment' && e.props.network === 'sew-collector');
  const g = llGravity(p);
  const u = utilities(p);
  const t = useT();
  if (!run.length) return <p>{t('No sewage collector.')}</p>;
  const zones = groundZones(p);
  const surface = (x: number, y: number) => {
    let z = groundAt(p, x, y, zones);
    for (const e of p.elements) if (e.type === 'Slab' && e.props.onGrade && e.tags.includes('patio') && e.props.rect && pointInRect(x, y, e.props.rect)) z = Math.max(z, e.props.topElevation);
    return z;
  };
  // the path, as distance along it
  const nodes: { d: number; x: number; y: number; zin: number; zout: number }[] = [];
  let d = 0;
  run.forEach((s, i) => {
    if (i === 0) nodes.push({ d: 0, x: s.props.start[0], y: s.props.start[1], zin: s.props.start[2], zout: s.props.start[2] });
    else nodes[nodes.length - 1]!.zout = s.props.start[2];
    d += Math.abs(s.props.end[0] - s.props.start[0]) + Math.abs(s.props.end[1] - s.props.start[1]);
    nodes.push({ d, x: s.props.end[0], y: s.props.end[1], zin: s.props.end[2], zout: s.props.end[2] });
  });
  const total = d;
  const at = (dd: number) => {
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1]!, b = nodes[i]!;
      if (dd <= b.d + 1e-9) { const f = (dd - a.d) / Math.max(b.d - a.d, 1e-9); return [a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f] as const; }
    }
    const l = nodes[nodes.length - 1]!; return [l.x, l.y] as const;
  };
  const llFront = p.levels.find((l) => l.id === 'LL')?.outline?.y0 ?? 0;
  const llD = nodes.find((n, i) => i > 0 && n.y <= llFront + 1e-6) ? (() => { for (let i = 1; i < nodes.length; i++) { const a = nodes[i - 1]!, b = nodes[i]!; if ((a.y - llFront) * (b.y - llFront) <= 0 && Math.abs(a.x - b.x) < 1e-6) return a.d + Math.abs(a.y - llFront); } return 0; })() : 0;
  const ground = Array.from({ length: Math.ceil(total / 0.25) + 1 }, (_, i) => { const dd = Math.min(total, i * 0.25); const [x, y] = at(dd); return [dd, surface(x, y)] as const; });
  const zMax = Math.max(1.0, ...ground.map((q) => q[1])) + 0.3, zMin = Math.min(-u.sewerDepth - 0.5, g.arrives - 0.3);
  const W = 1000, H = 420, ml = 60, mr = 30, mt = 20, mb = 40, V = 3; // vertical ×3
  const sx = (W - ml - mr) / total;
  const sz = Math.min((H - mt - mb) / (zMax - zMin), sx * V);
  const X = (dd: number) => ml + dd * sx, Y = (z: number) => mt + (zMax - z) * sz;
  const boxes = p.elements.filter((e): e is Fixture => e.type === 'Fixture' && e.props.kind === 'inspection-box');
  const o: ReactNode[] = [];
  o.push(<polyline key="g" points={ground.map(([dd, z]) => `${X(dd)},${Y(z)}`).join(' ')} className="secground" />);
  for (let zz = Math.ceil(zMin); zz <= zMax; zz++) o.push(<g key={`z${zz}`}><line x1={ml - 4} x2={W - mr} y1={Y(zz)} y2={Y(zz)} className="secgrid" /><text x={ml - 8} y={Y(zz) + 3} className="seclab" textAnchor="end">{t.n(zz, 2)}</text></g>);
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1]!, b = nodes[i]!;
    o.push(<line key={`p${i}`} x1={X(a.d)} y1={Y(a.zout)} x2={X(b.d)} y2={Y(b.zin)} className="secpipe" />);
  }
  nodes.forEach((n, i) => {
    const box = boxes.find((b) => Math.hypot(b.props.at[0] - n.x, b.props.at[1] - n.y) < 0.3);
    if (box) o.push(<rect key={`b${i}`} x={X(n.d) - 5} y={Y(surface(n.x, n.y))} width={10} height={Math.max(2, Y(n.zout) - Y(surface(n.x, n.y)) + 4)} className="secbox" />);
    o.push(<circle key={`n${i}`} cx={X(n.d)} cy={Y(n.zout)} r={2.6} className="secnode" />);
    o.push(<text key={`t${i}`} x={X(n.d)} y={Y(n.zout) + 14} className="seclab" textAnchor="middle">{t.n(n.zout, 2)}</text>);
    if (box) o.push(<text key={`bt${i}`} x={X(n.d)} y={Y(surface(n.x, n.y)) - 6} className="seclab" textAnchor="middle">CI</text>);
  });
  // street sewer
  const sewerZ = -u.sewerDepth;
  o.push(<circle key="sewer" cx={X(total)} cy={Y(sewerZ + 0.15)} r={0.15 * sz} className="secsewer" />);
  o.push(<line key="need" x1={X(total) - 80} x2={X(total) + 10} y1={Y(g.needs)} y2={Y(g.needs)} className="secneed" />);
  o.push(<text key="needt" x={X(total) - 82} y={Y(g.needs) - 4} className="seclab bad" textAnchor="end">{t('connection must arrive above {z}', { z: t.n(g.needs, 2) })}</text>);
  o.push(<text key="sewt" x={X(total) - 8} y={Y(sewerZ) + 22} className="seclab" textAnchor="end">{t('street sewer, {d} m deep', { d: t.n(u.sewerDepth, 2) })}</text>);
  // what the lower level would do by gravity
  o.push(<line key="ll" x1={X(llD)} y1={Y(g.leaves)} x2={X(total)} y2={Y(g.arrives)} className={'secll' + (g.ok ? ' ok' : '')} />);
  o.push(<text key="llt" x={X(llD) + 6} y={Y(g.leaves) - 6} className={'seclab ' + (g.ok ? 'ok' : 'bad')}>{t('lower level by gravity: leaves {a}, arrives {b} — {r}', { a: t.n(g.leaves, 2), b: t.n(g.arrives, 2), r: g.ok ? t('works') : t('too low: lift station needed') })}</text>);
  o.push(<text key="st" x={X(total)} y={H - 10} className="seclab" textAnchor="end">{`${t('STREET')} →`}</text>);
  o.push(<text key="ho" x={X(0)} y={H - 10} className="seclab">{t('house (stack {y}) ←', { y: t.n(run[0]!.props.start[1], 1) })}</text>);
  return (
    <div className="pl-tab">
      <svg viewBox={`0 0 ${W} ${H}`} className="sec" role="img" aria-label={t('Longitudinal section of the sewage run to the street')} data-testid="sewer-section">{o}</svg>
      <div className="ctlrow">
        <SewerDepth p={p} />
        <span className="hint">{t('Brown: the house sewage, {l} m from the farthest stack to the street sewer at 1 %. Dashed: the lower level if it drained by gravity. Vertical scale ×{v}.', { l: t.n(total, 1), v: t.n(sz / sx, 1) })}</span>
      </div>
    </div>
  );
}

function SewerDepth({ p }: { p: Project }) {
  const run = useApp((s) => s.run);
  const u = utilities(p);
  const [v, setV] = useState(u.sewerDepth.toFixed(2));
  const t = useT();
  useEffect(() => setV(u.sewerDepth.toFixed(2)), [u.sewerDepth]);
  const commit = () => { const n = Number(v.replace(',', '.')); if (Number.isFinite(n) && Math.abs(n - u.sewerDepth) > 1e-6) run(setUtilities({ sewerDepth: n })); else setV(u.sewerDepth.toFixed(2)); };
  return (
    <label className="field small">
      <span>{t('Street sewer depth')}</span>
      <span className="inputwrap"><input type="number" step={0.05} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} data-testid="sewer-depth" /><em>{t('m (SEMAE to confirm)')}</em></span>
    </label>
  );
}

/* ---------- schedules ---------- */

function Schedule({ p }: { p: Project }) {
  const s = schedule(p);
  const t = useT();
  const download = () => {
    const blob = new Blob([scheduleCsv(p)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = exportName(p, 'plumbing-schedule.csv');
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <div className="pl-tab sched">
      <div className="ctlrow"><b>{t('{n} m of pipe', { n: t.n(s.totalMetres, Number.isInteger(s.totalMetres) ? 0 : 1) })}</b><button onClick={download} data-testid="csv">{t('Download CSV')}</button></div>
      <div className="schedgrid">
        <table className="rooms"><thead><tr><th>{t('Pipes')}</th><th>DN</th><th>{t('Material')}</th><th>m</th></tr></thead>
          <tbody>{s.pipeRows.map((r) => <tr key={`${r.system}${r.dn}${r.material}`}><td><i style={{ background: SYSTEM_COLOR[r.system as PipeSystem] }} />{t(SYSTEM_NAME[r.system as PipeSystem])}</td><td>{r.dn}</td><td>{r.material}</td><td>{t.n(r.metres, 1)}</td></tr>)}</tbody></table>
        <table className="rooms"><thead><tr><th>{t('Fittings')}</th><th>DN</th><th>{t('Elbows')}</th><th>{t('Tees')}</th></tr></thead>
          <tbody>{s.fittingRows.map((r) => <tr key={`${r.system}${r.dn}`}><td><i style={{ background: SYSTEM_COLOR[r.system as PipeSystem] }} />{t(SYSTEM_NAME[r.system as PipeSystem])}</td><td>{r.dn}</td><td>{r.elbows}</td><td>{r.tees}</td></tr>)}</tbody></table>
        <table className="rooms"><thead><tr><th>{t('Fixtures')}</th><th>{t('Level')}</th><th>{t('No.')}</th></tr></thead>
          <tbody>{s.fixtureRows.map((r) => <tr key={`${r.kind}${r.level}`}><td>{r.label}</td><td>{r.level}</td><td>{r.count}</td></tr>)}</tbody></table>
      </div>
      <p className="hint">{t('Quantities for design and budgeting. Fittings are counted where pipes meet (two at an angle = elbow; three or more = tee).')}</p>
    </div>
  );
}

/* ---------- street services ---------- */

function Services({ p }: { p: Project }) {
  const run = useApp((s) => s.run);
  const u = utilities(p);
  const t = useT();
  const field = (label: string, key: keyof typeof u, unit: string, step: number) => (
    <ServiceField key={String(key)} label={label} value={u[key]} unit={unit} step={step} onCommit={(v) => run(setUtilities({ [key]: v }))} />
  );
  return (
    <div className="pl-tab">
      <div className="services">
        {field(t('Street sewer depth'), 'sewerDepth', t('m below the street ({w} to confirm)', { w: waterCompany(p) }), 0.05)}
        {field(t('Sewer distance from the lot'), 'sewerOffset', t('m into the street'), 0.5)}
        {field(t('Water main depth'), 'waterMainDepth', 'm', 0.1)}
        {field(t('Design rainfall'), 'rainIntensity', t('mm/h, 5-minute storm (to confirm)'), 5)}
      </div>
      <p className="hint">{t('Changing a value re-checks the plumbing at once (and can be undone). The lower level needs the lift station unless the sewer is deep enough.')}</p>
      <p className="hint">{networkLabel('sew-collector')}: {llGravity(p).ok ? t('the lower level could drain by gravity.') : t('the lower level cannot drain by gravity.')}</p>
    </div>
  );
}

function ServiceField({ label, value, unit, step, onCommit }: { label: string; value: number; unit: string; step: number; onCommit: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => { const n = Number(v.replace(',', '.')); if (Number.isFinite(n) && n !== value) onCommit(n); else setV(String(value)); };
  return (
    <label className="field">
      <span>{label}</span>
      <span className="inputwrap"><input type="number" step={step} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} /><em>{unit}</em></span>
    </label>
  );
}
