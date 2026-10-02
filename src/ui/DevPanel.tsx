// Hidden developer panel (Ctrl/Cmd + Shift + D, or ?dev in the address): paste a JSON command list, see the dry run.
// This is what P3's AI will call; nothing changes in the model until "Apply".
import { useMemo, useState } from 'react';
import { CATALOGUE, dryRun, parseCalls, type DryRun } from '../model/catalogue';
import { useApp, useProject } from '../store';

const EXAMPLE = '[{ "name": "resize_room", "args": { "room": "Bedroom 2", "deltaM2": -2 } }]';

export function DevPanel() {
  const open = useApp((s) => s.devOpen);
  const p = useProject();
  const { setPanel, run, flash } = useApp.getState();
  const [text, setText] = useState(EXAMPLE);
  const [res, setRes] = useState<DryRun | { error: string } | null>(null);
  const names = useMemo(() => CATALOGUE.map((c) => c.name).join(', '), []);
  if (!open) return null;
  const go = () => {
    try { setRes(dryRun(p, parseCalls(JSON.parse(text)))); } catch (e) { setRes({ error: e instanceof Error ? e.message : String(e) }); }
  };
  const apply = () => {
    if (!res || 'error' in res || !res.ok) return;
    if (res.commands.every((c) => run(c))) flash('Applied. Undo takes it back.');
    setRes(null);
    setPanel({ devOpen: false });
  };
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="dev-title" onClick={() => setPanel({ devOpen: false })}>
      <div className="box wide" onClick={(e) => e.stopPropagation()} data-testid="dev-panel">
        <h2 id="dev-title">Command dry run (developer)</h2>
        <p className="hint">Commands: {names}. Paste a JSON list of {'{ name, args }'}; the dry run uses a copy of the model.</p>
        <textarea className="devtext" value={text} onChange={(e) => setText(e.target.value)} rows={5} spellCheck={false} data-testid="dev-input" />
        <div className="btnrow">
          <button onClick={go} data-testid="dev-run">Dry run</button>
          <button disabled={!res || 'error' in res || !res.ok} onClick={apply} data-testid="dev-apply">Apply</button>
          <button className="ghost" onClick={() => setPanel({ devOpen: false })}>Close</button>
        </div>
        {res && 'error' in res && <p className="bad" data-testid="dev-error">{res.error}</p>}
        {res && !('error' in res) && (
          <div className="devres" data-testid="dev-result">
            <h4>Steps</h4>
            <ul>{res.steps.map((s, i) => <li key={i} className={s.error ? 'bad' : ''}>{s.summary}{s.error ? ` — ${s.error}` : ''}</li>)}</ul>
            <h4>What would change</h4>
            <ul data-testid="dev-diff">{res.diff.length ? res.diff.map((d, i) => <li key={i}>{d}</li>) : <li>Nothing.</li>}</ul>
            <h4>Checks that change</h4>
            <ul data-testid="dev-checks">{res.checks.length ? res.checks.map((c) => <li key={c.id}>{c.title}: {c.before} → {c.after}</li>) : <li>None.</li>}</ul>
          </div>
        )}
      </div>
    </div>
  );
}
