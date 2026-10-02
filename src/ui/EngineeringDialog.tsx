// Spec 08: the Engineering window — assumptions, loads, structure, assemblies, thermal, environment and cost.
// Everything here is read from the model and its assumptions; changing a value updates every estimate at once.
import { exportName } from '../model/legal';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ASSUMPTIONS, changed, valueOf, type Assumption } from '../model/eng/assumptions';
import { ASSEMBLIES, DEFAULT_ASSEMBLY, USE_LABEL, assemblyById, optionsFor, values, type AssemblyUse } from '../model/eng/assemblies';
import { applyProposedSizes, moveGridLine, saveCostSnapshot, setAssumption, setDefaultAssembly } from '../model/eng/commands';
import { assembliesCsv, costCsv, structureCsv } from '../model/eng/csv';
import { DISCLAIMER, costOf, energyOf, envOf, frameOf, thermalOf, type CostEstimate } from '../model/eng';
import type { Status } from '../model/eng/frame';
import type { Project } from '../model/schema';
import { useApp, useProject, type EngTab } from '../store';
import { useT } from '../i18n/useT';

const TABS: [EngTab, string][] = [['assumptions', 'Assumptions'], ['loads', 'Loads'], ['structure', 'Structure'], ['assemblies', 'Assemblies'], ['thermal', 'Thermal'], ['environment', 'Environment'], ['cost', 'Cost']];
const UTIL: Record<Status, string> = { ok: 'u-ok', amber: 'u-amber', red: 'u-red' };

function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function EngineeringDialog() {
  const open = useApp((s) => s.engineeringOpen);
  const tab = useApp((s) => s.engTab);
  const set3d = useApp((s) => s.set3d);
  const p = useProject();
  const t = useT();
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') set3d({ engineeringOpen: false }); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, set3d]);
  if (!open) return null;
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="eng-title" onClick={() => set3d({ engineeringOpen: false })}>
      <div className="box wide eng" onClick={(e) => e.stopPropagation()}>
        <div className="phead">
          <h2 id="eng-title">{t('Engineering')} · {p.meta.version}</h2>
          <button className="ghost" onClick={() => set3d({ engineeringOpen: false })} aria-label={t('Close')}>✕</button>
        </div>
        <p className="disclaimer" data-testid="disclaimer">{DISCLAIMER}</p>
        <div className="seg" role="tablist">
          {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => set3d({ engTab: k })} data-testid={`eng-tab-${k}`}>{t(l)}</button>)}
        </div>
        {tab === 'assumptions' && <Assumptions p={p} />}
        {tab === 'loads' && <Loads p={p} />}
        {tab === 'structure' && <Structure p={p} />}
        {tab === 'assemblies' && <Assemblies p={p} />}
        {tab === 'thermal' && <Thermal p={p} />}
        {tab === 'environment' && <Environment p={p} />}
        {tab === 'cost' && <Cost p={p} />}
      </div>
    </div>
  );
}

/* ---------- assumptions ---------- */

function AssumptionInput({ a, p }: { a: Assumption; p: Project }) {
  const run = useApp((s) => s.run);
  const v = valueOf(p, a.key);
  const [text, setText] = useState(v === null ? '' : String(v));
  const t = useT();
  useEffect(() => setText(v === null ? '' : String(v)), [v]);
  const commit = () => {
    const s = text.trim().replace(',', '.');
    if (s === '' && a.toConfirm) { if (v !== null) run(setAssumption(a.key, null)); return; }
    const n = Number(s);
    if (!Number.isFinite(n) || s === '' || !run(setAssumption(a.key, n))) setText(v === null ? '' : String(v));
  };
  return (
    <input type="number" inputMode="decimal" step={a.step} min={a.min} max={a.max} value={text} placeholder={a.toConfirm ? t('TO CONFIRM') : ''}
      onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      aria-label={a.label} data-testid={`as-${a.key}`} />
  );
}

function Assumptions({ p }: { p: Project }) {
  const run = useApp((s) => s.run);
  const groups = [...new Set(ASSUMPTIONS.map((a) => a.group))];
  const t = useT();
  return (
    <div className="pl-tab">
      <p className="hint">{t('One list for every estimate. Change a value and the loads, sections, footings, thermal checks and cost all update at once. Empty fields are')} <b>{t('TO CONFIRM')}</b>.</p>
      <div className="schedgrid one engscroll">
        {groups.map((g) => (
          <table key={g} className="rooms eng-as">
            <thead><tr><th colSpan={2}>{g}</th><th>{t('Value')}</th><th>{t('Unit')}</th><th>{t('Source')}</th></tr></thead>
            <tbody>{ASSUMPTIONS.filter((a) => a.group === g).map((a) => (
              <tr key={a.key} className={changed(p, a.key) ? 'changed' : ''}>
                <td>{a.label}{a.toConfirm && <span className="tc">{t('TO CONFIRM')}</span>}</td>
                <td>{changed(p, a.key) && <button className="small ghost" title={t('Back to {v}', { v: a.value ?? t('empty') })} onClick={() => run(setAssumption(a.key, a.value))}>↺</button>}</td>
                <td><AssumptionInput a={a} p={p} /></td>
                <td>{a.unit}</td>
                <td className="src">{a.source}</td>
              </tr>
            ))}</tbody>
          </table>
        ))}
      </div>
    </div>
  );
}

/* ---------- loads ---------- */

function Loads({ p }: { p: Project }) {
  const f = frameOf(p);
  const select = useApp((s) => s.select);
  const slabs = [...new Set(f.bays.map((b) => b.slabName))];
  const t = useT();
  const n2 = (v: number) => t.n(v, 2);
  return (
    <div className="pl-tab">
      <p className="hint">{t('Loads per bay of each slab (NBR 6120:2019, values to verify). Dead = the assembly + finishes + partitions (or the walls standing on it) + equipment. Factored = {g} × service (one factor for the estimate).', { g: valueOf(p, 'gammaF') ?? '' })}</p>
      <div className="schedgrid one engscroll">
        <table className="rooms eng-t" data-testid="loads-table">
          <thead><tr><th>{t('Slab · bay')}</th><th>{t('Size m')}</th><th>{t('Deck spans')}</th><th>{t('Assembly')}</th><th>{t('Finishes')}</th><th>{t('Partitions')}</th><th>{t('Walls')}</th><th>{t('Equipment')}</th><th>{t('Live')}</th><th>{t('Service')}</th><th>{t('Factored')}</th></tr></thead>
          <tbody>{slabs.flatMap((name) => f.bays.filter((b) => b.slabName === name).map((b) => (
            <tr key={b.id} onClick={() => select(b.slabId)}>
              <td>{name} <em>{t('x {a}–{b}, y {c}–{d}', { a: t.n(b.rect.x0, 1), b: t.n(b.rect.x1, 1), c: t.n(b.rect.y0, 1), d: t.n(b.rect.y1, 1) })}</em></td>
              <td>{n2(b.rect.x1 - b.rect.x0)} × {n2(b.rect.y1 - b.rect.y0)}</td>
              <td className={b.deck ? UTIL[b.deck.status] : ''}>{b.spanDir ? t('{s} m along {dir}', { s: n2(b.span), dir: b.spanDir }) : '—'}</td>
              <td>{n2(b.dead.assembly)}</td><td>{n2(b.dead.finishes)}</td><td>{n2(b.dead.partitions)}</td>
              <td>{n2(b.dead.walls)}</td><td>{n2(b.dead.points)}</td><td title={b.liveLabel}>{n2(b.live)}</td>
              <td>{n2(b.service)}</td><td>{n2(b.factored)}</td>
            </tr>
          )))}</tbody>
        </table>
        <h4>{t('Equipment and other point loads')}</h4>
        <table className="rooms eng-t">
          <thead><tr><th>{t('Item')}</th><th>{t('At')}</th><th>kN</th><th>{t('How')}</th></tr></thead>
          <tbody>{f.points.filter((pt) => !pt.id.includes(':')).map((pt) => (
            <tr key={pt.id + pt.at.join()} onClick={() => select(pt.id)}><td>{pt.label}</td><td>{pt.at.map((v) => n2(v)).join(t.lang === 'en' ? ', ' : '; ')}</td><td>{n2(pt.kN)}</td><td>{pt.how}</td></tr>
          ))}
          {f.points.some((pt) => pt.id.includes(':')) && <tr><td>{t('PV modules ({n})', { n: f.points.filter((pt) => /PV/.test(pt.label)).length })}</td><td>{t('main roof')}</td><td>{n2(f.points.filter((pt) => /PV/.test(pt.label)).reduce((a, pt) => a + pt.kN, 0))}</td><td>{t('28 kg module + 6 kg frame each')}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- structure ---------- */

function GridEditor({ p }: { p: Project }) {
  const run = useApp((s) => s.run);
  const flash = useApp((s) => s.flash);
  const t = useT();
  const line = (axis: 'x' | 'y', i: number) => {
    const v = p.grid[axis][i]!;
    const inner = i > 0 && i < p.grid[axis].length - 1;
    return (
      <label key={`${axis}${i}`} className="gridcell">
        <span>{axis}{i + 1}</span>
        {inner ? <GridInput v={v} onCommit={(n) => { if (run(moveGridLine(axis, i, n))) flash(t('Grid line {l} moved to {v} m: the frame and the services follow.', { l: `${axis}${i + 1}`, v: t.n(n, 2) })); }} testId={`grid-${axis}-${i}`} /> : <b>{t.n(v, 2)}</b>}
      </label>
    );
  };
  return (
    <div className="gridedit">
      <span className="lbl">{t('Grid x (south → north)')}</span>{p.grid.x.map((_, i) => line('x', i))}
      <span className="lbl">{t('Grid y (street → rear)')}</span>{p.grid.y.map((_, i) => line('y', i))}
    </div>
  );
}
function GridInput({ v, onCommit, testId }: { v: number; onCommit: (n: number) => void; testId: string }) {
  const [t, setT] = useState(v.toFixed(2));
  useEffect(() => setT(v.toFixed(2)), [v]);
  return <input type="number" step={0.05} value={t} onChange={(e) => setT(e.target.value)} data-testid={testId}
    onBlur={() => { const n = Number(t); if (Number.isFinite(n) && Math.abs(n - v) > 1e-6) onCommit(n); else setT(v.toFixed(2)); }}
    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
}

function Structure({ p }: { p: Project }) {
  const f = frameOf(p);
  const run = useApp((s) => s.run);
  const select = useApp((s) => s.select);
  const set3d = useApp((s) => s.set3d);
  const setView = useApp((s) => s.setView);
  const flash = useApp((s) => s.flash);
  const q = f.quantities;
  const red = f.beams.filter((b) => b.check.status === 'red').length + f.columns.filter((c) => c.check.status === 'red').length + f.footings.filter((x) => x.check.status === 'red').length;
  const lookFrom = useApp((s) => s.lookFrom);
  const show3d = () => { set3d({ engineeringOpen: false, structure: true }); setView('3d'); lookFrom([17, -7, 13], [4.3, 7.5, 1.2]); };
  const t = useT();
  const n2 = (v: number) => t.n(v, 2);
  /** Whole numbers that can pass 1000: no thousands separator in English, as before. */
  const n0 = (v: number) => (t.lang === 'en' ? v.toFixed(0) : t.n(v, 0));
  return (
    <div className="pl-tab">
      <div className="engsum">
        <div><b>{t.n(q.steelKg / 1000, 1)} t</b><span>{t('steel · {k} kg/m² ({typ})', { k: t.n(q.steelPerM2, 0), typ: q.steelPerM2 >= 25 && q.steelPerM2 <= 45 ? t('typical 25–45') : t('outside the typical 25–45') })}</span></div>
        <div><b>{t.n(q.concrete.total, 1)} m³</b><span>{t('concrete · rebar {r} t', { r: t.n(q.rebarKg / 1000, 1) })}</span></div>
        <div><b>{n0(q.formwork)} m²</b><span>{t('formwork · {e} m³ excavation', { e: n0(q.excavation) })}</span></div>
        <div><b className={red ? 'bad' : 'ok'}>{red}</b><span>{t('members over capacity')}</span></div>
      </div>
      <div className="btnrow">
        <button onClick={show3d} data-testid="show-structure-3d">{t('Show utilisation and load path in 3D')}</button>
        <button onClick={() => { if (run(applyProposedSizes())) flash(t('Proposed sections and footing sizes applied. The pipes and conduits re-routed: check the MEP physics rows.')); }} data-testid="apply-proposed"
          title={t('Beams, columns and footings take the proposed sizes; the services re-route around them')}>{t('Use the proposed sizes')}</button>
        <button onClick={() => download(exportName(p, 'structure.csv'), structureCsv(p))}>{t('Structure schedule (CSV)')}</button>
      </div>
      <p className="hint">{t('Deeper beams and bigger footings change the space for pipes: after “Use the proposed sizes” look at the MEP physics checks. Undo puts the previous sizes back.')}</p>
      <GridEditor p={p} />
      <div className="schedgrid one engscroll">
        <h4>{t('Beams')}</h4>
        <table className="rooms eng-t" data-testid="beam-table">
          <thead><tr><th>{t('Beam')}</th><th>{t('Spans m')}</th><th>{t('Load kN/m')}</th><th>{t('Section')}</th><th>{t('Use')}</th><th>{t('Governing')}</th><th>{t('Proposed')}</th></tr></thead>
          <tbody>{f.beams.map((b) => (
            <tr key={b.beam.id} onClick={() => select(b.beam.id)}>
              <td>{b.beam.id}</td><td>{b.spans.map((s) => n2(s.L) + (s.primary ? '' : '*')).join(' · ')}</td>
              <td>{t.n(Math.max(0, ...b.spans.map((s) => s.w)), 1)}</td><td>{b.beam.props.profile}</td>
              <td className={UTIL[b.check.status]}>{n2(b.check.util)}</td><td className="src">{b.check.governing}</td><td>{b.proposed?.name ?? t('none in the table')}</td>
            </tr>
          ))}</tbody>
        </table>
        <p className="hint">{t('* span carried by another beam (secondary, depth ≈ span/25); the others sit on columns (primary, span/20).')}</p>
        <h4>{t('Columns and piers')}</h4>
        <table className="rooms eng-t" data-testid="column-table">
          <thead><tr><th>{t('Column')}</th><th>{t('At')}</th><th>N kN</th><th>Nd kN</th><th>L m</th><th>{t('Section')}</th><th>{t('Use')}</th><th>{t('Proposed')}</th></tr></thead>
          <tbody>{f.columns.map((c) => (
            <tr key={c.col.id} onClick={() => select(c.col.id)}>
              <td>{c.col.id}</td><td>{c.col.props.at.map((v) => n2(v)).join(t.lang === 'en' ? ', ' : '; ')}</td><td>{t.n(c.N, 0)}</td><td>{t.n(c.Nd, 0)}</td><td>{n2(c.L)}</td>
              <td>{c.col.props.profile}</td><td className={UTIL[c.check.status]}>{n2(c.check.util)}</td><td>{c.proposed?.name ?? '—'}</td>
            </tr>
          ))}</tbody>
        </table>
        <h4>{t('Footings (allowable soil pressure {p} kPa, TO CONFIRM by SPT)', { p: valueOf(p, 'soilPressure') ?? '—' })}</h4>
        <table className="rooms eng-t" data-testid="footing-table">
          <thead><tr><th>{t('Footing')}</th><th>{t('Carries')}</th><th>N kN</th><th>{t('Drawn')}</th><th>kPa</th><th>{t('Use')}</th><th>{t('Proposed')}</th></tr></thead>
          <tbody>{f.footings.map((x) => {
            const r = x.footing.props.rect;
            return (
              <tr key={x.footing.id} onClick={() => select(x.footing.id)}>
                <td>{x.footing.id}</td><td>{x.carries}</td><td>{t.n(x.N, 0)}</td><td>{n2(r.x1 - r.x0)} × {n2(r.y1 - r.y0)}</td><td>{t.n(x.pressure, 0)}</td>
                <td className={UTIL[x.check.status]}>{n2(x.check.util)}</td><td>{n2(x.B)} × {n2(x.B)} × {n2(x.h)}</td>
              </tr>
            );
          })}</tbody>
        </table>
        <h4>{t('Retaining walls')}</h4>
        <table className="rooms eng-t">
          <thead><tr><th>{t('Wall')}</th><th>{t('Soil height m')}</th><th>{t('Stem need / has')}</th><th>{t('Base ≈ 0.6 H')}</th><th>{t('Use')}</th></tr></thead>
          <tbody>{f.retaining.map((r) => (
            <tr key={r.wall.id} onClick={() => select(r.wall.id)}><td>{r.wall.id}</td><td>{n2(r.H)}</td><td>{n2(r.tNeed)} / {n2(r.tHas)}</td><td>{n2(r.base)}</td><td className={UTIL[r.check.status]}>{n2(r.check.util)}</td></tr>
          ))}</tbody>
        </table>
        <p className="hint">{t('Each retaining wall needs a drainage layer and weep holes behind it, and a drain at its foot.')}</p>
        <h4>{t('Lintels over openings wider than 1.20 m')}</h4>
        <table className="rooms eng-t">
          <thead><tr><th>{t('Opening')}</th><th>{t('Span m')}</th><th>{t('Kind')}</th><th>{t('Depth m')}</th></tr></thead>
          <tbody>{f.lintels.map((l) => <tr key={l.opening.id} onClick={() => select(l.opening.id)}><td>{l.opening.id}</td><td>{n2(l.span)}</td><td>{l.kind}</td><td>{n2(l.depth)}</td></tr>)}</tbody>
        </table>
        <h4>{t('Bracing (wind {q} kN/m², V0 {v} m/s TO CONFIRM)', { q: n2(f.wind.q), v: valueOf(p, 'v0') ?? '—' })}</h4>
        <p className="hint">{t('Wind on the whole house about {x} kN along x and {y} kN along y. Each storey needs at least one braced bay in each direction; these bays have the least glass in the way:', { x: t.n(f.wind.Fx, 0), y: t.n(f.wind.Fy, 0) })}</p>
        <table className="rooms eng-t" data-testid="bracing-table">
          <thead><tr><th>{t('Storey')}</th><th>{t('Direction')}</th><th>{t('Line')}</th><th>{t('Between')}</th><th>{t('Proposal')}</th></tr></thead>
          <tbody>{f.bracing.map((b, i) => <tr key={i}><td>{b.storey}</td><td>{b.dir}</td><td>{b.line}</td><td>{n2(b.from)} – {n2(b.to)}</td><td>{b.text}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- assemblies ---------- */

const USES: AssemblyUse[] = ['exterior', 'interior', 'wet', 'retaining', 'floor', 'terrace', 'roof', 'ground', 'patio'];

function Assemblies({ p }: { p: Project }) {
  const run = useApp((s) => s.run);
  const flash = useApp((s) => s.flash);
  const [open, setOpen] = useState<string | null>(null);
  const def = (u: AssemblyUse) => p.engineering?.assemblyDefaults?.[u] ?? DEFAULT_ASSEMBLY[u];
  const t = useT();
  return (
    <div className="pl-tab">
      <div className="asmdefaults">
        {USES.map((u) => (
          <label key={u} className="field small">
            <span>{USE_LABEL[u]}</span>
            <select value={def(u)} data-testid={`asm-default-${u}`} onChange={(e) => {
              if (run(setDefaultAssembly(u, e.target.value))) flash(t('{use}: {name}. Thickness, weight, U-value, loads, footings and cost are updated.', { use: USE_LABEL[u], name: assemblyById(e.target.value)?.name ?? e.target.value }));
            }}>
              {optionsFor(u).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        ))}
      </div>
      <p className="hint">{t('Walls take the thickness of their assembly (in 2D and 3D, and the services re-route). Floors and roofs keep the drawn structural deck so the levels do not move; their build-up changes the weight, the U-value and the cost. A single wall or slab can have its own assembly in its properties.')}</p>
      <div className="btnrow"><button onClick={() => download(exportName(p, 'assemblies.csv'), assembliesCsv(p))}>{t('Assemblies schedule (CSV)')}</button></div>
      <div className="schedgrid one engscroll">
        <table className="rooms eng-t" data-testid="assembly-table">
          <thead><tr><th>{t('Assembly')}</th><th>{t('Use')}</th><th>m</th><th>kg/m²</th><th>U W/m²K</th><th>CT kJ/m²K</th><th>Rw dB</th><th>R$/m²</th></tr></thead>
          <tbody>{ASSEMBLIES.map((a) => {
            const v = values(a);
            return [
              <tr key={a.id} onClick={() => setOpen(open === a.id ? null : a.id)} className={Object.values(USES).some((u) => def(u) === a.id) ? 'inuse' : ''}>
                <td>{open === a.id ? '▾' : '▸'} {a.name}</td><td>{USE_LABEL[a.use]}</td><td>{t.n(v.thickness, 3)}</td><td>{t.lang === 'en' ? v.mass.toFixed(0) : t.n(v.mass, 0)}</td><td>{t.n(v.U, 2)}</td><td>{t.n(v.CT, 0)}</td>
                <td>{t.n(v.Rw, 0)}{v.rwMethod === 'table' ? '' : '*'}</td><td>{t.lang === 'en' ? v.cost.toFixed(0) : t.n(v.cost, 0)}</td>
              </tr>,
              open === a.id ? (
                <tr key={a.id + 'l'} className="layers"><td colSpan={8}>
                  <ol>{a.layers.map((l, i) => <li key={i}>{l.material} — {t.n(l.t * 1000, 1)} mm · ρ {l.rho} kg/m³ · λ {l.lambda} W/mK · c {l.c} kJ/kgK · R$ {l.cost}/m²</li>)}</ol>
                  <p className="hint">{t('Fire: {f}. Source: {s}.', { f: a.fire, s: a.source })}</p>
                </td></tr>
              ) : null,
            ];
          })}</tbody>
        </table>
        <p className="hint">{t('* Rw from the mass law. Layers are listed from outside to inside (top to bottom for floors and roofs).')}</p>
      </div>
    </div>
  );
}

/* ---------- thermal ---------- */

function Thermal({ p }: { p: Project }) {
  const rows = thermalOf(p);
  const as = ASSUMPTIONS.filter((a) => a.key === 'zone' || a.key === 'absorptance');
  const t = useT();
  return (
    <div className="pl-tab">
      <div className="asmdefaults">{as.map((a) => <label key={a.key} className="field small"><span>{a.label}</span><span className="inputwrap"><AssumptionInput a={a} p={p} /><em>{a.unit}{a.toConfirm ? ` · ${t('TO CONFIRM')}` : ''}</em></span></label>)}</div>
      <p className="hint">{t('NBR 15575 simplified method: the U-value of the exterior walls and roofs, and the thermal capacity CT of the walls, against the limits of the bioclimatic zone. If an assembly fails, the standard asks for the computer simulation method instead (it does not mean the house is unacceptable).')}</p>
      <table className="rooms eng-t" data-testid="thermal-table">
        <thead><tr><th>{t('Assembly')}</th><th>{t('Where')}</th><th>U</th><th>CT</th><th>{t('Limit')}</th><th>{t('Result')}</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.kind + r.assembly.id}>
            <td>{r.assembly.name}</td><td>{r.kind === 'roof' ? t('{n} roof slab(s)', { n: r.elements.length }) : t('{n} walls, {a} m²', { n: r.elements.length, a: t.n(r.area, 0) })}</td>
            <td>{t.n(r.U, 2)}</td><td>{t.n(r.CT, 0)}</td><td className="src">{r.limit.text}</td>
            <td className={r.status === 'pass' ? 'u-ok' : 'u-red'}>{r.status === 'pass' ? t('passes') : t('simulation needed')}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/* ---------- environment ---------- */

function Environment({ p }: { p: Project }) {
  const env = envOf(p), energy = energyOf(p);
  const select = useApp((s) => s.select);
  const t = useT();
  return (
    <div className="pl-tab">
      <div className="schedgrid one engscroll">
        <div className="card" data-testid="energy-card">
          <h4>{t('Water heating and solar (estimate)')}</h4>
          {energy.text.map((x) => <p key={x}>{x}</p>)}
        </div>
        <h4>{t('Ventilation (long-stay rooms)')}</h4>
        <table className="rooms eng-t">
          <thead><tr><th>{t('Room')}</th><th>{t('Cross-ventilation')}</th><th>{t('Openable m²')}</th><th>{t('Need m²')}</th></tr></thead>
          <tbody>{env.ventilation.map((v) => (
            <tr key={v.room.id} onClick={() => select(v.room.id)}><td>{v.room.props.name}</td><td className={v.status === 'pass' ? '' : 'u-amber'}>{v.text}</td><td className={v.areaOk ? '' : 'u-red'}>{t.n(v.openable, 2)}</td><td>{t.n(v.need, 2)}</td></tr>
          ))}</tbody>
        </table>
        <h4>{t('Sun on the glass (hours of direct sun, 21 Dec and 21 Jun)')}</h4>
        <table className="rooms eng-t" data-testid="sun-table">
          <thead><tr><th>{t('Window')}</th><th>{t('Faces')}</th><th>{t('21 Dec')}</th><th>{t('21 Jun')}</th><th>{t('Shading')}</th></tr></thead>
          <tbody>{env.sun.map((s) => (
            <tr key={s.op.id} onClick={() => select(s.op.id)} data-window={s.op.id}><td>{s.op.id}</td><td>{s.side}</td><td className={s.status === 'warn' ? 'u-amber' : ''}>{t.n(s.dec, 1)} h</td><td>{t.n(s.jun, 1)} h</td><td>{s.shading.join(', ') || '—'}</td></tr>
          ))}</tbody>
        </table>
        <p className="hint">{t('Counted every half hour with the eaves, the upper floor, the brises, shutters, awnings and pergolas in the model (trees come with spec 06). West glass with more than 2 h of December sun is flagged.')}</p>
        <h4>{t('Daylight')}</h4>
        <table className="rooms eng-t">
          <thead><tr><th>{t('Room')}</th><th>{t('Average daylight factor')}</th></tr></thead>
          <tbody>{env.daylight.map((d) => <tr key={d.room.id} onClick={() => select(d.room.id)}><td>{d.room.props.name}</td><td className={d.status === 'pass' ? '' : 'u-amber'}>{t('{v} % (target ≥ 2 %)', { v: t.n(d.df, 1) })}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- cost ---------- */

const BAR = '#2F7FB5'; // single-series colour (dataviz)

function Cost({ p }: { p: Project }) {
  const c = costOf(p);
  const run = useApp((s) => s.run);
  const versions = useApp((s) => s.versions);
  const active = useApp((s) => s.active);
  const flash = useApp((s) => s.flash);
  const info = useApp((s) => s.info);
  // the other design versions of the project, for comparison
  const others = useMemo(() => (info?.versions ?? []).filter((v) => v.kind === 'design' && v.id !== active && versions[v.id]).map((v) => ({ v: v.id, name: v.name, c: costOf(versions[v.id]!.present) })), [versions, active, info]);
  const snap = p.engineering?.snapshot;
  const t = useT();
  return (
    <div className="pl-tab">
      <CostCard p={p} c={c} others={others} />
      <div className="btnrow">
        <button onClick={() => { const d = new Date(); if (run(saveCostSnapshot(`Snapshot ${d.toISOString().slice(0, 10)}`, d.toISOString()))) flash(t('Cost snapshot saved: the next changes are compared with it.')); }} data-testid="save-snapshot">{t('Save as snapshot')}</button>
        <button onClick={() => download(exportName(p, 'cost.csv'), costCsv(p))}>{t('Cost estimate (CSV)')}</button>
        {snap && <span className="hint">{t('Snapshot: {label} · {total}', { label: snap.label, total: `R$ ${t.n(Math.round(snap.total), 0)}` })}</span>}
      </div>
      <div className="schedgrid one engscroll">
        <table className="rooms eng-t" data-testid="cost-table">
          <thead><tr><th>{t('Group')}</th><th>{t('Item')}</th><th>{t('Quantity')}</th><th>{t('Rate')}</th><th>R$</th></tr></thead>
          <tbody>
            {c.items.map((i) => <tr key={i.key}><td>{i.group}</td><td>{i.label}</td><td>{t.lang === 'en' ? i.qty.toFixed(1) : t.n(i.qty, 1)} {i.unit}</td><td>{i.unit === 'each' && i.group === 'Features' ? '—' : t.lang === 'en' ? i.rate.toFixed(0) : t.n(i.rate, 0)}</td><td>{t.n(Math.round(i.value), 0)}</td></tr>)}
            <tr className="sum"><td /><td>{t('Overheads and profit (BDI {b} %)', { b: valueOf(p, 'costBdi') ?? '' })}</td><td /><td /><td>{t.n(Math.round(c.bdi), 0)}</td></tr>
            <tr className="sum"><td /><td>{t('Total by quantities')}</td><td /><td /><td>{t.n(Math.round(c.total), 0)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The cost card: both methods with their range, cost per m², the biggest items and the difference against the snapshot and the other versions. */
export function CostCard({ p, c, others }: { p: Project; c: CostEstimate; others?: { v: string; name: string; c: CostEstimate }[] }) {
  const snap = p.engineering?.snapshot;
  const top = c.items.slice(0, 6);
  const max = Math.max(...top.map((i) => i.value), 1);
  const [lo, hi] = c.range(c.total);
  const t = useT();
  const money = (v: number) => `R$ ${t.n(Math.round(v), 0)}`;
  const diff = (a: number, b: number) => `${a >= b ? '+' : '−'}${t.n(Math.round(Math.abs(a - b)), 0)} (${a >= b ? '+' : '−'}${t.n(Math.abs(((a - b) / Math.max(b, 1)) * 100), 1)} %)`;
  const rows: ReactNode[] = [];
  if (snap) rows.push(<li key="snap">{t('Against the snapshot “{label}”:', { label: snap.label })} <b>R$ {diff(c.total, snap.total)}</b></li>);
  for (const o of others ?? []) rows.push(<li key={o.v}>{t('Against {name}:', { name: t(o.name) })} <b>R$ {diff(c.total, o.c.total)}</b> {t('by quantities')}{o.c.area.total !== null && c.area.total !== null ? <>, R$ {diff(c.area.total, o.c.area.total)} {t('by area')}</> : null}</li>);
  return (
    <div className="costcard" data-testid="cost-card">
      <div className="costmethods">
        <div>
          <h4>{t('By quantities')}</h4>
          <b className="big" data-testid="cost-total">{money(c.total)}</b>
          <span>{t('range {lo} – {hi} (±25 %)', { lo: money(lo), hi: money(hi) })}</span>
          <span>{t('{v}/m² over {a} m² of rooms', { v: money(c.perM2), a: t.n(c.gross, 0) })}</span>
        </div>
        <div>
          <h4>{t('By area (CUB)')}</h4>
          {c.area.total === null
            ? <b className="big tc" data-testid="cost-cub">{t('CUB TO CONFIRM')}</b>
            : <><b className="big" data-testid="cost-cub">{money(c.area.total)}</b><span>{t('range {lo} – {hi}', { lo: money(c.area.total * 0.75), hi: money(c.area.total * 1.25) })}</span></>}
          <span>{c.area.cub === null ? t('Enter the CUB in Assumptions') : t('R$ {v}/m² (R8-N, Sinduscon-SP, Sep 2026)', { v: t.n(c.area.cub, 2) })} {t('× {e} m² equivalent + {x} % not in the CUB', { e: t.n(c.area.equivalent, 1), x: t.n(c.area.extras * 100, 0) })}</span>
        </div>
      </div>
      <h4>{t('Biggest items')}</h4>
      <svg className="chart costbars" viewBox={`0 0 620 ${top.length * 24 + 4}`} role="img" aria-label={t('Biggest cost items')}>
        {top.map((i, k) => (
          <g key={i.key} transform={`translate(0 ${k * 24})`}>
            <title>{`${i.label}: ${money(i.value)} (${i.how})`}</title>
            <text x={0} y={15} className="axis">{i.label.length > 52 ? i.label.slice(0, 51) + '…' : i.label}</text>
            <rect x={340} y={4} width={Math.max(2, (i.value / max) * 220)} height={14} rx={3} fill={BAR} />
            <text x={340 + Math.max(2, (i.value / max) * 220) + 6} y={15} className="val">{`${t.n(i.value / 1000, 0)}k`}</text>
          </g>
        ))}
      </svg>
      {rows.length > 0 && <ul className="costdiff">{rows}</ul>}
      <p className="disclaimer">{DISCLAIMER}</p>
    </div>
  );
}
