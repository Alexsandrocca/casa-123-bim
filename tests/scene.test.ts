import { describe, expect, it } from 'vitest';
import { moveWall } from '../src/model/commands';
import { buildScene, type BoxPart } from '../src/scene/build3d';
import { startAt, walkRoute, walkWorld } from '../src/scene/walk';
import { load } from './helpers';

const v2 = load('casa-123.json');
const scene = buildScene(v2, { doorsOpen: false });
const boxes = scene.parts.filter((p): p is BoxPart => p.kind === 'box');

describe('3D build', () => {
  it('gives every wall, slab, beam, column, footing, stair and deck some 3D parts', () => {
    const ids = new Set(scene.parts.map((p) => p.id));
    for (const e of v2.elements) {
      if (['Space', 'Opening'].includes(e.type)) continue;
      expect(ids.has(e.id), e.id).toBe(true);
    }
    for (const b of boxes) for (const v of b.s) expect(v).toBeGreaterThan(0);
  });

  it('cuts real holes for openings: the entry door leaves the wall open from floor to door head', () => {
    const wall = boxes.filter((b) => b.id === 'SL-wall-01');
    expect(wall.length).toBeGreaterThan(3);
    // at the middle of the entry door (x 1.4) nothing of the wall exists between 0.7 and 2.6
    const solid = wall.filter((b) => Math.abs(b.c[0] - 1.4) < b.s[0] / 2 && b.c[2] - b.s[2] / 2 < 2.6 && b.c[2] + b.s[2] / 2 > 0.7);
    expect(solid).toHaveLength(0);
    expect(boxes.some((b) => b.id === 'SL-door-01' && b.mat === 'door')).toBe(true);
    expect(boxes.some((b) => b.id === 'UF-win-01' && b.mat === 'glass')).toBe(true);
  });

  it('opens and closes door leaves', () => {
    const open = buildScene(v2, { doorsOpen: true }).parts.filter((p) => p.id === 'SL-door-01' && p.mat === 'door') as BoxPart[];
    const closed = boxes.filter((p) => p.id === 'SL-door-01' && p.mat === 'door');
    expect(open[0]!.s[1]).toBeGreaterThan(0.5); // swung into the house, across the wall
    expect(closed[0]!.s[1]).toBeLessThan(0.1);
  });

  it('puts 1.10 m guards on the veranda edge and around the stair well, but not along walls', () => {
    const guards = boxes.filter((b) => b.mat === 'rail');
    expect(guards.some((g) => g.id === 'SL-slab-03' && Math.abs(g.c[1] - 15) < 0.1 && g.s[0] > 8)).toBe(true);
    for (const g of guards) expect(g.c[2] + g.s[2] / 2 - (g.c[2] - 1.1 + g.s[2] / 2)).toBeCloseTo(1.1, 1);
    expect(guards.some((g) => g.id === 'SL-slab-01')).toBe(true); // the stair well on the street level
    expect(guards.some((g) => g.id === 'stair-01' || g.id === 'stair-02')).toBe(true);
    // the street-level front edge is a wall: no guard there
    expect(guards.some((g) => Math.abs(g.c[1]) < 0.1 && g.c[2] < 2)).toBe(false);
  });

  it('builds the roof parapet at +7.10 and eaves 0.40 m', () => {
    const parapet = boxes.filter((b) => b.id === 'roof-slab-01' && b.mat === 'parapet');
    expect(parapet.length).toBe(4);
    for (const b of parapet) expect(b.c[2] + b.s[2] / 2).toBeCloseTo(7.1, 5);
    const roof = boxes.filter((b) => b.id === 'roof-slab-01' && b.mat === 'roof');
    expect(Math.max(...roof.map((b) => b.c[0] + b.s[0] / 2))).toBeCloseTo(8.6 + 0.4, 5);
  });

  it('updates when a wall moves', () => {
    const moved = buildScene(moveWall('SL', 'v', 2, 4, 1.5).apply(v2));
    expect(moved.parts.some((p) => p.kind === 'box' && p.mat === 'wallWet' && Math.abs(p.c[0] - 1.5) < 1e-6)).toBe(true);
  });
});

describe('walk mode', () => {
  const world = walkWorld(buildScene(v2, { doorsOpen: true }));

  it('walks from the street, through the entry, down the stair, to the garden door and out', () => {
    const start = startAt(world, 1.4, -6);
    expect(start.foot).toBeCloseTo(0, 1);
    const r = walkRoute(world, start, [
      [1.4, -2.6], [1.4, -0.6], [1.4, 1.0], [2.6, 2.2], [2.6, 7.7], [2.45, 8.0], [2.45, 12.9], [1.6, 14.2], [1.6, 16.0],
    ]);
    expect(r.stuckAt, JSON.stringify(r.stuckAt)).toBeUndefined();
    expect(r.reached).toBe(true);
    const inside = r.path.find((s) => s.y > 1 && s.y < 2)!;
    expect(inside.foot).toBeCloseTo(0.6, 2); // street level floor
    expect(r.path.find((s) => s.y > 13.5 && s.y < 14.5)!.foot).toBeCloseTo(-2.5, 2); // lower level
    expect(r.path[r.path.length - 1]!.foot).toBeCloseTo(-2.55, 2); // garden
  });

  it('is blocked by walls', () => {
    const inHall = startAt(world, 2.6, 4, 1);
    const r = walkRoute(world, inHall, [[0.5, 4]]); // into the storage wall at x = 2.0
    expect(r.reached).toBe(false);
    expect(r.stuckAt!.x).toBeGreaterThan(2.0);
  });
});
