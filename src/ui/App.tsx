import { Suspense, lazy, useEffect, useRef, type ReactNode } from 'react';
import { deleteOpening, resetLevel } from '../model/commands';
import { deleteFeature } from '../model/eng/commands';
import { getEl } from '../model/geometry';
import { PLAN_LEVELS } from '../model/schema';
import { BASES, VERSION_IDS, useApp, useProject, type Tool } from '../store';
import { AboutDialog, ChecksBar, PropertiesPanel } from './Panels';
import { PlanView } from './PlanView';
import { PlumbingDialog } from './PlumbingDialog';
import { ElectricalDialog } from './ElectricalDialog';
import { EngineeringDialog } from './EngineeringDialog';
import { FEATURE_TYPES } from '../model/eng/features';

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

export function App() {
  const active = useApp((s) => s.active);
  const level = useApp((s) => s.level);
  const tool = useApp((s) => s.tool);
  const featureKind = useApp((s) => s.featureKind);
  const message = useApp((s) => s.message);
  const view = useApp((s) => s.view);
  const plumbing2d = useApp((s) => s.plumbing2d);
  const elec2d = useApp((s) => s.elec2d);
  const physics = useApp((s) => s.physics);
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
        const el = getEl(s.versions[s.active]!.present, s.selection);
        if (el?.type === 'Opening') { e.preventDefault(); if (s.run(deleteOpening(el.id))) s.select(null); }
        if (el?.type === 'Feature') { e.preventDefault(); if (s.run(deleteFeature(el.id))) s.select(null); }
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
          {VERSION_IDS.map((v) => (
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
        <ToolButton label="Add outlet" pressed={tool === 'outlet'} onClick={() => { setTool('outlet'); st.set3d({ elec2d: true }); }} testId="tool-outlet">{ICONS.outlet}</ToolButton>
        <hr />
        <ToolButton label="Undo" onClick={st.undo} disabled={!canUndo} testId="undo">{ICONS.undo}</ToolButton>
        <ToolButton label="Redo" onClick={st.redo} disabled={!canRedo}>{ICONS.redo}</ToolButton>
        <hr />
        <ToolButton label="Plumbing" onClick={() => st.set3d({ plumbingOpen: true })} testId="plumbing">{ICONS.plumbing}</ToolButton>
        <ToolButton label="Electrical" onClick={() => st.set3d({ electricalOpen: true })} testId="electrical">{ICONS.electrical}</ToolButton>
        <ToolButton label="Engineering" onClick={() => st.set3d({ engineeringOpen: true })} testId="engineering">{ICONS.engineering}</ToolButton>
        <ToolButton label="Features" pressed={tool === 'feature'} onClick={() => st.placeFeature(tool === 'feature' ? null : featureKind ?? 'brise')} testId="features">{ICONS.features}</ToolButton>
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
          {view !== '3d' && (
            <label className="check">
              <input type="checkbox" checked={plumbing2d} onChange={(e) => st.set3d({ plumbing2d: e.target.checked })} data-testid="plumbing2d" /> Plumbing
            </label>
          )}
          {view !== '3d' && (
            <label className="check">
              <input type="checkbox" checked={elec2d} onChange={(e) => st.set3d({ elec2d: e.target.checked })} data-testid="elec2d" /> Electrical
            </label>
          )}
          {view !== '3d' && (plumbing2d || elec2d) && (
            <label className="check" title="Colour each pipe and conduit by the space that holds it; red = floating">
              <input type="checkbox" checked={physics} onChange={(e) => st.set3d({ physics: e.target.checked })} data-testid="physics2d" /> Physics colours
            </label>
          )}
          <span className="hint">
            {tool === 'feature' && featureKind ? `${FEATURE_TYPES.find((f) => f.kind === featureKind)!.label}: ${FEATURE_TYPES.find((f) => f.kind === featureKind)!.hint} (works in 2D and 3D; Esc to stop)` : tool === 'door' ? 'Click a wall to add a door.' : tool === 'window' ? 'Click an outside wall to add a window.' : tool === 'outlet' ? 'Click in a room to add an outlet on its nearest wall.' : 'Drag inside walls, doors and windows. Double-click a wall to add an opening.'}
          </span>
        </div>
        {tool === 'feature' && (
          <div className="palette" role="toolbar" aria-label="Features" data-testid="feature-palette">
            {FEATURE_TYPES.map((f) => (
              <button key={f.kind} className="small" aria-pressed={featureKind === f.kind} onClick={() => st.placeFeature(f.kind)} title={f.effect} data-testid={`feature-${f.kind}`}>{f.label}</button>
            ))}
          </div>
        )}
        <div className={'views ' + view}>
          {view !== '3d' && <PlanView />}
          {view !== '2d' && <Suspense fallback={<div className="scene3d loading">Loading 3D…</div>}><Scene3D /></Suspense>}
        </div>
        <div className="flash" role="status" aria-live="polite">{message}</div>
      </main>

      <PropertiesPanel />
      <ChecksBar />
      <AboutDialog />
      <PlumbingDialog />
      <ElectricalDialog />
      <EngineeringDialog />
    </div>
  );
}
