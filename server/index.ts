// The local server: serves the app (through Vite while developing, or the built dist/) and the /api routes.
// Start: npm run dev (or double-click "Open Casa BIM.command").
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from './api';
import { Storage } from './storage';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=') as [string, string]));
const PORT = Number(args.get('port') ?? process.env.PORT ?? 5173);
const PROD = args.has('prod');

/** .env.local: KEY=value lines. The values stay in this process. */
function readEnv(): Record<string, string> {
  const f = join(ROOT, '.env.local');
  if (!existsSync(f)) {
    const ex = join(ROOT, '.env.local.example');
    if (existsSync(ex)) copyFileSync(ex, f);
  }
  const out: Record<string, string> = {};
  if (!existsSync(f)) return out;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = readEnv();
// CASABIM_NO_AI=1 (end-to-end tests) runs without a key even when .env.local has one
const apiKey = process.env.CASABIM_NO_AI ? undefined : process.env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY || undefined;
const model = process.env.ANTHROPIC_MODEL || env.ANTHROPIC_MODEL || 'claude-opus-5-5';
const storage = new Storage(process.env.PROJECTS_DIR || args.get('projects') || join(ROOT, 'projects'));
storage.syncGitignore();

function readBody(req: IncomingMessage, limit = 50 * 1024 * 1024): Promise<unknown> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let n = 0;
    req.on('data', (c: Buffer) => { n += c.length; if (n > limit) { fail(new Error('Too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      const s = Buffer.concat(chunks).toString('utf8');
      try { ok(s ? JSON.parse(s) : undefined); } catch { fail(new Error('Bad JSON')); }
    });
    req.on('error', fail);
  });
}

async function api(req: IncomingMessage, res: ServerResponse) {
  let body: unknown;
  try { body = req.method === 'GET' || req.method === 'DELETE' ? undefined : await readBody(req); } catch (e) {
    res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: (e as Error).message }));
    return;
  }
  const r = await handleApi({ storage, ai: { apiKey, model } }, req.method ?? 'GET', req.url ?? '/', body);
  res.writeHead(r.status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(r.body));
}

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

async function main() {
  let vite: { middlewares: (req: IncomingMessage, res: ServerResponse, next: () => void) => void } | null = null;
  if (!PROD) {
    const { createServer: createVite } = await import('vite');
    vite = await createVite({ root: ROOT, server: { middlewareMode: true, hmr: { port: PORT + 10000 } }, appType: 'spa' });
  }
  const dist = join(ROOT, 'dist');
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/api/')) { void api(req, res); return; }
    if (vite) { vite.middlewares(req, res, () => res.writeHead(404).end()); return; }
    const p = resolve(dist, '.' + decodeURIComponent((req.url ?? '/').split('?')[0]!));
    const file = p.startsWith(dist) && existsSync(p) && extname(p) ? p : join(dist, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
  });
  server.listen(PORT, () => {
    console.log(`Casa BIM is running: http://localhost:${PORT}`);
    console.log(apiKey ? `AI: connected (${model}).` : 'AI: no key yet. Open the file .env.local in this folder with TextEdit, paste your key after ANTHROPIC_API_KEY=, save, then close and reopen this window.');
  });
}

void main();
