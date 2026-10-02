// Home = Projects: the list, New project, Open, Duplicate, Delete (with a confirmation step), Import.
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { useT } from '../i18n/useT';
import type { ProjectFile } from '../model/project-file';
import { starterModel } from '../model/starter';
import type { Compass } from '../model/orientation';
import { lotSummary, useApp } from '../store';
import { ZONE_COLOR } from './PlanView';
import { LegalFooter } from './LegalFooter';
import { LangToggle } from './Shell';

const STAGE_LABEL: Record<ProjectFile['stage'], string> = { lot: 'Lot', start: 'Start', plans: 'Plans', '3d': '3D', approve: 'Approve', bim: 'BIM', outputs: 'Outputs' };

function Thumb({ p }: { p: ProjectFile }) {
  const th = p.thumb;
  if (!th) return <div className="thumb empty" aria-hidden="true" />;
  const xs = th.lot.map((c) => c[0]), ys = th.lot.map((c) => c[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = 1;
  // street at the bottom: flip y
  const Y = (y: number) => y1 + y0 - y;
  return (
    <svg className="thumb" viewBox={`${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`} aria-hidden="true">
      <polygon points={th.lot.map(([x, y]) => `${x},${Y(y)}`).join(' ')} className="th-lot" />
      {th.rooms.map(([a, b, c, d, z], i) => <rect key={i} x={a} y={Y(d)} width={c - a} height={d - b} style={{ fill: ZONE_COLOR[z as keyof typeof ZONE_COLOR] ?? '#ddd' }} className="th-room" />)}
    </svg>
  );
}

function NewProject({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [f, setF] = useState({ name: '', address: '', city: '', state: '', lat: '', lon: '', width: '12', depth: '30', street: 'S' as Compass });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const num = (v: string) => Number(v.replace(',', '.'));
  const valid = f.name.trim() && f.city.trim() && Number.isFinite(num(f.lat)) && f.lat !== '' && Number.isFinite(num(f.lon)) && f.lon !== '' && num(f.width) >= 8 && num(f.depth) >= 15;
  const create = async () => {
    setBusy(true); setErr('');
    try {
      const model = starterModel({
        project: f.name.trim(), address: f.address.trim(), city: f.city.trim(), state: f.state.trim().toUpperCase(),
        lat: num(f.lat), lon: num(f.lon), lotWidth: num(f.width), lotDepth: num(f.depth), street: f.street,
      });
      const now = new Date().toISOString();
      const info: ProjectFile = {
        schema: 'casabim-project/1', id: 'new', name: f.name.trim(), address: f.address.trim(), lot: lotSummary(model), program: {}, style: {},
        versions: [{ id: 'v1', name: 'Version 1', kind: 'design', file: 'versions/v1.json', original: 'originals/v1.json', edits: 0 }],
        designVersionId: 'v1', approvedVersionId: null, stage: 'plans', language: 'pt-BR', includeInGit: false, created: now, updated: now,
      };
      const made = await api.importProject({ schema: 'casabim-export/1', project: info, files: { 'versions/v1.json': model, 'originals/v1.json': model } });
      onDone();
      useApp.getState().go({ page: 'project', id: made.id, tab: 'design' });
    } catch (e) { setErr(e instanceof ApiError ? e.message : (e as Error).message); } finally { setBusy(false); }
  };
  const field = (k: keyof typeof f, label: string, hint?: string, inputMode?: 'decimal') => (
    <label className="nf">
      <span>{t(label)}</span>
      <input value={f[k]} inputMode={inputMode} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-testid={`new-${k}`} />
      {hint && <small className="hint">{t(hint)}</small>}
    </label>
  );
  return (
    <div className="newproj" data-testid="new-project-form">
      <h3>{t('New project')}</h3>
      <p className="hint">{t('A simple single-storey starting house on a flat rectangular lot. The lot wizard (P1) and the house catalogue (P2) come next.')}</p>
      <div className="nfgrid">
        {field('name', 'Name')}
        {field('address', 'Address')}
        {field('city', 'City')}
        {field('state', 'State (UF)')}
        {field('lat', 'Latitude', 'Google Maps: right-click the lot, copy the first number.', 'decimal')}
        {field('lon', 'Longitude', 'The second number.', 'decimal')}
        {field('width', 'Lot width at the street (m)', undefined, 'decimal')}
        {field('depth', 'Lot depth (m)', undefined, 'decimal')}
        <label className="nf">
          <span>{t('The street is on the lot’s')}</span>
          <select value={f.street} onChange={(e) => setF({ ...f, street: e.target.value as Compass })} data-testid="new-street">
            {(['N', 'E', 'S', 'W'] as const).map((c) => <option key={c} value={c}>{t({ N: 'north side', E: 'east side', S: 'south side', W: 'west side' }[c])}</option>)}
          </select>
        </label>
      </div>
      {err && <p className="bad">{err}</p>}
      <div className="btnrow">
        <button className="strong" disabled={!valid || busy} onClick={create} data-testid="create-project">{busy ? t('Creating…') : t('Create project')}</button>
        <button className="ghost" onClick={onDone}>{t('Cancel')}</button>
      </div>
    </div>
  );
}

export function Home() {
  const t = useT();
  const projects = useApp((s) => s.projects);
  const message = useApp((s) => s.message);
  const { loadProjects, go, flash } = useApp.getState();
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { void loadProjects(); }, [loadProjects]);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try { await fn(); flash(t(done)); await loadProjects(); } catch (e) { flash(e instanceof ApiError ? e.message : (e as Error).message); }
  };
  const exportOne = async (p: ProjectFile) => {
    const data = await api.exportProject(p.id);
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${p.id}.casabim.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try { const made = await api.importProject(JSON.parse(await file.text())); flash(t('Imported as “{name}”.', { name: made.name })); await loadProjects(); } catch (e) { flash(e instanceof ApiError ? e.message : t('That file is not a project export.')); }
    if (fileRef.current) fileRef.current.value = '';
  };
  const date = (iso: string) => new Date(iso).toLocaleString(t.lang === 'pt-BR' ? 'pt-BR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="home">
      <header className="hometop">
        <div>
          <div className="eyebrow">{t('Casa BIM · family edition')}</div>
          <h1>{t('Projects')}</h1>
        </div>
        <span className="spacer" />
        <LangToggle />
        <button onClick={() => fileRef.current?.click()}>{t('Import project')}</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => importFile(e.target.files?.[0])} />
        <button className="strong" onClick={() => setCreating(true)} data-testid="new-project">{t('New project')}</button>
      </header>
      <main className="homebody">
        {creating && <NewProject onDone={() => setCreating(false)} />}
        {projects === null && <p className="hint">{t('Loading…')}</p>}
        {projects?.length === 0 && <p className="hint">{t('No projects yet. Is the local server running?')}</p>}
        <ul className="plist" data-testid="project-list">
          {projects?.map((p) => (
            <li key={p.id} className="pcard" data-testid={`project-${p.id}`}>
              <button className="pthumb" onClick={() => go({ page: 'project', id: p.id, tab: 'design' })} aria-label={t('Open {name}', { name: p.name })}><Thumb p={p} /></button>
              <div className="pinfo">
                <h3>{p.name}</h3>
                <p className="hint">{p.address || '—'}</p>
                <p className="pmeta">
                  <span className="stagechip">{t(STAGE_LABEL[p.stage])}</span>
                  <span>{p.lot.city}{p.lot.state ? `/${p.lot.state}` : ''} · {t.n(p.lot.area, 0)} m²</span>
                  <span>{t('Last edit')}: {date(p.updated)}</span>
                </p>
                {confirm === p.id ? (
                  <div className="confirm" role="alert">
                    <span>{t('Delete “{name}” and all its versions? This cannot be undone.', { name: p.name })}</span>
                    <button className="danger" onClick={() => { setConfirm(null); void act(() => api.remove(p.id), 'Project deleted.'); }} data-testid="confirm-delete">{t('Delete')}</button>
                    <button className="ghost" onClick={() => setConfirm(null)}>{t('Cancel')}</button>
                  </div>
                ) : (
                  <div className="btnrow">
                    <button onClick={() => go({ page: 'project', id: p.id, tab: 'design' })} data-testid={`open-${p.id}`}>{t('Open')}</button>
                    <button onClick={() => void act(() => api.duplicate(p.id, `${p.name} (${t('copy')})`), 'Project duplicated.')}>{t('Duplicate')}</button>
                    <button onClick={() => void exportOne(p)}>{t('Export project')}</button>
                    <button className="ghost danger" onClick={() => setConfirm(p.id)} data-testid={`delete-${p.id}`}>{t('Delete')}</button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
        <div className="flash" role="status" aria-live="polite">{message}</div>
      </main>
      <LegalFooter />
    </div>
  );
}
