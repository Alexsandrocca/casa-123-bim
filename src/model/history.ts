// Undo/redo history for one version of the project. Immutable: every call returns a new history.
import type { Command } from './commands';
import type { Project } from './schema';

export const HISTORY_LIMIT = 100;

export interface Hist { present: Project; past: Project[]; future: Project[] }

export const initHist = (present: Project): Hist => ({ present, past: [], future: [] });

export const commit = (h: Hist, next: Project): Hist =>
  next === h.present ? h : { present: next, past: [...h.past, h.present].slice(-HISTORY_LIMIT), future: [] };

/** Apply a command. Throws CommandError when the command is refused. */
export const runCmd = (h: Hist, cmd: Command): Hist => commit(h, cmd.apply(h.present));

export function undo(h: Hist): Hist {
  const prev = h.past[h.past.length - 1];
  return prev ? { present: prev, past: h.past.slice(0, -1), future: [h.present, ...h.future] } : h;
}

export function redo(h: Hist): Hist {
  const next = h.future[0];
  return next ? { present: next, past: [...h.past, h.present], future: h.future.slice(1) } : h;
}

/** Small mutable wrapper, handy in tests. */
export class History {
  h: Hist;
  constructor(p: Project) { this.h = initHist(p); }
  get present() { return this.h.present; }
  run(cmd: Command) { const before = this.h; this.h = runCmd(this.h, cmd); return this.h !== before; }
  undo() { const b = this.h; this.h = undo(this.h); return this.h !== b; }
  redo() { const b = this.h; this.h = redo(this.h); return this.h !== b; }
}
