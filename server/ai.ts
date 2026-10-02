// The Claude API proxy. The key is read from .env.local on this machine and never leaves the server:
// the browser only ever sees the answer text, token counts and costs.
import Anthropic from '@anthropic-ai/sdk';
import type { Storage } from './storage';

export interface AiConfig { apiKey: string | undefined; model: string }

export interface ChatRequest {
  project: string;
  /** What the call is for (shown in the usage log): 'test', 'prompt', … */
  purpose: string;
  system?: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens?: number;
  /** Go over the monthly budget for this one call. */
  override?: boolean;
}

export interface Usage { inputTokens: number; outputTokens: number }

/** What the server needs from the API: one call, text back. Tests replace it with a fake. */
export type CallClaude = (cfg: AiConfig, req: ChatRequest) => Promise<{ text: string; usage: Usage; model: string; stop: string | null }>;

export const callClaude: CallClaude = async (cfg, req) => {
  const client = new Anthropic({ apiKey: cfg.apiKey });
  const res = await client.messages.create({
    model: cfg.model,
    max_tokens: req.maxTokens ?? 4000,
    ...(req.system ? { system: req.system } : {}),
    messages: req.messages,
  });
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  return { text, usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens }, model: res.model, stop: res.stop_reason };
};

export class AiError extends Error {
  constructor(public status: number, public code: 'no-key' | 'over-budget' | 'api', message: string) { super(message); }
}

const month = (d = new Date()) => d.toISOString().slice(0, 7);

export function monthTotal(storage: Storage, when = new Date()) {
  return storage.usage().filter((u) => u.date.startsWith(month(when))).reduce((a, u) => a + u.usd, 0);
}

export function aiStatus(storage: Storage, cfg: AiConfig) {
  const s = storage.settings().ai;
  const spent = monthTotal(storage);
  const share = s.monthlyBudgetUsd > 0 ? spent / s.monthlyBudgetUsd : 0;
  return {
    connected: !!cfg.apiKey,
    model: cfg.model,
    monthUsd: spent,
    monthBrl: spent * s.usdToBrl,
    budgetUsd: s.monthlyBudgetUsd,
    warn: s.monthlyBudgetUsd > 0 && share >= 0.8,
    blocked: s.monthlyBudgetUsd > 0 && share >= 1 && !s.allowOverBudget,
  };
}

export async function chat(storage: Storage, cfg: AiConfig, req: ChatRequest, call: CallClaude = callClaude) {
  if (!cfg.apiKey) throw new AiError(503, 'no-key', 'No API key yet. Add it to .env.local (see the AI panel).');
  const st = aiStatus(storage, cfg);
  if (st.blocked && !req.override) throw new AiError(402, 'over-budget', `The monthly AI budget (US$ ${st.budgetUsd.toFixed(2)}) is used up.`);
  let r;
  try { r = await call(cfg, req); } catch (e) {
    // the SDK's error text never contains the key; keep only the status and message
    const status = e instanceof Anthropic.APIError ? e.status ?? 502 : 502;
    throw new AiError(502, 'api', `Claude API error${status ? ` ${status}` : ''}: ${e instanceof Error ? e.message.slice(0, 200) : 'unknown'}`);
  }
  const s = storage.settings().ai;
  const usd = (r.usage.inputTokens * s.priceInPerMTok + r.usage.outputTokens * s.priceOutPerMTok) / 1e6;
  const line = { date: new Date().toISOString(), purpose: req.purpose, model: r.model, tokensIn: r.usage.inputTokens, tokensOut: r.usage.outputTokens, usd: Math.round(usd * 1e6) / 1e6, brl: Math.round(usd * s.usdToBrl * 1e4) / 1e4 };
  storage.appendUsage(req.project, line);
  return { text: r.text, stop: r.stop, usage: line, status: aiStatus(storage, cfg) };
}
