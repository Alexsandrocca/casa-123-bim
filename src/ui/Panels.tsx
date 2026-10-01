// Properties panel, checks bar and About panel.
import { useEffect, useMemo, useState } from 'react';
import { minArea, needsDaylight, runChecks, summarize, type CheckResult } from '../model/checks';
import {
  deleteDevice, deleteOpening, doorMax, flipOpening, moveDevice, moveFixture, setCircuitSection, setDevice, setSolar, renameSpace, resizeOpening, setElementProps, setOpeningSize, setPipe, setServiceSpace, setWallThickness,
} from '../model/commands';
import { whyHere } from '../model/mep/analysis';
import { networkLabel } from '../model/plumbing/checks';
import { kindOf } from '../model/plumbing/library';
import { BEAM_PROFILES, COLUMN_PROFILES, PIER_PROFILES, profile } from '../model/profiles';
import { byLevel, getEl, glassArea, openingSegIn, spaceArea, wallLength, wallSeg } from '../model/geometry';
import { cameraFov, cameraRange, deviceType } from '../model/electrical/library';
import type { Beam, Carport, Circuit, Column, Conduit, Device, Element, Fixture, PipeSegment, ServiceSpace, SolarArray, Footing, Opening, PlanLevel, Project, Slab, Space, Stair, Wall } from '../model/schema';
import { useApp, useProject } from '../store';
import { EstRow } from './Estimate';
import { assemblyOf, optionsFor, useOf } from '../model/eng/assemblies';
import { deleteFeature, setAssembly, setFeature } from '../model/eng/commands';
import { beamEstimates, columnEstimates, featureEstimates, footingEstimates, slabEstimates, wallEstimates } from '../model/eng/estimates';
import { featureType } from '../model/eng/features';
import { DISCLAIMER, frameOf } from '../model/eng';
import type { Feature } from '../model/schema';
import { ZONE_COLOR } from './PlanView';

const m = (v: number) => v.toFixed(2);

const ZONE_NAME: Record<string, string> = {
  social: 'Social', private: 'Private', wet: 'Wet room', service: 'Service', circ: 'Circulation',
  work: 'Work', stair: 'Stair', garage: 'Garage',
};
const WALL_NAME: Record<string, string> = {
  exterior: 'Exterior wall', interior: 'Interior wall', wet: 'Wet-room wall', retaining: 'Retaining wall',
};

export function openingLabel(op: Opening): string {
  const { kind, role, high } = op.props;
  if (kind === 'garage') return 'Garage door';
  if (kind === 'slider') return role === 'door' ? 'Glass sliding door' : 'Sliding window';
  if (role === 'window') return high ? 'High window' : 'Window';
  return 'Door';
}

/* ---------- small inputs ---------- */

function NumberField({ label, value, onCommit, step = 0.05, min, unit = 'm', testId }: {
  label: string; value: number; onCommit: (v: number) => void; step?: number; min?: number; unit?: string; testId?: string;
}) {
  const [text, setText] = useState(value.toFixed(2));
  useEffect(() => setText(value.toFixed(2)), [value]);
  const commit = () => {
    const v = Number(text.replace(',', '.'));
    if (Number.isFinite(v) && Math.abs(v - value) > 1e-6) onCommit(v); else setText(value.toFixed(2));
  };
  return (
    <label className="field">
      <span>{label}</span>
      <span className="inputwrap">
        <input
          type="number" inputMode="decimal" step={step} min={min} value={text} data-testid={testId}
          onChange={(e) => setText(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setText(value.toFixed(2)); }}
        />
        <em>{unit}</em>
      </span>
    </label>
  );
}

function TextField({ label, value, onCommit, testId }: { label: string; value: string; onCommit: (v: string) => void; testId?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => { if (text.trim() !== value) onCommit(text); };
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="text" value={text} data-testid={testId} onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setText(value); }}
      />
    </label>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => <div className="kv"><span>{k}</span><b>{v}</b></div>;

/* ---------- properties ---------- */

export function PropertiesPanel() {
  const p = useProject();
  const level = useApp((s) => s.level);
  const selection = useApp((s) => s.selection);
  const el = selection ? getEl(p, selection) : undefined;
  return (
    <aside className="props" aria-label="Properties">
      {!el && <LevelSummary p={p} level={level} />}
      {el?.type === 'Space' && <SpaceProps p={p} s={el} />}
      {el?.type === 'Wall' && <WallProps p={p} w={el} />}
      {el?.type === 'Opening' && <OpeningProps p={p} op={el} />}
      {el?.type === 'Column' && <ColumnProps c={el} />}
      {el?.type === 'Beam' && <BeamProps b={el} />}
      {el?.type === 'Slab' && <SlabProps s={el} />}
      {el?.type === 'Footing' && <FootingProps f={el} />}
      {el?.type === 'Feature' && <FeatureProps f={el} />}
      {el && ['Wall', 'Slab', 'Beam', 'Column', 'Footing', 'Feature'].includes(el.type) && <Estimates el={el} />}
      {el?.type === 'Stair' && <StairProps st={el} />}
      {el?.type === 'Carport' && <CarportProps c={el} />}
      {el?.type === 'Fixture' && <FixtureProps f={el} />}
      {el?.type === 'PipeSegment' && <PipeProps s={el} />}
      {el?.type === 'Device' && <DeviceProps d={el} p={p} />}
      {el?.type === 'Circuit' && <CircuitProps c={el} p={p} />}
      {el?.type === 'SolarArray' && <SolarProps a={el} />}
      {el?.type === 'ServiceSpace' && <ServiceSpaceProps sp={el} />}
      {el?.type === 'Conduit' && <ConduitProps c={el} p={p} />}
      {el && ['Fixture', 'PipeSegment', 'Device', 'Conduit'].includes(el.type) && <WhyHere p={p} id={el.id} />}
      {el?.notes?.length ? (
        <div className="notes" data-testid="notes">
          <h4>Notes for the architect and engineers</h4>
          {el.notes.map((n, i) => <p key={i}>{n}</p>)}
        </div>
      ) : null}
      {el && !['Space', 'Wall', 'Opening', 'Column', 'Beam', 'Slab', 'Footing', 'Stair', 'Carport', 'Fixture', 'PipeSegment', 'Device', 'Circuit', 'SolarArray', 'ServiceSpace', 'Conduit', 'Feature'].includes(el.type) && <GenericProps el={el} />}
    </aside>
  );
}

function Header({ title, sub }: { title: string; sub: string }) {
  const select = useApp((s) => s.select);
  return (
    <div className="phead">
      <div><h3>{title}</h3><div className="eyebrow">{sub}</div></div>
      <button className="ghost" onClick={() => select(null)} aria-label="Close properties">✕</button>
    </div>
  );
}

function LevelSummary({ p, level }: { p: Project; level: PlanLevel }) {
  const lv = p.levels.find((l) => l.id === level)!;
  const select = useApp((s) => s.select);
  const rooms = byLevel(p, level, 'Space').filter((s) => s.props.zone !== 'stair');
  // Gross floor area: all the rooms and the stair on this floor (the outline may include open patios).
  const gross = byLevel(p, level, 'Space').reduce((sum, s) => sum + spaceArea(s), 0);
  return (
    <>
      <div className="phead"><div><h3>{lv.name}</h3><div className="eyebrow" data-testid="gross">{p.meta.version} · {gross.toFixed(1)} m² gross</div></div></div>
      <p className="hint">{p.meta.note}</p>
      <table className="rooms">
        <thead><tr><th>Room</th><th>m²</th><th>Min</th><th>Window</th></tr></thead>
        <tbody>
          {rooms.map((s) => {
            const a = spaceArea(s), min = minArea(s), g = glassArea(p, s), light = needsDaylight(s);
            const okA = !min || a >= min - 0.005, okL = !light || g >= a / 8 - 0.005;
            return (
              <tr key={s.id} onClick={() => select(s.id)}>
                <td><i style={{ background: ZONE_COLOR[s.props.zone] }} />{s.props.name}</td>
                <td>{a.toFixed(1)}</td>
                <td className={okA ? 'ok' : 'bad'}>{min ? `≥ ${min}` : '–'}</td>
                <td className={okL ? 'ok' : 'bad'}>{light ? (g > 0 ? `1/${Math.max(1, Math.round(a / g))}` : 'none') : '–'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="hint">Drag an inside wall to resize the rooms on both sides (5 cm steps). Drag a door or window to slide it along its wall. Double-click a wall to add a door (inside) or a window (outside). Click anything to see and edit its properties. The outer walls and the stair stay fixed. Your changes are saved in this browser.</p>
    </>
  );
}

function SpaceProps({ p, s }: { p: Project; s: Space }) {
  const run = useApp((st) => st.run);
  const a = spaceArea(s), min = minArea(s), g = glassArea(p, s);
  const lv = p.levels.find((l) => l.id === s.level)!;
  return (
    <>
      <Header title={s.props.name} sub={`Room · ${ZONE_NAME[s.props.zone]} · ${s.id}`} />
      {s.props.zone !== 'stair'
        ? <TextField label="Name" value={s.props.name} testId="room-name" onCommit={(v) => run(renameSpace(s.id, v))} />
        : <p className="hint">The stair core is fixed. Its walls cannot be dragged.</p>}
      <div className="kvs">
        <Row k="Area" v={`${a.toFixed(2)} m²`} />
        {min > 0 && <Row k="Code minimum" v={`${min} m²`} />}
        {needsDaylight(s) && <Row k="Window glass" v={g > 0 ? `${g.toFixed(2)} m² (1/${Math.max(1, Math.round(a / g))})` : 'none'} />}
        <Row k="Floor level" v={`${(s.props.floorElevation ?? lv.elevation) >= 0 ? '+' : '−'}${Math.abs(s.props.floorElevation ?? lv.elevation).toFixed(2)} m`} />
        <Row k="Parts" v={`${s.props.cells.length} rectangle${s.props.cells.length > 1 ? 's' : ''}`} />
        {s.props.cells.map((c, i) => <Row key={i} k={`  part ${i + 1}`} v={`${m(c.x1 - c.x0)} × ${m(c.y1 - c.y0)} m`} />)}
      </div>
    </>
  );
}

function WallProps({ p, w }: { p: Project; w: Wall }) {
  const run = useApp((st) => st.run);
  const s = wallSeg(w);
  const hosted = byLevel(p, w.level, 'Opening').filter((o) => o.props.host === w.id);
  const fixed = w.props.wallType === 'exterior' || w.props.wallType === 'retaining';
  return (
    <>
      <Header title={WALL_NAME[w.props.wallType]!} sub={`Wall · ${w.id}`} />
      <AssemblySelect p={p} el={w} />
      <NumberField label="Thickness" value={w.props.thickness} step={0.01} min={0.05} onCommit={(v) => run(setWallThickness(w.id, v))} testId="wall-thickness" />
      <div className="kvs">
        <Row k="Length" v={`${m(wallLength(w))} m`} />
        <Row k="Height" v={`${m(w.props.height)} m`} />
        <Row k="Runs along" v={s.o === 'v' ? `x = ${m(s.c)}, y ${m(s.a)} → ${m(s.b)}` : `y = ${m(s.c)}, x ${m(s.a)} → ${m(s.b)}`} />
        <Row k="Doors and windows" v={String(hosted.length)} />
      </div>
      <p className="hint">{fixed ? 'Outer walls follow the building outline and stay fixed.' : 'Drag this wall in the plan to resize the rooms on both sides. Its type comes from the rooms it separates.'}</p>
    </>
  );
}

function OpeningProps({ p, op }: { p: Project; op: Opening }) {
  const run = useApp((st) => st.run);
  const select = useApp((st) => st.select);
  const host = getEl(p, op.props.host) as Wall | undefined;
  const s = openingSegIn(p, op);
  const isDoor = op.props.role === 'door';
  const swingable = isDoor && op.props.kind === 'door';
  return (
    <>
      <Header title={openingLabel(op)} sub={`${isDoor ? 'Door' : 'Window'} · ${op.id}`} />
      <div className="btnrow">
        <button onClick={() => run(resizeOpening(op.id, op.props.width - 0.1))}>− 10 cm</button>
        <button onClick={() => run(resizeOpening(op.id, op.props.width + 0.1))}>+ 10 cm</button>
        {swingable && <button onClick={() => run(flipOpening(op.id))}>Flip swing</button>}
        <button className="danger" onClick={() => { if (run(deleteOpening(op.id))) select(null); }}>Delete</button>
      </div>
      <NumberField label="Width" value={op.props.width} onCommit={(v) => run(resizeOpening(op.id, v))} testId="op-width" />
      <NumberField label="Height" value={op.props.height} onCommit={(v) => run(setOpeningSize(op.id, { height: v }))} />
      {!isDoor && <NumberField label="Sill" value={op.props.sill} onCommit={(v) => run(setOpeningSize(op.id, { sill: v }))} />}
      <div className="kvs">
        {s && <Row k="Position" v={s.o === 'v' ? `x = ${m(s.c)}, y ${m(s.a)} → ${m(s.b)}` : `y = ${m(s.c)}, x ${m(s.a)} → ${m(s.b)}`} />}
        <Row k="Host wall" v={host ? `${WALL_NAME[host.props.wallType]} ${host.id}` : '—'} />
        {!isDoor && <Row k="Glass" v={`${(op.props.width * op.props.height).toFixed(2)} m²`} />}
        {isDoor && <Row k="Width range" v={`0.60 – ${doorMax(op).toFixed(2)} m`} />}
      </div>
      <p className="hint">Drag it in the plan to slide it along its wall. Delete or Backspace removes it.</p>
    </>
  );
}

function ProfileSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} data-testid="profile">
        {options.includes(value) ? null : <option value={value}>{value}</option>}
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

const lvl = (v: number) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(2)}`;

function ColumnProps({ c }: { c: Column }) {
  const run = useApp((st) => st.run);
  const pier = c.props.kind === 'pier';
  const pr = profile(c.props.profile);
  return (
    <>
      <Header title={pier ? 'Pier' : 'Steel column'} sub={`${pier ? 'Pier' : 'Column'} · ${c.id} · generated from the grid`} />
      <ProfileSelect label="Section" value={c.props.profile} options={(pier ? PIER_PROFILES : COLUMN_PROFILES).map((p) => p.name)}
        onChange={(v) => run(setElementProps(c.id, { profile: v }, 'Change column section'))} />
      <div className="kvs">
        <Row k="Size" v={`${m(pr.b)} × ${m(pr.d)} m`} />
        <Row k="At" v={`x ${m(c.props.at[0])}, y ${m(c.props.at[1])}`} />
        <Row k="From" v={`${lvl(c.props.baseElevation)} (top of footing)`} />
        <Row k="To" v={`${lvl(c.props.topElevation)} (under the beams)`} />
        <Row k="Height" v={`${m(c.props.topElevation - c.props.baseElevation)} m`} />
      </div>
      <Proposed id={c.id} kind="column" current={c.props.profile} />
      <p className="hint">Sizes are for design only. The structural engineer sizes the real frame (NBR 8800).</p>
    </>
  );
}

/** The lightest section that passes, with a button to use it (spec 08). */
function Proposed({ id, kind, current }: { id: string; kind: 'beam' | 'column'; current: string }) {
  const p = useProject();
  const run = useApp((st) => st.run);
  const f = frameOf(p);
  const r = kind === 'beam' ? f.beams.find((b) => b.beam.id === id) : f.columns.find((c) => c.col.id === id);
  if (!r) return null;
  const cls = r.check.status === 'red' ? 'bad' : r.check.status === 'amber' ? 'warn' : 'ok';
  return (
    <div className="proposed" data-testid="proposed">
      <p><b className={cls}>Utilisation {r.check.util.toFixed(2)}</b> · {r.check.governing}</p>
      {r.proposed && r.proposed.name !== current && (
        <button className="small" onClick={() => run(setElementProps(id, { profile: r.proposed!.name }, `Use ${r.proposed!.name}`))}>Use {r.proposed.name} (lightest that passes)</button>
      )}
    </div>
  );
}

function BeamProps({ b }: { b: Beam }) {
  const run = useApp((st) => st.run);
  const pr = profile(b.props.profile);
  const len = Math.hypot(b.props.end[0] - b.props.start[0], b.props.end[1] - b.props.start[1]);
  return (
    <>
      <Header title="Steel beam" sub={`Beam · ${b.id} · generated`} />
      <ProfileSelect label="Section" value={b.props.profile} options={BEAM_PROFILES.map((p) => p.name)}
        onChange={(v) => run(setElementProps(b.id, { profile: v }, 'Change beam section'))} />
      <div className="kvs">
        <Row k="Length" v={`${m(len)} m`} />
        <Row k="Depth" v={`${m(pr.d)} m`} />
        <Row k="Top of steel" v={lvl(b.props.elevation)} />
        <Row k="From → to" v={`(${m(b.props.start[0])}, ${m(b.props.start[1])}) → (${m(b.props.end[0])}, ${m(b.props.end[1])})`} />
      </div>
      <Proposed id={b.id} kind="beam" current={b.props.profile} />
    </>
  );
}

function SlabProps({ s }: { s: Slab }) {
  const run = useApp((st) => st.run);
  const p = useProject();
  return (
    <>
      <Header title={s.props.name} sub={`Slab · ${s.id}${s.props.onGrade ? ' · on the ground' : ' · steel deck'}`} />
      <AssemblySelect p={p} el={s} />
      {s.props.eaves !== undefined && <NumberField label="Eaves" value={s.props.eaves} onCommit={(v) => run(setElementProps(s.id, { eaves: Math.max(0, v) }, 'Change eaves'))} />}
      {s.props.parapet !== undefined && <NumberField label="Parapet" value={s.props.parapet} onCommit={(v) => run(setElementProps(s.id, { parapet: Math.max(0, v) }, 'Change parapet'))} />}
      <div className="kvs">
        <Row k="Top" v={lvl(s.props.topElevation)} />
        <Row k="Thickness" v={`${m(s.props.thickness)} m`} />
        {s.props.parapet !== undefined && <Row k="Parapet top" v={lvl(s.props.topElevation + s.props.parapet)} />}
      </div>
      {s.props.eaves !== undefined && <p className="hint">Eaves up to 0.70 m are not counted in site coverage (Piracicaba LC 474/2025).</p>}
    </>
  );
}

function FootingProps({ f }: { f: Footing }) {
  const r = f.props.rect;
  return (
    <>
      <Header title={f.props.kind === 'pad' ? 'Pad footing' : 'Strip footing'} sub={`Footing · ${f.id}${f.props.carries ? ` · carries ${f.props.carries}` : ''}`} />
      <div className="kvs">
        <Row k="Plan size" v={`${m(r.x1 - r.x0)} × ${m(r.y1 - r.y0)} m`} />
        <Row k="Top" v={lvl(f.props.topElevation)} />
        <Row k="Depth" v={`${m(f.props.depth)} m`} />
      </div>
      <p className="hint">Drawn sizes are placeholders; the estimate below sizes them on the loads. Real footings come from the soil borings (SPT) and NBR 6122.</p>
    </>
  );
}

function StairProps({ st }: { st: Stair }) {
  const { riser, tread, width, flights, name } = st.props;
  const n = flights.reduce((a, f) => a + f.risers, 0);
  return (
    <>
      <Header title={name} sub={`Stair · ${st.id}`} />
      <div className="kvs">
        <Row k="Risers" v={`${n} × ${riser.toFixed(3)} m = ${(n * riser).toFixed(2)} m`} />
        <Row k="Tread" v={`${m(tread)} m`} />
        <Row k="Width" v={`${m(width)} m`} />
        <Row k="2h + b" v={`${(2 * riser + tread).toFixed(3)} m`} />
        <Row k="Flights" v={String(flights.length)} />
      </div>
    </>
  );
}

function CarportProps({ c }: { c: Carport }) {
  const r = c.props.rect;
  const rear = c.props.roofFront + c.props.slope * (r.y1 - r.y0);
  return (
    <>
      <Header title={c.props.name} sub={`Carport · ${c.id} · independent light steel frame`} />
      <div className="kvs">
        <Row k="Footprint" v={`${m(r.x1 - r.x0)} × ${m(r.y1 - r.y0)} m`} />
        <Row k="Parking" v={`${c.props.parking.length} bays of 2.50 × 5.00 m`} />
        <Row k="Roof top" v={`${lvl(c.props.roofFront)} at the street → ${lvl(rear)} at the house`} />
        <Row k="Roof slope" v={`${(c.props.slope * 100).toFixed(0)} % to the street, gutter at the front`} />
        <Row k="Solar" v={`${c.props.solarModules} modules reserved (moved from the old garage roof)`} />
        <Row k="EV charger" v="7 kW on a carport column" />
      </div>
      <p className="hint">A covered carport in the front setback must be confirmed with the Prefeitura (LC 474/2025 and the building code).</p>
    </>
  );
}

function FixtureProps({ f }: { f: Fixture }) {
  const run = useApp((st) => st.run);
  const t = kindOf(f.props.kind);
  const auto = f.tags.includes('auto');
  return (
    <>
      <Header title={t.label} sub={`Fixture · ${f.id} · ${f.level}`} />
      {auto ? <p className="hint">Placed by the router where an outside sewage pipe turns or joins.</p> : (
        <>
          <NumberField label="x (north)" value={f.props.at[0]} onCommit={(v) => run(moveFixture(f.id, v, f.props.at[1]))} testId="fx-x" />
          <NumberField label="y (rear)" value={f.props.at[1]} onCommit={(v) => run(moveFixture(f.id, f.props.at[0], v))} testId="fx-y" />
        </>
      )}
      <div className="kvs">
        <Row k="Stands at" v={lvl(f.props.z)} />
        {t.drainDn && <Row k="Drain" v={`DN ${t.drainDn} · ${t.uhc} fixture units`} />}
        {t.weight && <Row k="Water" v={`weight ${t.weight}${t.hot ? ' · cold and hot' : ' · cold'}`} />}
        {f.props.area !== undefined && <Row k="Roof area" v={`${f.props.area.toFixed(1)} m²`} />}
      </div>
      {!auto && <p className="hint">Turn on “Plumbing” above the plan and drag the fixture; the pipes re-route and the checks update.</p>}
    </>
  );
}

function PipeProps({ s }: { s: PipeSegment }) {
  const run = useApp((st) => st.run);
  const [a, b] = [s.props.start, s.props.end];
  const h = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const slope = h > 0.01 ? ((a[2] - b[2]) / h) * 100 : null;
  const unit = s.props.system === 'sewage' ? 'fixture units' : s.props.system === 'rain' ? 'm² of roof' : 'ΣP';
  const DNS = [20, 25, 32, 40, 50, 75, 100, 150];
  return (
    <>
      <Header title={`Pipe · ${s.props.system}`} sub={`${s.id} · ${networkLabel(s.props.network)}`} />
      <ProfileSelect label="DN" value={String(s.props.dn)} options={DNS.map(String)} onChange={(v) => run(setPipe(s.id, { dn: Number(v) }))} />
      <ProfileSelect label="Material" value={s.props.material} options={['PVC', 'PPR', 'CPVC']} onChange={(v) => run(setPipe(s.id, { material: v as 'PVC' | 'PPR' | 'CPVC' }))} />
      <div className="kvs">
        <Row k="Length" v={`${m(len)} m`} />
        <Row k={slope === null ? 'Vertical' : 'Slope'} v={slope === null ? `${lvl(Math.max(a[2], b[2]))} → ${lvl(Math.min(a[2], b[2]))}` : `${slope.toFixed(1)} %`} />
        <Row k="From" v={`(${m(a[0])}, ${m(a[1])}) at ${lvl(a[2])}`} />
        <Row k="To" v={`(${m(b[0])}, ${m(b[1])}) at ${lvl(b[2])}`} />
        <Row k="Flow" v={s.props.pressure ? 'under pressure' : 'by gravity, from → to'} />
        <Row k="Load" v={`${s.props.load} ${unit}`} />
        <Row k="Serves" v={`${s.props.serves.length} fixture${s.props.serves.length === 1 ? '' : 's'}`} />
      </div>
      <p className="hint">{s.props.manual ? 'Edited by hand: the router keeps this DN and material.' : 'Placed by the router. Changing DN or material keeps your choice when the pipes re-route.'}</p>
    </>
  );
}

function DeviceProps({ d, p }: { d: Device; p: Project }) {
  const run = useApp((st) => st.run);
  const select = useApp((st) => st.select);
  const t = deviceType(d.props.kind);
  const circuits = p.elements.filter((e): e is Circuit => e.type === 'Circuit' && e.props.purpose !== 'feeder');
  const c = circuits.find((x) => x.id === d.props.circuit);
  const cam = t.group === 'camera';
  const floor = p.levels.find((l) => l.id === (d.level === 'roof' ? 'roof' : d.level))?.elevation ?? 0;
  return (
    <>
      <Header title={t.label} sub={`${d.props.name} · ${d.id}`} />
      <NumberField label="x (north)" value={d.props.at[0]} onCommit={(v) => run(moveDevice(d.id, v, d.props.at[1]))} testId="dev-x" />
      <NumberField label="y (rear)" value={d.props.at[1]} onCommit={(v) => run(moveDevice(d.id, d.props.at[0], v))} testId="dev-y" />
      {['outlet', 'light', 'dedicated'].includes(t.group) && (
        <NumberField label={t.group === 'dedicated' ? 'Power' : 'Power (VA)'} unit={t.group === 'dedicated' ? 'W' : 'VA'} step={10} value={d.props.power} onCommit={(v) => run(setDevice(d.id, { power: v }))} testId="dev-power" />
      )}
      {cam && (
        <>
          <NumberField label="Bearing" unit="° (0 N, 90 street)" step={5} value={d.props.bearing ?? 0} onCommit={(v) => run(setDevice(d.id, { bearing: ((v % 360) + 360) % 360 }))} testId="cam-bearing" />
          <NumberField label="Lens" unit="mm" step={0.1} value={d.props.lensMm ?? 2.8} onCommit={(v) => run(setDevice(d.id, { lensMm: v }))} testId="cam-lens" />
          <NumberField label="Tilt down" unit="°" step={1} value={d.props.tilt ?? 15} onCommit={(v) => run(setDevice(d.id, { tilt: v }))} />
        </>
      )}
      {circuits.length > 0 && ['outlet', 'light', 'dedicated'].includes(t.group) && (
        <ProfileSelect label="Circuit" value={d.props.circuit ?? ''} options={circuits.map((x) => x.id)} onChange={(v) => run(setDevice(d.id, { circuit: v }))} />
      )}
      <div className="kvs">
        <Row k="Height" v={`${m(d.props.z - floor)} m above the floor (${lvl(d.props.z)})`} />
        {c && <Row k="On circuit" v={`${c.props.name} · ${c.props.breaker} A · ${c.props.section} mm²`} />}
        {cam && <Row k="View" v={`${cameraFov(d.props.lensMm ?? 2.8).toFixed(0)}° wide, about ${cameraRange(d.props.lensMm ?? 2.8).toFixed(0)} m`} />}
      </div>
      <div className="btnrow">
        {c && <button onClick={() => select(c.id)}>Show circuit</button>}
        {!['panel', 'sub-panel'].includes(d.props.kind) && <button className="danger" onClick={() => { if (run(deleteDevice(d.id))) select(null); }}>Delete</button>}
      </div>
      <p className="hint">{d.props.manualCircuit ? 'Circuit chosen by hand.' : 'Turn on “Electrical” above the plan to drag it; the circuit, cable and schedule update.'}</p>
    </>
  );
}

function CircuitProps({ c, p }: { c: Circuit; p: Project }) {
  const run = useApp((st) => st.run);
  const devs = p.elements.filter((e): e is Device => e.type === 'Device' && e.props.circuit === c.id);
  return (
    <>
      <Header title={c.props.name} sub={`Circuit · ${c.id}`} />
      <ProfileSelect label="Cable mm²" value={String(c.props.section)} options={['1.5', '2.5', '4', '6', '10', '16', '25']} onChange={(v) => run(setCircuitSection(c.id, Number(v)))} />
      <div className="kvs">
        <Row k="Load" v={`${c.props.load} ${c.props.purpose === 'dedicated' ? 'W' : 'VA'} · ${c.props.current} A`} />
        <Row k="Supply" v={`${c.props.voltage} V · phase ${c.props.phases.join('')}`} />
        <Row k="Breaker" v={`${c.props.breaker} A${c.props.rcd ? ' · RCD 30 mA' : ''}`} />
        <Row k="Length" v={`${m(c.props.length)} m to the farthest point`} />
        <Row k="Voltage drop" v={`${c.props.drop.toFixed(2)} % (max 4 %)`} />
        <Row k="Points" v={String(devs.length)} />
      </div>
      <p className="hint">{c.props.manualSection ? 'Section chosen by hand; the checks tell if it is enough.' : 'Sized from the load, the length and the voltage drop (NBR 5410).'}</p>
    </>
  );
}

function SolarProps({ a }: { a: SolarArray }) {
  const run = useApp((st) => st.run);
  return (
    <>
      <Header title={a.props.name} sub={`Solar array · ${a.id}`} />
      <NumberField label="Modules" unit="" step={1} value={a.props.modules} onCommit={(v) => run(setSolar({ modules: Math.max(0, Math.round(v)) }))} />
      <NumberField label="Tilt" unit="°" step={1} value={a.props.tilt} onCommit={(v) => run(setSolar({ tilt: v }))} />
      <NumberField label="Inverter" unit="kW" step={0.5} value={a.props.inverterKw} onCommit={(v) => run(setSolar({ inverterKw: v }))} />
      <NumberField label="Battery" unit="kWh" step={5} value={a.props.batteryKwh} onCommit={(v) => run(setSolar({ batteryKwh: Math.max(0, v) }))} />
      <p className="hint">Facing north, {a.props.setback.toFixed(2)} m from the parapet. Open Electrical → Solar for the layout and the monthly estimate.</p>
    </>
  );
}

/* ---------- spec 08 ---------- */

function AssemblySelect({ p, el }: { p: Project; el: Wall | Slab }) {
  const run = useApp((st) => st.run);
  const flash = useApp((st) => st.flash);
  const a = assemblyOf(p, el);
  const opts = optionsFor(useOf(el));
  return (
    <label className="field">
      <span>Assembly</span>
      <select value={a.id} data-testid="assembly" onChange={(e) => { if (run(setAssembly(el.id, e.target.value))) flash(el.type === 'Wall' ? 'Assembly changed: thickness, weight, U-value, loads and cost follow.' : 'Assembly changed: weight, U-value, loads and cost follow.'); }}>
        {opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </label>
  );
}

function Estimates({ el }: { el: Element }) {
  const p = useProject();
  const list = el.type === 'Wall' ? wallEstimates(p, el) : el.type === 'Slab' ? slabEstimates(p, el) : el.type === 'Beam' ? beamEstimates(p, el)
    : el.type === 'Column' ? columnEstimates(p, el) : el.type === 'Footing' ? footingEstimates(p, el) : el.type === 'Feature' ? featureEstimates(p, el) : [];
  if (!list.length) return null;
  return (
    <div className="kvs" data-testid="estimates">
      <h4>Estimates</h4>
      {list.map((e) => <EstRow key={e.label} e={e} testId={`est-${e.label.replace(/\W+/g, '-').toLowerCase()}`} />)}
      <p className="hint">{DISCLAIMER}</p>
    </div>
  );
}

function FeatureProps({ f }: { f: Feature }) {
  const run = useApp((st) => st.run);
  const select = useApp((st) => st.select);
  const t = featureType(f.props.kind);
  return (
    <>
      <Header title={t.label} sub={`Feature · ${f.id}${f.props.host ? ` · on ${f.props.host}` : ''}`} />
      {Object.entries(f.props.params).map(([k, v]) => {
        const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
        if (typeof v === 'boolean') return (
          <label key={k} className="check"><input type="checkbox" checked={v} onChange={(e) => run(setFeature(f.id, { params: { [k]: e.target.checked } }))} data-testid={`feat-${k}`} /> {label}</label>
        );
        if (typeof v === 'string') return (
          <ProfileSelect key={k} label={label} value={v} options={t.choices?.[k] ?? [v]} onChange={(nv) => run(setFeature(f.id, { params: { [k]: nv } }))} />
        );
        return <NumberField key={k} label={label} value={v} step={k === 'angle' || k === 'open' || k === 'tank' ? 5 : 0.05} unit={t.units?.[k] ?? ''} onCommit={(nv) => run(setFeature(f.id, { params: { [k]: nv } }))} testId={`feat-${k}`} />;
      })}
      {f.props.width !== undefined && <NumberField label="Width" value={f.props.width} onCommit={(v) => run(setFeature(f.id, { width: Math.max(0.3, v) }))} />}
      {f.props.offset !== undefined && <NumberField label="From wall start" value={f.props.offset} onCommit={(v) => run(setFeature(f.id, { offset: Math.max(0, v) }))} />}
      <p className="hint">{t.effect}</p>
      <div className="btnrow"><button className="danger" onClick={() => { if (run(deleteFeature(f.id))) select(null); }}>Delete</button></div>
    </>
  );
}

/* ---------- spec 04b ---------- */

/** One line: what holds this item or run, why it goes this way, and the rule. */
function WhyHere({ p, id }: { p: Project; id: string }) {
  const text = useMemo(() => whyHere(p, id), [p, id]);
  if (!text) return null;
  const bad = /PROBLEM|Not inside|crosses|outside|horizontal run|above the crawlspace/.test(text);
  return <p className={'why' + (bad ? ' bad' : '')} data-testid="why-here"><b>Why here? </b>{text}</p>;
}

function ConduitProps({ c, p }: { c: Conduit; p: Project }) {
  const [a, b] = [c.props.start, c.props.end];
  const circuit = p.elements.find((e) => e.id === c.props.circuit);
  return (
    <>
      <Header title="Conduit" sub={`${c.id} · ${circuit?.type === 'Circuit' ? circuit.props.name : c.props.circuit}`} />
      <div className="kvs">
        <Row k="Size" v={`${c.props.dn} mm`} />
        <Row k="Length" v={`${m(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]))} m`} />
        <Row k="From" v={`(${m(a[0])}, ${m(a[1])}) at ${lvl(a[2])}`} />
        <Row k="To" v={`(${m(b[0])}, ${m(b[1])}) at ${lvl(b[2])}`} />
      </div>
    </>
  );
}

const SVC_TITLE: Record<string, string> = { shaft: 'Shaft', plenum: 'Lowered ceiling (plenum)', 'roof-zone': 'Roof zone' };

function ServiceSpaceProps({ sp }: { sp: ServiceSpace }) {
  const run = useApp((st) => st.run);
  const r = sp.props.rect;
  const setRect = (patch: Partial<typeof r>) => run(setServiceSpace(sp.id, { rect: { ...r, ...patch } }));
  return (
    <>
      <Header title={SVC_TITLE[sp.props.kind] ?? sp.props.kind} sub={`${sp.props.name} · ${sp.id}`} />
      {sp.props.kind === 'plenum' && (
        <NumberField label="Depth below the slab" value={sp.props.depth ?? 0.25} step={0.01} min={0.1} onCommit={(v) => run(setServiceSpace(sp.id, { depth: v }))} testId="plenum-depth" />
      )}
      {sp.props.kind === 'shaft' && (
        <>
          <NumberField label="From x" value={r.x0} onCommit={(v) => setRect({ x0: v, x1: v + (r.x1 - r.x0) })} testId="shaft-x" />
          <NumberField label="From y" value={r.y0} onCommit={(v) => setRect({ y0: v, y1: v + (r.y1 - r.y0) })} testId="shaft-y" />
          <NumberField label="Width (x)" value={r.x1 - r.x0} onCommit={(v) => setRect({ x1: r.x0 + v })} />
          <NumberField label="Length (y)" value={r.y1 - r.y0} onCommit={(v) => setRect({ y1: r.y0 + v })} />
        </>
      )}
      <div className="kvs">
        <Row k="Plan" v={`x ${m(r.x0)}–${m(r.x1)}, y ${m(r.y0)}–${m(r.y1)}`} />
        {sp.props.z0 !== undefined && <Row k={sp.props.kind === 'roof-zone' ? 'Stands at' : 'From'} v={lvl(sp.props.z0)} />}
        {sp.props.z1 !== undefined && <Row k="To" v={lvl(sp.props.z1)} />}
        {sp.props.accessFace && <Row k="Access panel" v={`${sp.props.accessFace} face`} />}
        {sp.props.access && <Row k="Access" v={sp.props.access} />}
      </div>
      <p className="hint">{sp.props.kind === 'plenum' ? 'A deeper lowered ceiling holds more pipes but lowers the room; the height check shows the result.' : sp.props.kind === 'shaft' ? 'Pipes and conduits re-route when the shaft moves or changes size.' : 'Equipment stands here with room around it for maintenance.'}</p>
    </>
  );
}

function GenericProps({ el }: { el: Element }) {
  return (
    <>
      <Header title={el.type} sub={el.id} />
      <pre className="json">{JSON.stringify(el.props, null, 1)}</pre>
    </>
  );
}

/* ---------- checks ---------- */

const ICON = { pass: '✓', warn: '!', fail: '✕', confirm: '?' } as const;

export function ChecksBar() {
  const p = useProject();
  const level = useApp((s) => s.level);
  const open = useApp((s) => s.checksOpen);
  const scope = useApp((s) => s.checksScope);
  const { setChecksOpen, setChecksScope, select, setLevel } = useApp.getState();
  const all = useMemo(() => runChecks(p), [p]);
  const shown = scope === 'all' ? all : all.filter((c) => !c.level || c.level === level);
  const sum = summarize(shown);
  const order = { fail: 0, confirm: 1, warn: 2, pass: 3 };
  const sorted = [...shown].sort((a, b) => order[a.status] - order[b.status]);
  const go = (c: CheckResult) => {
    if (c.level && c.level !== level && ['LL', 'SL', 'UF'].includes(c.level)) setLevel(c.level as PlanLevel);
    if (c.elementIds[0]) select(c.elementIds[0]);
    // MEP rows know where the problem is: the 3D camera zooms to it
    if (c.at) useApp.getState().lookFrom([c.at[0] + 2.5, c.at[1] - 3, c.at[2] + 2.2], c.at);
  };
  return (
    <section className={'checks' + (open ? ' open' : '')} aria-label="Checks">
      <div className="checkhead">
        <button className="ghost strong" onClick={() => setChecksOpen(!open)} aria-expanded={open} data-testid="checks-toggle">
          {open ? '▾' : '▸'} Checks
        </button>
        <span className="pill ok">{sum.pass} pass</span>
        {sum.warn > 0 && <span className="pill warn">{sum.warn} warning{sum.warn > 1 ? 's' : ''}</span>}
        {sum.confirm > 0 && <span className="pill confirm" data-testid="checks-confirm">{sum.confirm} to confirm</span>}
        <span className={'pill ' + (sum.fail ? 'bad' : 'muted')} data-testid="checks-fail">{sum.fail} fail</span>
        <span className="spacer" />
        <div className="seg small" role="group" aria-label="Which checks">
          <button aria-pressed={scope === 'level'} onClick={() => setChecksScope('level')}>This floor + site</button>
          <button aria-pressed={scope === 'all'} onClick={() => setChecksScope('all')}>Whole house</button>
        </div>
      </div>
      {open && (
        <div className="checklist">
          <table>
            <thead><tr><th /><th>Check</th><th>Result</th><th>Rule</th><th>Source</th></tr></thead>
            <tbody>
              {sorted.map((c) => (
                <tr key={c.id} className={c.status} onClick={() => go(c)}>
                  <td className={'st ' + c.status} aria-label={c.status === 'confirm' ? 'to confirm' : c.status}>{ICON[c.status]}</td>
                  <td>{c.title}{c.level && scope === 'all' ? <em> · {c.level}</em> : null}</td>
                  <td className="mono">{c.value}</td>
                  <td>{c.rule}</td>
                  <td className="src">{c.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ---------- about ---------- */

export function AboutDialog() {
  const open = useApp((s) => s.aboutOpen);
  const p = useProject();
  const setAbout = useApp((s) => s.setAbout);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbout(false); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, setAbout]);
  if (!open) return null;
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={() => setAbout(false)}>
      <div className="box" onClick={(e) => e.stopPropagation()}>
        <h2 id="about-title">About Casa 123 BIM</h2>
        <p>This is a <b>design and decision tool</b> for the family's house at {p.site.address}. It helps us try layouts, check them against the main code rules and share one precise model with the professionals.</p>
        <p><b>It does not replace the official project.</b> The permit drawings and the executive designs (architecture, structure, plumbing, electrical) must be made and signed by licensed professionals, with their ART/RRT. They receive this model through the IFC export.</p>
        <p>The checks cover the rules we know (São Paulo sanitary code, Civil Code art. 1.301, stair comfort, setbacks). They are a guide, not an approval.</p>
        <p className="disclaimer" data-testid="about-disclaimer">{DISCLAIMER}</p>
        <h4>Still to confirm</h4>
        <ul>{p.site.toConfirm.map((t) => <li key={t}>{t}</li>)}</ul>
        <p className="hint">Units are metres. Plan axes: x from the south wall to the north, y from the street to the rear.</p>
        <button onClick={() => setAbout(false)} autoFocus>Close</button>
      </div>
    </div>
  );
}
