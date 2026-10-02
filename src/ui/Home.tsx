// Home = Projects: the list, New project, Open, Duplicate, Delete (with a confirmation step), Import.
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { useT } from '../i18n/useT';
import type { ProjectFile } from '../model/project-file';
import { useApp } from '../store';
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

export function Home() {
  const t = useT();
  const projects = useApp((s) => s.projects);
  const message = useApp((s) => s.message);
  const { loadProjects, go, flash } = useApp.getState();
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
        <button className="strong" onClick={() => go({ page: 'new' })} data-testid="new-project">{t('New project')}</button>
      </header>
      <main className="homebody">
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
