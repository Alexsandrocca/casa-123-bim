import { describe, expect, it } from 'vitest';
import {
  CommandError, addOpening, deleteOpening, flipOpening, moveOpening, moveWall, nextOpeningId, renameSpace, resetLevel, resizeOpening,
} from '../src/model/commands';
import { getEl, openingSegIn, spaceArea, wallSeg, wallsOn } from '../src/model/geometry';
import { History } from '../src/model/history';
import type { Opening } from '../src/model/schema';
import { load, space } from './helpers';

const v2 = load('casa-123.json');
const area = (p: typeof v2, L: string, n: string) => +spaceArea(space(p, L, n)).toFixed(3);
const op = (p: typeof v2, id: string) => getEl(p, id) as Opening;

describe('move wall', () => {
  it('moving the kitchen/dining line resizes both rooms, and undo restores them', () => {
    const h = new History(v2);
    h.run(moveWall('SL', 'h', 7.6, 6, 7.1));
    expect(area(h.present, 'SL', 'Kitchen')).toBeCloseTo(5.4 * 2.1, 3);
    expect(area(h.present, 'SL', 'Dining')).toBeCloseTo(5.4 * 2.5, 3);
    h.undo();
    expect(area(h.present, 'SL', 'Kitchen')).toBeCloseTo(14.04, 3);
    expect(area(h.present, 'SL', 'Dining')).toBeCloseTo(10.8, 3);
    h.redo();
    expect(area(h.present, 'SL', 'Kitchen')).toBeCloseTo(11.34, 3);
  });

  it('snaps to 5 cm and keeps rooms at least 0.80 m wide', () => {
    const p = moveWall('SL', 'h', 7.6, 6, 7.62).apply(v2);
    expect(area(p, 'SL', 'Kitchen')).toBeCloseTo(5.4 * 2.6, 3);
    const q = moveWall('SL', 'h', 7.6, 6, 0).apply(v2);
    expect(space(q, 'SL', 'Kitchen').props.cells[0]!.y1).toBeCloseTo(5.8, 5);
  });

  it('refuses to move the stair walls', () => {
    expect(() => moveWall('UF', 'v', 1.6, 10, 2).apply(v2)).toThrow(CommandError);
  });

  it('moves the doors in the wall and rebuilds the walls on both sides', () => {
    // SL x=2: WC, storage and pantry doors open onto the entry hall
    const p = moveWall('SL', 'v', 2, 4, 1.5).apply(v2);
    expect(area(p, 'SL', 'WC')).toBeCloseTo(1.5 * 1.8, 3);
    for (const id of ['SL-door-04', 'SL-door-05', 'SL-door-06']) expect(openingSegIn(p, op(p, id))!.c).toBeCloseTo(1.5, 5);
    const lines = wallsOn(p, 'SL').map(wallSeg).filter((s) => s.o === 'v');
    expect(lines.some((s) => Math.abs(s.c - 1.5) < 1e-6)).toBe(true);
    expect(lines.some((s) => Math.abs(s.c - 2) < 1e-6)).toBe(false);
    // wall ids survive the move
    expect(wallsOn(p, 'SL').map((w) => w.id).sort()).toEqual(wallsOn(v2, 'SL').map((w) => w.id).sort());
  });
});

describe('openings', () => {
  it('slides a door along its wall, clamped inside the wall', () => {
    const p = moveOpening('SL-door-03', 5.02).apply(v2);
    expect(openingSegIn(p, op(p, 'SL-door-03'))!.a).toBeCloseTo(5.0, 5);
    const q = moveOpening('SL-door-03', 100).apply(v2);
    expect(openingSegIn(q, op(q, 'SL-door-03'))!.b).toBeCloseTo(8.6 - 0.05, 5);
  });

  it('resizes, flips, adds and deletes', () => {
    let p = resizeOpening('SL-door-03', 0.9).apply(v2);
    expect(op(p, 'SL-door-03').props.width).toBeCloseTo(0.9, 5);
    p = resizeOpening('SL-door-03', 0.1).apply(p);
    expect(op(p, 'SL-door-03').props.width).toBeCloseTo(0.6, 5);
    p = flipOpening('SL-door-03').apply(p);
    expect(op(p, 'SL-door-03').props.swing).toBe(-op(v2, 'SL-door-03').props.swing);
    const id = nextOpeningId(p, 'SL', 'window');
    expect(id).toBe('SL-win-10');
    p = addOpening(id, 'SL-wall-02', 2, 'window').apply(p);
    expect(openingSegIn(p, op(p, id))).toMatchObject({ o: 'v', c: 8.6, a: 1.4, b: 2.6 });
    p = deleteOpening(id).apply(p);
    expect(getEl(p, id)).toBeUndefined();
  });
});

describe('rooms and floors', () => {
  it('renames a room but refuses duplicates on the same floor', () => {
    const p = renameSpace(space(v2, 'SL', 'Pantry').id, 'Larder').apply(v2);
    expect(space(p, 'SL', 'Larder')).toBeTruthy();
    expect(() => renameSpace(space(v2, 'SL', 'Pantry').id, 'kitchen').apply(v2)).toThrow(CommandError);
  });

  it('resets one floor only', () => {
    let p = moveWall('SL', 'h', 7.6, 6, 7.1).apply(v2);
    p = moveWall('UF', 'h', 9, 6, 9.5).apply(p);
    p = resetLevel('SL', v2).apply(p);
    expect(area(p, 'SL', 'Kitchen')).toBeCloseTo(14.04, 3);
    expect(area(p, 'UF', 'Bedroom 3')).not.toBeCloseTo(area(v2, 'UF', 'Bedroom 3'), 2);
  });
});
