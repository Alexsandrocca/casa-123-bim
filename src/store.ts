// App state: one undo history per version, the current floor, selection and UI flags.
import { create } from 'zustand';
import v1json from '../model/casa-123-v1.json';
import v2json from '../model/casa-123.json';
import v3json from '../model/casa-123-v3.json';
import { CommandError, replaceProject, type Command } from './model/commands';
import { migrate } from './model/migrate';
import { commit, initHist, redo, runCmd, undo, type Hist } from './model/history';
import { PLAN_LEVELS, parseProject, type PlanLevel, type Project } from './model/schema';

export type VersionId = 'v1' | 'v2' | 'v3';
export const VERSION_IDS: VersionId[] = ['v1', 'v2', 'v3'];
export type Tool = 'select' | 'door' | 'window';
export type ViewMode = '2d' | '3d' | 'split';
export type CameraPreset = 'street' | 'garden' | 'ramp' | 'top';
export interface Section { h: 'off' | 'LL' | 'SL' | 'UF'; v: 'off' | 'across' | 'along'; pos: number }
export interface SunTime { month: number; day: number; hour: number }

export const BASES: Record<VersionId, Project> = { v1: parseProject(v1json), v2: parseProject(v2json), v3: parseProject(v3json) };

const KEY = { model: (v: VersionId) => `casa123bim.model.${v}`, ui: 'casa123bim.ui.3' };

function readStored(v: VersionId): Project {
  try {
    const raw = localStorage.getItem(KEY.model(v));
    if (raw) return migrate(parseProject(JSON.parse(raw)), BASES[v]);
  } catch { /* fall back to the committed model */ }
  return BASES[v];
}

function readUi(): { active: VersionId; level: PlanLevel; view: ViewMode } {
  try {
    const ui = JSON.parse(localStorage.getItem(KEY.ui) ?? '{}') as { active?: string; level?: string; view?: string };
    return {
      active: ui.active === 'v1' || ui.active === 'v2' ? ui.active : 'v3',
      level: (PLAN_LEVELS as readonly string[]).includes(ui.level ?? '') ? (ui.level as PlanLevel) : 'SL',
      view: ui.view === '3d' || ui.view === 'split' ? ui.view : '2d',
    };
  } catch { return { active: 'v3', level: 'SL', view: '2d' }; }
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
  view: ViewMode;
  doorsOpen: boolean;
  /** 3D: building ghosted so the pipes show. */
  xray: boolean;
  /** 2D: draw the plumbing on the plan. */
  plumbing2d: boolean;
  plumbingOpen: boolean;
  walk: boolean;
  camera: { preset: CameraPreset; n: number; pos?: [number, number, number]; target?: [number, number, number] };
  section: Section;
  sun: SunTime;

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
  setView(v: ViewMode): void;
  set3d(patch: Partial<Pick<AppState, 'doorsOpen' | 'walk' | 'section' | 'sun' | 'xray' | 'plumbing2d' | 'plumbingOpen'>>): void;
  goCamera(preset: CameraPreset): void;
  /** Point the camera from pos to target (house coordinates). */
  lookFrom(pos: [number, number, number], target: [number, number, number]): void;
  /** Select from the 3D view: also shows the element's floor in 2D. */
  pick(id: string | null): void;
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
    versions: { v1: initHist(readStored('v1')), v2: initHist(readStored('v2')), v3: initHist(readStored('v3')) },
    active: ui.active,
    level: ui.level,
    selection: null,
    tool: 'select',
    preview: null,
    message: '',
    checksOpen: false,
    checksScope: 'level',
    aboutOpen: false,
    view: ui.view,
    doorsOpen: false,
    xray: false,
    plumbing2d: false,
    plumbingOpen: false,
    walk: false,
    camera: { preset: 'street', n: 0 },
    section: { h: 'off', v: 'off', pos: 6 },
    sun: { month: 6, day: 21, hour: 9 },

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
    setView(v) { set({ view: v, walk: v === '2d' ? false : get().walk }); },
    set3d(patch) { set(patch); },
    goCamera(preset) { set((s) => ({ camera: { preset, n: s.camera.n + 1 }, walk: false })); },
    lookFrom(pos, target) { set((s) => ({ camera: { preset: s.camera.preset, n: s.camera.n + 1, pos, target }, walk: false })); },
    pick(id) {
      if (!id) { set({ selection: null }); return; }
      const el = hist().present.elements.find((e) => e.id === id);
      const lv = el && (PLAN_LEVELS as readonly string[]).includes(el.level) ? (el.level as PlanLevel) : get().level;
      set({ selection: id, level: lv });
    },
  };
});

/** The project every view should draw: the drag preview while dragging, otherwise the saved one. */
export const useProject = () => useApp((s) => s.preview ?? s.versions[s.active].present);

// Autosave to this browser.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
useApp.subscribe((s, prev) => {
  if (s.versions === prev.versions && s.active === prev.active && s.level === prev.level && s.view === prev.view) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      for (const v of VERSION_IDS) {
        if (s.versions[v].present !== BASES[v] || localStorage.getItem(KEY.model(v))) {
          localStorage.setItem(KEY.model(v), JSON.stringify(s.versions[v].present));
        }
      }
      localStorage.setItem(KEY.ui, JSON.stringify({ active: s.active, level: s.level, view: s.view }));
    } catch { /* storage full or blocked: the model still lives in memory */ }
  }, 250);
});
