// Spec 08: an estimated number with its small "Estimate" badge. The badge opens the explanation:
// the rule used, the assumptions (with their values, editable in Engineering → Assumptions), the source and the confidence.
import { useEffect, useRef, useState } from 'react';
import { assumption, valueOf } from '../model/eng/assumptions';
import type { Estimate } from '../model/eng';
import { useApp, useProject } from '../store';
import { useT } from '../i18n/useT';

export const fmtNum = (v: number, unit: string) => {
  if (unit === 'R$') return `R$ ${Math.round(v).toLocaleString('en-US')}`;
  const d = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2;
  return `${v.toFixed(d)}${unit ? ` ${unit}` : ''}`;
};

/** The same as fmtNum, in the language's number format (for the screen). */
const fmtNumT = (t: ReturnType<typeof useT>, v: number, unit: string) => {
  if (unit === 'R$') return `R$ ${t.n(Math.round(v), 0)}`;
  const d = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2;
  return `${t.n(v, d)}${unit ? ` ${unit}` : ''}`;
};

export function EstBadge({ e, testId }: { e: Estimate; testId?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const p = useProject();
  const set3d = useApp((s) => s.set3d);
  const t = useT();
  useEffect(() => {
    if (!open) return;
    const close = (ev: MouseEvent) => { if (ref.current && !ref.current.contains(ev.target as Node)) setOpen(false); };
    const esc = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <span className="estwrap" ref={ref}>
      <button className={'estbadge' + (e.toConfirm ? ' confirm' : '')} onClick={() => setOpen(!open)} aria-expanded={open} data-testid={testId ?? 'est-badge'} title={t('How this estimate was made')}>
        {e.toConfirm ? t('To confirm') : t('Estimate')}
      </button>
      {open && (
        <span className="estpop" role="dialog" aria-label={t('About {x}', { x: e.label })}>
          <b>{e.label}</b>
          <span><em>{t('Method')}</em>{e.method}</span>
          {e.assumptions.length > 0 && (
            <span><em>{t('Assumptions')}</em>
              {e.assumptions.map((k) => {
                const a = assumption(k);
                const v = valueOf(p, k);
                return <span key={k} className="estassume">{a?.label ?? k}: <b>{v === null ? t('TO CONFIRM') : `${v} ${a?.unit ?? ''}`}</b>{a?.toConfirm ? ` · ${t('to confirm')}` : ''}</span>;
              })}
              <button className="small" onClick={() => { set3d({ engineeringOpen: true, engTab: 'assumptions' }); setOpen(false); }}>{t('Edit the assumptions')}</button>
            </span>
          )}
          <span><em>{t('Source')}</em>{e.source}</span>
          <span><em>{t('Confidence')}</em>{t(e.confidence)}{e.toConfirm ? ` · ${t('TO CONFIRM')}` : ''}</span>
        </span>
      )}
    </span>
  );
}

/** A row in the properties panel: label, estimated value, badge. */
export function EstRow({ e, text, testId }: { e: Estimate; text?: string; testId?: string }) {
  const t = useT();
  return (
    <div className="kv est">
      <span>{e.label}</span>
      <b data-testid={testId}>{text ?? (e.value === null ? t('TO CONFIRM') : fmtNumT(t, e.value, e.unit))}</b>
      <EstBadge e={e} />
    </div>
  );
}
