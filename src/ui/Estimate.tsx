// Spec 08: an estimated number with its small "Estimate" badge. The badge opens the explanation:
// the rule used, the assumptions (with their values, editable in Engineering → Assumptions), the source and the confidence.
import { useEffect, useRef, useState } from 'react';
import { assumption, valueOf } from '../model/eng/assumptions';
import type { Estimate } from '../model/eng';
import { useApp, useProject } from '../store';

export const fmtNum = (v: number, unit: string) => {
  if (unit === 'R$') return `R$ ${Math.round(v).toLocaleString('en-US')}`;
  const d = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2;
  return `${v.toFixed(d)}${unit ? ` ${unit}` : ''}`;
};

export function EstBadge({ e, testId }: { e: Estimate; testId?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const p = useProject();
  const set3d = useApp((s) => s.set3d);
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
      <button className={'estbadge' + (e.toConfirm ? ' confirm' : '')} onClick={() => setOpen(!open)} aria-expanded={open} data-testid={testId ?? 'est-badge'} title="How this estimate was made">
        {e.toConfirm ? 'To confirm' : 'Estimate'}
      </button>
      {open && (
        <span className="estpop" role="dialog" aria-label={`About ${e.label}`}>
          <b>{e.label}</b>
          <span><em>Method</em>{e.method}</span>
          {e.assumptions.length > 0 && (
            <span><em>Assumptions</em>
              {e.assumptions.map((k) => {
                const a = assumption(k);
                const v = valueOf(p, k);
                return <span key={k} className="estassume">{a?.label ?? k}: <b>{v === null ? 'TO CONFIRM' : `${v} ${a?.unit ?? ''}`}</b>{a?.toConfirm ? ' · to confirm' : ''}</span>;
              })}
              <button className="small" onClick={() => { set3d({ engineeringOpen: true, engTab: 'assumptions' }); setOpen(false); }}>Edit the assumptions</button>
            </span>
          )}
          <span><em>Source</em>{e.source}</span>
          <span><em>Confidence</em>{e.confidence}{e.toConfirm ? ' · TO CONFIRM' : ''}</span>
        </span>
      )}
    </span>
  );
}

/** A row in the properties panel: label, estimated value, badge. */
export function EstRow({ e, text, testId }: { e: Estimate; text?: string; testId?: string }) {
  return (
    <div className="kv est">
      <span>{e.label}</span>
      <b data-testid={testId}>{text ?? (e.value === null ? 'TO CONFIRM' : fmtNum(e.value, e.unit))}</b>
      <EstBadge e={e} />
    </div>
  );
}
