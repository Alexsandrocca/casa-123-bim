// Plumbing schedules: pipe lengths by system, DN and material; fittings; fixtures. All read from the model.
import type { Fixture, PipeSegment, Project } from '../schema';
import { kindOf } from './library';

export interface PipeRow { system: string; dn: number; material: string; metres: number }
export interface FittingRow { system: string; dn: number; elbows: number; tees: number }
export interface FixtureRow { kind: string; label: string; level: string; count: number }

const SYSTEM_ORDER = ['sewage', 'vent', 'cold', 'hot', 'rain'];
const length = (s: PipeSegment) => Math.hypot(s.props.end[0] - s.props.start[0], s.props.end[1] - s.props.start[1], s.props.end[2] - s.props.start[2]);
const dir = (s: PipeSegment) => {
  const d = [s.props.end[0] - s.props.start[0], s.props.end[1] - s.props.start[1], s.props.end[2] - s.props.start[2]];
  const l = Math.hypot(...d) || 1;
  return d.map((v) => Math.round((v / l) * 100) / 100).map(Math.abs).join(',');
};

export function schedule(p: Project) {
  const pipes = p.elements.filter((e): e is PipeSegment => e.type === 'PipeSegment');
  const fixtures = p.elements.filter((e): e is Fixture => e.type === 'Fixture');
  const pm = new Map<string, PipeRow>();
  for (const s of pipes) {
    const k = `${s.props.system}|${s.props.dn}|${s.props.material}`;
    const r = pm.get(k) ?? { system: s.props.system, dn: s.props.dn, material: s.props.material, metres: 0 };
    r.metres += length(s);
    pm.set(k, r);
  }
  const pipeRows = [...pm.values()].map((r) => ({ ...r, metres: Math.round(r.metres * 10) / 10 }))
    .sort((a, b) => SYSTEM_ORDER.indexOf(a.system) - SYSTEM_ORDER.indexOf(b.system) || a.dn - b.dn);

  // Fittings: where pipes of one system meet. Two pipes at an angle = elbow; three or more = tee.
  const nodes = new Map<string, { system: string; dn: number; dirs: Set<string>; n: number }>();
  for (const s of pipes) {
    for (const pt of [s.props.start, s.props.end]) {
      const k = `${s.props.system}|${pt.map((v) => v.toFixed(2)).join(',')}`;
      const v = nodes.get(k) ?? { system: s.props.system, dn: 0, dirs: new Set<string>(), n: 0 };
      v.dn = Math.max(v.dn, s.props.dn); v.dirs.add(dir(s)); v.n++;
      nodes.set(k, v);
    }
  }
  const fm = new Map<string, FittingRow>();
  for (const v of nodes.values()) {
    if (v.n < 2) continue;
    const kind = v.n >= 3 ? 'tees' : v.dirs.size > 1 ? 'elbows' : null;
    if (!kind) continue;
    const k = `${v.system}|${v.dn}`;
    const r = fm.get(k) ?? { system: v.system, dn: v.dn, elbows: 0, tees: 0 };
    r[kind]++;
    fm.set(k, r);
  }
  const fittingRows = [...fm.values()].sort((a, b) => SYSTEM_ORDER.indexOf(a.system) - SYSTEM_ORDER.indexOf(b.system) || a.dn - b.dn);

  const xm = new Map<string, FixtureRow>();
  for (const f of fixtures) {
    const k = `${f.props.kind}|${f.level}`;
    const r = xm.get(k) ?? { kind: f.props.kind, label: kindOf(f.props.kind).label, level: f.level, count: 0 };
    r.count++;
    xm.set(k, r);
  }
  const fixtureRows = [...xm.values()].sort((a, b) => a.label.localeCompare(b.label) || a.level.localeCompare(b.level));
  return { pipeRows, fittingRows, fixtureRows, totalMetres: Math.round(pipes.reduce((a, s) => a + length(s), 0) * 10) / 10 };
}

const csvCell = (v: string | number) => (typeof v === 'number' ? String(v) : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** One CSV file with three sections. */
export function scheduleCsv(p: Project): string {
  const s = schedule(p);
  const lines: string[] = ['Pipes', 'System,DN,Material,Metres', ...s.pipeRows.map((r) => [r.system, r.dn, r.material, r.metres].map(csvCell).join(',')),
    '', 'Fittings', 'System,DN,Elbows,Tees', ...s.fittingRows.map((r) => [r.system, r.dn, r.elbows, r.tees].map(csvCell).join(',')),
    '', 'Fixtures', 'Fixture,Level,Count', ...s.fixtureRows.map((r) => [r.label, r.level, r.count].map(csvCell).join(','))];
  return lines.join('\n') + '\n';
}
