// Controls over the 3D view: camera presets, walk, doors, section cuts and sun.
import { useEffect, useState } from 'react';
import { SUN_PRESETS, sunPosition } from '../scene/sun';
import { useApp, useProject, type CameraPreset } from '../store';
import { viewFrame } from '../scene/frame';
import { planLevels } from '../model/schema';
import { useT } from '../i18n/useT';

/** Keys held down in walk mode (read every frame by the walker). */
export const walkKeys = { fwd: false, back: false, left: false, right: false, strafeL: false, strafeR: false, run: false };
type K = keyof typeof walkKeys;

const KEYMAP: Record<string, K> = {
  KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back', ArrowLeft: 'left', ArrowRight: 'right',
  KeyA: 'strafeL', KeyD: 'strafeR', ShiftLeft: 'run', ShiftRight: 'run',
};

const PRESET_LABEL: Record<CameraPreset, string> = { street: 'Street', garden: 'Garden', ramp: 'Side ramp', top: 'Top' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const hhmm = (h: number) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

function HoldButton({ k, label, children }: { k: K; label: string; children: string }) {
  const on = () => { walkKeys[k] = true; };
  const off = () => { walkKeys[k] = false; };
  return (
    <button aria-label={label} title={label} onPointerDown={on} onPointerUp={off} onPointerLeave={off} onPointerCancel={off}>{children}</button>
  );
}

export function Controls3D({ style = 'bim' }: { style?: 'design' | 'bim' }) {
  const bim = style === 'bim';
  const t = useT();
  const walk = useApp((s) => s.walk);
  const doorsOpen = useApp((s) => s.doorsOpen);
  const xray = useApp((s) => s.xray);
  const cones = useApp((s) => s.cones);
  const physics = useApp((s) => s.physics);
  const structure = useApp((s) => s.structure);
  const section = useApp((s) => s.section);
  const sun = useApp((s) => s.sun);
  const { set3d, goCamera, lookFrom } = useApp.getState();
  const p = useProject();
  const fr = viewFrame(p);
  const [cx, cy] = fr.center;
  /** Turn a vertical section on and look straight at the cut. */
  const cutAt = (v: 'across' | 'along', pos: number) => {
    set3d({ section: { ...section, v, pos } });
    if (v === 'across') lookFrom([cx, pos - 16, 3.0], [cx, pos + 3, 0.8]);
    else lookFrom([pos + 18, cy, 3.0], [pos - 3, cy, 0.6]);
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

  const pos = sunPosition(2026, sun.month, sun.day, sun.hour, p);
  const range = section.v === 'across' ? { min: fr.along.from + 1, max: fr.along.to - 1 } : { min: fr.across.from + 1, max: fr.across.to - 1 };

  return (
    <div className="ctl3d">
      <div className="ctlrow">
        <div className="seg small" role="group" aria-label={t('Camera')}>
          {(Object.keys(PRESET_LABEL) as CameraPreset[]).filter((k) => fr.presets[k]).map((p) => (
            <button key={p} onClick={() => goCamera(p)}>{t(PRESET_LABEL[p])}</button>
          ))}
        </div>
        <button className="small" aria-pressed={walk} onClick={() => set3d({ walk: !walk })} data-testid="walk">{walk ? t('Stop walking') : t('Walk')}</button>
        <button className="small" aria-pressed={doorsOpen} onClick={() => set3d({ doorsOpen: !doorsOpen })}>{doorsOpen ? t('Doors open') : t('Doors closed')}</button>
        {bim && <>
        <button className="small" aria-pressed={xray} onClick={() => { set3d({ xray: !xray }); if (!xray) { const o = fr.overview(); lookFrom(o.pos, o.target); } }} data-testid="xray">{t('Systems x-ray')}</button>
        <button className="small" aria-pressed={physics} onClick={() => { set3d({ physics: !physics }); if (!physics) { const o = fr.overview(); lookFrom(o.pos, o.target); } }} data-testid="physics" title={t('Colour every pipe and conduit by what holds it; red = floating')}>{t('Physics')}</button>
        <button className="small" aria-pressed={structure} onClick={() => { set3d({ structure: !structure }); if (!structure) { const o = fr.overview(1.5); lookFrom(o.pos, o.target); } }} data-testid="structure3d" title={t('Utilisation colours on the frame and the deck, and the load path with the kN at each column base (spec 08 estimates)')}>{t('Structure')}</button>
        <button className="small" aria-pressed={cones} onClick={() => set3d({ cones: !cones })} data-testid="cones">{t('Camera views')}</button>
        </>}
        <button className="small ghost" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? t('Less ▴') : t('Section & sun ▾')}</button>
      </div>
      {structure && bim && (
        <div className="ctlpanel legend3d" data-testid="structure-legend">
          <span><i className="u-ok" /> {t('use < {v}', { v: t.n(0.7, 1) })}</span><span><i className="u-amber" /> {t('{a} – {b} (deck: needs props)', { a: t.n(0.7, 1), b: t.n(1, 1) })}</span><span><i className="u-red" /> {t('over {v}', { v: t.n(1, 1) })}</span>
          <span><i className="lp" /> {t('load path · kN at each column base (service)')}</span>
          <span className="hint">{t('Estimates. Click a member for its governing rule.')}</span>
        </div>
      )}
      {open && (
        <div className="ctlpanel">
          <div className="ctlrow">
            <span className="lbl">{t('Floor cut')}</span>
            <div className="seg small" role="group" aria-label={t('Floor cut')}>
              {['off', ...planLevels(p)].map((h) => (
                <button key={h} aria-pressed={section.h === h} onClick={() => set3d({ section: { ...section, h } })}>{h === 'off' ? t('Off') : p.levels.find((l) => l.id === h)?.shortName ?? h}</button>
              ))}
            </div>
          </div>
          <div className="ctlrow">
            <span className="lbl">{t('Section')}</span>
            <div className="seg small" role="group" aria-label={t('Vertical section')}>
              <button aria-pressed={section.v === 'off'} onClick={() => set3d({ section: { ...section, v: 'off' } })}>{t('Off')}</button>
              <button aria-pressed={section.v === 'across'} onClick={() => cutAt('across', fr.across.mid)} data-testid="section-across">{t('Across')}</button>
              <button aria-pressed={section.v === 'along'} onClick={() => cutAt('along', fr.along.mid)} data-testid="section-along">{t('Along')}</button>
            </div>
          </div>
          {section.v !== 'off' && (
            <label className="ctlrow">
              <span className="lbl">{section.v === 'across' ? `y ${t.n(section.pos, 2)}` : `x ${t.n(section.pos, 2)}`}</span>
              <input type="range" min={range.min} max={range.max} step={0.05} value={section.pos} aria-label={t('Section position')}
                onChange={(e) => set3d({ section: { ...section, pos: Number(e.target.value) } })} data-testid="section-pos" />
            </label>
          )}
          <div className="ctlrow">
            <span className="lbl">{t('Sun')}</span>
            <div className="seg small" role="group" aria-label={t('Sun presets')}>
              {SUN_PRESETS.map((s) => (
                <button key={s.label} aria-pressed={sun.month === s.month && sun.day === s.day && sun.hour === s.hour}
                  onClick={() => set3d({ sun: { month: s.month, day: s.day, hour: s.hour } })}>{t(s.label)}</button>
              ))}
            </div>
          </div>
          <div className="ctlrow">
            <select aria-label={t('Month')} value={sun.month} onChange={(e) => set3d({ sun: { ...sun, month: Number(e.target.value) } })}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{sun.day} {t(m)}</option>)}
            </select>
            <input type="range" min={5} max={19} step={0.25} value={sun.hour} aria-label={t('Time of day')}
              onChange={(e) => set3d({ sun: { ...sun, hour: Number(e.target.value) } })} />
            <span className="mono">{hhmm(sun.hour)} · {pos.altitude > 0 ? t('{alt}° up, {az}° from north', { alt: t.n(pos.altitude, 0), az: t.n(pos.azimuth, 0) }) : t('below the horizon')}</span>
          </div>
        </div>
      )}
      {walk && (
        <div className="walkpad" aria-label={t('Walk controls')}>
          <p className="hint">{t('Arrows or W A S D to walk, drag to look around, Shift to go faster.')}</p>
          <div className="pad">
            <span /><HoldButton k="fwd" label={t('Forward')}>▲</HoldButton><span />
            <HoldButton k="left" label={t('Turn left')}>◀</HoldButton><HoldButton k="back" label={t('Back')}>▼</HoldButton><HoldButton k="right" label={t('Turn right')}>▶</HoldButton>
          </div>
        </div>
      )}
    </div>
  );
}
