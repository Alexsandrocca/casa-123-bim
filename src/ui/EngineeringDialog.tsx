// Spec 08: the Engineering window — assumptions, loads, structure, assemblies, thermal, environment and cost.
// Everything here is read from the model and its assumptions; changing a value updates every estimate at once.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ASSUMPTIONS, changed, valueOf, type Assumption } from '../model/eng/assumptions';
import { ASSEMBLIES, DEFAULT_ASSEMBLY, USE_LABEL, assemblyById, optionsFor, values, type AssemblyUse } from '../model/eng/assemblies';
import { applyProposedSizes, moveGridLine, saveCostSnapshot, setAssumption, setDefaultAssembly } from '../model/eng/commands';
import { assembliesCsv, costCsv, structureCsv } from '../model/eng/csv';
import { DISCLAIMER, costOf, energyOf, envOf, frameOf, thermalOf, type CostEstimate } from '../model/eng';
import { brl } from '../model/eng/cost';
import type { Status } from '../model/eng/frame';
import type { Project } from '../model/schema';
import { BASES, VERSION_IDS, useApp, useProject, type EngTab } from '../store';

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
          <h2 id="eng-title">Engineering · {p.meta.version}</h2>
          <button className="ghost" onClick={() => set3d({ engineeringOpen: false })} aria-label="Close">✕</button>
        </div>
        <p className="disclaimer" data-testid="disclaimer">{DISCLAIMER}</p>
        <div className="seg" role="tablist">
          {TABS.map(([t, l]) => <button key={t} role="tab" aria-selected={tab === t} aria-pressed={tab === t} onClick={() => set3d({ engTab: t })} data-testid={`eng-tab-${t}`}>{l}</button>)}
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
  useEffect(() => setText(v === null ? '' : String(v)), [v]);
  const commit = () => {
    const t = text.trim().replace(',', '.');
    if (t === '' && a.toConfirm) { if (v !== null) run(setAssumption(a.key, null)); return; }
    const n = Number(t);
    if (!Number.isFinite(n) || t === '' || !run(setAssumption(a.key, n))) setText(v === null ? '' : String(v));
  };
  return (
    <input type="number" inputMode="decimal" step={a.step} min={a.min} max={a.max} value={text} placeholder={a.toConfirm ? 'TO CONFIRM' : ''}
      onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      aria-label={a.label} data-testid={`as-${a.key}`} />
  );
}

function Assumptions({ p }: { p: Project }) {
  const run = useApp((s) => s.run);
  const groups = [...new Set(ASSUMPTIONS.map((a) => a.group))];
  return (
    <div className="pl-tab">
      <p className="hint">One list for every estimate. Change a value and the loads, sections, footings, thermal checks and cost all update at once. Empty fields are <b>TO CONFIRM</b>.</p>
      <div className="schedgrid one engscroll">
        {groups.map((g) => (
          <table key={g} className="rooms eng-as">
            <thead><tr><th colSpan={2}>{g}</th><th>Value</th><th>Unit</th><th>Source</th></tr></thead>
            <tbody>{ASSUMPTIONS.filter((a) => a.group === g).map((a) => (
              <tr key={a.key} className={changed(p, a.key) ? 'changed' : ''}>
                <td>{a.label}{a.toConfirm && <span className="tc">TO CONFIRM</span>}</td>
                <td>{changed(p, a.key) && <button className="small ghost" title={`Back to ${a.value ?? 'empty'}`} onClick={() => run(setAssumption(a.key, a.value))}>↺</button>}</td>
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
  return (
    <div className="pl-tab">
      <p className="hint">Loads per bay of each slab (NBR 6120:2019, values to verify). Dead = the assembly + finishes + partitions (or the walls standing on it) + equipment. Factored = {valueOf(p, 'gammaF')} × service (one factor for the estimate).</p>
      <div className="schedgrid one engscroll">
        <table className="rooms eng-t" data-testid="loads-table">
          <thead><tr><th>Slab · bay</th><th>Size m</th><th>Deck spans</th><th>Assembly</th><th>Finishes</th><th>Partitions</th><th>Walls</th><th>Equipment</th><th>Live</th><th>Service</th><th>Factored</th></tr></thead>
          <tbody>{slabs.flatMap((name) => f.bays.filter((b) => b.slabName === name).map((b) => (
            <tr key={b.id} onClick={() => select(b.slabId)}>
              <td>{name} <em>x {b.rect.x0.toFixed(1)}–{b.rect.x1.toFixed(1)}, y {b.rect.y0.toFixed(1)}–{b.rect.y1.toFixed(1)}</em></td>
              <td>{(b.rect.x1 - b.rect.x0).toFixed(2)} × {(b.rect.y1 - b.rect.y0).toFixed(2)}</td>
              <td className={b.deck ? UTIL[b.deck.status] : ''}>{b.spanDir ? `${b.span.toFixed(2)} m along ${b.spanDir}` : '—'}</td>
              <td>{b.dead.assembly.toFixed(2)}</td><td>{b.dead.finishes.toFixed(2)}</td><td>{b.dead.partitions.toFixed(2)}</td>
              <td>{b.dead.walls.toFixed(2)}</td><td>{b.dead.points.toFixed(2)}</td><td title={b.liveLabel}>{b.live.toFixed(2)}</td>
              <td>{b.service.toFixed(2)}</td><td>{b.factored.toFixed(2)}</td>
            </tr>
          )))}</tbody>
        </table>
        <h4>Equipment and other point loads</h4>
        <table className="rooms eng-t">
          <thead><tr><th>Item</th><th>At</th><th>kN</th><th>How</th></tr></thead>
          <tbody>{f.points.filter((pt) => !pt.id.includes(':')).map((pt) => (
            <tr key={pt.id + pt.at.join()} onClick={() => select(pt.id)}><td>{pt.label}</td><td>{pt.at.map((v) => v.toFixed(2)).join(', ')}</td><td>{pt.kN.toFixed(2)}</td><td>{pt.how}</td></tr>
          ))}
          {f.points.some((pt) => pt.id.includes(':')) && <tr><td>PV modules ({f.points.filter((pt) => /PV/.test(pt.label)).length})</td><td>main roof</td><td>{f.points.filter((pt) => /PV/.test(pt.label)).reduce((a, pt) => a + pt.kN, 0).toFixed(2)}</td><td>28 kg module + 6 kg frame each</td></tr>}
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
  const line = (axis: 'x' | 'y', i: number) => {
    const v = p.grid[axis][i]!;
    const inner = i > 0 && i < p.grid[axis].length - 1;
    return (
      <label key={`${axis}${i}`} className="gridcell">
        <span>{axis}{i + 1}</span>
        {inner ? <GridInput v={v} onCommit={(n) => { if (run(moveGridLine(axis, i, n))) flash(`Grid line ${axis}${i + 1} moved to ${n.toFixed(2)} m: the frame and the services follow.`); }} testId={`grid-${axis}-${i}`} /> : <b>{v.toFixed(2)}</b>}
      </label>
    );
  };
  return (
    <div className="gridedit">
      <span className="lbl">Grid x (south → north)</span>{p.grid.x.map((_, i) => line('x', i))}
      <span className="lbl">Grid y (street → rear)</span>{p.grid.y.map((_, i) => line('y', i))}
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
  return (
    <div className="pl-tab">
      <div className="engsum">
        <div><b>{(q.steelKg / 1000).toFixed(1)} t</b><span>steel · {q.steelPerM2.toFixed(0)} kg/m² ({q.steelPerM2 >= 25 && q.steelPerM2 <= 45 ? 'typical 25–45' : 'outside the typical 25–45'})</span></div>
        <div><b>{q.concrete.total.toFixed(1)} m³</b><span>concrete · rebar {(q.rebarKg / 1000).toFixed(1)} t</span></div>
        <div><b>{q.formwork.toFixed(0)} m²</b><span>formwork · {q.excavation.toFixed(0)} m³ excavation</span></div>
        <div><b className={red ? 'bad' : 'ok'}>{red}</b><span>members over capacity</span></div>
      </div>
      <div className="btnrow">
        <button onClick={show3d} data-testid="show-structure-3d">Show utilisation and load path in 3D</button>
        <button onClick={() => { if (run(applyProposedSizes())) flash('Proposed sections and footing sizes applied. The pipes and conduits re-routed: check the MEP physics rows.'); }} data-testid="apply-proposed"
          title="Beams, columns and footings take the proposed sizes; the services re-route around them">Use the proposed sizes</button>
        <button onClick={() => download(`casa-123-${p.meta.versionId}-structure.csv`, structureCsv(p))}>Structure schedule (CSV)</button>
      </div>
      <p className="hint">Deeper beams and bigger footings change the space for pipes: after “Use the proposed sizes” look at the MEP physics checks. Undo puts the previous sizes back.</p>
      <GridEditor p={p} />
      <div className="schedgrid one engscroll">
        <h4>Beams</h4>
        <table className="rooms eng-t" data-testid="beam-table">
          <thead><tr><th>Beam</th><th>Spans m</th><th>Load kN/m</th><th>Section</th><th>Use</th><th>Governing</th><th>Proposed</th></tr></thead>
          <tbody>{f.beams.map((b) => (
            <tr key={b.beam.id} onClick={() => select(b.beam.id)}>
              <td>{b.beam.id}</td><td>{b.spans.map((s) => s.L.toFixed(2) + (s.primary ? '' : '*')).join(' · ')}</td>
              <td>{Math.max(0, ...b.spans.map((s) => s.w)).toFixed(1)}</td><td>{b.beam.props.profile}</td>
              <td className={UTIL[b.check.status]}>{b.check.util.toFixed(2)}</td><td className="src">{b.check.governing}</td><td>{b.proposed?.name ?? 'none in the table'}</td>
            </tr>
          ))}</tbody>
        </table>
        <p className="hint">* span carried by another beam (secondary, depth ≈ span/25); the others sit on columns (primary, span/20).</p>
        <h4>Columns and piers</h4>
        <table className="rooms eng-t" data-testid="column-table">
          <thead><tr><th>Column</th><th>At</th><th>N kN</th><th>Nd kN</th><th>L m</th><th>Section</th><th>Use</th><th>Proposed</th></tr></thead>
          <tbody>{f.columns.map((c) => (
            <tr key={c.col.id} onClick={() => select(c.col.id)}>
              <td>{c.col.id}</td><td>{c.col.props.at.map((v) => v.toFixed(2)).join(', ')}</td><td>{c.N.toFixed(0)}</td><td>{c.Nd.toFixed(0)}</td><td>{c.L.toFixed(2)}</td>
              <td>{c.col.props.profile}</td><td className={UTIL[c.check.status]}>{c.check.util.toFixed(2)}</td><td>{c.proposed?.name ?? '—'}</td>
            </tr>
          ))}</tbody>
        </table>
        <h4>Footings (allowable soil pressure {valueOf(p, 'soilPressure') ?? '—'} kPa, TO CONFIRM by SPT)</h4>
        <table className="rooms eng-t" data-testid="footing-table">
          <thead><tr><th>Footing</th><th>Carries</th><th>N kN</th><th>Drawn</th><th>kPa</th><th>Use</th><th>Proposed</th></tr></thead>
          <tbody>{f.footings.map((x) => {
            const r = x.footing.props.rect;
            return (
              <tr key={x.footing.id} onClick={() => select(x.footing.id)}>
                <td>{x.footing.id}</td><td>{x.carries}</td><td>{x.N.toFixed(0)}</td><td>{(r.x1 - r.x0).toFixed(2)} × {(r.y1 - r.y0).toFixed(2)}</td><td>{x.pressure.toFixed(0)}</td>
                <td className={UTIL[x.check.status]}>{x.check.util.toFixed(2)}</td><td>{x.B.toFixed(2)} × {x.B.toFixed(2)} × {x.h.toFixed(2)}</td>
              </tr>
            );
          })}</tbody>
        </table>
        <h4>Retaining walls</h4>
        <table className="rooms eng-t">
          <thead><tr><th>Wall</th><th>Soil height m</th><th>Stem need / has</th><th>Base ≈ 0.6 H</th><th>Use</th></tr></thead>
          <tbody>{f.retaining.map((r) => (
            <tr key={r.wall.id} onClick={() => select(r.wall.id)}><td>{r.wall.id}</td><td>{r.H.toFixed(2)}</td><td>{r.tNeed.toFixed(2)} / {r.tHas.toFixed(2)}</td><td>{r.base.toFixed(2)}</td><td className={UTIL[r.check.status]}>{r.check.util.toFixed(2)}</td></tr>
          ))}</tbody>
        </table>
        <p className="hint">Each retaining wall needs a drainage layer and weep holes behind it, and a drain at its foot.</p>
        <h4>Lintels over openings wider than 1.20 m</h4>
        <table className="rooms eng-t">
          <thead><tr><th>Opening</th><th>Span m</th><th>Kind</th><th>Depth m</th></tr></thead>
          <tbody>{f.lintels.map((l) => <tr key={l.opening.id} onClick={() => select(l.opening.id)}><td>{l.opening.id}</td><td>{l.span.toFixed(2)}</td><td>{l.kind}</td><td>{l.depth.toFixed(2)}</td></tr>)}</tbody>
        </table>
        <h4>Bracing (wind {f.wind.q.toFixed(2)} kN/m², V0 {valueOf(p, 'v0') ?? '—'} m/s TO CONFIRM)</h4>
        <p className="hint">Wind on the whole house about {f.wind.Fx.toFixed(0)} kN along x and {f.wind.Fy.toFixed(0)} kN along y. Each storey needs at least one braced bay in each direction; these bays have the least glass in the way:</p>
        <table className="rooms eng-t" data-testid="bracing-table">
          <thead><tr><th>Storey</th><th>Direction</th><th>Line</th><th>Between</th><th>Proposal</th></tr></thead>
          <tbody>{f.bracing.map((b, i) => <tr key={i}><td>{b.storey}</td><td>{b.dir}</td><td>{b.line}</td><td>{b.from.toFixed(2)} – {b.to.toFixed(2)}</td><td>{b.text}</td></tr>)}</tbody>
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
  return (
    <div className="pl-tab">
      <div className="asmdefaults">
        {USES.map((u) => (
          <label key={u} className="field small">
            <span>{USE_LABEL[u]}</span>
            <select value={def(u)} data-testid={`asm-default-${u}`} onChange={(e) => {
              if (run(setDefaultAssembly(u, e.target.value))) flash(`${USE_LABEL[u]}: ${assemblyById(e.target.value)?.name}. Thickness, weight, U-value, loads, footings and cost are updated.`);
            }}>
              {optionsFor(u).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        ))}
      </div>
      <p className="hint">Walls take the thickness of their assembly (in 2D and 3D, and the services re-route). Floors and roofs keep the drawn structural deck so the levels do not move; their build-up changes the weight, the U-value and the cost. A single wall or slab can have its own assembly in its properties.</p>
      <div className="btnrow"><button onClick={() => download(`casa-123-${p.meta.versionId}-assemblies.csv`, assembliesCsv(p))}>Assemblies schedule (CSV)</button></div>
      <div className="schedgrid one engscroll">
        <table className="rooms eng-t" data-testid="assembly-table">
          <thead><tr><th>Assembly</th><th>Use</th><th>m</th><th>kg/m²</th><th>U W/m²K</th><th>CT kJ/m²K</th><th>Rw dB</th><th>R$/m²</th></tr></thead>
          <tbody>{ASSEMBLIES.map((a) => {
            const v = values(a);
            return [
              <tr key={a.id} onClick={() => setOpen(open === a.id ? null : a.id)} className={Object.values(USES).some((u) => def(u) === a.id) ? 'inuse' : ''}>
                <td>{open === a.id ? '▾' : '▸'} {a.name}</td><td>{USE_LABEL[a.use]}</td><td>{v.thickness.toFixed(3)}</td><td>{v.mass.toFixed(0)}</td><td>{v.U.toFixed(2)}</td><td>{v.CT.toFixed(0)}</td>
                <td>{v.Rw.toFixed(0)}{v.rwMethod === 'table' ? '' : '*'}</td><td>{v.cost.toFixed(0)}</td>
              </tr>,
              open === a.id ? (
                <tr key={a.id + 'l'} className="layers"><td colSpan={8}>
                  <ol>{a.layers.map((l, i) => <li key={i}>{l.material} — {(l.t * 1000).toFixed(1)} mm · ρ {l.rho} kg/m³ · λ {l.lambda} W/mK · c {l.c} kJ/kgK · R$ {l.cost}/m²</li>)}</ol>
                  <p className="hint">Fire: {a.fire}. Source: {a.source}.</p>
                </td></tr>
              ) : null,
            ];
          })}</tbody>
        </table>
        <p className="hint">* Rw from the mass law. Layers are listed from outside to inside (top to bottom for floors and roofs).</p>
      </div>
    </div>
  );
}

/* ---------- thermal ---------- */

function Thermal({ p }: { p: Project }) {
  const rows = thermalOf(p);
  const as = ASSUMPTIONS.filter((a) => a.key === 'zone' || a.key === 'absorptance');
  return (
    <div className="pl-tab">
      <div className="asmdefaults">{as.map((a) => <label key={a.key} className="field small"><span>{a.label}</span><span className="inputwrap"><AssumptionInput a={a} p={p} /><em>{a.unit}{a.toConfirm ? ' · TO CONFIRM' : ''}</em></span></label>)}</div>
      <p className="hint">NBR 15575 simplified method: the U-value of the exterior walls and roofs, and the thermal capacity CT of the walls, against the limits of the bioclimatic zone. If an assembly fails, the standard asks for the computer simulation method instead (it does not mean the house is unacceptable).</p>
      <table className="rooms eng-t" data-testid="thermal-table">
        <thead><tr><th>Assembly</th><th>Where</th><th>U</th><th>CT</th><th>Limit</th><th>Result</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.kind + r.assembly.id}>
            <td>{r.assembly.name}</td><td>{r.kind === 'roof' ? `${r.elements.length} roof slab(s)` : `${r.elements.length} walls, ${r.area.toFixed(0)} m²`}</td>
            <td>{r.U.toFixed(2)}</td><td>{r.CT.toFixed(0)}</td><td className="src">{r.limit.text}</td>
            <td className={r.status === 'pass' ? 'u-ok' : 'u-red'}>{r.status === 'pass' ? 'passes' : 'simulation needed'}</td>
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
  return (
    <div className="pl-tab">
      <div className="schedgrid one engscroll">
        <div className="card" data-testid="energy-card">
          <h4>Water heating and solar (estimate)</h4>
          {energy.text.map((t) => <p key={t}>{t}</p>)}
        </div>
        <h4>Ventilation (long-stay rooms)</h4>
        <table className="rooms eng-t">
          <thead><tr><th>Room</th><th>Cross-ventilation</th><th>Openable m²</th><th>Need m²</th></tr></thead>
          <tbody>{env.ventilation.map((v) => (
            <tr key={v.room.id} onClick={() => select(v.room.id)}><td>{v.room.props.name}</td><td className={v.status === 'pass' ? '' : 'u-amber'}>{v.text}</td><td className={v.areaOk ? '' : 'u-red'}>{v.openable.toFixed(2)}</td><td>{v.need.toFixed(2)}</td></tr>
          ))}</tbody>
        </table>
        <h4>Sun on the glass (hours of direct sun, 21 Dec and 21 Jun)</h4>
        <table className="rooms eng-t" data-testid="sun-table">
          <thead><tr><th>Window</th><th>Faces</th><th>21 Dec</th><th>21 Jun</th><th>Shading</th></tr></thead>
          <tbody>{env.sun.map((s) => (
            <tr key={s.op.id} onClick={() => select(s.op.id)} data-window={s.op.id}><td>{s.op.id}</td><td>{s.side}</td><td className={s.status === 'warn' ? 'u-amber' : ''}>{s.dec.toFixed(1)} h</td><td>{s.jun.toFixed(1)} h</td><td>{s.shading.join(', ') || '—'}</td></tr>
          ))}</tbody>
        </table>
        <p className="hint">Counted every half hour with the eaves, the upper floor, the brises, shutters, awnings and pergolas in the model (trees come with spec 06). West glass with more than 2 h of December sun is flagged.</p>
        <h4>Daylight</h4>
        <table className="rooms eng-t">
          <thead><tr><th>Room</th><th>Average daylight factor</th></tr></thead>
          <tbody>{env.daylight.map((d) => <tr key={d.room.id} onClick={() => select(d.room.id)}><td>{d.room.props.name}</td><td className={d.status === 'pass' ? '' : 'u-amber'}>{d.df.toFixed(1)} % (target ≥ 2 %)</td></tr>)}</tbody>
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
  const others = useMemo(() => VERSION_IDS.filter((v) => v !== active).map((v) => ({ v, name: BASES[v].meta.version, c: costOf(versions[v].present) })), [versions, active]);
  const snap = p.engineering?.snapshot;
  return (
    <div className="pl-tab">
      <CostCard p={p} c={c} others={others} />
      <div className="btnrow">
        <button onClick={() => { const d = new Date(); if (run(saveCostSnapshot(`Snapshot ${d.toISOString().slice(0, 10)}`, d.toISOString()))) flash('Cost snapshot saved: the next changes are compared with it.'); }} data-testid="save-snapshot">Save as snapshot</button>
        <button onClick={() => download(`casa-123-${p.meta.versionId}-cost.csv`, costCsv(p))}>Cost estimate (CSV)</button>
        {snap && <span className="hint">Snapshot: {snap.label} · {brl(snap.total)}</span>}
      </div>
      <div className="schedgrid one engscroll">
        <table className="rooms eng-t" data-testid="cost-table">
          <thead><tr><th>Group</th><th>Item</th><th>Quantity</th><th>Rate</th><th>R$</th></tr></thead>
          <tbody>
            {c.items.map((i) => <tr key={i.key}><td>{i.group}</td><td>{i.label}</td><td>{i.qty.toFixed(1)} {i.unit}</td><td>{i.unit === 'each' && i.group === 'Features' ? '—' : i.rate.toFixed(0)}</td><td>{Math.round(i.value).toLocaleString('en-US')}</td></tr>)}
            <tr className="sum"><td /><td>Overheads and profit (BDI {valueOf(p, 'costBdi')} %)</td><td /><td /><td>{Math.round(c.bdi).toLocaleString('en-US')}</td></tr>
            <tr className="sum"><td /><td>Total by quantities</td><td /><td /><td>{Math.round(c.total).toLocaleString('en-US')}</td></tr>
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
  const diff = (a: number, b: number) => `${a >= b ? '+' : '−'}${brl(Math.abs(a - b)).slice(3)} (${a >= b ? '+' : '−'}${Math.abs(((a - b) / Math.max(b, 1)) * 100).toFixed(1)} %)`;
  const rows: ReactNode[] = [];
  if (snap) rows.push(<li key="snap">Against the snapshot “{snap.label}”: <b>R$ {diff(c.total, snap.total)}</b></li>);
  for (const o of others ?? []) rows.push(<li key={o.v}>Against {o.name}: <b>R$ {diff(c.total, o.c.total)}</b> by quantities{o.c.area.total !== null && c.area.total !== null ? <>, R$ {diff(c.area.total, o.c.area.total)} by area</> : null}</li>);
  return (
    <div className="costcard" data-testid="cost-card">
      <div className="costmethods">
        <div>
          <h4>By quantities</h4>
          <b className="big" data-testid="cost-total">{brl(c.total)}</b>
          <span>range {brl(lo)} – {brl(hi)} (±25 %)</span>
          <span>{brl(c.perM2)}/m² over {c.gross.toFixed(0)} m² of rooms</span>
        </div>
        <div>
          <h4>By area (CUB)</h4>
          {c.area.total === null
            ? <b className="big tc" data-testid="cost-cub">CUB TO CONFIRM</b>
            : <><b className="big" data-testid="cost-cub">{brl(c.area.total)}</b><span>range {brl(c.area.total * 0.75)} – {brl(c.area.total * 1.25)}</span></>}
          <span>{c.area.cub === null ? 'Enter the CUB in Assumptions' : `R$ ${c.area.cub.toFixed(2)}/m² (R8-N, Sinduscon-SP, Sep 2026)`} × {c.area.equivalent.toFixed(1)} m² equivalent + {(c.area.extras * 100).toFixed(0)} % not in the CUB</span>
        </div>
      </div>
      <h4>Biggest items</h4>
      <svg className="chart costbars" viewBox={`0 0 620 ${top.length * 24 + 4}`} role="img" aria-label="Biggest cost items">
        {top.map((i, k) => (
          <g key={i.key} transform={`translate(0 ${k * 24})`}>
            <title>{`${i.label}: ${brl(i.value)} (${i.how})`}</title>
            <text x={0} y={15} className="axis">{i.label.length > 52 ? i.label.slice(0, 51) + '…' : i.label}</text>
            <rect x={340} y={4} width={Math.max(2, (i.value / max) * 220)} height={14} rx={3} fill={BAR} />
            <text x={340 + Math.max(2, (i.value / max) * 220) + 6} y={15} className="val">{`${(i.value / 1000).toFixed(0)}k`}</text>
          </g>
        ))}
      </svg>
      {rows.length > 0 && <ul className="costdiff">{rows}</ul>}
      <p className="disclaimer">{DISCLAIMER}</p>
    </div>
  );
}
