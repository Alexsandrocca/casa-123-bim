// /api/* routes. Pure request → response, so the tests call it without a network.
import { ProjectFile, Settings } from '../src/model/project-file';
import { AiError, aiStatus, chat, callClaude, type AiConfig, type CallClaude, type ChatRequest } from './ai';
import { Storage, StorageError } from './storage';

export interface ApiResult { status: number; body: unknown }

export interface ApiContext { storage: Storage; ai: AiConfig; call?: CallClaude }

const ok = (body: unknown, status = 200): ApiResult => ({ status, body });
const err = (status: number, message: string, code?: string): ApiResult => ({ status, body: { error: message, ...(code ? { code } : {}) } });

export async function handleApi(ctx: ApiContext, method: string, url: string, body: unknown): Promise<ApiResult> {
  const { storage } = ctx;
  const path = url.split('?')[0]!.replace(/\/+$/, '');
  const seg = path.split('/').filter(Boolean).slice(1); // after "api"
  try {
    // projects
    if (seg[0] === 'projects') {
      const [, id, sub, vid, which] = seg;
      if (!id && method === 'GET') return ok(storage.list());
      if (!id && method === 'POST') {
        // create from a full export-shaped payload (the client builds the starter model)
        return ok(storage.importProject(body), 201);
      }
      if (id === 'import' && method === 'POST') return ok(storage.importProject(body), 201);
      if (!id) return err(405, 'Method not allowed');
      if (!sub) {
        if (method === 'GET') return ok(storage.get(id));
        if (method === 'PUT') {
          const p = ProjectFile.parse(body);
          if (p.id !== id) return err(400, 'Id mismatch');
          return ok(storage.putProject({ ...p, updated: new Date().toISOString() }));
        }
        if (method === 'DELETE') { storage.delete(id); return ok({ deleted: id }); }
      }
      if (sub === 'export' && method === 'GET') return ok(storage.exportProject(id));
      if (sub === 'duplicate' && method === 'POST') return ok(storage.duplicate(id, String((body as { name?: string })?.name ?? `${storage.get(id).name} (copy)`)), 201);
      if (sub === 'files' && method === 'PUT') {
        // a new version file (approval snapshot, new design version) before project.json lists it
        const b = body as { file?: string; data?: unknown };
        if (!b?.file || !/^(versions|originals)\/[a-z0-9-]+\.json$/.test(b.file)) return err(400, 'Bad file name');
        storage.writeFile(id, b.file, b.data);
        return ok({ written: b.file });
      }
      if (sub === 'versions' && vid) {
        const w = which === 'original' ? 'original' : 'file';
        if (method === 'GET') return ok(storage.getVersion(id, vid, w));
        if (method === 'PUT') { storage.putVersion(id, vid, body, w); return ok({ saved: vid }); }
      }
      return err(404, 'Not found');
    }
    if (seg[0] === 'settings') {
      if (method === 'GET') return ok(storage.settings());
      if (method === 'PUT') return ok(storage.putSettings(Settings.parse(body)));
    }
    if (seg[0] === 'ai') {
      if (seg[1] === 'status' && method === 'GET') return ok(aiStatus(storage, ctx.ai));
      if (seg[1] === 'chat' && method === 'POST') {
        const b = body as ChatRequest;
        if (!b || typeof b.project !== 'string' || !Array.isArray(b.messages) || !b.messages.length) return err(400, 'Bad chat request');
        storage.get(b.project); // the usage goes to an existing project
        return ok(await chat(storage, ctx.ai, b, ctx.call ?? callClaude));
      }
      if (seg[1] === 'test' && method === 'POST') {
        const project = String((body as { project?: string })?.project ?? '');
        storage.get(project);
        const r = await chat(storage, ctx.ai, { project, purpose: 'test connection', messages: [{ role: 'user', content: 'Reply with the single word: ok' }], maxTokens: 20, override: true }, ctx.call ?? callClaude);
        return ok({ ok: true, reply: r.text.trim(), usage: r.usage, status: r.status });
      }
    }
    return err(404, 'Not found');
  } catch (e) {
    if (e instanceof StorageError) return err(e.status, e.message);
    if (e instanceof AiError) return err(e.status, e.message, e.code);
    if (e && typeof e === 'object' && 'issues' in e) return err(400, 'Invalid data');
    return err(500, e instanceof Error ? e.message : 'Server error');
  }
}
