// The frame around a project: name, journey stepper, DESIGN / BIM tabs, approval bar, AI indicator, language, saving.
import { useEffect, useMemo, useState } from 'react';
import { api, type AiStatus } from '../api';
import { useT } from '../i18n/useT';
import { LANGS } from '../i18n';
import { approvalState, useApp } from '../store';

export function LangToggle() {
  const lang = useApp((s) => s.lang);
  const setLang = useApp((s) => s.setLang);
  return (
    <div className="seg small" role="group" aria-label="Language / Idioma">
      {LANGS.map((l) => <button key={l} aria-pressed={lang === l} onClick={() => setLang(l)} data-testid={`lang-${l}`}>{l === 'pt-BR' ? 'PT' : 'EN'}</button>)}
    </div>
  );
}

const STEPS: { key: string; label: string; phase?: string }[] = [
  { key: 'lot', label: 'Lot', phase: 'P1' },
  { key: 'start', label: 'Start', phase: 'P2' },
  { key: 'plans', label: 'Plans' },
  { key: '3d', label: '3D' },
  { key: 'approve', label: 'Approve' },
  { key: 'bim', label: 'BIM' },
  { key: 'outputs', label: 'Outputs', phase: 'P7' },
];

export function Stepper() {
  const t = useT();
  const tab = useApp((s) => (s.route.page === 'project' ? s.route.tab : 'design'));
  const view = useApp((s) => s.view);
  const approved = useApp((s) => !!s.info?.approvedVersionId);
  const { setTab, setView } = useApp.getState();
  const current = tab === 'bim' ? 'bim' : view === '3d' ? '3d' : 'plans';
  const go = (k: string) => {
    if (k === 'plans') { setTab('design'); setView('2d'); }
    if (k === '3d') { setTab('design'); setView('3d'); }
    if (k === 'approve') { setTab('design'); document.querySelector<HTMLButtonElement>('[data-testid="approve"]')?.focus(); }
    if (k === 'bim') setTab('bim');
  };
  return (
    <nav className="stepper" aria-label={t('Journey')}>
      <ol>
        {STEPS.map((s, i) => {
          const off = !!s.phase || (s.key === 'bim' && !approved);
          return (
            <li key={s.key} className={current === s.key ? 'cur' : ''}>
              <button disabled={off} onClick={() => go(s.key)} title={s.phase ? t('Coming in {phase}', { phase: s.phase }) : s.key === 'bim' && !approved ? t('Approve the design first') : ''} data-testid={`step-${s.key}`} aria-current={current === s.key ? 'step' : undefined}>
                <span className="n">{i + 1}</span>{t(s.label)}{s.phase && <small>{t('coming in {phase}', { phase: s.phase })}</small>}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function Tabs() {
  const t = useT();
  const tab = useApp((s) => (s.route.page === 'project' ? s.route.tab : 'design'));
  const approved = useApp((s) => !!s.info?.approvedVersionId);
  const setTab = useApp((s) => s.setTab);
  return (
    <div className="tabs" role="tablist" aria-label={t('Tabs')}>
      <button role="tab" aria-selected={tab === 'design'} aria-pressed={tab === 'design'} onClick={() => setTab('design')} data-testid="tab-design">{t('DESIGN')}</button>
      <button role="tab" aria-selected={tab === 'bim'} aria-pressed={tab === 'bim'} disabled={!approved} title={approved ? '' : t('Approve the design first')} onClick={() => setTab('bim')} data-testid="tab-bim">BIM</button>
    </div>
  );
}

/** "Changes since approval: N" with Re-approve and Discard, on both tabs. */
export function ApprovalBar() {
  const t = useT();
  const info = useApp((s) => s.info);
  const versions = useApp((s) => s.versions);
  const st = useMemo(() => approvalState({ info, versions }), [info, versions]);
  const tab = useApp((s) => (s.route.page === 'project' ? s.route.tab : 'design'));
  const { approve, discardDesign } = useApp.getState();
  const [busy, setBusy] = useState(false);
  if (!st) return null;
  return (
    <div className={'approvalbar' + (st.changes ? ' changed' : '')} data-testid="approval-bar">
      <span>{tab === 'bim' ? t('BIM works on') : t('Approved')}: <b>{st.approved.name}</b></span>
      {st.changes > 0 ? (
        <>
          <span className="chg" data-testid="changes-since-approval">{t('Changes since approval: {n}', { n: st.changes })}</span>
          <button className="small" disabled={busy} onClick={async () => { setBusy(true); await approve(); setBusy(false); }} data-testid="reapprove">{t('Re-approve')}</button>
          <button className="small ghost" onClick={discardDesign} data-testid="discard">{t('Discard changes')}</button>
        </>
      ) : <span className="hint">{t('No changes since approval.')}</span>}
    </div>
  );
}

export function SaveIndicator() {
  const t = useT();
  const s = useApp((x) => x.saveState);
  const text = { saved: 'Saved', saving: 'Saving…', unsaved: 'Not saved yet', error: 'Not saved: is the local server running?' }[s];
  return <span className={'savestate ' + s} data-testid="save-state">{t(text)}</span>;
}

/** "AI: connected · this month US$ x" — opens the AI panel. */
export function AiIndicator() {
  const t = useT();
  const [st, setSt] = useState<AiStatus | null>(null);
  const open = useApp((s) => s.aiOpen);
  const setPanel = useApp((s) => s.setPanel);
  useEffect(() => { api.aiStatus().then(setSt).catch(() => setSt(null)); }, [open]);
  const label = !st ? t('AI: server offline') : st.connected ? t('AI: connected · this month US$ {usd}', { usd: t.n(st.monthUsd, 2) }) : t('AI: no key');
  return (
    <button className={'aiind' + (st?.warn ? ' warn' : '') + (st?.connected ? ' on' : '')} onClick={() => setPanel({ aiOpen: true })} data-testid="ai-indicator">
      {label}{st?.warn ? ` · ${st.blocked ? t('budget used up') : t('80 % of budget')}` : ''}
    </button>
  );
}
