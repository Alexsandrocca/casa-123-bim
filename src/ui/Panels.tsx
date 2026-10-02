// Properties panel, checks bar and About panel.
import { useEffect, useMemo, useState } from 'react';
import { minArea, needsDaylight, runChecks, summarize, type CheckResult } from '../model/checks';
import {
  deleteDevice, deleteOpening, doorMax, flipOpening, moveDevice, moveFixture, setCircuitSection, setDevice, setSolar, renameSpace, resizeOpening, setElementProps, setOpeningSize, setPipe, setServiceSpace,
} from '../model/commands';
import { whyHere } from '../model/mep/analysis';
import { networkLabel } from '../model/plumbing/checks';
import { kindOf } from '../model/plumbing/library';
import { BEAM_PROFILES, COLUMN_PROFILES, PIER_PROFILES, profile } from '../model/profiles';
import { byLevel, getEl, glassArea, openingSegIn, spaceArea, wallLength, wallSeg } from '../model/geometry';
import { cameraFov, cameraRange, deviceType } from '../model/electrical/library';
import type { Beam, Carport, Circuit, Column, Conduit, Device, Element, Fixture, PipeSegment, ServiceSpace, SolarArray, Footing, Opening, PlanLevel, Project, Slab, Space, Stair, Wall } from '../model/schema';
import { useApp, useProject } from '../store';
import { bearingDir, compassOf } from '../model/orientation';
import { cityCode, sanitary } from '../model/region';
import { isPlanLevel } from '../model/schema';
import { EstRow } from './Estimate';
import { assemblyOf, optionsFor, useOf } from '../model/eng/assemblies';
import { deleteFeature, setAssembly, setFeature } from '../model/eng/commands';
import { beamEstimates, columnEstimates, featureEstimates, footingEstimates, slabEstimates, wallEstimates } from '../model/eng/estimates';
import { featureType } from '../model/eng/features';
import { DISCLAIMER, frameOf } from '../model/eng';
import type { Feature } from '../model/schema';
import { ZONE_COLOR } from './PlanView';
import { useT } from '../i18n/useT';
import { ConfirmList } from './LotText';
import { toConfirm } from '../model/lot';

type T = ReturnType<typeof useT>;
/** Lengths and levels in the language's number format. */
const fm = (t: T) => ({
  m: (v: number) => t.n(v, 2),
  lvl: (v: number) => `${v < 0 ? '−' : '+'}${t.n(Math.abs(v), 2)}`,
});

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
  const t = useT();
  return (
    <aside className="props" aria-label={t('Properties')}>
      {!el && <LevelSummary p={p} level={level} />}
      {el?.type === 'Space' && <SpaceProps p={p} s={el} editable={false} />}
      {el?.type === 'Wall' && <WallProps p={p} w={el} />}
      {el?.type === 'Opening' && <OpeningProps p={p} op={el} editable={false} />}
      {el && ['Space', 'Wall', 'Opening'].includes(el.type) && <EditInDesign id={el.id} />}
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
          <h4>{t('Notes for the architect and engineers')}</h4>
          {el.notes.map((n, i) => <p key={i}>{n}</p>)}
        </div>
      ) : null}
      {el && !['Space', 'Wall', 'Opening', 'Column', 'Beam', 'Slab', 'Footing', 'Stair', 'Carport', 'Fixture', 'PipeSegment', 'Device', 'Circuit', 'SolarArray', 'ServiceSpace', 'Conduit', 'Feature'].includes(el.type) && <GenericProps el={el} />}
    </aside>
  );
}

function Header({ title, sub }: { title: string; sub: string }) {
  const select = useApp((s) => s.select);
  const t = useT();
  return (
    <div className="phead">
      <div><h3>{title}</h3><div className="eyebrow">{sub}</div></div>
      <button className="ghost" onClick={() => select(null)} aria-label={t('Close properties')}>✕</button>
    </div>
  );
}

function LevelSummary({ p, level }: { p: Project; level: PlanLevel }) {
  const lv = p.levels.find((l) => l.id === level)!;
  const select = useApp((s) => s.select);
  const rooms = byLevel(p, level, 'Space').filter((s) => s.props.zone !== 'stair');
  // Gross floor area: all the rooms and the stair on this floor (the outline may include open patios).
  const gross = byLevel(p, level, 'Space').reduce((sum, s) => sum + spaceArea(s), 0);
  const t = useT();
  return (
    <>
      <div className="phead"><div><h3>{lv.name}</h3><div className="eyebrow" data-testid="gross">{p.meta.version} · {t('{a} m² gross', { a: t.n(gross, 1) })}</div></div></div>
      <p className="hint">{p.meta.note}</p>
      <table className="rooms">
        <thead><tr><th>{t('Room')}</th><th>m²</th><th>{t('Min')}</th><th>{t('Window')}</th></tr></thead>
        <tbody>
          {rooms.map((s) => {
            const a = spaceArea(s), min = minArea(s), g = glassArea(p, s), light = needsDaylight(s);
            const okA = !min || a >= min - 0.005, okL = !light || g >= a / 8 - 0.005;
            return (
              <tr key={s.id} onClick={() => select(s.id)}>
                <td><i style={{ background: ZONE_COLOR[s.props.zone] }} />{s.props.name}</td>
                <td>{t.n(a, 1)}</td>
                <td className={okA ? 'ok' : 'bad'}>{min ? `≥ ${t.n(min, Number.isInteger(min) ? 0 : 1)}` : '–'}</td>
                <td className={okL ? 'ok' : 'bad'}>{light ? (g > 0 ? `1/${Math.max(1, Math.round(a / g))}` : t('none')) : '–'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="hint">{t('Click anything to see its properties. Rooms, walls, doors and windows are edited in the DESIGN tab; structure, systems, assemblies and features here. Your changes are saved in the project folder.')}</p>
    </>
  );
}

/** P1 (Q24): architecture is edited only in the DESIGN tab; the BIM tab shows it read-only with a way there. */
function EditInDesign({ id }: { id: string }) {
  const t = useT();
  const editInDesign = useApp((st) => st.editInDesign);
  return (
    <div className="editindesign">
      <p className="hint">{t('Walls, doors, windows and rooms are edited in the DESIGN tab, so the design stays the one source of the building.')}</p>
      <button className="strong" onClick={() => editInDesign(id)} data-testid="edit-in-design">{t('Edit in DESIGN')}</button>
    </div>
  );
}

export function SpaceProps({ p, s, editable = true }: { p: Project; s: Space; editable?: boolean }) {
  const run = useApp((st) => st.run);
  const a = spaceArea(s), min = minArea(s), g = glassArea(p, s);
  const lv = p.levels.find((l) => l.id === s.level)!;
  const t = useT();
  const { m } = fm(t);
  return (
    <>
      <Header title={s.props.name} sub={`${t('Room')} · ${t(ZONE_NAME[s.props.zone] ?? s.props.zone)} · ${s.id}`} />
      {s.props.zone === 'stair'
        ? <p className="hint">{t('The stair core is fixed. Its walls cannot be dragged.')}</p>
        : editable ? <TextField label={t('Name')} value={s.props.name} testId="room-name" onCommit={(v) => run(renameSpace(s.id, v))} /> : null}
      <div className="kvs">
        <Row k={t('Area')} v={`${t.n(a, 2)} m²`} />
        {min > 0 && <Row k={t('Code minimum')} v={`${t.n(min, Number.isInteger(min) ? 0 : 1)} m²`} />}
        {needsDaylight(s) && <Row k={t('Window glass')} v={g > 0 ? `${t.n(g, 2)} m² (1/${Math.max(1, Math.round(a / g))})` : t('none')} />}
        <Row k={t('Floor level')} v={`${(s.props.floorElevation ?? lv.elevation) >= 0 ? '+' : '−'}${t.n(Math.abs(s.props.floorElevation ?? lv.elevation), 2)} m`} />
        <Row k={t('Parts')} v={t(s.props.cells.length > 1 ? '{n} rectangles' : '{n} rectangle', { n: s.props.cells.length })} />
        {s.props.cells.map((c, i) => <Row key={i} k={`  ${t('part {n}', { n: i + 1 })}`} v={`${m(c.x1 - c.x0)} × ${m(c.y1 - c.y0)} m`} />)}
      </div>
    </>
  );
}

function WallProps({ p, w }: { p: Project; w: Wall }) {
  const s = wallSeg(w);
  const hosted = byLevel(p, w.level, 'Opening').filter((o) => o.props.host === w.id);
  const fixed = w.props.wallType === 'exterior' || w.props.wallType === 'retaining';
  const t = useT();
  const { m } = fm(t);
  return (
    <>
      <Header title={t(WALL_NAME[w.props.wallType]!)} sub={`${t('Wall')} · ${w.id}`} />
      <AssemblySelect p={p} el={w} />
      <div className="kvs">
        <Row k={t('Thickness')} v={`${m(w.props.thickness)} m`} />
        <Row k={t('Length')} v={`${m(wallLength(w))} m`} />
        <Row k={t('Height')} v={`${m(w.props.height)} m`} />
        <Row k={t('Runs along')} v={s.o === 'v' ? t('x = {c}, y {a} → {b}', { c: m(s.c), a: m(s.a), b: m(s.b) }) : t('y = {c}, x {a} → {b}', { c: m(s.c), a: m(s.a), b: m(s.b) })} />
        <Row k={t('Doors and windows')} v={String(hosted.length)} />
      </div>
      <p className="hint">{fixed ? t('Outer walls follow the building outline and stay fixed.') : t('Its type comes from the rooms it separates. Its thickness follows its assembly.')}</p>
    </>
  );
}

export function OpeningProps({ p, op, editable = true }: { p: Project; op: Opening; editable?: boolean }) {
  const run = useApp((st) => st.run);
  const select = useApp((st) => st.select);
  const host = getEl(p, op.props.host) as Wall | undefined;
  const s = openingSegIn(p, op);
  const isDoor = op.props.role === 'door';
  const swingable = isDoor && op.props.kind === 'door';
  const t = useT();
  const { m } = fm(t);
  return (
    <>
      <Header title={t(openingLabel(op))} sub={`${isDoor ? t('Door') : t('Window')} · ${op.id}`} />
      {editable ? (
        <>
          <div className="btnrow">
            <button onClick={() => run(resizeOpening(op.id, op.props.width - 0.1))}>− 10 cm</button>
            <button onClick={() => run(resizeOpening(op.id, op.props.width + 0.1))}>+ 10 cm</button>
            {swingable && <button onClick={() => run(flipOpening(op.id))}>{t('Flip swing')}</button>}
            <button className="danger" onClick={() => { if (run(deleteOpening(op.id))) select(null); }}>{t('Delete')}</button>
          </div>
          <NumberField label={t('Width')} value={op.props.width} onCommit={(v) => run(resizeOpening(op.id, v))} testId="op-width" />
          <NumberField label={t('Height')} value={op.props.height} onCommit={(v) => run(setOpeningSize(op.id, { height: v }))} />
          {!isDoor && <NumberField label={t('Sill')} value={op.props.sill} onCommit={(v) => run(setOpeningSize(op.id, { sill: v }))} />}
        </>
      ) : null}
      <div className="kvs">
        {!editable && <Row k={t('Width')} v={`${m(op.props.width)} m`} />}
        {!editable && <Row k={t('Height')} v={`${m(op.props.height)} m`} />}
        {!editable && !isDoor && <Row k={t('Sill')} v={`${m(op.props.sill)} m`} />}
        {s && <Row k={t('Position')} v={s.o === 'v' ? t('x = {c}, y {a} → {b}', { c: m(s.c), a: m(s.a), b: m(s.b) }) : t('y = {c}, x {a} → {b}', { c: m(s.c), a: m(s.a), b: m(s.b) })} />}
        <Row k={t('Host wall')} v={host ? `${t(WALL_NAME[host.props.wallType]!)} ${host.id}` : '—'} />
        {!isDoor && <Row k={t('Glass')} v={`${t.n(op.props.width * op.props.height, 2)} m²`} />}
        {isDoor && <Row k={t('Width range')} v={`${m(0.6)} – ${m(doorMax(op))} m`} />}
      </div>
      {editable && <p className="hint">{t('Drag it in the plan to slide it along its wall. Delete or Backspace removes it.')}</p>}
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

function ColumnProps({ c }: { c: Column }) {
  const run = useApp((st) => st.run);
  const pier = c.props.kind === 'pier';
  const pr = profile(c.props.profile);
  const t = useT();
  const { m, lvl } = fm(t);
  return (
    <>
      <Header title={pier ? t('Pier') : t('Steel column')} sub={`${pier ? t('Pier') : t('Column')} · ${c.id} · ${t('generated from the grid')}`} />
      <ProfileSelect label={t('Section')} value={c.props.profile} options={(pier ? PIER_PROFILES : COLUMN_PROFILES).map((p) => p.name)}
        onChange={(v) => run(setElementProps(c.id, { profile: v }, 'Change column section'))} />
      <div className="kvs">
        <Row k={t('Size')} v={`${m(pr.b)} × ${m(pr.d)} m`} />
        <Row k={t('At')} v={t('x {x}, y {y}', { x: m(c.props.at[0]), y: m(c.props.at[1]) })} />
        <Row k={t('From')} v={`${lvl(c.props.baseElevation)} (${t('top of footing')})`} />
        <Row k={t('To')} v={`${lvl(c.props.topElevation)} (${t('under the beams')})`} />
        <Row k={t('Height')} v={`${m(c.props.topElevation - c.props.baseElevation)} m`} />
      </div>
      <Proposed id={c.id} kind="column" current={c.props.profile} />
      <p className="hint">{t('Sizes are for design only. The structural engineer sizes the real frame (NBR 8800).')}</p>
    </>
  );
}

/** The lightest section that passes, with a button to use it (spec 08). */
function Proposed({ id, kind, current }: { id: string; kind: 'beam' | 'column'; current: string }) {
  const p = useProject();
  const run = useApp((st) => st.run);
  const f = frameOf(p);
  const r = kind === 'beam' ? f.beams.find((b) => b.beam.id === id) : f.columns.find((c) => c.col.id === id);
  const t = useT();
  if (!r) return null;
  const cls = r.check.status === 'red' ? 'bad' : r.check.status === 'amber' ? 'warn' : 'ok';
  return (
    <div className="proposed" data-testid="proposed">
      <p><b className={cls}>{t('Utilisation {u}', { u: t.n(r.check.util, 2) })}</b> · {r.check.governing}</p>
      {r.proposed && r.proposed.name !== current && (
        <button className="small" onClick={() => run(setElementProps(id, { profile: r.proposed!.name }, `Use ${r.proposed!.name}`))}>{t('Use {name} (lightest that passes)', { name: r.proposed.name })}</button>
      )}
    </div>
  );
}

function BeamProps({ b }: { b: Beam }) {
  const run = useApp((st) => st.run);
  const pr = profile(b.props.profile);
  const len = Math.hypot(b.props.end[0] - b.props.start[0], b.props.end[1] - b.props.start[1]);
  const t = useT();
  const { m, lvl } = fm(t);
  return (
    <>
      <Header title={t('Steel beam')} sub={`${t('Beam')} · ${b.id} · ${t('generated')}`} />
      <ProfileSelect label={t('Section')} value={b.props.profile} options={BEAM_PROFILES.map((p) => p.name)}
        onChange={(v) => run(setElementProps(b.id, { profile: v }, 'Change beam section'))} />
      <div className="kvs">
        <Row k={t('Length')} v={`${m(len)} m`} />
        <Row k={t('Depth')} v={`${m(pr.d)} m`} />
        <Row k={t('Top of steel')} v={lvl(b.props.elevation)} />
        <Row k={t('From → to')} v={`${t('({x}, {y})', { x: m(b.props.start[0]), y: m(b.props.start[1]) })} → ${t('({x}, {y})', { x: m(b.props.end[0]), y: m(b.props.end[1]) })}`} />
      </div>
      <Proposed id={b.id} kind="beam" current={b.props.profile} />
    </>
  );
}

function SlabProps({ s }: { s: Slab }) {
  const run = useApp((st) => st.run);
  const p = useProject();
  const t = useT();
  const { m, lvl } = fm(t);
  return (
    <>
      <Header title={s.props.name} sub={`${t('Slab')} · ${s.id} · ${s.props.onGrade ? t('on the ground') : t('steel deck')}`} />
      <AssemblySelect p={p} el={s} />
      {s.props.eaves !== undefined && <NumberField label={t('Eaves')} value={s.props.eaves} onCommit={(v) => run(setElementProps(s.id, { eaves: Math.max(0, v) }, 'Change eaves'))} />}
      {s.props.parapet !== undefined && <NumberField label={t('Parapet')} value={s.props.parapet} onCommit={(v) => run(setElementProps(s.id, { parapet: Math.max(0, v) }, 'Change parapet'))} />}
      <div className="kvs">
        <Row k={t('Top')} v={lvl(s.props.topElevation)} />
        <Row k={t('Thickness')} v={`${m(s.props.thickness)} m`} />
        {s.props.parapet !== undefined && <Row k={t('Parapet top')} v={lvl(s.props.topElevation + s.props.parapet)} />}
      </div>
      {s.props.eaves !== undefined && <p className="hint">{p.site.lot.rules.eaves.value !== null ? t('Eaves up to {v} m are not counted in site coverage ({code}).', { v: m(p.site.lot.rules.eaves.value), code: cityCode(p) }) : t('The eaves limit is TO CONFIRM ({code}).', { code: cityCode(p) })}</p>}
    </>
  );
}

function FootingProps({ f }: { f: Footing }) {
  const r = f.props.rect;
  const t = useT();
  const { m, lvl } = fm(t);
  return (
    <>
      <Header title={f.props.kind === 'pad' ? t('Pad footing') : t('Strip footing')} sub={`${t('Footing')} · ${f.id}${f.props.carries ? ` · ${t('carries {x}', { x: f.props.carries })}` : ''}`} />
      <div className="kvs">
        <Row k={t('Plan size')} v={`${m(r.x1 - r.x0)} × ${m(r.y1 - r.y0)} m`} />
        <Row k={t('Top')} v={lvl(f.props.topElevation)} />
        <Row k={t('Depth')} v={`${m(f.props.depth)} m`} />
      </div>
      <p className="hint">{t('Drawn sizes are placeholders; the estimate below sizes them on the loads. Real footings come from the soil borings (SPT) and NBR 6122.')}</p>
    </>
  );
}

function StairProps({ st }: { st: Stair }) {
  const { riser, tread, width, flights, name } = st.props;
  const n = flights.reduce((a, f) => a + f.risers, 0);
  const t = useT();
  const { m } = fm(t);
  return (
    <>
      <Header title={name} sub={`${t('Stair')} · ${st.id}`} />
      <div className="kvs">
        <Row k={t('Risers')} v={`${n} × ${t.n(riser, 3)} m = ${t.n(n * riser, 2)} m`} />
        <Row k={t('Tread')} v={`${m(tread)} m`} />
        <Row k={t('Width')} v={`${m(width)} m`} />
        <Row k="2h + b" v={`${t.n(2 * riser + tread, 3)} m`} />
        <Row k={t('Flights')} v={String(flights.length)} />
      </div>
    </>
  );
}

function CarportProps({ c }: { c: Carport }) {
  const p = useProject();
  const r = c.props.rect;
  const rear = c.props.roofFront + c.props.slope * (r.y1 - r.y0);
  const t = useT();
  const { m, lvl } = fm(t);
  return (
    <>
      <Header title={c.props.name} sub={`${t('Carport')} · ${c.id} · ${t('independent light steel frame')}`} />
      <div className="kvs">
        <Row k={t('Footprint')} v={`${m(r.x1 - r.x0)} × ${m(r.y1 - r.y0)} m`} />
        <Row k={t('Parking')} v={t('{n} bays of {w} × {l} m', { n: c.props.parking.length, w: m(2.5), l: m(5) })} />
        <Row k={t('Roof top')} v={t('{a} at the street → {b} at the house', { a: lvl(c.props.roofFront), b: lvl(rear) })} />
        <Row k={t('Roof slope')} v={t('{p} % to the street, gutter at the front', { p: t.n(c.props.slope * 100, 0) })} />
        <Row k={t('Solar')} v={t('{n} modules reserved (moved from the old garage roof)', { n: c.props.solarModules })} />
        <Row k={t('EV charger')} v={t('7 kW on a carport column')} />
      </div>
      <p className="hint">{t('A covered carport in the front setback must be confirmed with the city hall (Prefeitura) ({code}).', { code: cityCode(p) })}</p>
    </>
  );
}

function FixtureProps({ f }: { f: Fixture }) {
  const run = useApp((st) => st.run);
  const k = kindOf(f.props.kind);
  const auto = f.tags.includes('auto');
  const t = useT();
  const { lvl } = fm(t);
  return (
    <>
      <Header title={k.label} sub={`${t('Fixture')} · ${f.id} · ${f.level}`} />
      {auto ? <p className="hint">{t('Placed by the router where an outside sewage pipe turns or joins.')}</p> : (
        <>
          <NumberField label={t('x (north)')} value={f.props.at[0]} onCommit={(v) => run(moveFixture(f.id, v, f.props.at[1]))} testId="fx-x" />
          <NumberField label={t('y (rear)')} value={f.props.at[1]} onCommit={(v) => run(moveFixture(f.id, f.props.at[0], v))} testId="fx-y" />
        </>
      )}
      <div className="kvs">
        <Row k={t('Stands at')} v={lvl(f.props.z)} />
        {k.drainDn && <Row k={t('Drain')} v={t('DN {dn} · {u} fixture units', { dn: k.drainDn, u: String(k.uhc) })} />}
        {k.weight && <Row k={t('Water')} v={t(k.hot ? 'weight {w} · cold and hot' : 'weight {w} · cold', { w: k.weight })} />}
        {f.props.area !== undefined && <Row k={t('Roof area')} v={`${t.n(f.props.area, 1)} m²`} />}
      </div>
      {!auto && <p className="hint">{t('Turn on “Plumbing” above the plan and drag the fixture; the pipes re-route and the checks update.')}</p>}
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
  const t = useT();
  const { m, lvl } = fm(t);
  return (
    <>
      <Header title={`${t('Pipe')} · ${t(s.props.system)}`} sub={`${s.id} · ${networkLabel(s.props.network)}`} />
      <ProfileSelect label="DN" value={String(s.props.dn)} options={DNS.map(String)} onChange={(v) => run(setPipe(s.id, { dn: Number(v) }))} />
      <ProfileSelect label={t('Material')} value={s.props.material} options={['PVC', 'PPR', 'CPVC']} onChange={(v) => run(setPipe(s.id, { material: v as 'PVC' | 'PPR' | 'CPVC' }))} />
      <div className="kvs">
        <Row k={t('Length')} v={`${m(len)} m`} />
        <Row k={slope === null ? t('Vertical') : t('Slope')} v={slope === null ? `${lvl(Math.max(a[2], b[2]))} → ${lvl(Math.min(a[2], b[2]))}` : `${t.n(slope, 1)} %`} />
        <Row k={t('From')} v={t('({x}, {y}) at {z}', { x: m(a[0]), y: m(a[1]), z: lvl(a[2]) })} />
        <Row k={t('To')} v={t('({x}, {y}) at {z}', { x: m(b[0]), y: m(b[1]), z: lvl(b[2]) })} />
        <Row k={t('Flow')} v={s.props.pressure ? t('under pressure') : t('by gravity, from → to')} />
        <Row k={t('Load')} v={`${s.props.load} ${t(unit)}`} />
        <Row k={t('Serves')} v={t(s.props.serves.length === 1 ? '{n} fixture' : '{n} fixtures', { n: s.props.serves.length })} />
      </div>
      <p className="hint">{s.props.manual ? t('Edited by hand: the router keeps this DN and material.') : t('Placed by the router. Changing DN or material keeps your choice when the pipes re-route.')}</p>
    </>
  );
}

function DeviceProps({ d, p }: { d: Device; p: Project }) {
  const run = useApp((st) => st.run);
  const select = useApp((st) => st.select);
  const dt = deviceType(d.props.kind);
  const circuits = p.elements.filter((e): e is Circuit => e.type === 'Circuit' && e.props.purpose !== 'feeder');
  const c = circuits.find((x) => x.id === d.props.circuit);
  const cam = dt.group === 'camera';
  const floor = p.levels.find((l) => l.id === (d.level === 'roof' ? 'roof' : d.level))?.elevation ?? 0;
  const t = useT();
  const { m, lvl } = fm(t);
  return (
    <>
      <Header title={dt.label} sub={`${d.props.name} · ${d.id}`} />
      <NumberField label={t('x (north)')} value={d.props.at[0]} onCommit={(v) => run(moveDevice(d.id, v, d.props.at[1]))} testId="dev-x" />
      <NumberField label={t('y (rear)')} value={d.props.at[1]} onCommit={(v) => run(moveDevice(d.id, d.props.at[0], v))} testId="dev-y" />
      {['outlet', 'light', 'dedicated'].includes(dt.group) && (
        <NumberField label={dt.group === 'dedicated' ? t('Power') : t('Power (VA)')} unit={dt.group === 'dedicated' ? 'W' : 'VA'} step={10} value={d.props.power} onCommit={(v) => run(setDevice(d.id, { power: v }))} testId="dev-power" />
      )}
      {cam && (
        <>
          <NumberField label={t('Bearing')} unit={t('° (0 N, 90 E)')} step={5} value={d.props.bearing ?? 0} onCommit={(v) => run(setDevice(d.id, { bearing: ((v % 360) + 360) % 360 }))} testId="cam-bearing" />
          <NumberField label={t('Lens')} unit="mm" step={0.1} value={d.props.lensMm ?? 2.8} onCommit={(v) => run(setDevice(d.id, { lensMm: v }))} testId="cam-lens" />
          <NumberField label={t('Tilt down')} unit="°" step={1} value={d.props.tilt ?? 15} onCommit={(v) => run(setDevice(d.id, { tilt: v }))} />
        </>
      )}
      {circuits.length > 0 && ['outlet', 'light', 'dedicated'].includes(dt.group) && (
        <ProfileSelect label={t('Circuit')} value={d.props.circuit ?? ''} options={circuits.map((x) => x.id)} onChange={(v) => run(setDevice(d.id, { circuit: v }))} />
      )}
      <div className="kvs">
        <Row k={t('Height')} v={t('{h} m above the floor ({z})', { h: m(d.props.z - floor), z: lvl(d.props.z) })} />
        {c && <Row k={t('On circuit')} v={`${c.props.name} · ${c.props.breaker} A · ${c.props.section} mm²`} />}
        {cam && <Row k={t('View')} v={t('{a}° wide, about {r} m', { a: t.n(cameraFov(d.props.lensMm ?? 2.8), 0), r: t.n(cameraRange(d.props.lensMm ?? 2.8), 0) })} />}
      </div>
      <div className="btnrow">
        {c && <button onClick={() => select(c.id)}>{t('Show circuit')}</button>}
        {!['panel', 'sub-panel'].includes(d.props.kind) && <button className="danger" onClick={() => { if (run(deleteDevice(d.id))) select(null); }}>{t('Delete')}</button>}
      </div>
      <p className="hint">{d.props.manualCircuit ? t('Circuit chosen by hand.') : t('Turn on “Electrical” above the plan to drag it; the circuit, cable and schedule update.')}</p>
    </>
  );
}

function CircuitProps({ c, p }: { c: Circuit; p: Project }) {
  const run = useApp((st) => st.run);
  const devs = p.elements.filter((e): e is Device => e.type === 'Device' && e.props.circuit === c.id);
  const t = useT();
  const { m } = fm(t);
  return (
    <>
      <Header title={c.props.name} sub={`${t('Circuit')} · ${c.id}`} />
      <ProfileSelect label={t('Cable mm²')} value={String(c.props.section)} options={['1.5', '2.5', '4', '6', '10', '16', '25']} onChange={(v) => run(setCircuitSection(c.id, Number(v)))} />
      <div className="kvs">
        <Row k={t('Load')} v={`${c.props.load} ${c.props.purpose === 'dedicated' ? 'W' : 'VA'} · ${c.props.current} A`} />
        <Row k={t('Supply')} v={t('{v} V · phase {ph}', { v: c.props.voltage, ph: c.props.phases.join('') })} />
        <Row k={t('Breaker')} v={`${c.props.breaker} A${c.props.rcd ? ` · ${t('RCD 30 mA')}` : ''}`} />
        <Row k={t('Length')} v={t('{l} m to the farthest point', { l: m(c.props.length) })} />
        <Row k={t('Voltage drop')} v={t('{d} % (max 4 %)', { d: t.n(c.props.drop, 2) })} />
        <Row k={t('Points')} v={String(devs.length)} />
      </div>
      <p className="hint">{c.props.manualSection ? t('Section chosen by hand; the checks tell if it is enough.') : t('Sized from the load, the length and the voltage drop (NBR 5410).')}</p>
    </>
  );
}

function SolarProps({ a }: { a: SolarArray }) {
  const run = useApp((st) => st.run);
  const p = useProject();
  const t = useT();
  return (
    <>
      <Header title={a.props.name} sub={`${t('Solar array')} · ${a.id}`} />
      <NumberField label={t('Modules')} unit="" step={1} value={a.props.modules} onCommit={(v) => run(setSolar({ modules: Math.max(0, Math.round(v)) }))} />
      <NumberField label={t('Tilt')} unit="°" step={1} value={a.props.tilt} onCommit={(v) => run(setSolar({ tilt: v }))} />
      <NumberField label={t('Inverter')} unit="kW" step={0.5} value={a.props.inverterKw} onCommit={(v) => run(setSolar({ inverterKw: v }))} />
      <NumberField label={t('Battery')} unit="kWh" step={5} value={a.props.batteryKwh} onCommit={(v) => run(setSolar({ batteryKwh: Math.max(0, v) }))} />
      <p className="hint">{t('Facing {dir}, {d} m from the parapet. Open Electrical → Solar for the layout and the monthly estimate.', { dir: t(({ N: 'north', E: 'east', S: 'south', W: 'west' } as const)[compassOf(p, ...bearingDir(p, a.props.bearing))]), d: t.n(a.props.setback, 2) })}</p>
    </>
  );
}

/* ---------- spec 08 ---------- */

function AssemblySelect({ p, el }: { p: Project; el: Wall | Slab }) {
  const run = useApp((st) => st.run);
  const flash = useApp((st) => st.flash);
  const a = assemblyOf(p, el);
  const opts = optionsFor(useOf(el));
  const t = useT();
  return (
    <label className="field">
      <span>{t('Assembly')}</span>
      <select value={a.id} data-testid="assembly" onChange={(e) => { if (run(setAssembly(el.id, e.target.value))) flash(el.type === 'Wall' ? t('Assembly changed: thickness, weight, U-value, loads and cost follow.') : t('Assembly changed: weight, U-value, loads and cost follow.')); }}>
        {opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </label>
  );
}

function Estimates({ el }: { el: Element }) {
  const p = useProject();
  const list = el.type === 'Wall' ? wallEstimates(p, el) : el.type === 'Slab' ? slabEstimates(p, el) : el.type === 'Beam' ? beamEstimates(p, el)
    : el.type === 'Column' ? columnEstimates(p, el) : el.type === 'Footing' ? footingEstimates(p, el) : el.type === 'Feature' ? featureEstimates(p, el) : [];
  const t = useT();
  if (!list.length) return null;
  return (
    <div className="kvs" data-testid="estimates">
      <h4>{t('Estimates')}</h4>
      {list.map((e) => <EstRow key={e.label} e={e} testId={`est-${e.label.replace(/\W+/g, '-').toLowerCase()}`} />)}
      <p className="hint">{DISCLAIMER}</p>
    </div>
  );
}

function FeatureProps({ f }: { f: Feature }) {
  const run = useApp((st) => st.run);
  const select = useApp((st) => st.select);
  const ft = featureType(f.props.kind);
  const t = useT();
  return (
    <>
      <Header title={ft.label} sub={`${t('Feature')} · ${f.id}${f.props.host ? ` · ${t('on {host}', { host: f.props.host })}` : ''}`} />
      {Object.entries(f.props.params).map(([k, v]) => {
        const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
        if (typeof v === 'boolean') return (
          <label key={k} className="check"><input type="checkbox" checked={v} onChange={(e) => run(setFeature(f.id, { params: { [k]: e.target.checked } }))} data-testid={`feat-${k}`} /> {label}</label>
        );
        if (typeof v === 'string') return (
          <ProfileSelect key={k} label={label} value={v} options={ft.choices?.[k] ?? [v]} onChange={(nv) => run(setFeature(f.id, { params: { [k]: nv } }))} />
        );
        return <NumberField key={k} label={label} value={v} step={k === 'angle' || k === 'open' || k === 'tank' ? 5 : 0.05} unit={ft.units?.[k] ?? ''} onCommit={(nv) => run(setFeature(f.id, { params: { [k]: nv } }))} testId={`feat-${k}`} />;
      })}
      {f.props.width !== undefined && <NumberField label={t('Width')} value={f.props.width} onCommit={(v) => run(setFeature(f.id, { width: Math.max(0.3, v) }))} />}
      {f.props.offset !== undefined && <NumberField label={t('From wall start')} value={f.props.offset} onCommit={(v) => run(setFeature(f.id, { offset: Math.max(0, v) }))} />}
      <p className="hint">{ft.effect}</p>
      <div className="btnrow"><button className="danger" onClick={() => { if (run(deleteFeature(f.id))) select(null); }}>{t('Delete')}</button></div>
    </>
  );
}

/* ---------- spec 04b ---------- */

/** One line: what holds this item or run, why it goes this way, and the rule. */
function WhyHere({ p, id }: { p: Project; id: string }) {
  const text = useMemo(() => whyHere(p, id), [p, id]);
  const t = useT();
  if (!text) return null;
  const bad = /PROBLEM|Not inside|crosses|outside|horizontal run|above the crawlspace/.test(text);
  return <p className={'why' + (bad ? ' bad' : '')} data-testid="why-here"><b>{t('Why here?')} </b>{text}</p>;
}

function ConduitProps({ c, p }: { c: Conduit; p: Project }) {
  const [a, b] = [c.props.start, c.props.end];
  const circuit = p.elements.find((e) => e.id === c.props.circuit);
  const t = useT();
  const { m, lvl } = fm(t);
  return (
    <>
      <Header title={t('Conduit')} sub={`${c.id} · ${circuit?.type === 'Circuit' ? circuit.props.name : c.props.circuit}`} />
      <div className="kvs">
        <Row k={t('Size')} v={`${c.props.dn} mm`} />
        <Row k={t('Length')} v={`${m(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]))} m`} />
        <Row k={t('From')} v={t('({x}, {y}) at {z}', { x: m(a[0]), y: m(a[1]), z: lvl(a[2]) })} />
        <Row k={t('To')} v={t('({x}, {y}) at {z}', { x: m(b[0]), y: m(b[1]), z: lvl(b[2]) })} />
      </div>
    </>
  );
}

const SVC_TITLE: Record<string, string> = { shaft: 'Shaft', plenum: 'Lowered ceiling (plenum)', 'roof-zone': 'Roof zone' };

function ServiceSpaceProps({ sp }: { sp: ServiceSpace }) {
  const run = useApp((st) => st.run);
  const r = sp.props.rect;
  const setRect = (patch: Partial<typeof r>) => run(setServiceSpace(sp.id, { rect: { ...r, ...patch } }));
  const t = useT();
  const { m, lvl } = fm(t);
  return (
    <>
      <Header title={SVC_TITLE[sp.props.kind] ? t(SVC_TITLE[sp.props.kind]!) : sp.props.kind} sub={`${sp.props.name} · ${sp.id}`} />
      {sp.props.kind === 'plenum' && (
        <NumberField label={t('Depth below the slab')} value={sp.props.depth ?? 0.25} step={0.01} min={0.1} onCommit={(v) => run(setServiceSpace(sp.id, { depth: v }))} testId="plenum-depth" />
      )}
      {sp.props.kind === 'shaft' && (
        <>
          <NumberField label={t('From x')} value={r.x0} onCommit={(v) => setRect({ x0: v, x1: v + (r.x1 - r.x0) })} testId="shaft-x" />
          <NumberField label={t('From y')} value={r.y0} onCommit={(v) => setRect({ y0: v, y1: v + (r.y1 - r.y0) })} testId="shaft-y" />
          <NumberField label={t('Width (x)')} value={r.x1 - r.x0} onCommit={(v) => setRect({ x1: r.x0 + v })} />
          <NumberField label={t('Length (y)')} value={r.y1 - r.y0} onCommit={(v) => setRect({ y1: r.y0 + v })} />
        </>
      )}
      <div className="kvs">
        <Row k={t('Plan')} v={t('x {a}–{b}, y {c}–{d}', { a: m(r.x0), b: m(r.x1), c: m(r.y0), d: m(r.y1) })} />
        {sp.props.z0 !== undefined && <Row k={sp.props.kind === 'roof-zone' ? t('Stands at') : t('From')} v={lvl(sp.props.z0)} />}
        {sp.props.z1 !== undefined && <Row k={t('To')} v={lvl(sp.props.z1)} />}
        {sp.props.accessFace && <Row k={t('Access panel')} v={t('{f} face', { f: sp.props.accessFace })} />}
        {sp.props.access && <Row k={t('Access')} v={sp.props.access} />}
      </div>
      <p className="hint">{sp.props.kind === 'plenum' ? t('A deeper lowered ceiling holds more pipes but lowers the room; the height check shows the result.') : sp.props.kind === 'shaft' ? t('Pipes and conduits re-route when the shaft moves or changes size.') : t('Equipment stands here with room around it for maintenance.')}</p>
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
  const t = useT();
  const go = (c: CheckResult) => {
    if (c.level && c.level !== level && isPlanLevel(p, c.level)) setLevel(c.level);
    if (c.elementIds[0]) select(c.elementIds[0]);
    // MEP rows know where the problem is: the 3D camera zooms to it
    if (c.at) useApp.getState().lookFrom([c.at[0] + 2.5, c.at[1] - 3, c.at[2] + 2.2], c.at);
  };
  return (
    <section className={'checks' + (open ? ' open' : '')} aria-label={t('Checks')}>
      <div className="checkhead">
        <button className="ghost strong" onClick={() => setChecksOpen(!open)} aria-expanded={open} data-testid="checks-toggle">
          {open ? '▾' : '▸'} {t('Checks')}
        </button>
        <span className="pill ok">{t('{n} pass', { n: sum.pass })}</span>
        {sum.warn > 0 && <span className="pill warn">{t(sum.warn > 1 ? '{n} warnings' : '{n} warning', { n: sum.warn })}</span>}
        {sum.confirm > 0 && <span className="pill confirm" data-testid="checks-confirm">{t('{n} to confirm', { n: sum.confirm })}</span>}
        <span className={'pill ' + (sum.fail ? 'bad' : 'muted')} data-testid="checks-fail">{t('{n} fail', { n: sum.fail })}</span>
        <span className="spacer" />
        <div className="seg small" role="group" aria-label={t('Which checks')}>
          <button aria-pressed={scope === 'level'} onClick={() => setChecksScope('level')}>{t('This floor + site')}</button>
          <button aria-pressed={scope === 'all'} onClick={() => setChecksScope('all')}>{t('Whole house')}</button>
        </div>
      </div>
      {open && (
        <div className="checklist">
          <table>
            <thead><tr><th /><th>{t('Check')}</th><th>{t('Result')}</th><th>{t('Rule')}</th><th>{t('Source')}</th></tr></thead>
            <tbody>
              {sorted.map((c) => (
                <tr key={c.id} className={c.status} onClick={() => go(c)}>
                  <td className={'st ' + c.status} aria-label={c.status === 'confirm' ? t('to confirm') : t(c.status)}>{ICON[c.status]}</td>
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
  const t = useT();
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
        <h2 id="about-title">{t('About {project}', { project: p.meta.project })}</h2>
        <p>{t('This is a')} <b>{t('design and decision tool')}</b> {t("for the family's house at {address}. It helps us try layouts, check them against the main code rules and share one precise model with the professionals.", { address: p.site.address })}</p>
        <p><b>{t('It does not replace the official project.')}</b> {t('The permit drawings and the executive designs (architecture, structure, plumbing, electrical) must be made and signed by licensed professionals, with their ART/RRT. They receive this model through the IFC export.')}</p>
        <p>{t('The checks cover the rules we know ({sanitary}, Civil Code art. 1.301, stair comfort, setbacks; {code}). They are a guide, not an approval.', { sanitary: sanitary(p), code: cityCode(p) })}</p>
        <p className="disclaimer" data-testid="about-disclaimer">{DISCLAIMER}</p>
        <h4>{t('Still to confirm')}</h4>
        <ConfirmList t={t} groups={toConfirm(p.site.lot, p)} />
        <p className="hint">{t('Units are metres. Plan axes: y from the street to the rear, x to the right seen from the street (towards the {dir}).', { dir: t(({ N: 'north', E: 'east', S: 'south', W: 'west' } as const)[compassOf(p, 1, 0)]) })}</p>
        <button onClick={() => setAbout(false)} autoFocus>{t('Close')}</button>
      </div>
    </div>
  );
}
