// Controls over the 3D view: camera presets, walk, doors, section cuts and sun.
import { useEffect, useState } from 'react';
import { SUN_PRESETS, sunPosition } from '../scene/sun';
import { useApp, type CameraPreset } from '../store';

/** Keys held down in walk mode (read every frame by the walker). */
export const walkKeys = { fwd: false, back: false, left: false, right: false, strafeL: false, strafeR: false, run: false };
type K = keyof typeof walkKeys;

const KEYMAP: Record<string, K> = {
  KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back', ArrowLeft: 'left', ArrowRight: 'right',
  KeyA: 'strafeL', KeyD: 'strafeR', ShiftLeft: 'run', ShiftRight: 'run',
};

const PRESET_LABEL: Record<CameraPreset, string> = { street: 'Street', garden: 'Garden', ramp: 'North ramp', top: 'Top' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const hhmm = (h: number) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

function HoldButton({ k, label, children }: { k: K; label: string; children: string }) {
  const on = () => { walkKeys[k] = true; };
  const off = () => { walkKeys[k] = false; };
  return (
    <button aria-label={label} title={label} onPointerDown={on} onPointerUp={off} onPointerLeave={off} onPointerCancel={off}>{children}</button>
  );
}

export function Controls3D() {
  const walk = useApp((s) => s.walk);
  const doorsOpen = useApp((s) => s.doorsOpen);
  const xray = useApp((s) => s.xray);
  const cones = useApp((s) => s.cones);
  const physics = useApp((s) => s.physics);
  const structure = useApp((s) => s.structure);
  const section = useApp((s) => s.section);
  const sun = useApp((s) => s.sun);
  const { set3d, goCamera, lookFrom } = useApp.getState();
  /** Turn a vertical section on and look straight at the cut. */
  const cutAt = (v: 'across' | 'along', pos: number) => {
    set3d({ section: { ...section, v, pos } });
    if (v === 'across') lookFrom([4.3, pos - 16, 3.0], [4.3, pos + 3, 0.8]);
    else lookFrom([pos + 18, 7.5, 3.0], [pos - 3, 7.5, 0.6]);
  };
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!walk) return;
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
    const down = (e: KeyboardEvent) => { const k = KEYMAP[e.code]; if (k && !typing(e)) { walkKeys[k] = true; e.preventDefault(); } };
    const up = (e: KeyboardEvent) => { const k = KEYMAP[e.code]; if (k) walkKeys[k] = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      for (const k of Object.keys(walkKeys) as K[]) walkKeys[k] = false;
    };
  }, [walk]);

  const pos = sunPosition(2026, sun.month, sun.day, sun.hour);
  const range = section.v === 'across' ? { min: -4, max: 21 } : { min: -2, max: 12 };

  return (
    <div className="ctl3d">
      <div className="ctlrow">
        <div className="seg small" role="group" aria-label="Camera">
          {(Object.keys(PRESET_LABEL) as CameraPreset[]).map((p) => (
            <button key={p} onClick={() => goCamera(p)}>{PRESET_LABEL[p]}</button>
          ))}
        </div>
        <button className="small" aria-pressed={walk} onClick={() => set3d({ walk: !walk })} data-testid="walk">{walk ? 'Stop walking' : 'Walk'}</button>
        <button className="small" aria-pressed={doorsOpen} onClick={() => set3d({ doorsOpen: !doorsOpen })}>{doorsOpen ? 'Doors open' : 'Doors closed'}</button>
        <button className="small" aria-pressed={xray} onClick={() => { set3d({ xray: !xray }); if (!xray) lookFrom([17, -9, 11], [4.3, 7.5, 0.5]); }} data-testid="xray">Systems x-ray</button>
        <button className="small" aria-pressed={physics} onClick={() => { set3d({ physics: !physics }); if (!physics) lookFrom([17, -9, 11], [4.3, 7.5, 0.5]); }} data-testid="physics" title="Colour every pipe and conduit by what holds it; red = floating">Physics</button>
        <button className="small" aria-pressed={structure} onClick={() => { set3d({ structure: !structure }); if (!structure) lookFrom([16, -8, 12], [4.3, 7.5, 1.5]); }} data-testid="structure3d" title="Utilisation colours on the frame and the deck, and the load path with the kN at each column base (spec 08 estimates)">Structure</button>
        <button className="small" aria-pressed={cones} onClick={() => set3d({ cones: !cones })} data-testid="cones">Camera views</button>
        <button className="small ghost" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Less ▴' : 'Section & sun ▾'}</button>
      </div>
      {structure && (
        <div className="ctlpanel legend3d" data-testid="structure-legend">
          <span><i className="u-ok" /> use &lt; 0.7</span><span><i className="u-amber" /> 0.7 – 1.0 (deck: needs props)</span><span><i className="u-red" /> over 1.0</span>
          <span><i className="lp" /> load path · kN at each column base (service)</span>
          <span className="hint">Estimates. Click a member for its governing rule.</span>
        </div>
      )}
      {open && (
        <div className="ctlpanel">
          <div className="ctlrow">
            <span className="lbl">Floor cut</span>
            <div className="seg small" role="group" aria-label="Floor cut">
              {(['off', 'LL', 'SL', 'UF'] as const).map((h) => (
                <button key={h} aria-pressed={section.h === h} onClick={() => set3d({ section: { ...section, h } })}>{h === 'off' ? 'Off' : h}</button>
              ))}
            </div>
          </div>
          <div className="ctlrow">
            <span className="lbl">Section</span>
            <div className="seg small" role="group" aria-label="Vertical section">
              <button aria-pressed={section.v === 'off'} onClick={() => set3d({ section: { ...section, v: 'off' } })}>Off</button>
              <button aria-pressed={section.v === 'across'} onClick={() => cutAt('across', 6)} data-testid="section-across">Across</button>
              <button aria-pressed={section.v === 'along'} onClick={() => cutAt('along', 2.45)} data-testid="section-along">Along</button>
            </div>
          </div>
          {section.v !== 'off' && (
            <label className="ctlrow">
              <span className="lbl">{section.v === 'across' ? `y ${section.pos.toFixed(2)}` : `x ${section.pos.toFixed(2)}`}</span>
              <input type="range" min={range.min} max={range.max} step={0.05} value={section.pos} aria-label="Section position"
                onChange={(e) => set3d({ section: { ...section, pos: Number(e.target.value) } })} data-testid="section-pos" />
            </label>
          )}
          <div className="ctlrow">
            <span className="lbl">Sun</span>
            <div className="seg small" role="group" aria-label="Sun presets">
              {SUN_PRESETS.map((s) => (
                <button key={s.label} aria-pressed={sun.month === s.month && sun.day === s.day && sun.hour === s.hour}
                  onClick={() => set3d({ sun: { month: s.month, day: s.day, hour: s.hour } })}>{s.label}</button>
              ))}
            </div>
          </div>
          <div className="ctlrow">
            <select aria-label="Month" value={sun.month} onChange={(e) => set3d({ sun: { ...sun, month: Number(e.target.value) } })}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{sun.day} {m}</option>)}
            </select>
            <input type="range" min={5} max={19} step={0.25} value={sun.hour} aria-label="Time of day"
              onChange={(e) => set3d({ sun: { ...sun, hour: Number(e.target.value) } })} />
            <span className="mono">{hhmm(sun.hour)} · {pos.altitude > 0 ? `${pos.altitude.toFixed(0)}° up, ${pos.azimuth.toFixed(0)}° from north` : 'below the horizon'}</span>
          </div>
        </div>
      )}
      {walk && (
        <div className="walkpad" aria-label="Walk controls">
          <p className="hint">Arrows or W A S D to walk, drag to look around, Shift to go faster.</p>
          <div className="pad">
            <span /><HoldButton k="fwd" label="Forward">▲</HoldButton><span />
            <HoldButton k="left" label="Turn left">◀</HoldButton><HoldButton k="back" label="Back">▼</HoldButton><HoldButton k="right" label="Turn right">▶</HoldButton>
          </div>
        </div>
      )}
    </div>
  );
}
