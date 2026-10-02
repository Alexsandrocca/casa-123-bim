// AI panel: connection, how to add the key (by the owner, in a text editor — never in a chat), test, usage and budget.
import { useEffect, useState } from 'react';
import { api, ApiError, type AiStatus, type UsageLine } from '../api';
import { useT } from '../i18n/useT';
import type { Settings } from '../model/project-file';
import { useApp } from '../store';

export function AiPanel() {
  const t = useT();
  const open = useApp((s) => s.aiOpen);
  const project = useApp((s) => s.info?.id);
  const setPanel = useApp((s) => s.setPanel);
  const [st, setSt] = useState<AiStatus | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [test, setTest] = useState<{ ok: boolean; text: string; usage?: UsageLine } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    api.aiStatus().then(setSt).catch(() => setSt(null));
    api.settings().then(setSettings).catch(() => setSettings(null));
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setPanel({ aiOpen: false }); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, setPanel]);
  if (!open) return null;

  const runTest = async () => {
    if (!project) return;
    setBusy(true); setTest(null);
    try {
      const r = await api.aiTest(project);
      setTest({ ok: true, text: t('Claude answered “{reply}”. Cost of the test: US$ {usd}.', { reply: r.reply, usd: t.n(r.usage.usd, 4) }), usage: r.usage });
      setSt(r.status);
    } catch (e) { setTest({ ok: false, text: e instanceof ApiError ? e.message : String(e) }); } finally { setBusy(false); }
  };
  const save = async (patch: Partial<Settings['ai']>) => {
    if (!settings) return;
    try { const s = await api.putSettings({ ai: { ...settings.ai, ...patch } }); setSettings(s); setSt(await api.aiStatus()); } catch { /* keep the old value */ }
  };
  const num = (label: string, key: keyof Settings['ai'], step: number) => settings && typeof settings.ai[key] === 'number' && (
    <label className="field small">
      <span>{t(label)}</span>
      <input type="number" step={step} min={0} defaultValue={settings.ai[key] as number} onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0) void save({ [key]: v }); }} data-testid={`ai-${key}`} />
    </label>
  );

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="ai-title" onClick={() => setPanel({ aiOpen: false })}>
      <div className="box" onClick={(e) => e.stopPropagation()} data-testid="ai-panel">
        <h2 id="ai-title">{t('AI assistant')}</h2>
        {!st && <p className="bad">{t('The local server is not running. Open the app with “Open Casa BIM.command”.')}</p>}
        {st && !st.connected && (
          <div className="howto" data-testid="ai-howto">
            <p><b>{t('No API key yet.')}</b> {t('The app works without it; only the AI features need it. To add the key, do it yourself, on this Mac:')}</p>
            <ol>
              <li>{t('In Finder, open the folder casa-123-bim and double-click “Add AI key.command”. TextEdit opens a small file.')}</li>
              <li>{t('Right after ANTHROPIC_API_KEY= paste your key, with no spaces. Save (Cmd + S) and close TextEdit.')}</li>
              <li>{t('Close the app window (the Terminal one) and double-click “Open Casa BIM.command” again.')}</li>
            </ol>
            <p className="hint">{t('Never paste the key into a chat or into this page. It stays in that file on this Mac and is never sent to the browser.')}</p>
          </div>
        )}
        {st?.connected && <p className="ok">{t('Connected. Model: {model}.', { model: st.model })}</p>}
        {st && (
          <p>{t('This month: US$ {usd} (about R$ {brl}).', { usd: t.n(st.monthUsd, 2), brl: t.n(st.monthBrl, 2) })}{st.budgetUsd > 0 ? ` ${t('Budget: US$ {b}.', { b: t.n(st.budgetUsd, 2) })}` : ''}</p>
        )}
        {st?.warn && <p className="warn">{st.blocked ? t('The monthly budget is used up: AI calls are blocked until next month, unless you allow going over it below.') : t('80 % of the monthly budget is used.')}</p>}
        <div className="btnrow">
          <button disabled={!st?.connected || busy || !project} onClick={runTest} data-testid="ai-test">{busy ? t('Testing…') : t('Test AI connection')}</button>
          {!project && <span className="hint">{t('Open a project to test (the usage is logged in it).')}</span>}
        </div>
        {test && <p className={test.ok ? 'ok' : 'bad'} data-testid="ai-test-result">{test.text}</p>}
        {settings && (
          <>
            <h4>{t('Costs and budget')}</h4>
            {num('Price in (US$ per million tokens)', 'priceInPerMTok', 0.5)}
            {num('Price out (US$ per million tokens)', 'priceOutPerMTok', 0.5)}
            {num('US$ → R$ rate', 'usdToBrl', 0.05)}
            {num('Monthly budget (US$, 0 = none)', 'monthlyBudgetUsd', 1)}
            <label className="check"><input type="checkbox" checked={settings.ai.allowOverBudget} onChange={(e) => void save({ allowOverBudget: e.target.checked })} /> {t('Allow going over the budget')}</label>
            <p className="hint">{t('Every call is logged in the project folder (ai-usage.jsonl) with date, purpose, tokens and cost.')}</p>
          </>
        )}
        <button onClick={() => setPanel({ aiOpen: false })}>{t('Close')}</button>
      </div>
    </div>
  );
}
