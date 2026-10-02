// Project files on disk. Every path is resolved inside the projects folder; anything else is refused.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { ProjectFile, Settings, slugify, type VersionEntry } from '../src/model/project-file';

export class StorageError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const DEFAULT_SETTINGS: Settings = {
  // Claude Opus 5.5 list prices (US$ per million tokens); the exchange rate is a rough value to edit.
  ai: { priceInPerMTok: 4, priceOutPerMTok: 20, usdToBrl: 5.4, monthlyBudgetUsd: 20, allowOverBudget: false },
};

/** Projects that are always committed (the sample project). */
const ALWAYS_IN_GIT = ['casa-123'];

export class Storage {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
    mkdirSync(this.root, { recursive: true });
  }

  /** A path inside the projects folder, or an error. */
  path(...parts: string[]): string {
    const p = resolve(this.root, ...parts);
    const rel = relative(this.root, p);
    if (rel === '' || rel.startsWith('..') || rel.split(sep).includes('..') || resolve(this.root, rel) !== p) throw new StorageError(400, 'Path outside the projects folder');
    return p;
  }

  private checkId(id: string) {
    if (!/^[a-z0-9-]{1,40}$/.test(id)) throw new StorageError(400, 'Bad project id');
  }

  private readJson(file: string): unknown {
    try { return JSON.parse(readFileSync(file, 'utf8')); } catch { throw new StorageError(404, 'File not found'); }
  }

  /** Write through a temporary file so a crash never leaves half a file. */
  private writeJson(file: string, data: unknown) {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 1) + '\n');
    renameSync(tmp, file);
  }

  list(): ProjectFile[] {
    const out: ProjectFile[] = [];
    for (const d of readdirSync(this.root)) {
      const f = join(this.root, d, 'project.json');
      if (!existsSync(f)) continue;
      const parsed = ProjectFile.safeParse(this.readJson(f));
      if (parsed.success) out.push(parsed.data);
    }
    return out.sort((a, b) => b.updated.localeCompare(a.updated));
  }

  exists(id: string): boolean { this.checkId(id); return existsSync(this.path(id, 'project.json')); }

  get(id: string): ProjectFile {
    this.checkId(id);
    const parsed = ProjectFile.safeParse(this.readJson(this.path(id, 'project.json')));
    if (!parsed.success) throw new StorageError(422, `project.json of ${id} is not valid`);
    return parsed.data;
  }

  putProject(p: ProjectFile): ProjectFile {
    this.checkId(p.id);
    const parsed = ProjectFile.parse(p);
    this.writeJson(this.path(p.id, 'project.json'), parsed);
    this.syncGitignore();
    return parsed;
  }

  private versionEntry(id: string, vid: string): VersionEntry {
    const v = this.get(id).versions.find((x) => x.id === vid);
    if (!v) throw new StorageError(404, `No version ${vid}`);
    return v;
  }

  getVersion(id: string, vid: string, which: 'file' | 'original' = 'file'): unknown {
    const v = this.versionEntry(id, vid);
    const f = which === 'original' ? v.original : v.file;
    if (!f) throw new StorageError(404, 'No original for this version');
    return this.readJson(this.path(id, f));
  }

  putVersion(id: string, vid: string, model: unknown, which: 'file' | 'original' = 'file') {
    const v = this.versionEntry(id, vid);
    if (v.kind === 'approved' && which === 'file' && existsSync(this.path(id, v.file))) throw new StorageError(409, 'Approved snapshots are frozen');
    const f = which === 'original' ? v.original : v.file;
    if (!f) throw new StorageError(404, 'No original for this version');
    this.writeJson(this.path(id, f), model);
  }

  /** Write a version file that is not in project.json yet (a new snapshot), then the caller adds its entry. */
  writeFile(id: string, file: string, data: unknown) { this.checkId(id); this.writeJson(this.path(id, file), data); }

  delete(id: string) {
    this.checkId(id);
    if (!this.exists(id)) throw new StorageError(404, 'No such project');
    rmSync(this.path(id), { recursive: true, force: true });
    this.syncGitignore();
  }

  freeId(name: string): string {
    const base = slugify(name);
    let id = base, n = 2;
    while (existsSync(join(this.root, id))) id = `${base}-${n++}`;
    return id;
  }

  /** One JSON with the project and every version file (Export project). */
  exportProject(id: string) {
    const p = this.get(id);
    const files: Record<string, unknown> = {};
    for (const v of p.versions) {
      for (const f of [v.file, v.original]) if (f && existsSync(this.path(id, f))) files[f] = this.readJson(this.path(id, f));
    }
    return { schema: 'casabim-export/1', project: p, files };
  }

  /** Import an exported project under a free id (never overwrites). */
  importProject(data: unknown): ProjectFile {
    const d = data as { schema?: string; project?: unknown; files?: Record<string, unknown> };
    if (d?.schema !== 'casabim-export/1' || !d.files) throw new StorageError(400, 'Not a project export');
    const src = ProjectFile.parse(d.project);
    const id = this.freeId(src.name);
    const now = new Date().toISOString();
    for (const [f, content] of Object.entries(d.files)) {
      if (!/^(versions|originals)\/[a-z0-9-]+(\.original)?\.json$/.test(f)) throw new StorageError(400, `Unexpected file ${f}`);
      this.writeJson(this.path(id, f), content);
    }
    return this.putProject({ ...src, id, includeInGit: false, created: now, updated: now });
  }

  duplicate(id: string, name: string): ProjectFile {
    const ex = this.exportProject(id);
    return this.importProject({ ...ex, project: { ...ex.project, name } });
  }

  appendUsage(id: string, line: object) {
    this.checkId(id);
    const f = this.path(id, 'ai-usage.jsonl');
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, JSON.stringify(line) + '\n', { flag: 'a' });
  }

  /** Every usage line of every project (for the monthly total). */
  usage(): { project: string; date: string; usd: number; purpose: string }[] {
    const out: { project: string; date: string; usd: number; purpose: string }[] = [];
    for (const d of readdirSync(this.root)) {
      const f = join(this.root, d, 'ai-usage.jsonl');
      if (!existsSync(f) || !statSync(f).isFile()) continue;
      for (const l of readFileSync(f, 'utf8').split('\n')) {
        if (!l.trim()) continue;
        try { const u = JSON.parse(l) as { date: string; usd: number; purpose: string }; out.push({ project: d, ...u }); } catch { /* skip a broken line */ }
      }
    }
    return out;
  }

  settings(): Settings {
    const f = join(this.root, 'settings.json');
    if (!existsSync(f)) return DEFAULT_SETTINGS;
    const parsed = Settings.safeParse(this.readJson(f));
    return parsed.success ? parsed.data : DEFAULT_SETTINGS;
  }

  putSettings(s: Settings): Settings {
    const parsed = Settings.parse(s);
    this.writeJson(join(this.root, 'settings.json'), parsed);
    return parsed;
  }

  /** projects/.gitignore: family projects stay out of git unless the project says otherwise. */
  syncGitignore() {
    const keep = new Set(ALWAYS_IN_GIT);
    for (const p of this.list()) if (p.includeInGit) keep.add(p.id);
    const lines = [
      '# Written by the local server. Family projects stay out of git unless "Include in git" is on.',
      '*', '!.gitignore', ...[...keep].sort().map((id) => `!${id}/`), ...[...keep].sort().map((id) => `!${id}/**`), '',
    ];
    writeFileSync(join(this.root, '.gitignore'), lines.join('\n'));
  }
}
