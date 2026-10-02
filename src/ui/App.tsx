import { Suspense, lazy, useEffect, useRef, type ReactNode } from 'react';
import { deleteOpening, renameSpace, resetLevel } from '../model/commands';
import { deleteFeature } from '../model/eng/commands';
import { byLevel, getEl, spaceArea } from '../model/geometry';
import { planLevels } from '../model/schema';
import { parseRoute, useApp, useProject, type Tool } from '../store';
import { useT } from '../i18n/useT';
import { AboutDialog, ChecksBar, OpeningProps, PropertiesPanel } from './Panels';
import { PlanView, ZONE_COLOR } from './PlanView';
import { PlumbingDialog } from './PlumbingDialog';
import { ElectricalDialog } from './ElectricalDialog';
import { EngineeringDialog } from './EngineeringDialog';
import { FEATURE_TYPES } from '../model/eng/features';
import { Home } from './Home';
import { LotWizardPage, NewProjectPage } from './LotWizard';
import { AiIndicator, ApprovalBar, EnvelopeBanner, LangToggle, SaveIndicator, Stepper, Tabs } from './Shell';
import { AiPanel } from './AiPanel';
import { DevPanel } from './DevPanel';
import { LegalFooter } from './LegalFooter';

const Scene3D = lazy(() => import('./Scene3D'));

function ToolButton({ label, pressed, onClick, disabled, children, testId }: {
  label: string; pressed?: boolean; onClick: () => void; disabled?: boolean; children: ReactNode; testId?: string;
}) {
  return (
    <button className="tool" title={label} aria-label={label} aria-pressed={pressed} onClick={onClick} disabled={disabled} data-testid={testId}>
      {children}<span>{label}</span>
    </button>
  );
}

const icon = (d: string) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;
const ICONS = {
  select: icon('M5 3l13 8-6 1.5L9 19z'),
  door: icon('M5 20V4h8v16M13 4a8 8 0 0 1 6 12'),
  window: icon('M4 12h16M4 9h16v6H4z'),
  undo: icon('M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-3'),
  redo: icon('M15 7l5 5-5 5M20 12H9a5 5 0 0 0 0 10h3'),
  reset: icon('M4 4v6h6M5 10a8 8 0 1 1-1 5'),
  outlet: icon('M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9 9v3M15 9v3M9 16h6'),
  electrical: icon('M13 2L4 14h7l-1 8 9-12h-7z'),
  plumbing: icon('M5 4v6a4 4 0 0 0 4 4h6a4 4 0 0 1 4 4v2M3 4h4M17 20h4'),
  engineering: icon('M4 20h16M6 20V9l6-5 6 5v11M9 20v-6h6v6M6 12h12'),
  features: icon('M4 8h16M4 12h16M4 16h16M8 4v16'),
};

/** Keyboard: undo/redo, delete the selected door/window/feature, Esc, and the hidden developer panel. */
function useKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useApp.getState();
      if (!s.info || !s.versions[s.active]) return;
      const typing = e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); s.setPanel({ devOpen: !s.devOpen }); return; }
      if (mod && !typing && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); return; }
      if (mod && !typing && e.key.toLowerCase() === 'y') { e.preventDefault(); s.redo(); return; }
      if (typing) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.selection) {
        const el = getEl(s.versions[s.active]!.present, s.selection);
        const design = s.route.page === 'project' && s.route.tab === 'design';
        if (el?.type === 'Opening' && design) { e.preventDefault(); if (s.run(deleteOpening(el.id))) s.select(null); }
        if (el?.type === 'Feature' && s.route.page === 'project' && s.route.tab === 'bim') { e.preventDefault(); if (s.run(deleteFeature(el.id))) s.select(null); }
      }
      if (e.key === 'Escape') { s.select(null); s.setTool('select'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function ModelFileButtons() {
  const t = useT();
  const p = useProject();
  const info = useApp((s) => s.info);
  const fileRef = useRef<HTMLInputElement>(null);
  const st = useApp.getState();
  const save = () => {
    const blob = new Blob([JSON.stringify(p, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${info?.id ?? 'model'}-${p.meta.versionId}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const open = async (f: File | undefined) => {
    if (!f) return;
    try { st.openModel(JSON.parse(await f.text())); } catch { st.flash(t('That file is not a model of this app. Nothing was changed.')); }
    if (fileRef.current) fileRef.current.value = '';
  };
  return (
    <>
      <button className="small" onClick={() => fileRef.current?.click()}>{t('Open model')}</button>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => open(e.target.files?.[0])} data-testid="open-file" />
      <button className="small" onClick={save}>{t('Save model')}</button>
    </>
  );
}

function Header() {
  const t = useT();
  const info = useApp((s) => s.info)!;
  const { go, setAbout } = useApp.getState();
  return (
    <header className="top">
      <button className="ghost back" onClick={() => go({ page: 'home' })} data-testid="home">← {t('Projects')}</button>
      <div className="brand">
        <div className="eyebrow">{info.address}</div>
        <h1 data-testid="project-name">{info.name}</h1>
      </div>
      <Tabs />
      <Stepper />
      <span className="spacer" />
      <SaveIndicator />
      <AiIndicator />
      <LangToggle />
      <ModelFileButtons />
      <button className="ghost small" onClick={() => setAbout(true)}>{t('About')}</button>
    </header>
  );
}

function ViewBar({ children }: { children?: ReactNode }) {
  const t = useT();
  const p = useProject();
  const view = useApp((s) => s.view);
  const level = useApp((s) => s.level);
  const st = useApp.getState();
  return (
    <>
      <div className="seg" role="group" aria-label={t('View')}>
        {(['2d', '3d', 'split'] as const).map((v) => (
          <button key={v} aria-pressed={view === v} onClick={() => st.setView(v)} data-testid={`view-${v}`}>{v === 'split' ? t('Split') : v.toUpperCase()}</button>
        ))}
      </div>
      <div className="seg" role="tablist" aria-label={t('Floor')}>
        {planLevels(p).map((l) => (
          <button key={l} role="tab" aria-selected={level === l} aria-pressed={level === l} onClick={() => st.setLevel(l)}>
            {p.levels.find((x) => x.id === l)?.shortName}
          </button>
        ))}
      </div>
      {children}
    </>
  );
}

function Views({ style }: { style: 'design' | 'bim' }) {
  const t = useT();
  const view = useApp((s) => s.view);
  return (
    <div className={'views ' + view}>
      {view !== '3d' && <PlanView style={style} />}
      {view !== '2d' && <Suspense fallback={<div className="scene3d loading">{t('Loading 3D…')}</div>}><Scene3D style={style} /></Suspense>}
    </div>
  );
}

function DesignVersions() {
  const t = useT();
  const info = useApp((s) => s.info)!;
  const active = useApp((s) => s.active);
  const setVersion = useApp((s) => s.setVersion);
  const designs = info.versions.filter((v) => v.kind === 'design');
  if (designs.length < 2) return null;
  return (
    <div className="seg" role="group" aria-label={t('Version')} data-testid="versions">
      {designs.map((v) => <button key={v.id} aria-pressed={active === v.id} onClick={() => setVersion(v.id)}>{t(v.name)}</button>)}
    </div>
  );
}

/** DESIGN side panel: the rooms of the floor (names and areas), the selected room's name, and the approval. */
function DesignPanel() {
  const t = useT();
  const p = useProject();
  const level = useApp((s) => s.level);
  const selection = useApp((s) => s.selection);
  const info = useApp((s) => s.info)!;
  const { select, run, approve, setTab } = useApp.getState();
  const rooms = byLevel(p, level, 'Space').filter((s) => s.props.zone !== 'stair');
  const sel = selection ? getEl(p, selection) : undefined;
  const total = byLevel(p, level, 'Space').reduce((a, s) => a + spaceArea(s), 0);
  const lv = p.levels.find((l) => l.id === level);
  return (
    <aside className="props design" aria-label={t('Rooms')}>
      <div className="phead"><div><h3>{lv?.name}</h3><div className="eyebrow" data-testid="gross">{t(info.versions.find((v) => v.id === p.meta.versionId)?.name ?? p.meta.version)} · {t.n(total, 1)} m²</div></div></div>
      <ul className="roomlist">
        {rooms.map((s) => (
          <li key={s.id}>
            <button className={selection === s.id ? 'sel' : ''} onClick={() => select(s.id)}>
              <i style={{ background: ZONE_COLOR[s.props.zone] }} /><span>{s.props.name}</span><b>{t.n(spaceArea(s), 1)} m²</b>
            </button>
          </li>
        ))}
      </ul>
      {sel?.type === 'Opening' && <OpeningProps p={p} op={sel} />}
      {sel?.type === 'Space' && (
        <label className="field">
          <span>{t('Name')}</span>
          <input key={sel.id + sel.props.name} defaultValue={sel.props.name} onBlur={(e) => { if (e.target.value !== sel.props.name) run(renameSpace(sel.id, e.target.value)); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} data-testid="design-room-name" />
        </label>
      )}
      <p className="hint">{t('Drag an inside wall to resize the rooms on both sides. Drag a door or window along its wall. Double-click a wall to add a door or a window. Undo takes anything back.')}</p>
      <div className="approvebox">
        <button className="strong" onClick={async () => { if (await approve()) setTab('bim'); }} data-testid="approve">
          {info.approvedVersionId ? t('Re-approve design') : t('Approve design')}
        </button>
        <p className="hint">{t('Approving freezes a named copy of this design. The BIM tab (engineering, systems, estimates) works on it.')}</p>
      </div>
    </aside>
  );
}

function Workspace() {
  const t = useT();
  const loading = useApp((s) => s.loading);
  const info = useApp((s) => s.info);
  const has = useApp((s) => !!s.versions[s.active]);
  const tab = useApp((s) => (s.route.page === 'project' ? s.route.tab : 'design'));
  const message = useApp((s) => s.message);
  if (loading || !info || !has) return <div className="loadingpage">{t('Opening the project…')}<div className="flash">{message}</div></div>;
  return (
    <div className={'app tab-' + tab}>
      <Header />
      {tab !== 'lot' && <ApprovalBar />}
      {tab === 'lot' ? <LotWizardPage /> : tab === 'design' ? <DesignWorkspace /> : <BimWorkspace />}
      <LegalFooter />
      <AboutDialog />
      <AiPanel />
      <DevPanel />
    </div>
  );
}

function DesignWorkspace() {
  const t = useT();
  const tool = useApp((s) => s.tool);
  const message = useApp((s) => s.message);
  const canUndo = useApp((s) => s.versions[s.active]!.past.length > 0);
  const canRedo = useApp((s) => s.versions[s.active]!.future.length > 0);
  const st = useApp.getState();
  const setTool = (x: Tool) => st.setTool(tool === x ? 'select' : x);
  return (
    <>
      <nav className="toolbar" aria-label={t('Tools')}>
        <ToolButton label={t('Select')} pressed={tool === 'select'} onClick={() => st.setTool('select')}>{ICONS.select}</ToolButton>
        <ToolButton label={t('Add door')} pressed={tool === 'door'} onClick={() => setTool('door')}>{ICONS.door}</ToolButton>
        <ToolButton label={t('Add window')} pressed={tool === 'window'} onClick={() => setTool('window')}>{ICONS.window}</ToolButton>
        <hr />
        <ToolButton label={t('Undo')} onClick={st.undo} disabled={!canUndo} testId="undo">{ICONS.undo}</ToolButton>
        <ToolButton label={t('Redo')} onClick={st.redo} disabled={!canRedo}>{ICONS.redo}</ToolButton>
      </nav>
      <main className="center">
        <div className="viewbar">
          <DesignVersions />
          <ViewBar>
            <span className="hint">{tool === 'door' ? t('Click a wall to add a door.') : tool === 'window' ? t('Click an outside wall to add a window.') : t('Drag inside walls, doors and windows. Double-click a wall to add an opening.')}</span>
          </ViewBar>
        </div>
        <EnvelopeBanner />
        <Views style="design" />
        <div className="flash" role="status" aria-live="polite">{message}</div>
      </main>
      <DesignPanel />
    </>
  );
}

function BimWorkspace() {
  const t = useT();
  const level = useApp((s) => s.level);
  const tool = useApp((s) => s.tool);
  const featureKind = useApp((s) => s.featureKind);
  const message = useApp((s) => s.message);
  const view = useApp((s) => s.view);
  const plumbing2d = useApp((s) => s.plumbing2d);
  const elec2d = useApp((s) => s.elec2d);
  const physics = useApp((s) => s.physics);
  const canUndo = useApp((s) => s.versions[s.active]!.past.length > 0);
  const canRedo = useApp((s) => s.versions[s.active]!.future.length > 0);
  const base = useApp((s) => s.bases[s.active]);
  const st = useApp.getState();
  const setTool = (x: Tool) => st.setTool(tool === x ? 'select' : x);
  const ft = featureKind ? FEATURE_TYPES.find((f) => f.kind === featureKind) : undefined;
  return (
    <>
      <nav className="toolbar" aria-label={t('Tools')}>
        <ToolButton label={t('Select')} pressed={tool === 'select'} onClick={() => st.setTool('select')}>{ICONS.select}</ToolButton>
        <ToolButton label={t('Add outlet')} pressed={tool === 'outlet'} onClick={() => { setTool('outlet'); st.set3d({ elec2d: true }); }} testId="tool-outlet">{ICONS.outlet}</ToolButton>
        <hr />
        <ToolButton label={t('Undo')} onClick={st.undo} disabled={!canUndo} testId="undo">{ICONS.undo}</ToolButton>
        <ToolButton label={t('Redo')} onClick={st.redo} disabled={!canRedo}>{ICONS.redo}</ToolButton>
        <hr />
        <ToolButton label={t('Plumbing')} onClick={() => st.set3d({ plumbingOpen: true })} testId="plumbing">{ICONS.plumbing}</ToolButton>
        <ToolButton label={t('Electrical')} onClick={() => st.set3d({ electricalOpen: true })} testId="electrical">{ICONS.electrical}</ToolButton>
        <ToolButton label={t('Engineering')} onClick={() => st.set3d({ engineeringOpen: true })} testId="engineering">{ICONS.engineering}</ToolButton>
        <ToolButton label={t('Features')} pressed={tool === 'feature'} onClick={() => st.placeFeature(tool === 'feature' ? null : featureKind ?? 'brise')} testId="features">{ICONS.features}</ToolButton>
        <hr />
        <ToolButton label={t('Reset floor')} disabled={!base} onClick={() => {
          if (base && st.run(resetLevel(level, base))) st.flash(t('This floor is back to the approved version. Undo brings your edits back.'));
        }}>{ICONS.reset}</ToolButton>
      </nav>

      <main className="center">
        <div className="viewbar">
          <ViewBar>
            {view !== '3d' && (
              <label className="check">
                <input type="checkbox" checked={plumbing2d} onChange={(e) => st.set3d({ plumbing2d: e.target.checked })} data-testid="plumbing2d" /> {t('Plumbing')}
              </label>
            )}
            {view !== '3d' && (
              <label className="check">
                <input type="checkbox" checked={elec2d} onChange={(e) => st.set3d({ elec2d: e.target.checked })} data-testid="elec2d" /> {t('Electrical')}
              </label>
            )}
            {view !== '3d' && (plumbing2d || elec2d) && (
              <label className="check" title={t('Colour each pipe and conduit by the space that holds it; red = floating')}>
                <input type="checkbox" checked={physics} onChange={(e) => st.set3d({ physics: e.target.checked })} data-testid="physics2d" /> {t('Physics colours')}
              </label>
            )}
            <span className="hint">
              {tool === 'feature' && ft ? `${ft.label}: ${ft.hint} (${t('works in 2D and 3D; Esc to stop')})` : tool === 'outlet' ? t('Click in a room to add an outlet on its nearest wall.') : t('Click anything to see it. Walls, doors and windows are edited in the DESIGN tab.')}
            </span>
          </ViewBar>
        </div>
        {tool === 'feature' && (
          <div className="palette" role="toolbar" aria-label={t('Features')} data-testid="feature-palette">
            {FEATURE_TYPES.map((f) => (
              <button key={f.kind} className="small" aria-pressed={featureKind === f.kind} onClick={() => st.placeFeature(f.kind)} title={f.effect} data-testid={`feature-${f.kind}`}>{f.label}</button>
            ))}
          </div>
        )}
        <EnvelopeBanner />
        <Views style="bim" />
        <div className="flash" role="status" aria-live="polite">{message}</div>
      </main>

      <PropertiesPanel />
      <ChecksBar />
      <PlumbingDialog />
      <ElectricalDialog />
      <EngineeringDialog />
    </>
  );
}

export function App() {
  useKeys();
  const route = useApp((s) => s.route);
  const lang = useApp((s) => s.lang);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  useEffect(() => {
    // first load: the address decides; with none, the last project opened (else the list)
    const r = parseRoute(location.hash);
    let last: string | null = null;
    try { last = localStorage.getItem('casabim.last'); } catch { /* ignore */ }
    if (new URLSearchParams(location.search).has('dev')) useApp.getState().setPanel({ devOpen: true });
    if (r.page !== 'home') useApp.getState().go(r);
    else if (!location.hash && last) useApp.getState().go({ page: 'project', id: last, tab: 'design' });
    else useApp.getState().go({ page: 'home' });
  }, []);
  return route.page === 'home' ? <Home /> : route.page === 'new' ? <NewProjectPage /> : <Workspace />;
}
