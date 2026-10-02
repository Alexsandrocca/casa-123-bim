// Electrical window: circuits, panels (board and single-line diagram), solar, cameras, bill of materials. Read from the model.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { setSolar } from '../model/commands';
import { cameras, coverage, nvrDays, poeBudget } from '../model/electrical/cameras';
import { mainPanel, phaseBalance, subPanel } from '../model/electrical/design';
import { cameraFov, cameraRange, deviceType } from '../model/electrical/library';
import { billOfMaterials, circuitRows, electricalCsv, poles } from '../model/electrical/schedule';
import { MONTHS, energyEstimate, layoutModules, roofObstacles, solarArray } from '../model/electrical/solar';
import type { Circuit, Device, Project } from '../model/schema';
import { siteFrame } from '../model/site';
import { useApp, useProject } from '../store';

type Tab = 'circuits' | 'panels' | 'solar' | 'cameras' | 'materials';
const BAR = '#2F7FB5'; // single-series chart colour, validated for contrast and chroma (dataviz)

export function ElectricalDialog() {
  const open = useApp((s) => s.electricalOpen);
  const set3d = useApp((s) => s.set3d);
  const p = useProject();
  const [tab, setTab] = useState<Tab>('circuits');
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') set3d({ electricalOpen: false }); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, set3d]);
  if (!open) return null;
  const has = p.elements.some((e) => e.type === 'Circuit');
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="el-title" onClick={() => set3d({ electricalOpen: false })}>
      <div className="box wide" onClick={(e) => e.stopPropagation()}>
        <div className="phead">
          <h2 id="el-title">Electrical · {p.meta.version}</h2>
          <button className="ghost" onClick={() => set3d({ electricalOpen: false })} aria-label="Close">✕</button>
        </div>
        {!has ? <p>This version has no electrical design yet. It is designed on Version 3.</p> : (
          <>
            <div className="seg" role="tablist">
              {([['circuits', 'Circuits'], ['panels', 'Panels'], ['solar', 'Solar'], ['cameras', 'Cameras'], ['materials', 'Materials']] as [Tab, string][]).map(([t, l]) => (
                <button key={t} role="tab" aria-selected={tab === t} aria-pressed={tab === t} onClick={() => setTab(t)}>{l}</button>
              ))}
            </div>
            {tab === 'circuits' && <Circuits p={p} />}
            {tab === 'panels' && <Panels p={p} />}
            {tab === 'solar' && <Solar p={p} />}
            {tab === 'cameras' && <Cameras p={p} />}
            {tab === 'materials' && <Materials p={p} />}
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- circuits ---------- */

function Circuits({ p }: { p: Project }) {
  const rows = circuitRows(p);
  const select = useApp((s) => s.select);
  const set3d = useApp((s) => s.set3d);
  return (
    <div className="pl-tab">
      <div className="schedgrid one">
        <table className="rooms circuits" data-testid="circuit-table">
          <thead><tr><th>Circuit</th><th>Panel</th><th>Points</th><th>Load</th><th>V</th><th>Ph</th><th>A</th><th>mm²</th><th>Breaker</th><th>RCD</th><th>m</th><th>ΔV %</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} onClick={() => { select(r.id); set3d({ electricalOpen: false, elec2d: true }); }}>
              <td>{r.name}</td><td>{r.panel.replace(' electrical panel', '')}</td><td>{r.points}</td><td>{r.load}</td><td>{r.voltage}</td><td>{r.phases}</td><td>{r.current.toFixed(1)}</td>
              <td>{r.section}</td><td>{r.breaker} A</td><td>{r.rcd ? '30 mA' : '–'}</td><td>{r.length.toFixed(1)}</td><td className={r.drop > 4 ? 'bad' : ''}>{r.drop.toFixed(2)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="hint">Load in VA (outlets, lights) or W (appliances). Click a circuit to see it on the plan. Lengths follow the conduit routes: in the floor screed, the crawlspace, the ceiling lining and underground outside.</p>
    </div>
  );
}

/* ---------- panels: board layout and single-line diagram ---------- */

function Panels({ p }: { p: Project }) {
  const circuits = p.elements.filter((e): e is Circuit => e.type === 'Circuit');
  const main = mainPanel(p), sub = subPanel(p);
  const arr = solarArray(p);
  const ess = p.elements.find((e) => e.type === 'Device' && e.props.kind === 'essential-panel');
  return (
    <div className="pl-tab">
      <div className="boards">
        {[main, sub].filter(Boolean).map((pn) => <Board key={pn!.id} panel={pn!} circuits={circuits.filter((c) => c.props.panel === pn!.id)} p={p} />)}
      </div>
      <SingleLine p={p} circuits={circuits} main={main} sub={sub} pv={arr ? `${arr.props.modules} × ${arr.props.moduleW} W` : ''} inverter={arr?.props.inverterKw ?? 0} battery={arr?.props.batteryKwh ?? 0} essential={!!ess} />
    </div>
  );
}

function Board({ panel, circuits, p }: { panel: Device; circuits: Circuit[]; p: Project }) {
  const bal = phaseBalance(p, panel.id);
  const groups: { rcd: boolean; list: Circuit[] }[] = [];
  const withRcd = circuits.filter((c) => c.props.rcd), without = circuits.filter((c) => !c.props.rcd);
  for (let i = 0; i < withRcd.length; i += 4) groups.push({ rcd: true, list: withRcd.slice(i, i + 4) });
  if (without.length) groups.push({ rcd: false, list: without });
  const isMain = panel.props.kind === 'panel';
  return (
    <div className="board" data-testid={`board-${panel.props.kind}`}>
      <h4>{panel.props.name}</h4>
      <div className="rail">
        <Module w={3} cls="main">{isMain ? 'Main 3P 63 A' : 'Isolator 3P 40 A'}</Module>
        <Module w={4} cls="dps">DPS (surge)</Module>
        {isMain && <Module w={2} cls="meter">Bidirectional meter</Module>}
      </div>
      {groups.map((g, i) => (
        <div className="rail" key={i}>
          {g.rcd && <Module w={2} cls="rcd">RCD 30 mA</Module>}
          {g.list.map((c) => (
            <Module key={c.id} w={poles(c)} cls="cb" title={`${c.props.name}: ${c.props.section} mm², ${c.props.load} ${c.props.purpose === 'dedicated' ? 'W' : 'VA'}`}>
              <b>{c.props.breaker} A</b><span>{c.props.name.replace(/^(Outlets|Lighting) /, '').slice(0, 18)}</span><em>⚡ M · R</em>
            </Module>
          ))}
        </div>
      ))}
      <p className="hint">Phases A {(bal.loads.A / 1000).toFixed(1)} · B {(bal.loads.B / 1000).toFixed(1)} · C {(bal.loads.C / 1000).toFixed(1)} kW — imbalance {bal.imbalance.toFixed(1)} %. Each breaker has an energy meter (M) and an app relay (R).</p>
    </div>
  );
}

const Module = ({ w, cls, children, title }: { w: number; cls: string; children: ReactNode; title?: string }) => (
  <div className={'dmod ' + cls} style={{ flexBasis: `${w * 54}px` }} title={title}>{children}</div>
);

function SingleLine({ p, circuits, main, sub, pv, inverter, battery, essential }: { p: Project; circuits: Circuit[]; main?: Device; sub?: Device; pv: string; inverter: number; battery: number; essential: boolean }) {
  const mainC = circuits.filter((c) => c.props.panel === main?.id), subC = circuits.filter((c) => c.props.panel === sub?.id);
  const rowH = 17, W = 1000;
  const H = 140 + Math.max(mainC.length, subC.length) * rowH;
  const busX1 = 300, busX2 = 700;
  const o: ReactNode[] = [];
  const t = (x: number, y: number, s: string, cls = 'sll', anchor: 'start' | 'middle' | 'end' = 'start') => <text key={`${x},${y},${s}`} x={x} y={y} className={cls} textAnchor={anchor}>{s}</text>;
  o.push(<rect key="cpfl" x={20} y={20} width={120} height={30} className="slbox" />, t(80, 40, `${p.site.region.supply.utility ?? 'Supply (TO CONFIRM)'} ${p.site.region.supply.phaseV}/${p.site.region.supply.lineV} V ${p.site.region.supply.phases}φ`, 'sll', 'middle'));
  o.push(<line key="l1" x1={140} y1={35} x2={180} y2={35} className="slw" />, <rect key="m" x={180} y={22} width={60} height={26} className="slbox" />, t(210, 39, 'meter ⇄', 'sll', 'middle'));
  o.push(<line key="l2" x1={240} y1={35} x2={busX1} y2={35} className="slw" />, t(244, 62, 'main 63 A + DPS', 'sls'));
  o.push(<line key="bus1" x1={busX1} y1={35} x2={busX1} y2={60 + mainC.length * rowH} className="slbus" />, t(busX1 + 6, 30, main?.props.name ?? 'Main panel', 'slt'));
  mainC.forEach((c, i) => {
    const y = 60 + i * rowH;
    o.push(<line key={`mc${i}`} x1={busX1} y1={y} x2={busX1 + 30} y2={y} className="slw" />, t(busX1 + 34, y + 4, `${c.props.breaker} A ${poles(c)}P${c.props.rcd ? ' · RCD' : ''} · ${c.props.section} mm² · ${c.props.name}`, 'sls'));
  });
  if (sub) {
    o.push(<line key="bus2" x1={busX2} y1={35} x2={busX2} y2={60 + subC.length * rowH} className="slbus" />, t(busX2 + 6, 30, sub.props.name, 'slt'));
    subC.forEach((c, i) => {
      const y = 60 + i * rowH;
      o.push(<line key={`sc${i}`} x1={busX2} y1={y} x2={busX2 + 30} y2={y} className="slw" />, t(busX2 + 34, y + 4, `${c.props.breaker} A ${poles(c)}P${c.props.rcd ? ' · RCD' : ''} · ${c.props.section} mm² · ${c.props.name}`, 'sls'));
    });
  }
  if (pv) {
    const y = H - 40;
    o.push(<rect key="pv" x={20} y={y - 16} width={150} height={30} className="slbox pv" />, t(95, y + 3, `PV ${pv}`, 'sll', 'middle'));
    o.push(<line key="pvl" x1={170} y1={y} x2={200} y2={y} className="slw" />, <rect key="inv" x={200} y={y - 16} width={90} height={30} className="slbox pv" />, t(245, y + 3, `inverter ${inverter} kW`, 'sll', 'middle'));
    o.push(<line key="invl" x1={290} y1={y} x2={busX1} y2={y} className="slw" />, <line key="invb" x1={busX1} y1={y} x2={busX1} y2={60 + mainC.length * rowH} className="slw dash" />);
    if (battery) o.push(<rect key="bat" x={200} y={y - 56} width={90} height={26} className="slbox ess" />, t(245, y - 39, `battery ${battery} kWh`, 'sll', 'middle'), <line key="batl" x1={245} y1={y - 30} x2={245} y2={y - 16} className="slw" />);
    if (essential) o.push(t(300, y - 39, '→ essential-loads panel (lighting, fridge, rack, pumps)', 'sls'));
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="sec singleline" role="img" aria-label="Single-line diagram" data-testid="single-line">{o}</svg>
  );
}

/* ---------- solar ---------- */

function Solar({ p }: { p: Project }) {
  const run = useApp((s) => s.run);
  const a = solarArray(p);
  const est = useMemo(() => energyEstimate(p), [p]);
  const mods = useMemo(() => (a ? layoutModules(p, a) : []), [p, a]);
  const [hover, setHover] = useState<number | null>(null);
  if (!a || !est) return <p>No solar array in this version.</p>;
  const r = a.props.area;
  const S = 40, pad = 1;
  const X = (x: number) => (x - r.x0 + pad) * S, Y = (y: number) => (r.y1 - y + pad) * S; // north to the right, street at the bottom as in the plan
  const obs = roofObstacles(p, a.props.roofTop);
  // monthly bars
  const W = 560, H = 240, ml = 44, mb = 28, mt = 16;
  const max = Math.max(...est.monthly);
  const top = Math.ceil(max / 200) * 200;
  const bw = (W - ml - 10) / 12;
  const yv = (v: number) => mt + (H - mt - mb) * (1 - v / top);
  const hi = est.monthly.indexOf(max), lo = est.monthly.indexOf(Math.min(...est.monthly));
  return (
    <div className="pl-tab">
      <div className="solar">
        <figure>
          <svg viewBox={`0 0 ${(r.x1 - r.x0 + 2 * pad) * S} ${(r.y1 - r.y0 + 2 * pad) * S}`} className="roofplan" role="img" aria-label="Upper roof with the solar modules" data-testid="solar-roof">
            <rect x={X(r.x0)} y={Y(r.y1)} width={(r.x1 - r.x0) * S} height={(r.y1 - r.y0) * S} className="rp-roof" />
            <rect x={X(r.x0 + a.props.setback)} y={Y(r.y1 - a.props.setback)} width={(r.x1 - r.x0 - 2 * a.props.setback) * S} height={(r.y1 - r.y0 - 2 * a.props.setback) * S} className="rp-setback" />
            {obs.map((o, i) => <rect key={i} x={X(o.x0)} y={Y(o.y1)} width={(o.x1 - o.x0) * S} height={(o.y1 - o.y0) * S} className="rp-obs" />)}
            {mods.map((m, i) => <rect key={i} x={X(m.x0)} y={Y(m.y1)} width={(m.x1 - m.x0) * S} height={(m.y1 - m.y0) * S} className="rp-mod" />)}
            <text x={X(r.x1) - 4} y={Y(r.y0) + 16} className="sll" textAnchor="end">NORTH →</text>
          </svg>
          <figcaption className="hint">{est.placed} modules, {a.props.tilt}° facing north, rows spaced for no shade at winter noon. Grey: tanks, pump and vents (kept clear).</figcaption>
        </figure>
        <figure>
          <h4>Solar energy per month (estimate), kWh</h4>
          <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Monthly solar energy estimate" data-testid="solar-chart" onMouseLeave={() => setHover(null)}>
            {[0, top / 2, top].map((v) => <g key={v}><line x1={ml} x2={W - 10} y1={yv(v)} y2={yv(v)} className="grid" /><text x={ml - 6} y={yv(v) + 4} className="axis" textAnchor="end">{v}</text></g>)}
            {est.monthly.map((v, i) => {
              const x = ml + i * bw + 2, w = bw - 4, y = yv(v);
              return (
                <g key={i} onMouseEnter={() => setHover(i)}>
                  <rect x={ml + i * bw} y={mt} width={bw} height={H - mt - mb} fill="transparent" />
                  <path d={`M${x},${yv(0)} V${y + 4} Q${x},${y} ${x + 4},${y} H${x + w - 4} Q${x + w},${y} ${x + w},${y + 4} V${yv(0)} Z`} fill={BAR} opacity={hover === null || hover === i ? 1 : 0.55} />
                  <text x={x + w / 2} y={H - 10} className="axis" textAnchor="middle">{MONTHS[i]}</text>
                  {(i === hi || i === lo) && <text x={x + w / 2} y={y - 5} className="val" textAnchor="middle">{v}</text>}
                </g>
              );
            })}
            {hover !== null && (
              <g pointerEvents="none">
                <rect x={Math.min(ml + hover * bw, W - 130)} y={4} width={120} height={36} rx={4} className="tip" />
                <text x={Math.min(ml + hover * bw, W - 130) + 8} y={20} className="tipt">{MONTHS[hover]}</text>
                <text x={Math.min(ml + hover * bw, W - 130) + 8} y={34} className="tipv">{est.monthly[hover]} kWh</text>
              </g>
            )}
          </svg>
          <table className="rooms mini"><tbody><tr>{MONTHS.map((m, i) => <td key={m} title={m}>{m}<br />{est.monthly[i]}</td>)}</tr></tbody></table>
          <p className="hint">{est.kwp.toFixed(1)} kWp → about {Math.round(est.year / 12)} kWh/month, {est.year} kWh/year. Shade loss {(est.loss * 100).toFixed(1)} %. {p.site.region.pvYield ? `${p.site.region.pvYield.source} for ${p.site.region.city}` : 'Generic Brazilian yield (no value for this city yet, TO CONFIRM)'} — an ESTIMATE, to confirm with the installer.</p>
        </figure>
      </div>
      <div className="ctlrow">
        <label className="check"><input type="checkbox" checked={a.props.batteryKwh > 0} onChange={(e) => run(setSolar({ batteryKwh: e.target.checked ? 10 : 0 }))} data-testid="battery" /> Battery 10 kWh LFP with an essential-loads panel</label>
        <span className="hint">Hybrid inverter {a.props.inverterKw} kW (DC/AC {est.dcAc.toFixed(2)}). The 6 modules reserved on the carport roof are shown as a ghost array in 3D.</span>
      </div>
    </div>
  );
}

/* ---------- cameras ---------- */

function Cameras({ p }: { p: Project }) {
  const cov = useMemo(() => coverage(p), [p]);
  const poe = poeBudget(p), nvr = nvrDays(p);
  const f = siteFrame(p);
  const cams = cameras(p);
  const select = useApp((s) => s.select);
  const xs = f.lot.map((q) => q[0]), ys = f.lot.map((q) => q[1]);
  const x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1, y0 = Math.min(...ys) - 1, y1 = Math.max(...ys) + 1;
  const S = 22;
  const X = (x: number) => (x - x0) * S, Y = (y: number) => (y1 - y) * S;
  const rooms = p.elements.flatMap((e) => (e.type === 'Space' ? e.props.cells : []));
  return (
    <div className="pl-tab">
      <div className="solar">
        <svg viewBox={`0 0 ${(x1 - x0) * S} ${(y1 - y0) * S}`} className="lotmap" role="img" aria-label="Camera coverage of the lot" data-testid="coverage-map">
          <polygon points={f.lot.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ')} className="lm-lot" />
          {rooms.map((r, i) => <rect key={i} x={X(r.x0)} y={Y(r.y1)} width={(r.x1 - r.x0) * S} height={(r.y1 - r.y0) * S} className="lm-house" />)}
          {cov.blind.map(([x, y], i) => <rect key={`b${i}`} x={X(x - cov.cell / 2)} y={Y(y + cov.cell / 2)} width={cov.cell * S} height={cov.cell * S} className="lm-blind" />)}
          {cams.map((c) => {
            const [cx, cy] = c.props.at, lens = c.props.lensMm ?? 2.8;
            const b = ((p.site.region.xBearing - (c.props.bearing ?? 0)) * Math.PI) / 180, half = ((cameraFov(lens) / 2) * Math.PI) / 180, r = cameraRange(lens);
            const pt = (a: number) => [X(cx + Math.cos(a) * r), Y(cy + Math.sin(a) * r)];
            const [ax, ay] = pt(b + half), [bx, by] = pt(b - half);
            return (
              <g key={c.id} onClick={() => select(c.id)} className="lm-cam">
                <path d={`M${X(cx)},${Y(cy)} L${ax},${ay} A${r * S},${r * S} 0 0 0 ${bx},${by} Z`} className="lm-fov" />
                <circle cx={X(cx)} cy={Y(cy)} r={4} className="lm-dot" />
                <title>{c.props.name} · {lens} mm · {cameraFov(lens).toFixed(0)}° · {r.toFixed(0)} m</title>
              </g>
            );
          })}
          <text x={X((xs[0]! + xs[1]!) / 2)} y={Y(f.yStreet) + 16} className="sll" textAnchor="middle">STREET · EAST</text>
        </svg>
        <div className="kvs">
          <div className="kv"><span>Coverage of the open lot</span><b data-testid="coverage-pct">{cov.pct.toFixed(0)} %</b></div>
          <div className="kv"><span>Blind spots (red)</span><b>{(cov.blind.length * cov.cell * cov.cell).toFixed(1)} m²</b></div>
          <div className="kv"><span>Cameras</span><b>{nvr.cameras} × 4 MP + doorbell</b></div>
          <div className="kv"><span>PoE switch</span><b>{poe.used} of {poe.ports} ports · {poe.watts.toFixed(0)} of {poe.budgetW} W</b></div>
          <div className="kv"><span>NVR {nvr.channels} channels, {nvr.storageTB} TB</span><b>{nvr.gbPerDay} GB/day → {nvr.days.toFixed(0)} days</b></div>
          <p className="hint">Each camera sees within its lens angle and range and not through the house. Click a camera to select it, then change its direction or lens in the properties panel. Recording estimate: continuous, H.265, about 2 Mbit/s per camera.</p>
        </div>
      </div>
    </div>
  );
}

/* ---------- bill of materials ---------- */

function Materials({ p }: { p: Project }) {
  const b = billOfMaterials(p);
  const download = () => {
    const blob = new Blob([electricalCsv(p)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `casa-123-${p.meta.versionId}-electrical.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const table = (title: string, head: [string, string], rows: (string | number)[][]) => (
    <table className="rooms"><thead><tr><th>{title}</th><th>{head[0]}</th><th>{head[1]}</th></tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td></tr>)}</tbody></table>
  );
  return (
    <div className="pl-tab">
      <div className="ctlrow"><b>Bill of materials</b><button onClick={download} data-testid="elec-csv">Download CSV</button></div>
      <div className="schedgrid">
        {table('Cable (copper)', ['mm²', 'm'], b.cable.map((x) => ['', x.section, x.metres.toFixed(0)]))}
        {table('Conduit', ['DN', 'm'], b.conduit.map((x) => ['', x.dn, x.metres.toFixed(0)]))}
        {table('Boxes and protection', ['', 'No.'], [...b.boxes, ...b.breakers, ...b.protection].map((x) => [x.item, '', x.count]))}
        {table('Devices', ['', 'No.'], b.devices.map((x) => [x.item, '', x.count]))}
      </div>
      <p className="hint">Cable metres include all conductors of each circuit and 10 % for connections. Quantities for budgeting; the electrical engineer's project (NBR 5410, ART/RRT) is final.</p>
    </div>
  );
}

export const deviceGroupLabel = (d: Device) => deviceType(d.props.kind).label;
