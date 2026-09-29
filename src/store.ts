// App state: one undo history per version, the current floor, selection and UI flags.
import { create } from 'zustand';
import v1json from '../model/casa-123-v1.json';
import v2json from '../model/casa-123.json';
import { CommandError, replaceProject, type Command } from './model/commands';
import { migrate } from './model/migrate';
import { commit, initHist, redo, runCmd, undo, type Hist } from './model/history';
import { PLAN_LEVELS, parseProject, type PlanLevel, type Project } from './model/schema';

export type VersionId = 'v1' | 'v2';
export type Tool = 'select' | 'door' | 'window';

export const BASES: Record<VersionId, Project> = { v1: parseProject(v1json), v2: parseProject(v2json) };

const KEY = { model: (v: VersionId) => `casa123bim.model.${v}`, ui: 'casa123bim.ui' };

function readStored(v: VersionId): Project {
  try {
    const raw = localStorage.getItem(KEY.model(v));
    if (raw) return migrate(parseProject(JSON.parse(raw)), BASES[v]);
  } catch { /* fall back to the committed model */ }
  return BASES[v];
}

function readUi(): { active: VersionId; level: PlanLevel } {
  try {
    const ui = JSON.parse(localStorage.getItem(KEY.ui) ?? '{}') as { active?: string; level?: string };
    return {
      active: ui.active === 'v1' ? 'v1' : 'v2',
      level: (PLAN_LEVELS as readonly string[]).includes(ui.level ?? '') ? (ui.level as PlanLevel) : 'SL',
    };
  } catch { return { active: 'v2', level: 'SL' }; }
}

export interface AppState {
  versions: Record<VersionId, Hist>;
  active: VersionId;
  level: PlanLevel;
  selection: string | null;
  tool: Tool;
  /** A drag in progress: the project as it would be if the drag ended now. */
  preview: Project | null;
  message: string;
  checksOpen: boolean;
  checksScope: 'level' | 'all';
  aboutOpen: boolean;

  run(cmd: Command): boolean;
  previewCmd(cmd: Command): void;
  commitPreview(): void;
  cancelPreview(): void;
  undo(): void;
  redo(): void;
  setVersion(v: VersionId): void;
  setLevel(l: PlanLevel): void;
  select(id: string | null): void;
  setTool(t: Tool): void;
  flash(msg: string): void;
  openModel(data: unknown): void;
  setChecksOpen(open: boolean): void;
  setChecksScope(s: 'level' | 'all'): void;
  setAbout(open: boolean): void;
}

let flashTimer: ReturnType<typeof setTimeout> | undefined;

export const useApp = create<AppState>((set, get) => {
  const hist = () => get().versions[get().active];
  const setHist = (h: Hist, extra: Partial<AppState> = {}) =>
    set((s) => ({ versions: { ...s.versions, [s.active]: h }, ...extra }));
  const fail = (e: unknown) => {
    if (e instanceof CommandError) { get().flash(e.message); return false; }
    throw e;
  };
  const ui = readUi();
  return {
    versions: { v1: initHist(readStored('v1')), v2: initHist(readStored('v2')) },
    active: ui.active,
    level: ui.level,
    selection: null,
    tool: 'select',
    preview: null,
    message: '',
    checksOpen: false,
    checksScope: 'level',
    aboutOpen: false,

    run(cmd) {
      try {
        const h = runCmd(hist(), cmd);
        if (h === hist()) return false;
        setHist(h);
        return true;
      } catch (e) { return fail(e); }
    },
    previewCmd(cmd) {
      try { set({ preview: cmd.apply(hist().present) }); } catch (e) { fail(e); }
    },
    commitPreview() {
      const p = get().preview;
      if (p) setHist(commit(hist(), p), { preview: null });
    },
    cancelPreview() { set({ preview: null }); },
    undo() { const h = undo(hist()); if (h !== hist()) setHist(h, { selection: null, preview: null }); },
    redo() { const h = redo(hist()); if (h !== hist()) setHist(h, { selection: null, preview: null }); },
    setVersion(v) {
      if (v === get().active) return;
      set({ active: v, selection: null, preview: null });
      get().flash(`${BASES[v].meta.version} loaded. Your edits to each version are kept separately.`);
    },
    setLevel(l) { set({ level: l, selection: null, preview: null }); },
    select(id) { set({ selection: id }); },
    setTool(t) { set({ tool: t }); },
    flash(msg) {
      set({ message: msg });
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { if (get().message === msg) set({ message: '' }); }, 3500);
    },
    openModel(data) {
      let p: Project;
      try { p = parseProject(data); p = migrate(p, BASES[p.meta.versionId]); } catch {
        get().flash('That file is not a Casa 123 model. Nothing was changed.');
        return;
      }
      const v = p.meta.versionId;
      set({ active: v, selection: null, preview: null });
      setHist(runCmd(get().versions[v], replaceProject(p)));
      get().flash(`Opened ${p.meta.version}. Undo brings the previous model back.`);
    },
    setChecksOpen(open) { set({ checksOpen: open }); },
    setChecksScope(s) { set({ checksScope: s }); },
    setAbout(open) { set({ aboutOpen: open }); },
  };
});

/** The project every view should draw: the drag preview while dragging, otherwise the saved one. */
export const useProject = () => useApp((s) => s.preview ?? s.versions[s.active].present);

// Autosave to this browser.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
useApp.subscribe((s, prev) => {
  if (s.versions === prev.versions && s.active === prev.active && s.level === prev.level) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      for (const v of ['v1', 'v2'] as const) {
        if (s.versions[v].present !== BASES[v] || localStorage.getItem(KEY.model(v))) {
          localStorage.setItem(KEY.model(v), JSON.stringify(s.versions[v].present));
        }
      }
      localStorage.setItem(KEY.ui, JSON.stringify({ active: s.active, level: s.level }));
    } catch { /* storage full or blocked: the model still lives in memory */ }
  }, 250);
});
