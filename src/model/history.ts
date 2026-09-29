// Undo/redo history for one version of the project.
import type { Command } from './commands';
import type { Project } from './schema';

export const HISTORY_LIMIT = 100;

export class History {
  past: Project[] = [];
  future: Project[] = [];
  constructor(public present: Project) {}

  /** Apply a command. Returns false when it changed nothing. Throws CommandError when refused. */
  run(cmd: Command): boolean {
    const next = cmd.apply(this.present);
    if (next === this.present) return false;
    this.commit(next);
    return true;
  }

  /** Record a new state (used after a drag preview). */
  commit(next: Project) {
    this.past = [...this.past, this.present].slice(-HISTORY_LIMIT);
    this.future = [];
    this.present = next;
  }

  undo(): boolean {
    const prev = this.past[this.past.length - 1];
    if (!prev) return false;
    this.past = this.past.slice(0, -1);
    this.future = [this.present, ...this.future];
    this.present = prev;
    return true;
  }

  redo(): boolean {
    const next = this.future[0];
    if (!next) return false;
    this.future = this.future.slice(1);
    this.past = [...this.past, this.present];
    this.present = next;
    return true;
  }
}
