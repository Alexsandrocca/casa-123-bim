// Properties panel, checks bar and About panel.
import { useEffect, useMemo, useState } from 'react';
import { minArea, needsDaylight, runChecks, summarize, type CheckResult } from '../model/checks';
import {
  deleteOpening, doorMax, flipOpening, renameSpace, resizeOpening, setOpeningSize, setWallThickness,
} from '../model/commands';
import { byLevel, getEl, glassArea, openingSegIn, spaceArea, wallLength, wallSeg } from '../model/geometry';
import type { Element, Opening, PlanLevel, Project, Space, Wall } from '../model/schema';
import { useApp, useProject } from '../store';
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
      {el && !['Space', 'Wall', 'Opening'].includes(el.type) && <GenericProps el={el} />}
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
  const o = lv.outline!;
  const select = useApp((s) => s.select);
  const rooms = byLevel(p, level, 'Space').filter((s) => s.props.zone !== 'stair');
  return (
    <>
      <div className="phead"><div><h3>{lv.name}</h3><div className="eyebrow">{p.meta.version} · {((o.x1 - o.x0) * (o.y1 - o.y0)).toFixed(1)} m² gross</div></div></div>
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
      <NumberField label="Thickness" value={w.props.thickness} step={0.01} min={0.05} onCommit={(v) => run(setWallThickness(w.id, v))} />
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

function GenericProps({ el }: { el: Element }) {
  return (
    <>
      <Header title={el.type} sub={el.id} />
      <pre className="json">{JSON.stringify(el.props, null, 1)}</pre>
    </>
  );
}

/* ---------- checks ---------- */

const ICON = { pass: '✓', warn: '!', fail: '✕' } as const;

export function ChecksBar() {
  const p = useProject();
  const level = useApp((s) => s.level);
  const open = useApp((s) => s.checksOpen);
  const scope = useApp((s) => s.checksScope);
  const { setChecksOpen, setChecksScope, select, setLevel } = useApp.getState();
  const all = useMemo(() => runChecks(p), [p]);
  const shown = scope === 'all' ? all : all.filter((c) => !c.level || c.level === level);
  const sum = summarize(shown);
  const order = { fail: 0, warn: 1, pass: 2 };
  const sorted = [...shown].sort((a, b) => order[a.status] - order[b.status]);
  const go = (c: CheckResult) => {
    if (c.level && c.level !== level && ['LL', 'SL', 'UF'].includes(c.level)) setLevel(c.level as PlanLevel);
    if (c.elementIds[0]) select(c.elementIds[0]);
  };
  return (
    <section className={'checks' + (open ? ' open' : '')} aria-label="Checks">
      <div className="checkhead">
        <button className="ghost strong" onClick={() => setChecksOpen(!open)} aria-expanded={open} data-testid="checks-toggle">
          {open ? '▾' : '▸'} Checks
        </button>
        <span className="pill ok">{sum.pass} pass</span>
        {sum.warn > 0 && <span className="pill warn">{sum.warn} below target</span>}
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
                  <td className={'st ' + c.status} aria-label={c.status}>{ICON[c.status]}</td>
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
        <h4>Still to confirm</h4>
        <ul>{p.site.toConfirm.map((t) => <li key={t}>{t}</li>)}</ul>
        <p className="hint">Units are metres. Plan axes: x from the south wall to the north, y from the street to the rear.</p>
        <button onClick={() => setAbout(false)} autoFocus>Close</button>
      </div>
    </div>
  );
}
