// The browser side of the local server's /api. No secrets pass through here.
import type { ProjectFile, Settings } from './model/project-file';
import type { LotAiFields } from './model/lot-ai';

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'The local server is not running.');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? res.statusText, data.code);
  return data as T;
}

export interface AiStatus { connected: boolean; model: string; monthUsd: number; monthBrl: number; budgetUsd: number; warn: boolean; blocked: boolean }
export interface UsageLine { date: string; purpose: string; model: string; tokensIn: number; tokensOut: number; usd: number; brl: number }

export const api = {
  list: () => call<ProjectFile[]>('GET', '/api/projects'),
  get: (id: string) => call<ProjectFile>('GET', `/api/projects/${id}`),
  put: (p: ProjectFile) => call<ProjectFile>('PUT', `/api/projects/${p.id}`, p),
  remove: (id: string) => call<{ deleted: string }>('DELETE', `/api/projects/${id}`),
  duplicate: (id: string, name: string) => call<ProjectFile>('POST', `/api/projects/${id}/duplicate`, { name }),
  exportProject: (id: string) => call<unknown>('GET', `/api/projects/${id}/export`),
  importProject: (data: unknown) => call<ProjectFile>('POST', '/api/projects/import', data),
  version: (id: string, vid: string, original = false) => call<unknown>('GET', `/api/projects/${id}/versions/${vid}${original ? '/original' : ''}`),
  putVersion: (id: string, vid: string, model: unknown) => call<{ saved: string }>('PUT', `/api/projects/${id}/versions/${vid}`, model),
  putFile: (id: string, file: string, data: unknown) => call<{ written: string }>('PUT', `/api/projects/${id}/files`, { file, data }),
  settings: () => call<Settings>('GET', '/api/settings'),
  putSettings: (s: Settings) => call<Settings>('PUT', '/api/settings', s),
  aiStatus: () => call<AiStatus>('GET', '/api/ai/status'),
  aiLot: (text: string, project?: string) => call<{ fields: LotAiFields; usage: UsageLine; status: AiStatus }>('POST', '/api/ai/lot', { text, project }),
  aiTest: (project: string) => call<{ ok: boolean; reply: string; usage: UsageLine; status: AiStatus }>('POST', '/api/ai/test', { project }),
};
