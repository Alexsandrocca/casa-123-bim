// App state: the open project, one undo history per version, the tab (DESIGN / BIM), the approval, and the UI flags.
// Projects live on disk through the local server; this browser keeps a copy only for speed and crash recovery.
import { create } from 'zustand';
import { api, ApiError } from './api';
import { CommandError, replaceProject, type Command } from './model/commands';
import { withMep } from './model/commands';
import { migrate, upgradeRaw } from './model/migrate';
import { commit, initHist, redo, runCmd, undo, type Hist } from './model/history';
import { parseProject, planLevels, entryLevel, type FeatureKind, type PlanLevel, type Project } from './model/schema';
import type { ProjectFile, VersionEntry } from './model/project-file';
import { syncThickness } from './model/eng/commands';
import type { Lang } from './i18n';

export type Tab = 'design' | 'bim';
export type Tool = 'select' | 'door' | 'window' | 'outlet' | 'feature';
export type EngTab = 'assumptions' | 'loads' | 'structure' | 'assemblies' | 'thermal' | 'environment' | 'cost';
export type ViewMode = '2d' | '3d' | 'split';
export type CameraPreset = 'street' | 'garden' | 'ramp' | 'top';
export interface Section { h: string; v: 'off' | 'across' | 'along'; pos: number }
export interface SunTime { month: number; day: number; hour: number }
export type Route = { page: 'home' } | { page: 'project'; id: string; tab: Tab };
export type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';

/** What the DESIGN tab edits; everything else is the BIM tab's (kept when the design is re-approved). */
export const DESIGN_TYPES = ['Space', 'Wall', 'Opening'];

const KEY = {
  cache: (id: string, vid: string) => `casabim.cache.${id}.${vid}`,
  ui: 'casabim.ui.1',
  last: 'casabim.last',
  lang: 'casabim.lang',
  legacy: (v: string) => `casa123bim.model.${v}`,
  legacyDone: 'casabim.legacyImported',
};

const store = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* full or blocked: the server copy is the real one */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

function readUi(): { level: PlanLevel; view: ViewMode } {
  try {
    const ui = JSON.parse(store.get(KEY.ui) ?? '{}') as { level?: string; view?: string };
    return { level: ui.level ?? '', view: ui.view === '3d' || ui.view === 'split' ? ui.view : '2d' };
  } catch { return { level: '', view: '2d' }; }
}

export function parseRoute(hash: string): Route {
  const m = /^#\/p\/([a-z0-9-]+)(?:\/(design|bim))?/.exec(hash);
  return m ? { page: 'project', id: m[1]!, tab: (m[2] as Tab | undefined) ?? 'design' } : { page: 'home' };
}
export const routeHash = (r: Route) => (r.page === 'home' ? '#/' : `#/p/${r.id}/${r.tab}`);

/** The design elements of a model, for comparing a design with its approved snapshot. */
const designKey = (p: Project) => JSON.stringify(p.elements.filter((e) => DESIGN_TYPES.includes(e.type)));

/** Merge an approved design into the BIM model: the design elements and the site come from the design,
 *  the rest (structure, systems, features, assumptions) stays the BIM tab's; services re-host and re-route. */
export function mergeIntoBim(bim: Project, design: Project): Project {
  const next: Project = {
    ...bim,
    site: design.site, levels: design.levels,
    elements: [...design.elements.filter((e) => DESIGN_TYPES.includes(e.type)), ...bim.elements.filter((e) => !DESIGN_TYPES.includes(e.type))],
  };
  const synced = syncThickness(next);
  return synced.elements.some((e) => e.type === 'Fixture' || e.type === 'Device') ? withMep(synced) : synced;
}

export interface AppState {
  route: Route;
  lang: Lang;
  projects: ProjectFile[] | null;
  info: ProjectFile | null;
  loading: string | null;
  saveState: SaveState;
  /** Loaded models: design versions, the approved snapshot (read-only) and the BIM working copy. */
  versions: Record<string, Hist>;
  /** What "Reset floor" and old saved models go back to, per version. */
  bases: Record<string, Project>;
  active: string;
  dirty: string[];

  level: PlanLevel;
  selection: string | null;
  tool: Tool;
  /** A drag in progress: the project as it would be if the drag ended now. */
  preview: Project | null;
  message: string;
  checksOpen: boolean;
  checksScope: 'level' | 'all';
  aboutOpen: boolean;
  aiOpen: boolean;
  devOpen: boolean;
  view: ViewMode;
  doorsOpen: boolean;
  /** 3D: building ghosted so the pipes show. */
  xray: boolean;
  /** 2D: draw the plumbing on the plan. */
  plumbing2d: boolean;
  plumbingOpen: boolean;
  /** 2D electrical overlay, 3D camera cones, electrical window. */
  elec2d: boolean;
  cones: boolean;
  electricalOpen: boolean;
  /** Spec 04b: colour every pipe and conduit by the space that holds it (red = floating), show shafts and plenums. */
  physics: boolean;
  /** Spec 08: Engineering window and its tab, 3D structure overlay (utilisation colours, load path), feature being placed. */
  engineeringOpen: boolean;
  engTab: EngTab;
  structure: boolean;
  featureKind: FeatureKind | null;
  walk: boolean;
  camera: { preset: CameraPreset; n: number; pos?: [number, number, number]; target?: [number, number, number] };
  section: Section;
  sun: SunTime;

  // projects
  go(r: Route): void;
  loadProjects(): Promise<void>;
  openProject(id: string, tab: Tab): Promise<void>;
  setTab(t: Tab): void;
  setLang(l: Lang): void;
  approve(): Promise<boolean>;
  discardDesign(): void;
  flush(): Promise<void>;

  run(cmd: Command): boolean;
  previewCmd(cmd: Command): void;
  commitPreview(): void;
  cancelPreview(): void;
  undo(): void;
  redo(): void;
  setVersion(v: string): void;
  setLevel(l: PlanLevel): void;
  select(id: string | null): void;
  setTool(t: Tool): void;
  flash(msg: string): void;
  openModel(data: unknown): void;
  setChecksOpen(open: boolean): void;
  setChecksScope(s: 'level' | 'all'): void;
  setAbout(open: boolean): void;
  setPanel(patch: Partial<Pick<AppState, 'aiOpen' | 'devOpen'>>): void;
  setView(v: ViewMode): void;
  set3d(patch: Partial<Pick<AppState, 'doorsOpen' | 'walk' | 'section' | 'sun' | 'xray' | 'plumbing2d' | 'plumbingOpen' | 'elec2d' | 'cones' | 'electricalOpen' | 'physics' | 'engineeringOpen' | 'engTab' | 'structure'>>): void;
  /** Spec 08: pick a feature to place (null: back to selecting). */
  placeFeature(kind: FeatureKind | null): void;
  goCamera(preset: CameraPreset): void;
  /** Point the camera from pos to target (house coordinates). */
  lookFrom(pos: [number, number, number], target: [number, number, number]): void;
  /** Select from the 3D view: also shows the element's floor in 2D. */
  pick(id: string | null): void;
}

let flashTimer: ReturnType<typeof setTimeout> | undefined;
let lastPreview: Command | null = null;

const entry = (info: ProjectFile | null, vid: string) => info?.versions.find((v) => v.id === vid);
const readLang = (): Lang => (store.get(KEY.lang) === 'en' ? 'en' : 'pt-BR');

/** Which version a tab shows: the chosen design version, or the BIM working copy. */
export function versionFor(info: ProjectFile, tab: Tab): string {
  if (tab === 'bim') return info.versions.find((v) => v.kind === 'bim')?.id ?? info.designVersionId;
  return info.designVersionId;
}

export const useApp = create<AppState>((set, get) => {
  const hist = () => get().versions[get().active]!;
  const markDirty = (vid: string) => set((s) => ({ dirty: s.dirty.includes(vid) ? s.dirty : [...s.dirty, vid], saveState: 'unsaved' }));
  /** Count a design edit (the approval compares counts) and keep the history. */
  const setHist = (h: Hist, extra: Partial<AppState> = {}, delta = 0) => {
    const vid = get().active;
    set((s) => {
      const info = s.info && delta && entry(s.info, vid)?.kind === 'design'
        ? { ...s.info, versions: s.info.versions.map((v) => (v.id === vid ? { ...v, edits: (v.edits ?? 0) + delta } : v)) }
        : s.info;
      return { versions: { ...s.versions, [vid]: h }, info, ...extra };
    });
    markDirty(vid);
  };
  const fail = (e: unknown) => {
    if (e instanceof CommandError) { get().flash(e.message); return false; }
    throw e;
  };
  const ui = readUi();

  async function loadModel(id: string, v: VersionEntry, base?: Project): Promise<{ p: Project; recovered: boolean }> {
    const cached = store.get(KEY.cache(id, v.id));
    const raw = cached ? (JSON.parse(cached) as { model: unknown }).model : await api.version(id, v.id);
    let p = parseProject(upgradeRaw(raw, base));
    if (base) p = migrate(p, base);
    return { p, recovered: !!cached };
  }

  return {
    route: parseRoute(typeof location === 'undefined' ? '' : location.hash),
    lang: readLang(),
    projects: null,
    info: null,
    loading: null,
    saveState: 'saved',
    versions: {},
    bases: {},
    active: '',
    dirty: [],
    level: ui.level,
    selection: null,
    tool: 'select',
    preview: null,
    message: '',
    checksOpen: false,
    checksScope: 'level',
    aboutOpen: false,
    aiOpen: false,
    devOpen: false,
    view: ui.view,
    doorsOpen: false,
    xray: false,
    plumbing2d: false,
    plumbingOpen: false,
    elec2d: false,
    cones: false,
    electricalOpen: false,
    physics: false,
    engineeringOpen: false,
    engTab: 'structure',
    structure: false,
    featureKind: null,
    walk: false,
    camera: { preset: 'street', n: 0 },
    section: { h: 'off', v: 'off', pos: 6 },
    sun: { month: 6, day: 21, hour: 9 },

    go(r) {
      if (typeof location !== 'undefined' && location.hash !== routeHash(r)) location.hash = routeHash(r);
      const cur = get().route;
      set({ route: r });
      if (r.page === 'home') { void get().flush(); void get().loadProjects(); return; }
      if (cur.page !== 'project' || cur.id !== r.id || !get().info) void get().openProject(r.id, r.tab);
      else get().setTab(r.tab);
    },
    async loadProjects() {
      try { set({ projects: await api.list() }); } catch (e) { set({ projects: [] }); get().flash(e instanceof ApiError ? e.message : 'Could not read the projects.'); }
    },
    async openProject(id, tab) {
      await get().flush();
      set({ loading: id, info: null, versions: {}, bases: {}, dirty: [], selection: null, preview: null });
      try {
        const info = await api.get(id);
        const versions: Record<string, Hist> = {};
        const bases: Record<string, Project> = {};
        const recovered: string[] = [];
        // originals first (they are the base for old saves and for Reset floor)
        for (const v of info.versions) if (v.original) bases[v.id] = parseProject(upgradeRaw(await api.version(id, v.id, true)));
        for (const v of info.versions.filter((x) => x.kind === 'approved')) {
          const { p } = await loadModel(id, v);
          versions[v.id] = initHist(p);
        }
        for (const v of info.versions.filter((x) => x.kind !== 'approved')) {
          const base = bases[v.id] ?? (v.from ? versions[v.from]?.present : undefined);
          const { p, recovered: r } = await loadModel(id, v, base);
          versions[v.id] = initHist(p);
          if (!bases[v.id] && base) bases[v.id] = base;
          if (r) recovered.push(v.id);
        }
        // Casa 123: bring in the edits this browser kept before projects existed (spec P0), once.
        if (id === 'casa-123' && !store.get(KEY.legacyDone)) {
          for (const vid of ['v1', 'v2', 'v3']) {
            const raw = store.get(KEY.legacy(vid));
            if (!raw || !versions[vid] || !bases[vid]) continue;
            try {
              const p = migrate(parseProject(upgradeRaw(JSON.parse(raw), bases[vid])), bases[vid]!);
              versions[vid] = commit(versions[vid]!, p);
              recovered.push(vid);
              const bim = info.versions.find((x) => x.kind === 'bim');
              if (vid === info.designVersionId && bim && versions[bim.id]) {
                versions[bim.id] = commit(versions[bim.id]!, { ...p, meta: versions[bim.id]!.present.meta });
                recovered.push(bim.id);
              }
            } catch { /* an old copy that no longer reads is left alone */ }
          }
          store.set(KEY.legacyDone, new Date().toISOString());
        }
        const active = versionFor(info, tab === 'bim' && !info.approvedVersionId ? 'design' : tab);
        const p = versions[active]!.present;
        const level = planLevels(p).includes(get().level) ? get().level : entryLevel(p);
        store.set(KEY.last, id);
        const lang: Lang = info.language;
        store.set(KEY.lang, lang);
        set({
          info, versions, bases, active, level, loading: null, lang, dirty: recovered, saveState: recovered.length ? 'unsaved' : 'saved',
          route: { page: 'project', id, tab: active === versionFor(info, 'bim') && info.approvedVersionId ? 'bim' : 'design' },
        });
        if (recovered.length) { get().flash('Changes kept in this browser were brought back.'); scheduleSave(); }
      } catch (e) {
        set({ loading: null });
        get().flash(e instanceof ApiError ? e.message : `Could not open the project: ${(e as Error).message}`);
        get().go({ page: 'home' });
      }
    },
    setTab(t) {
      const info = get().info;
      if (!info) return;
      if (t === 'bim' && !info.approvedVersionId) { get().flash('Approve the design first: the BIM tab works on the approved version.'); return; }
      const active = versionFor(info, t);
      const p = get().versions[active]?.present;
      const level = p && !planLevels(p).includes(get().level) ? entryLevel(p) : get().level;
      set({ active, level, route: { page: 'project', id: info.id, tab: t }, selection: null, preview: null, tool: 'select', featureKind: null });
      if (typeof location !== 'undefined') location.hash = routeHash({ page: 'project', id: info.id, tab: t });
    },
    setLang(l) {
      store.set(KEY.lang, l);
      const info = get().info;
      set({ lang: l, info: info ? { ...info, language: l } : info });
      if (info) { set({ saveState: 'unsaved' }); scheduleSave(); }
    },
    async approve() {
      const s = get();
      const info = s.info;
      if (!info) return false;
      const design = s.versions[info.designVersionId]?.present;
      if (!design) return false;
      const n = info.versions.filter((v) => v.kind === 'approved').length + 1;
      const id = `a${n}`;
      const date = new Date().toISOString().slice(0, 10);
      const designEntry = entry(info, info.designVersionId)!;
      const snap: Project = { ...design, meta: { ...design.meta, version: `Approved ${n} — ${designEntry.name}`, versionId: id } };
      const file = `versions/${id}.json`;
      const bimEntry = info.versions.find((v) => v.kind === 'bim');
      const bimOld = bimEntry ? s.versions[bimEntry.id]?.present : undefined;
      const bim = bimOld ? mergeIntoBim(bimOld, snap) : snap;
      const bimNext: Project = { ...bim, meta: { ...bim.meta, version: `${designEntry.name} · BIM`, versionId: 'bim' } };
      const entries: VersionEntry[] = [
        ...info.versions.filter((v) => v.kind !== 'bim'),
        { id, name: `Approved ${n} — ${date}`, kind: 'approved', file, from: info.designVersionId, date, fromEdits: designEntry.edits ?? 0 },
        { id: 'bim', name: `${designEntry.name} · BIM`, kind: 'bim', file: bimEntry?.file ?? 'versions/bim.json', from: id },
      ];
      try {
        await api.putFile(info.id, file, snap);
        const nextInfo: ProjectFile = { ...info, versions: entries, approvedVersionId: id, stage: 'bim' };
        set((st) => ({
          info: nextInfo,
          versions: {
            ...st.versions, [id]: initHist(snap),
            bim: bimEntry && st.versions[bimEntry.id] ? commit(st.versions[bimEntry.id]!, bimNext) : initHist(bimNext),
          },
          bases: { ...st.bases, bim: snap },
        }));
        markDirty('bim');
        await get().flush();
        get().flash(`${nextInfo.versions.find((v) => v.id === id)!.name} saved. The BIM tab now works on it.`);
        return true;
      } catch (e) {
        get().flash(e instanceof ApiError ? e.message : 'Could not save the approval.');
        return false;
      }
    },
    discardDesign() {
      const s = get(), info = s.info;
      if (!info?.approvedVersionId) return;
      const a = entry(info, info.approvedVersionId)!;
      const snap = s.versions[a.id]?.present;
      const dv = a.from ?? info.designVersionId;
      const h = s.versions[dv];
      if (!snap || !h) return;
      const back = { ...snap, meta: h.present.meta };
      set((st) => ({
        versions: { ...st.versions, [dv]: commit(h, back) },
        info: st.info && { ...st.info, versions: st.info.versions.map((v) => (v.id === dv ? { ...v, edits: a.fromEdits ?? 0 } : v)) },
        selection: null, preview: null,
      }));
      markDirty(dv);
      get().flash('The design is back to the approved version. Undo brings your changes back.');
    },
    async flush() {
      clearTimeout(saveTimer);
      const s = get();
      if (!s.info || !s.dirty.length) return;
      const info = s.info;
      set({ saveState: 'saving' });
      try {
        for (const vid of s.dirty) {
          const e = entry(info, vid);
          const h = s.versions[vid];
          if (!e || !h || e.kind === 'approved') continue;
          await api.putVersion(info.id, vid, h.present);
          store.del(KEY.cache(info.id, vid));
        }
        const design = s.versions[info.designVersionId]?.present;
        const lot = design ? lotSummary(design) : info.lot;
        const saved = await api.put({ ...info, lot, address: design?.site.address ?? info.address });
        set((st) => ({ info: st.info?.id === saved.id ? { ...st.info, updated: saved.updated } : st.info, dirty: st.dirty.filter((d) => !s.dirty.includes(d)), saveState: 'saved' }));
      } catch {
        set({ saveState: 'error' });
      }
    },

    run(cmd) {
      try {
        const h = runCmd(hist(), cmd);
        if (h === hist()) return false;
        setHist(h, {}, 1);
        return true;
      } catch (e) { return fail(e); }
    },
    previewCmd(cmd) {
      // a quick version while dragging when the command has one; the full one runs when the drag ends
      try { lastPreview = cmd; set({ preview: (cmd.preview ?? cmd.apply).call(cmd, hist().present) }); } catch (e) { fail(e); }
    },
    commitPreview() {
      const p = get().preview;
      const cmd = lastPreview;
      lastPreview = null;
      if (!p) return;
      if (cmd?.preview) {
        try { setHist(runCmd(hist(), cmd), { preview: null }, 1); } catch (e) { set({ preview: null }); fail(e); }
      } else setHist(commit(hist(), p), { preview: null }, p === hist().present ? 0 : 1);
    },
    cancelPreview() { lastPreview = null; set({ preview: null }); },
    undo() { const h = undo(hist()); if (h !== hist()) setHist(h, { selection: null, preview: null }, -1); },
    redo() { const h = redo(hist()); if (h !== hist()) setHist(h, { selection: null, preview: null }, 1); },
    setVersion(v) {
      const info = get().info;
      if (!info || v === get().active || entry(info, v)?.kind !== 'design') return;
      set({ active: v, selection: null, preview: null, info: { ...info, designVersionId: v }, saveState: 'unsaved' });
      scheduleSave();
      get().flash(`${entry(info, v)!.name} loaded. Your edits to each version are kept separately.`);
    },
    setLevel(l) { set({ level: l, selection: null, preview: null }); },
    select(id) { set({ selection: id }); },
    setTool(t) { set({ tool: t, featureKind: t === 'feature' ? get().featureKind : null }); },
    placeFeature(kind) { set({ featureKind: kind, tool: kind ? 'feature' : 'select' }); },
    flash(msg) {
      set({ message: msg });
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { if (get().message === msg) set({ message: '' }); }, 3500);
    },
    openModel(data) {
      const s = get();
      const base = s.bases[s.active] ?? s.versions[s.active]?.present;
      let p: Project;
      try { p = parseProject(upgradeRaw(data, base)); if (base) p = migrate(p, base); } catch {
        get().flash('That file is not a model of this app. Nothing was changed.');
        return;
      }
      p = { ...p, meta: { ...p.meta, versionId: s.active } };
      setHist(runCmd(hist(), replaceProject(p)), { selection: null, preview: null }, 1);
      get().flash(`Opened ${p.meta.version}. Undo brings the previous model back.`);
    },
    setChecksOpen(open) { set({ checksOpen: open }); },
    setChecksScope(sc) { set({ checksScope: sc }); },
    setAbout(open) { set({ aboutOpen: open }); },
    setPanel(patch) { set(patch); },
    setView(v) { set({ view: v, walk: v === '2d' ? false : get().walk }); },
    set3d(patch) { set(patch); },
    goCamera(preset) { set((s) => ({ camera: { preset, n: s.camera.n + 1 }, walk: false })); },
    lookFrom(pos, target) { set((s) => ({ camera: { preset: s.camera.preset, n: s.camera.n + 1, pos, target }, walk: false })); },
    pick(id) {
      if (!id) { set({ selection: null }); return; }
      const p = hist().present;
      const el = p.elements.find((e) => e.id === id);
      const lv = el && planLevels(p).includes(el.level) ? el.level : get().level;
      set({ selection: id, level: lv });
    },
  };
});

/** Lot summary for the project list, from a design model. */
export function lotSummary(p: Project): ProjectFile['lot'] {
  const xs = p.site.lotPolygon.map((c) => c[0]), ys = p.site.lotPolygon.map((c) => c[1]);
  const area = Math.abs(p.site.lotPolygon.reduce((a, [x, y], i) => { const [u, v] = p.site.lotPolygon[(i + 1) % p.site.lotPolygon.length]!; return a + x * v - u * y; }, 0)) / 2;
  return { city: p.site.region.city, state: p.site.region.state, front: Math.max(...xs) - Math.min(...xs), depth: Math.max(...ys) - Math.min(...ys), area: Math.round(area * 10) / 10 };
}

/** The project every view should draw: the drag preview while dragging, otherwise the saved one. */
export const useProject = () => useApp((s) => s.preview ?? s.versions[s.active]!.present);

/** Changes in the design since the last approval (null: nothing approved yet). */
export function approvalState(s: Pick<AppState, 'info' | 'versions'>): { approved: VersionEntry; changes: number } | null {
  const info = s.info;
  if (!info?.approvedVersionId) return null;
  const a = entry(info, info.approvedVersionId);
  if (!a) return null;
  const d = entry(info, a.from ?? info.designVersionId);
  const snap = s.versions[a.id]?.present, design = d && s.versions[d.id]?.present;
  if (!d || !snap || !design) return { approved: a, changes: 0 };
  const n = Math.abs((d.edits ?? 0) - (a.fromEdits ?? 0));
  if (n === 0) return { approved: a, changes: 0 };
  return { approved: a, changes: sameDesign(design, snap) ? 0 : n };
}
let lastCmp: { a: Project; b: Project; same: boolean } | null = null;
function sameDesign(a: Project, b: Project) {
  if (lastCmp && lastCmp.a === a && lastCmp.b === b) return lastCmp.same;
  const same = designKey(a) === designKey(b);
  lastCmp = { a, b, same };
  return same;
}

// Save: to this browser at once (crash recovery), to the project folder shortly after.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let cacheTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void useApp.getState().flush(); }, 800);
}
useApp.subscribe((s, prev) => {
  if (s.level !== prev.level || s.view !== prev.view) store.set(KEY.ui, JSON.stringify({ level: s.level, view: s.view }));
  if (s.versions === prev.versions || !s.info) return;
  const id = s.info.id;
  clearTimeout(cacheTimer);
  cacheTimer = setTimeout(() => {
    const now = useApp.getState();
    for (const vid of now.dirty) {
      const h = now.versions[vid];
      if (h && entry(now.info, vid)?.kind !== 'approved') store.set(KEY.cache(id, vid), JSON.stringify({ at: Date.now(), model: h.present }));
    }
  }, 250);
  scheduleSave();
});
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const r = parseRoute(location.hash);
    const cur = useApp.getState().route;
    if (JSON.stringify(r) !== JSON.stringify(cur)) useApp.getState().go(r);
  });
  window.addEventListener('beforeunload', () => { void useApp.getState().flush(); });
}
