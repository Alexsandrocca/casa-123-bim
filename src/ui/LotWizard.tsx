// P1: the lot wizard — the first step of every project, and the place to review or change the lot later.
// Seven steps on the left, the step's questions in the middle, the lot to scale (or the map) on the right.
// Every answer can be "I don't know": it is filled with a sensible value and marked TO CONFIRM. Nothing blocks moving on.
import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from '../api';
import { useT } from '../i18n/useT';
import { CITIES, TYPICAL, cityInfo, defaultLot, regionFor, rulesFor, servicesFor } from '../model/cities';
import { ccwLot, lotFigures, toConfirm, type P2 } from '../model/lot';
import { COMPASS8, COMPASS8_BEARING, lotFromAi, trapezoid, xBearingForStreet, type Compass8, type LotAiFields } from '../model/lot-ai';
import { SUN_DAYS, sunDay, sunPerSide } from '../model/lot-sun';
import { compassOf } from '../model/orientation';
import type { ProjectFile } from '../model/project-file';
import type { FactStatus, Lot, NumFact, Project, Region } from '../model/schema';
import { planLevels } from '../model/schema';
import { starterModel } from '../model/starter';
import { lotSummary, useApp } from '../store';
import { LotCanvas, type CanvasLayer } from './LotCanvas';
import { ConfirmList } from './LotText';
import { LegalFooter } from './LegalFooter';
import { LangToggle } from './Shell';

const LotMap = lazy(() => import('./LotMap'));
const LotTerrain3D = lazy(() => import('./LotTerrain3D'));

type T = ReturnType<typeof useT>;
export interface LotDraft { name: string; address: string; lot: Lot; region: Region }
type StepKey = 'place' | 'shape' | 'north' | 'terrain' | 'rules' | 'services' | 'summary';
const STEPS: { key: StepKey; title: string; why: string; layer: CanvasLayer }[] = [
  { key: 'place', title: 'Address and location', why: 'The city sets the starting rules, whom to ask about the street services, and the sun.', layer: 'shape' },
  { key: 'shape', title: 'Lot shape', why: 'The shape and the street side decide where the house can go.', layer: 'shape' },
  { key: 'north', title: 'Orientation', why: 'North decides where the sun comes in: morning, afternoon, winter and summer.', layer: 'north' },
  { key: 'terrain', title: 'Terrain', why: 'The slope decides how the house sits on the ground: steps, cuts and retaining walls.', layer: 'terrain' },
  { key: 'rules', title: 'Rules', why: 'The setback decides where the house can be; the rates decide how big it can be.', layer: 'rules' },
  { key: 'services', title: 'Street services', why: 'The street services decide where the water, the sewage and the electricity come in, and whom to ask.', layer: 'services' },
  { key: 'summary', title: 'Summary', why: 'The lot in one card, and what is still to confirm, grouped by whom to ask.', layer: 'summary' },
];

const today = () => new Date().toISOString().slice(0, 10);
const told = <V,>(value: V) => ({ value, status: 'given' as const, source: 'Owner', date: today() });
const numText = (lang: string, v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '' : lang === 'pt-BR' ? String(Math.round(v * 1000) / 1000).replace('.', ',') : String(Math.round(v * 1000) / 1000));
const parseNum = (s: string) => { const v = Number(s.trim().replace(/\s/g, '').replace(',', '.')); return s.trim() === '' || !Number.isFinite(v) ? null : v; };

/* ---------------- small inputs ---------------- */

function StatusChip({ t, status, onChange, testId }: { t: T; status: FactStatus; onChange: (s: FactStatus) => void; testId?: string }) {
  return (
    <select className={'factstatus ' + status} value={status} onChange={(e) => onChange(e.target.value as FactStatus)} aria-label={t('How sure is this?')} data-testid={testId}>
      <option value="given">{t('given')}</option>
      <option value="confirmed">{t('confirmed')}</option>
      <option value="to-confirm">{t('TO CONFIRM')}</option>
    </select>
  );
}

/** A number the family knows, or not ("I don't know" fills the typical value and marks it TO CONFIRM). */
function FactField({ t, label, unit, fact, typical, onChange, testId, help }: {
  t: T; label: string; unit: string; fact: NumFact; typical: number | null; onChange: (f: NumFact) => void; testId: string; help?: string;
}) {
  const [text, setText] = useState(numText(t.lang, fact.value));
  useEffect(() => setText(numText(t.lang, fact.value)), [fact.value, t.lang]);
  const commit = () => {
    const v = parseNum(text);
    if (v === fact.value) return;
    onChange(v === null ? { value: null, status: 'to-confirm', source: '', date: today() } : told(v));
  };
  return (
    <div className={'ffield' + (fact.status === 'to-confirm' ? ' tbc' : '')}>
      <span className="flabel fhead"><label htmlFor={testId}>{label} <em>({unit})</em></label>
        <StatusChip t={t} status={fact.status} onChange={(s) => onChange({ ...fact, status: s, date: today() })} testId={`${testId}-status`} /></span>
      <span className="frow">
        <input id={testId} inputMode="decimal" value={text} placeholder={t('TO CONFIRM')} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} data-testid={testId} />
        <button type="button" className="small ghost dk" onClick={() => onChange({ value: typical, status: 'to-confirm', source: typical === null ? '' : 'Typical value (TO CONFIRM)', date: today() })} data-testid={`${testId}-dk`}>{t('I don’t know')}</button>
      </span>
      {help && <small className="hint">{help}</small>}
    </div>
  );
}

/** A plain number field (preset sizes). */
function NumField({ t, label, unit, value, onChange, testId }: { t: T; label: string; unit: string; value: number; onChange: (v: number) => void; testId: string }) {
  const [text, setText] = useState(numText(t.lang, value));
  useEffect(() => setText(numText(t.lang, value)), [value, t.lang]);
  const commit = () => { const v = parseNum(text); if (v !== null && v > 0 && v !== value) onChange(v); else setText(numText(t.lang, value)); };
  return (
    <label className="ffield">
      <span className="flabel">{label} <em>({unit})</em></span>
      <input inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} data-testid={testId} />
    </label>
  );
}

function TextField({ label, value, onChange, testId, list, placeholder }: { label: string; value: string; onChange: (v: string) => void; testId: string; list?: string; placeholder?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className="ffield">
      <span className="flabel">{label}</span>
      <input value={text} list={list} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onBlur={() => { if (text !== value) onChange(text); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} data-testid={testId} />
    </label>
  );
}

function Choice<V extends string>({ label, value, options, onChange, testId }: { label: string; value: V | null; options: [V, string][]; onChange: (v: V) => void; testId: string }) {
  return (
    <div className="ffield">
      <span className="flabel">{label}</span>
      <div className="seg choice" role="radiogroup" aria-label={label} data-testid={testId}>
        {options.map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={value === v} aria-pressed={value === v} onClick={() => onChange(v)} data-testid={`${testId}-${v}`}>{l}</button>)}
      </div>
    </div>
  );
}

/* ---------------- the shape presets ---------------- */

type Preset = 'rectangle' | 'trapezoid' | 'corner' | 'irregular';
interface ShapeForm { preset: Preset; front: number; rear: number; depth: number; extra: 'right' | 'left' | 'both'; second: 'right' | 'left' }

const near = (a: P2[], b: P2[]) => a.length === b.length && a.every((p, i) => Math.hypot(p[0] - b[i]![0], p[1] - b[i]![1]) < 1e-6);
function shapeOf(lot: Lot): ShapeForm {
  const p = ccwLot(lot).polygon, bx = { w: Math.max(...p.map((c) => c[0])) - Math.min(...p.map((c) => c[0])), d: Math.max(...p.map((c) => c[1])) - Math.min(...p.map((c) => c[1])) };
  const base: ShapeForm = { preset: 'irregular', front: bx.w, rear: bx.w, depth: bx.d, extra: 'right', second: 'right' };
  if (p.length !== 4) return base;
  const front = p[1]![0] - p[0]![0], depth = p[3]![1] - p[0]![1], rear = p[2]![0] - p[3]![0];
  const rect: P2[] = [[0, 0], [front, 0], [front, depth], [0, depth]];
  if (near(p, rect)) return { ...base, preset: lot.streetEdges.length > 1 ? 'corner' : 'rectangle', front, rear: front, depth, second: lot.streetEdges.includes(3) ? 'left' : 'right' };
  for (const extra of ['right', 'left', 'both'] as const) if (near(p, trapezoid(front, rear, depth, extra))) return { ...base, preset: 'trapezoid', front, rear, depth, extra };
  return base;
}
function polygonOf(f: ShapeForm): { polygon: P2[]; streetEdges: number[] } {
  if (f.preset === 'trapezoid') return { polygon: trapezoid(f.front, f.rear, f.depth, f.extra), streetEdges: [0] };
  const rect: P2[] = [[0, 0], [f.front, 0], [f.front, f.depth], [0, f.depth]];
  return { polygon: rect, streetEdges: f.preset === 'corner' ? (f.second === 'left' ? [0, 3] : [0, 1]) : [0] };
}

/* ---------------- the wizard ---------------- */

const SIDE_NAME = { street: 'Street', rear: 'Rear', left: 'Left side', right: 'Right side' } as const;
const COMPASS_WORD: Record<Compass8, string> = { N: 'north', NE: 'north-east', E: 'east', SE: 'south-east', S: 'south', SW: 'south-west', W: 'west', NW: 'north-west' };

export function LotWizard({ mode, initial, house, onSave, startAt, saved }: {
  mode: 'new' | 'edit';
  initial: LotDraft;
  /** The house in lot coordinates (an existing design), to see it against the envelope. */
  house?: P2[][];
  onSave: (d: LotDraft) => Promise<void>;
  startAt?: StepKey;
  /** A message after saving (shown on the summary). */
  saved?: string | null;
}) {
  const t = useT();
  const [d, setD] = useState<LotDraft>(initial);
  const [step, setStep] = useState<StepKey>(startAt ?? 'place');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [mapMode, setMapMode] = useState<'street' | null>(null);
  const i = STEPS.findIndex((s) => s.key === step);
  const S = STEPS[i]!;
  const lot = d.lot;
  const setLot = (l: Lot) => setD((x) => ({ ...x, lot: ccwLot(l) }));
  const fig = useMemo(() => lotFigures(lot), [lot]);

  const content: Record<StepKey, ReactNode> = {
    place: <PlaceStep t={t} d={d} setD={setD} mode={mode} />,
    shape: <ShapeStep t={t} lot={lot} setLot={setLot} />,
    north: <NorthStep t={t} lot={lot} region={d.region} setLot={setLot} onMap={() => setMapMode(mapMode === 'street' ? null : 'street')} mapOn={mapMode === 'street'} />,
    terrain: <TerrainStep t={t} lot={lot} setLot={setLot} />,
    rules: <RulesStep t={t} lot={lot} setLot={setLot} city={d.region.city} />,
    services: <ServicesStep t={t} lot={lot} setLot={setLot} />,
    summary: <SummaryStep t={t} d={d} saved={saved ?? null} />,
  };
  const save = async () => {
    setBusy(true); setErr('');
    try { await onSave(d); } catch (e) { setErr(e instanceof ApiError ? e.message : (e as Error).message); } finally { setBusy(false); }
  };
  const showMap = step === 'place' || (step === 'north' && mapMode === 'street');

  return (
    <div className="wizard" data-testid="lot-wizard">
      <nav className="wrail" aria-label={t('Lot wizard steps')}>
        <ol>
          {STEPS.map((s, k) => (
            <li key={s.key} className={s.key === step ? 'cur' : k < i ? 'done' : ''}>
              <button onClick={() => setStep(s.key)} aria-current={s.key === step ? 'step' : undefined} data-testid={`wstep-${s.key}`}><span className="n">{k + 1}</span>{t(s.title)}</button>
            </li>
          ))}
        </ol>
        <div className="wfig" data-testid="lot-figures">
          <div><span>{t('Area')}</span><b>{t.n(fig.area, 2)} m²</b></div>
          <div><span>{t('Perimeter')}</span><b>{t.n(fig.perimeter, 2)} m</b></div>
          <div><span>{t('Buildable area')}</span><b>{t.n(fig.envelopeArea, 1)} m²</b></div>
        </div>
      </nav>
      <section className="wform" aria-labelledby="wtitle">
        <h2 id="wtitle">{i + 1}. {t(S.title)}</h2>
        <p className="why">{t(S.why)}</p>
        <div className="wbody">{content[step]}</div>
        {err && <p className="bad">{err}</p>}
        <div className="wnav">
          <button disabled={i === 0} onClick={() => setStep(STEPS[i - 1]!.key)} data-testid="wback">← {t('Previous step')}</button>
          {step === 'summary'
            ? <button className="strong" disabled={busy || (mode === 'new' && !d.name.trim())} onClick={save} data-testid="save-lot">{busy ? t('Saving…') : t('Save lot')}</button>
            : <button className="strong" onClick={() => setStep(STEPS[i + 1]!.key)} data-testid="wnext">{t('Next step')} →</button>}
        </div>
      </section>
      <section className="wview">
        {showMap ? (
          <Suspense fallback={<div className="lotmap loading">{t('Loading the map…')}</div>}>
            <LotMap lot={lot} mode={step === 'north' ? 'street' : 'pick'}
              onPick={(lat, lon) => setLot({ ...lot, geo: { ...lot.geo, lat, lon, status: 'given', source: 'Map (OpenStreetMap)' } })}
              onStreet={(b) => { setLot({ ...lot, geo: { ...lot.geo, xBearing: Math.round(b * 10) / 10, status: 'given', source: 'Map: the street front' } }); setMapMode(null); }} />
          </Suspense>
        ) : <LotCanvas lot={lot} region={d.region} layer={S.layer} house={house} onChange={step === 'shape' ? setLot : undefined} />}
        {step === 'terrain' && <Suspense fallback={<div className="terrain3d loading">{t('Loading 3D…')}</div>}><LotTerrain3D lot={lot} /></Suspense>}
      </section>
    </div>
  );
}

/* ---------------- steps ---------------- */

/** A new city: its table fills only what is still TO CONFIRM; what the family told stays. */
function withCity(x: LotDraft, city: string, state: string): LotDraft {
  const r = rulesFor(city, state), s = servicesFor(city, state), c = cityInfo(city, state);
  const keep = <F extends { status: FactStatus }>(old: F, fresh: F) => (old.status === 'to-confirm' ? fresh : old);
  const rules: Lot['rules'] = {
    ...x.lot.rules, zone: keep(x.lot.rules.zone, r.zone),
    setbacks: { front: keep(x.lot.rules.setbacks.front, r.setbacks.front), rear: keep(x.lot.rules.setbacks.rear, r.setbacks.rear), left: keep(x.lot.rules.setbacks.left, r.setbacks.left), right: keep(x.lot.rules.setbacks.right, r.setbacks.right) },
    coverage: keep(x.lot.rules.coverage, r.coverage), permeability: keep(x.lot.rules.permeability, r.permeability), far: keep(x.lot.rules.far, r.far),
    height: keep(x.lot.rules.height, r.height), floors: keep(x.lot.rules.floors, r.floors), eaves: keep(x.lot.rules.eaves, r.eaves),
  };
  const sv = x.lot.services;
  const services: Lot['services'] = {
    sewer: { ...sv.sewer, ask: s.sewer.ask }, water: { ...sv.water, ask: s.water.ask },
    power: { supply: keep(sv.power.supply, s.power.supply), ask: s.power.ask }, storm: sv.storm, gas: { ...sv.gas, ask: s.gas.ask },
  };
  const geo = x.lot.geo.status === 'to-confirm' && c ? { ...x.lot.geo, lat: c.lat, lon: c.lon } : x.lot.geo;
  const region = { ...regionFor(city, state), ...(c ? {} : { pvYield: x.region.pvYield, solarHeaterShare: x.region.solarHeaterShare }) };
  return { ...x, region, lot: { ...x.lot, rules, services, geo } };
}

function PlaceStep({ t, d, setD, mode }: { t: T; d: LotDraft; setD: (f: (x: LotDraft) => LotDraft) => void; mode: 'new' | 'edit' }) {
  const lot = d.lot;
  const setCity = (city: string, state: string) => setD((x) => withCity(x, city, state));
  return (
    <>
      {mode === 'new' && <TextField label={t('Project name')} value={d.name} onChange={(v) => setD((x) => ({ ...x, name: v }))} testId="w-name" placeholder={t('e.g. Our house')} />}
      <TextField label={t('Address')} value={d.address} onChange={(v) => setD((x) => ({ ...x, address: v }))} testId="w-address" />
      <div className="frow2">
        <TextField label={t('City')} value={d.region.city} list="w-cities" onChange={(v) => setCity(v.trim(), d.region.state)} testId="w-city" />
        <TextField label={t('State (UF)')} value={d.region.state} onChange={(v) => setCity(d.region.city, v.trim().toUpperCase())} testId="w-state" />
      </div>
      <datalist id="w-cities">{CITIES.map((c) => <option key={c.city} value={c.city}>{`${c.city}/${c.state}`}</option>)}</datalist>
      <p className="hint" data-testid="w-city-known">{cityInfo(d.region.city, d.region.state)
        ? t('{city} is in the city table: its rules, utilities and sun are the starting values (each marked as known or TO CONFIRM).', { city: d.region.city })
        : t('This city is not in the table yet: its rules start empty and TO CONFIRM.')}</p>
      <div className="frow2">
        <GeoNum t={t} label={t('Latitude')} value={lot.geo.lat} onChange={(v) => setD((x) => ({ ...x, lot: { ...x.lot, geo: { ...x.lot.geo, lat: v, status: 'given', source: 'Owner' } } }))} testId="w-lat" />
        <GeoNum t={t} label={t('Longitude')} value={lot.geo.lon} onChange={(v) => setD((x) => ({ ...x, lot: { ...x.lot, geo: { ...x.lot.geo, lon: v, status: 'given', source: 'Owner' } } }))} testId="w-lon" />
      </div>
      <p className="hint">{t('Click the lot on the map, or type the numbers from Google Maps (right-click the lot).')}</p>
      <AiDescribe t={t} d={d} setD={setD} />
    </>
  );
}

function GeoNum({ t, label, value, onChange, testId }: { t: T; label: string; value: number; onChange: (v: number) => void; testId: string }) {
  const [text, setText] = useState(numText(t.lang, value));
  useEffect(() => setText(numText(t.lang, value)), [value, t.lang]);
  return (
    <label className="ffield">
      <span className="flabel">{label}</span>
      <input inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => { const v = parseNum(text); if (v !== null && Math.abs(v) <= 180 && v !== value) onChange(v); else setText(numText(t.lang, value)); }} data-testid={testId} />
    </label>
  );
}

/** "Describe your lot in words": the AI reads it; the values are shown first and applied only on "Use these values". */
function AiDescribe({ t, d, setD }: { t: T; d: LotDraft; setD: (f: (x: LotDraft) => LotDraft) => void }) {
  const project = useApp((s) => s.info?.id);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [fields, setFields] = useState<LotAiFields | null>(null);
  const [editing, setEditing] = useState(false);
  const read = async () => {
    setBusy(true); setMsg(''); setFields(null); setEditing(false);
    try {
      const r = await api.aiLot(text, project);
      setFields(r.fields);
      setMsg(t('Read by the AI · cost US$ {usd}', { usd: t.n(r.usage.usd, 4) }));
    } catch (e) {
      setMsg(e instanceof ApiError && e.code === 'no-key' ? t('The AI is not connected yet (no key). Fill in the steps by hand, or add the key with “Add AI key.command”.') : e instanceof ApiError ? e.message : String(e));
    } finally { setBusy(false); }
  };
  const use = () => {
    if (!fields) return;
    setD((x) => {
      let next: LotDraft = { ...x, lot: lotFromAi(x.lot, fields) };
      if (fields.address) next = { ...next, address: fields.address };
      if (fields.city) next = withCity(next, fields.city, fields.state ?? next.region.state);
      return next;
    });
    setFields(null); setMsg(t('Values used. Check them in the next steps.'));
  };
  const f = fields;
  const set = (patch: Partial<LotAiFields>) => f && setFields({ ...f, ...patch });
  const n = (v: number | null) => (v === null ? '—' : `${t.n(v, 2)} m`);
  return (
    <div className="aibox" data-testid="ai-describe">
      <label className="ffield">
        <span className="flabel">{t('Or describe your lot in words (optional, uses the AI)')}</span>
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('e.g. 14 m at the front, 15 at the back, 25 on the sides, it falls about 2 m to the back, the street is to the east, Piracicaba')} data-testid="ai-text" />
      </label>
      <button disabled={busy || !text.trim()} onClick={read} data-testid="ai-read">{busy ? t('Reading…') : t('Read with AI')}</button>
      {msg && <p className="hint" data-testid="ai-msg">{msg}</p>}
      {f && (
        <div className="aipreview" data-testid="ai-preview">
          <h4>{t('The AI understood:')}</h4>
          {editing ? (
            <div className="frow2">
              <NumField t={t} label={t('Front')} unit="m" value={f.front ?? 0} onChange={(v) => set({ front: v })} testId="ai-front" />
              <NumField t={t} label={t('Rear')} unit="m" value={f.rear ?? f.front ?? 0} onChange={(v) => set({ rear: v })} testId="ai-rear" />
              <NumField t={t} label={t('Sides (depth)')} unit="m" value={f.left ?? f.right ?? 0} onChange={(v) => set({ left: v, right: v })} testId="ai-depth" />
              <NumField t={t} label={t('Fall')} unit="m" value={f.fall ?? 0} onChange={(v) => set({ fall: v })} testId="ai-fall" />
            </div>
          ) : (
            <ul>
              <li>{t('Shape')}: <b>{f.shape ? t({ rectangle: 'rectangle', trapezoid: 'trapezoid', corner: 'corner lot', irregular: 'irregular' }[f.shape]) : '—'}</b> · {t('front')} {n(f.front)} · {t('rear')} {n(f.rear)} · {t('sides')} {n(f.left)} / {n(f.right)}</li>
              <li>{t('Terrain')}: <b>{f.terrain ? t({ flat: 'flat', down: 'falls towards the rear', up: 'rises towards the rear', side: 'falls to one side' }[f.terrain]) : '—'}</b>{f.fall !== null ? ` · ${n(f.fall)}` : ''}</li>
              <li>{t('The street is to the')}: <b>{f.streetFaces ? t(COMPASS_WORD[f.streetFaces]) : '—'}</b></li>
              <li>{t('City')}: <b>{f.city ? `${f.city}${f.state ? `/${f.state}` : ''}` : '—'}</b></li>
              {f.notes.length > 0 && <li>{t('Notes')}: {f.notes.join('; ')}</li>}
            </ul>
          )}
          <div className="btnrow">
            <button className="strong" onClick={use} data-testid="ai-use">{t('Use these values')}</button>
            <button onClick={() => setEditing(!editing)} data-testid="ai-edit">{editing ? t('Done') : t('Edit')}</button>
            <button className="ghost" onClick={() => setFields(null)}>{t('Discard')}</button>
          </div>
        </div>
      )}
      {d.lot.notes.length > 0 && <p className="hint">{t('Notes')}: {d.lot.notes.join('; ')}</p>}
    </div>
  );
}

function ShapeStep({ t, lot, setLot }: { t: T; lot: Lot; setLot: (l: Lot) => void }) {
  const [f, setF] = useState<ShapeForm>(() => shapeOf(lot));
  useEffect(() => { const s = shapeOf(lot); if (s.preset !== 'irregular' || f.preset === 'irregular') setF(s); }, [lot]); // follow drags
  const apply = (next: ShapeForm) => {
    setF(next);
    if (next.preset === 'irregular') return;
    const g = polygonOf(next);
    setLot({ ...lot, ...g, shape: { status: 'given', source: 'Owner' } });
  };
  const fig = lotFigures(lot);
  const p = ccwLot(lot).polygon;
  const setCorner = (k: number, c: 0 | 1, v: number) => setLot({ ...lot, polygon: p.map((q, j) => (j === k ? (c === 0 ? [v, q[1]] : [q[0], v]) as P2 : q)), shape: { status: 'given', source: 'Owner' } });
  const toggleStreet = (k: number) => {
    const has = lot.streetEdges.includes(k);
    const next = has ? lot.streetEdges.filter((e) => e !== k) : [...lot.streetEdges, k].sort((a, b) => a - b);
    if (next.length) setLot({ ...lot, streetEdges: next });
  };
  return (
    <>
      <Choice label={t('Shape')} value={f.preset} onChange={(v) => apply({ ...f, preset: v })} testId="w-preset"
        options={[['rectangle', t('Rectangle')], ['trapezoid', t('Trapezoid')], ['corner', t('Corner lot')], ['irregular', t('Irregular')]]} />
      {f.preset !== 'irregular' && (
        <div className="frow2">
          <NumField t={t} label={t('Front (on the street)')} unit="m" value={f.front} onChange={(v) => apply({ ...f, front: v, rear: f.preset === 'trapezoid' ? f.rear : v })} testId="w-front" />
          {f.preset === 'trapezoid' && <NumField t={t} label={t('Rear')} unit="m" value={f.rear} onChange={(v) => apply({ ...f, rear: v })} testId="w-rear" />}
          <NumField t={t} label={f.preset === 'corner' ? t('Depth (along the second street)') : t('Sides (depth)')} unit="m" value={f.depth} onChange={(v) => apply({ ...f, depth: v })} testId="w-depth" />
        </div>
      )}
      {f.preset === 'trapezoid' && (
        <Choice label={t('Which side takes the difference at the rear?')} value={f.extra} onChange={(v) => apply({ ...f, extra: v })} testId="w-extra"
          options={[['right', t('right side')], ['left', t('left side')], ['both', t('half each')]]} />
      )}
      {f.preset === 'corner' && (
        <Choice label={t('The second street is on the')} value={f.second} onChange={(v) => apply({ ...f, second: v })} testId="w-second"
          options={[['left', t('left side')], ['right', t('right side')]]} />
      )}
      {f.preset === 'irregular' && (
        <div className="corners" data-testid="w-corners">
          <p className="hint">{t('Corners in metres: x along the street from the front-left corner, y away from the street. Or drag the corners on the drawing (5 cm steps).')}</p>
          <table><thead><tr><th>#</th><th>x (m)</th><th>y (m)</th><th /></tr></thead>
            <tbody>
              {p.map(([x, y], k) => (
                <tr key={k}>
                  <td>{k + 1}</td>
                  <td><CornerNum t={t} value={x} onChange={(v) => setCorner(k, 0, v)} testId={`w-cx-${k}`} /></td>
                  <td><CornerNum t={t} value={y} onChange={(v) => setCorner(k, 1, v)} testId={`w-cy-${k}`} /></td>
                  <td>{p.length > 3 && <button className="small ghost" onClick={() => setLot({ ...lot, polygon: p.filter((_, j) => j !== k), streetEdges: lot.streetEdges.filter((e) => e < p.length - 1).length ? lot.streetEdges.filter((e) => e < p.length - 1) : [0] })} aria-label={t('Remove corner')}>✕</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="small" onClick={() => { const a = p[p.length - 1]!, b = p[0]!; setLot({ ...lot, polygon: [...p, [(a[0] + b[0]) / 2 - 1, (a[1] + b[1]) / 2] as P2] }); }} data-testid="w-addcorner">+ {t('Add a corner')}</button>
        </div>
      )}
      <div className="ffield">
        <span className="flabel">{t('Which sides face a street?')}</span>
        <ul className="streetsides" data-testid="w-streetsides">
          {fig.sides.map((len, k) => (
            <li key={k}><label className="check"><input type="checkbox" checked={lot.streetEdges.includes(k)} onChange={() => toggleStreet(k)} data-testid={`w-street-${k}`} /> {t('Side {n}', { n: k + 1 })}: {t.n(len, 2)} m · {t(SIDE_NAME[fig.roles[k]!])}</label></li>
          ))}
        </ul>
      </div>
      <div className="figs">
        <span>{t('Area')}: <b data-testid="w-area">{t.n(fig.area, 2)} m²</b></span>
        <span>{t('Perimeter')}: <b>{t.n(fig.perimeter, 2)} m</b></span>
      </div>
      <ShapeStatus t={t} lot={lot} setLot={setLot} />
    </>
  );
}

function ShapeStatus({ t, lot, setLot }: { t: T; lot: Lot; setLot: (l: Lot) => void }) {
  return (
    <p className="hint">{t('How sure are these measurements?')} <StatusChip t={t} status={lot.shape.status} onChange={(s) => setLot({ ...lot, shape: { ...lot.shape, status: s } })} testId="w-shape-status" />
      {' '}<button className="small ghost dk" onClick={() => setLot({ ...lot, shape: { status: 'to-confirm', source: 'Estimate' } })} data-testid="w-shape-dk">{t('I don’t know')}</button></p>
  );
}

function CornerNum({ t, value, onChange, testId }: { t: T; value: number; onChange: (v: number) => void; testId: string }) {
  const [text, setText] = useState(numText(t.lang, value));
  useEffect(() => setText(numText(t.lang, value)), [value, t.lang]);
  return <input className="cnum" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => { const v = parseNum(text); if (v !== null && v !== value) onChange(Math.round(v * 20) / 20); else setText(numText(t.lang, value)); }} data-testid={testId} />;
}

function NorthStep({ t, lot, region, setLot, onMap, mapOn }: { t: T; lot: Lot; region: Region; setLot: (l: Lot) => void; onMap: () => void; mapOn: boolean }) {
  const street = ((lot.geo.xBearing + 90) % 360 + 360) % 360;
  const site = { site: { lot, region } };
  const days = SUN_DAYS.map((x) => sunDay(site, x.month, x.day));
  const sides = sunPerSide(site, days);
  const fig = lotFigures(lot);
  const setStreet = (b: number) => setLot({ ...lot, geo: { ...lot.geo, xBearing: xBearingForStreet(((b % 360) + 360) % 360), status: 'given', source: 'Owner' } });
  const near8 = COMPASS8.find((c) => Math.abs(((COMPASS8_BEARING[c] - street + 540) % 360) - 180) < 1e-6) ?? null;
  return (
    <>
      <Choice label={t('The street side of the lot faces')} value={near8} onChange={(c) => setStreet(COMPASS8_BEARING[c])} testId="w-faces"
        options={COMPASS8.map((c) => [c, t(COMPASS_WORD[c])] as [Compass8, string])} />
      <div className="dialrow">
        <label className="ffield">
          <span className="flabel">{t('Exact direction')} <em>(°)</em></span>
          <input type="range" min={0} max={359} step={1} value={Math.round(street)} onChange={(e) => setStreet(Number(e.target.value))} data-testid="w-dial" aria-label={t('Direction the street side faces, degrees from north')} />
        </label>
        <b className="dialval" data-testid="w-dial-value">{Math.round(street)}°</b>
      </div>
      <p className="hint">
        <button className="small" onClick={onMap} data-testid="w-north-map">{mapOn ? t('Back to the drawing') : t('Take it from the map')}</button>{' '}
        {t('How sure?')} <StatusChip t={t} status={lot.geo.status} onChange={(s) => setLot({ ...lot, geo: { ...lot.geo, status: s } })} testId="w-geo-status" />
        {' '}<button className="small ghost dk" onClick={() => setLot({ ...lot, geo: { ...lot.geo, status: 'to-confirm', source: 'Estimate' } })} data-testid="w-geo-dk">{t('I don’t know')}</button>
      </p>
      <table className="suntable" data-testid="w-sun-table">
        <thead><tr><th>{t('Side')}</th><th>{t('faces')}</th><th>21/6 ({t('winter')})</th><th>21/12 ({t('summer')})</th></tr></thead>
        <tbody>
          {sides.map((s) => (
            <tr key={s.edge}>
              <td>{t(SIDE_NAME[s.role])} · {t.n(fig.sides[s.edge]!, 1)} m</td>
              <td>{t(({ N: 'north', E: 'east', S: 'south', W: 'west' } as const)[compassOf(site as never, s.normal[0], s.normal[1])])}</td>
              <td>{t('{h} h of sun', { h: t.n(s.hours[0]!, 1) })}</td>
              <td>{t('{h} h of sun', { h: t.n(s.hours[1]!, 1) })}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">{t('The drawing shows the sun path on 21 June (winter, blue) and 21 December (summer, orange): the nearer the centre, the higher the sun.')}</p>
    </>
  );
}

function TerrainStep({ t, lot, setLot }: { t: T; lot: Lot; setLot: (l: Lot) => void }) {
  const tr = lot.terrain;
  const set = (patch: Partial<Lot['terrain']>, status: FactStatus = 'given') => setLot({ ...lot, terrain: { ...tr, ...patch, status, source: status === 'given' ? 'Owner' : 'Estimate (no topographic survey yet)' } });
  const corners = tr.corners ?? [0, 0, 0, 0];
  return (
    <>
      <Choice label={t('The ground')} value={tr.kind} onChange={(k) => set({ kind: k, fall: k === 'flat' ? 0 : tr.fall || 1, ...(k === 'corners' ? { corners } : {}) })} testId="w-terrain"
        options={[['flat', t('flat')], ['down', t('falls towards the rear')], ['up', t('rises towards the rear')], ['side', t('falls to one side')], ['corners', t('4 corner heights')]]} />
      {(tr.kind === 'down' || tr.kind === 'up' || tr.kind === 'side') && (
        <NumField t={t} label={tr.kind === 'side' ? t('Fall across the lot') : t('Difference between the street and the rear')} unit="m" value={Math.abs(tr.fall) || 0.01} onChange={(v) => set({ fall: tr.kind === 'side' && tr.fall < 0 ? -v : v })} testId="w-fall" />
      )}
      {tr.kind === 'side' && (
        <Choice label={t('The lower side is the')} value={tr.fall < 0 ? 'left' : 'right'} onChange={(s) => set({ fall: s === 'left' ? -Math.abs(tr.fall) : Math.abs(tr.fall) })} testId="w-lowside" options={[['left', t('left side')], ['right', t('right side')]]} />
      )}
      {tr.kind === 'corners' && (
        <div className="frow2">
          {([t('Front left'), t('Front right'), t('Rear right'), t('Rear left')]).map((lbl, k) => (
            <label key={k} className="ffield"><span className="flabel">{lbl} <em>(m)</em></span>
              <CornerNum t={t} value={corners[k]!} onChange={(v) => { const c = [...corners] as [number, number, number, number]; c[k] = v; set({ corners: c }); }} testId={`w-h-${k}`} />
            </label>
          ))}
        </div>
      )}
      <p className="hint">{t('How sure?')} <StatusChip t={t} status={tr.status} onChange={(s) => setLot({ ...lot, terrain: { ...tr, status: s } })} testId="w-terrain-status" />
        {' '}<button className="small ghost dk" onClick={() => set({ kind: tr.kind === 'flat' ? 'flat' : tr.kind }, 'to-confirm')} data-testid="w-terrain-dk">{t('I don’t know')}</button></p>
      <p className="note">{t('Later you can upload the topographic survey: its spot heights replace this estimate.')}</p>
    </>
  );
}

function RulesStep({ t, lot, setLot, city }: { t: T; lot: Lot; setLot: (l: Lot) => void; city: string }) {
  const r = lot.rules, fig = lotFigures(lot);
  const set = (patch: Partial<Lot['rules']>) => setLot({ ...lot, rules: { ...r, ...patch } });
  const sb = (k: keyof Lot['rules']['setbacks']) => (f: NumFact) => set({ setbacks: { ...r.setbacks, [k]: f } });
  const area = (v: number | null) => (v === null ? t('TO CONFIRM') : `${t.n(v, 1)} m²`);
  return (
    <>
      <p className="hint">{t('Starting values for {city}. Change any of them; “I don’t know” keeps a typical value marked TO CONFIRM.', { city: city || t('this city') })}</p>
      <label className="ffield"><span className="flabel">{t('Zone')}</span>
        <span className="frow"><input value={r.zone.value ?? ''} placeholder={t('TO CONFIRM')} onChange={(e) => set({ zone: e.target.value ? told(e.target.value) : { value: null, status: 'to-confirm', source: '', date: today() } })} data-testid="w-zone" />
          <StatusChip t={t} status={r.zone.status} onChange={(s) => set({ zone: { ...r.zone, status: s } })} /></span>
      </label>
      <h4>{t('Setbacks')}</h4>
      <div className="frow2">
        <FactField t={t} label={t('Front')} unit="m" fact={r.setbacks.front} typical={TYPICAL.setbacks.front} onChange={sb('front')} testId="w-sb-front" />
        <FactField t={t} label={t('Rear')} unit="m" fact={r.setbacks.rear} typical={TYPICAL.setbacks.rear} onChange={sb('rear')} testId="w-sb-rear" />
        <FactField t={t} label={t('Left side')} unit="m" fact={r.setbacks.left} typical={TYPICAL.setbacks.sides} onChange={sb('left')} testId="w-sb-left" />
        <FactField t={t} label={t('Right side')} unit="m" fact={r.setbacks.right} typical={TYPICAL.setbacks.sides} onChange={sb('right')} testId="w-sb-right" />
      </div>
      <h4>{t('How much can be built')}</h4>
      <div className="frow2">
        <FactField t={t} label={t('Site coverage TO')} unit="%" fact={r.coverage} typical={TYPICAL.coverage} onChange={(f) => set({ coverage: f })} testId="w-to" />
        <FactField t={t} label={t('Permeable area TP')} unit="%" fact={r.permeability} typical={TYPICAL.permeability} onChange={(f) => set({ permeability: f })} testId="w-tp" />
        <FactField t={t} label={t('Floor-area ratio CA')} unit="×" fact={r.far} typical={TYPICAL.far} onChange={(f) => set({ far: f })} testId="w-ca" />
        <FactField t={t} label={t('Height limit')} unit="m" fact={r.height} typical={TYPICAL.height} onChange={(f) => set({ height: f })} testId="w-height" />
        <FactField t={t} label={t('Floors')} unit={t('floors')} fact={r.floors} typical={TYPICAL.floors} onChange={(f) => set({ floors: f })} testId="w-floors" />
        <FactField t={t} label={t('Eaves not counted up to')} unit="m" fact={r.eaves} typical={TYPICAL.eaves} onChange={(f) => set({ eaves: f })} testId="w-eaves" />
      </div>
      <label className="ffield"><span className="flabel">{t('Special notes (e.g. the subdivision’s own rules)')}</span>
        <textarea rows={2} value={r.notes} onChange={(e) => set({ notes: e.target.value })} data-testid="w-rnotes" />
      </label>
      <div className="outcard" data-testid="w-rules-out">
        <div><span>{t('Buildable area (inside the setbacks)')}</span><b data-testid="w-env-area">{t.n(fig.envelopeArea, 1)} m²</b></div>
        <div><span>{t('Maximum footprint (TO)')}</span><b data-testid="w-max-footprint">{area(fig.maxFootprint)}</b></div>
        <div><span>{t('Maximum total built area (CA)')}</span><b data-testid="w-max-built">{area(fig.maxBuilt)}</b></div>
        <div><span>{t('Minimum permeable area (TP)')}</span><b data-testid="w-min-permeable">{area(fig.minPermeable)}</b></div>
        <p className="hint">{t('Green: where the house can be. Orange dashes: no window closer than 1.50 m to a neighbour (Civil Code art. 1.301).')}</p>
        {!fig.convex && <p className="hint">{t('This lot has an inward corner: the buildable area shown is on the safe side; the architect confirms it.')}</p>}
      </div>
    </>
  );
}

function ServicesStep({ t, lot, setLot }: { t: T; lot: Lot; setLot: (l: Lot) => void }) {
  const s = lot.services;
  const set = (patch: Partial<Lot['services']>) => setLot({ ...lot, services: { ...s, ...patch } });
  const ask = (name: string) => <p className="ask">{t('Who to ask')}: <b>{name}</b></p>;
  const yn = (v: boolean | null) => (v === null ? 'dk' : v ? 'yes' : 'no');
  const ynSet = (k: string) => (k === 'dk' ? { value: null, status: 'to-confirm' as const, source: '', date: today() } : told(k === 'yes'));
  const sup = s.power.supply.value;
  return (
    <>
      <fieldset className="svc">
        <legend>{t('Sewer')}</legend>
        <Choice label={t('Is there a public sewer in the street?')} value={yn(s.sewer.exists.value)} onChange={(k) => set({ sewer: { ...s.sewer, exists: ynSet(k) } })} testId="w-sewer" options={[['yes', t('yes')], ['no', t('no (septic tank)')], ['dk', t('I don’t know')]]} />
        <FactField t={t} label={t('Depth of the sewer below the street')} unit="m" fact={s.sewer.depth} typical={TYPICAL.sewerDepth} onChange={(f) => set({ sewer: { ...s.sewer, depth: f } })} testId="w-sewer-depth" />
        {ask(s.sewer.ask)}
      </fieldset>
      <fieldset className="svc">
        <legend>{t('Water')}</legend>
        <FactField t={t} label={t('Depth of the water main')} unit="m" fact={s.water.depth} typical={TYPICAL.waterDepth} onChange={(f) => set({ water: { ...s.water, depth: f } })} testId="w-water-depth" />
        {ask(s.water.ask)}
      </fieldset>
      <fieldset className="svc">
        <legend>{t('Electricity')}</legend>
        <Choice label={t('Voltage')} value={sup ? `${sup.phaseV}/${sup.lineV}` : null} onChange={(k) => { const [a, b] = k.split('/').map(Number); set({ power: { ...s.power, supply: { ...told({ phaseV: a!, lineV: b!, phases: sup?.phases ?? 1 }) } } }); }} testId="w-volt"
          options={[['127/220', '127/220 V'], ['220/380', '220/380 V']]} />
        <Choice label={t('Phases')} value={sup ? String(sup.phases) : null} onChange={(k) => set({ power: { ...s.power, supply: told({ ...(sup ?? TYPICAL.supply), phases: Number(k) }) } })} testId="w-phases"
          options={[['1', t('single-phase')], ['2', t('two-phase')], ['3', t('three-phase')]]} />
        <p className="hint">{t('How sure?')} <StatusChip t={t} status={s.power.supply.status} onChange={(st) => set({ power: { ...s.power, supply: { ...s.power.supply, status: st } } })} testId="w-power-status" />
          {' '}<button className="small ghost dk" onClick={() => set({ power: { ...s.power, supply: { value: sup ?? TYPICAL.supply, status: 'to-confirm', source: 'Typical value (TO CONFIRM)', date: today() } } })} data-testid="w-power-dk">{t('I don’t know')}</button></p>
        {ask(s.power.ask)}
      </fieldset>
      <fieldset className="svc">
        <legend>{t('Rainwater')}</legend>
        <Choice label={t('In the street there is')} value={s.storm.kind.value ?? 'dk'} onChange={(k) => set({ storm: { ...s.storm, kind: k === 'dk' ? { value: null, status: 'to-confirm', source: '', date: today() } : told(k as 'drain' | 'gutter' | 'none') } })} testId="w-storm"
          options={[['drain', t('a storm drain')], ['gutter', t('only the gutter')], ['none', t('neither')], ['dk', t('I don’t know')]]} />
        {ask('Prefeitura')}
      </fieldset>
      <fieldset className="svc">
        <legend>{t('Gas')}</legend>
        <label className="check"><input type="checkbox" checked={s.gas.wanted} onChange={(e) => set({ gas: { ...s.gas, wanted: e.target.checked } })} data-testid="w-gas-wanted" /> {t('We would like piped gas')}</label>
        <Choice label={t('Piped gas in the street?')} value={yn(s.gas.exists.value)} onChange={(k) => set({ gas: { ...s.gas, exists: ynSet(k) } })} testId="w-gas" options={[['yes', t('yes')], ['no', t('no')], ['dk', t('I don’t know')]]} />
        {ask(s.gas.ask)}
      </fieldset>
    </>
  );
}

function SummaryStep({ t, d, saved }: { t: T; d: LotDraft; saved: string | null }) {
  const lot = d.lot, fig = lotFigures(lot);
  const model = useApp((s) => (s.info ? s.versions[s.info.designVersionId]?.present : undefined));
  const site = { site: { lot, region: d.region } };
  const sides = sunPerSide(site, SUN_DAYS.map((x) => sunDay(site, x.month, x.day)));
  const best = (k: 0 | 1) => [...sides].sort((a, b) => b.hours[k]! - a.hours[k]!)[0];
  const area = (v: number | null) => (v === null ? t('TO CONFIRM') : `${t.n(v, 1)} m²`);
  const groups = toConfirm(lot, model);
  return (
    <div className="lotcard" data-testid="lot-card">
      {saved && <p className="good" role="status" data-testid="lot-saved">{saved}</p>}
      <h3>{d.name || t('New project')}</h3>
      <p className="hint">{d.address}{d.region.city && !d.address.includes(d.region.city) ? ` · ${d.region.city}${d.region.state ? `/${d.region.state}` : ''}` : ''}</p>
      <div className="kgrid">
        <div><span>{t('Lot area')}</span><b data-testid="card-area">{t.n(fig.area, 2)} m²</b></div>
        <div><span>{t('Sides')}</span><b>{fig.sides.map((s) => t.n(s, 2)).join(' · ')} m</b></div>
        <div><span>{t('Buildable area')}</span><b>{t.n(fig.envelopeArea, 1)} m²</b></div>
        <div><span>{t('Maximum footprint (TO)')}</span><b>{area(fig.maxFootprint)}</b></div>
        <div><span>{t('Maximum total built area (CA)')}</span><b>{area(fig.maxBuilt)}</b></div>
        <div><span>{t('Minimum permeable area (TP)')}</span><b>{area(fig.minPermeable)}</b></div>
        <div><span>{t('Sun')}</span><b>{t('most winter sun: {side} ({h} h on 21/6)', { side: t(SIDE_NAME[best(0)!.role]).toLowerCase(), h: t.n(best(0)!.hours[0]!, 1) })}</b></div>
      </div>
      <h4>{t('Still to confirm, and with whom')}</h4>
      <ConfirmList t={t} groups={groups} testId="confirm-list" />
      <p className="hint">{t('Saving moves the project to the next stage, Start (the house catalogue comes in P2). The house is never moved by a lot change: if it falls outside the buildable area, the plan shows it in red.')}</p>
    </div>
  );
}

/* ---------------- pages ---------------- */

/** The house outlines of a design model, in lot coordinates. */
export function houseInLot(p: Project): P2[][] {
  const o = p.site.houseOrigin;
  return p.levels.filter((l) => l.plan && l.outline && planLevels(p).includes(l.id)).map((l) => {
    const r = l.outline!;
    return [[r.x0 + o.x, r.y0 + o.y], [r.x1 + o.x, r.y0 + o.y], [r.x1 + o.x, r.y1 + o.y], [r.x0 + o.x, r.y1 + o.y]] as P2[];
  });
}

/** The wizard on an existing project (the "Lot" step of the journey). */
export function LotWizardPage() {
  const t = useT();
  const info = useApp((s) => s.info)!;
  const model = useApp((s) => s.versions[s.info!.designVersionId]?.present);
  const note = useApp((s) => s.lotNote);
  const { saveLot, flash } = useApp.getState();
  const [saved, setSaved] = useState<string | null>(note);
  useEffect(() => { if (note) useApp.setState({ lotNote: null }); }, [note]);
  if (!model) return null;
  const initial: LotDraft = { name: info.name, address: model.site.address, lot: model.site.lot, region: model.site.region };
  return (
    <LotWizard key={info.id} mode="edit" initial={initial} house={houseInLot(model)} startAt={note ? 'summary' : undefined} saved={saved}
      onSave={async (d) => {
        const n = await saveLot({ address: d.address, lot: d.lot, region: d.region });
        const msg = n ? t('Lot saved in {n} versions. The checks have run again; nothing in the house was moved.', { n }) : t('Lot saved. Nothing had changed.');
        setSaved(msg); flash(msg);
      }} />
  );
}

/** "New project": the wizard first, then a simple starting house inside the buildable area. */
export function NewProjectPage() {
  const t = useT();
  const { go, flash } = useApp.getState();
  const initial: LotDraft = useMemo(() => {
    return { name: '', address: '', region: regionFor('', ''), lot: defaultLot('', '') };
  }, []);
  return (
    <div className="newpage">
      <header className="top">
        <button className="ghost back" onClick={() => go({ page: 'home' })} data-testid="home">← {t('Projects')}</button>
        <div className="brand"><div className="eyebrow">{t('New project')}</div><h1>{t('Your lot')}</h1></div>
        <span className="spacer" />
        <LangToggle />
      </header>
      <LotWizard mode="new" initial={initial} onSave={async (d) => {
        const model = starterModel({ project: d.name.trim(), address: d.address.trim(), region: d.region, lot: d.lot });
        const zone = cityInfo(d.region.city, d.region.state)?.climate.zone;
        const withZone: Project = zone ? { ...model, assumptions: { ...(model.assumptions ?? {}), zone } } : model;
        const now = new Date().toISOString();
        const info: ProjectFile = {
          schema: 'casabim-project/1', id: 'new', name: d.name.trim(), address: d.address.trim(), lot: lotSummary(withZone), program: {}, style: {},
          versions: [{ id: 'v1', name: 'Version 1', kind: 'design', file: 'versions/v1.json', original: 'originals/v1.json', edits: 0 }],
          designVersionId: 'v1', approvedVersionId: null, stage: 'start', language: useApp.getState().lang, includeInGit: false, created: now, updated: now,
        };
        const made = await api.importProject({ schema: 'casabim-export/1', project: info, files: { 'versions/v1.json': withZone, 'originals/v1.json': withZone } });
        useApp.setState({ lotNote: t('Lot saved. The project is at the Start stage; for now a simple house was placed inside the buildable area.') });
        flash(t('Project created.'));
        go({ page: 'project', id: made.id, tab: 'lot' });
      }} />
      <LegalFooter />
    </div>
  );
}

