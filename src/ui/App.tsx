import { Suspense, lazy, useEffect, useRef, type ReactNode } from 'react';
import { deleteOpening, resetLevel } from '../model/commands';
import { getEl } from '../model/geometry';
import { PLAN_LEVELS } from '../model/schema';
import { BASES, useApp, useProject, type Tool } from '../store';
import { AboutDialog, ChecksBar, PropertiesPanel } from './Panels';
import { PlanView } from './PlanView';

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
};

export function App() {
  const active = useApp((s) => s.active);
  const level = useApp((s) => s.level);
  const tool = useApp((s) => s.tool);
  const message = useApp((s) => s.message);
  const view = useApp((s) => s.view);
  const canUndo = useApp((s) => s.versions[s.active].past.length > 0);
  const canRedo = useApp((s) => s.versions[s.active].future.length > 0);
  const p = useProject();
  const st = useApp.getState();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useApp.getState();
      const typing = e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !typing && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); return; }
      if (mod && !typing && e.key.toLowerCase() === 'y') { e.preventDefault(); s.redo(); return; }
      if (typing) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.selection) {
        const el = getEl(s.versions[s.active].present, s.selection);
        if (el?.type === 'Opening') { e.preventDefault(); if (s.run(deleteOpening(el.id))) s.select(null); }
      }
      if (e.key === 'Escape') { s.select(null); s.setTool('select'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const save = () => {
    const blob = new Blob([JSON.stringify(p, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `casa-123-${p.meta.versionId}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const open = async (f: File | undefined) => {
    if (!f) return;
    try { st.openModel(JSON.parse(await f.text())); } catch { st.flash('That file is not a Casa 123 model. Nothing was changed.'); }
    if (fileRef.current) fileRef.current.value = '';
  };
  const setTool = (t: Tool) => st.setTool(tool === t ? 'select' : t);

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <div className="eyebrow">Casa 123 · Rua Alceu Maynardi Araújo, 123</div>
          <h1>Casa 123 BIM</h1>
        </div>
        <div className="seg" role="group" aria-label="Version">
          {(['v1', 'v2'] as const).map((v) => (
            <button key={v} aria-pressed={active === v} onClick={() => st.setVersion(v)}>{BASES[v].meta.version}</button>
          ))}
        </div>
        <span className="spacer" />
        <button onClick={() => fileRef.current?.click()}>Open model</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => open(e.target.files?.[0])} data-testid="open-file" />
        <button onClick={save}>Save model</button>
        <button className="ghost" onClick={() => st.setAbout(true)}>About</button>
      </header>

      <nav className="toolbar" aria-label="Tools">
        <ToolButton label="Select" pressed={tool === 'select'} onClick={() => st.setTool('select')}>{ICONS.select}</ToolButton>
        <ToolButton label="Add door" pressed={tool === 'door'} onClick={() => setTool('door')}>{ICONS.door}</ToolButton>
        <ToolButton label="Add window" pressed={tool === 'window'} onClick={() => setTool('window')}>{ICONS.window}</ToolButton>
        <hr />
        <ToolButton label="Undo" onClick={st.undo} disabled={!canUndo} testId="undo">{ICONS.undo}</ToolButton>
        <ToolButton label="Redo" onClick={st.redo} disabled={!canRedo}>{ICONS.redo}</ToolButton>
        <hr />
        <ToolButton label="Reset floor" onClick={() => {
          if (st.run(resetLevel(level, BASES[active]))) st.flash(`This floor is back to the original ${BASES[active].meta.version}. Undo brings your edits back.`);
        }}>{ICONS.reset}</ToolButton>
      </nav>

      <main className="center">
        <div className="viewbar">
          <div className="seg" role="group" aria-label="View">
            {(['2d', '3d', 'split'] as const).map((v) => (
              <button key={v} aria-pressed={view === v} onClick={() => st.setView(v)} data-testid={`view-${v}`}>{v === 'split' ? 'Split' : v.toUpperCase()}</button>
            ))}
          </div>
          <div className="seg" role="tablist" aria-label="Floor">
            {PLAN_LEVELS.map((l) => (
              <button key={l} role="tab" aria-selected={level === l} aria-pressed={level === l} onClick={() => st.setLevel(l)}>
                {p.levels.find((x) => x.id === l)?.shortName}
              </button>
            ))}
          </div>
          <span className="hint">
            {tool === 'door' ? 'Click a wall to add a door.' : tool === 'window' ? 'Click an outside wall to add a window.' : 'Drag inside walls, doors and windows. Double-click a wall to add an opening.'}
          </span>
        </div>
        <div className={'views ' + view}>
          {view !== '3d' && <PlanView />}
          {view !== '2d' && <Suspense fallback={<div className="scene3d loading">Loading 3D…</div>}><Scene3D /></Suspense>}
        </div>
        <div className="flash" role="status" aria-live="polite">{message}</div>
      </main>

      <PropertiesPanel />
      <ChecksBar />
      <AboutDialog />
    </div>
  );
}
