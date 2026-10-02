// P0: the typed command catalogue and the dry run (what P3's AI will call).
import { describe, expect, it } from 'vitest';
import { CATALOGUE, compile, dryRun, parseCalls } from '../src/model/catalogue';
import { History } from '../src/model/history';
import { spaceArea } from '../src/model/geometry';
import type { Space } from '../src/model/schema';
import { load } from './helpers';

const v2 = load('casa-123.json');
const room = (p: typeof v2, name: string, level = 'SL') => p.elements.find((e): e is Space => e.type === 'Space' && e.level === level && e.props.name === name)!;

describe('command catalogue', () => {
  it('every entry has a name, a description and a schema that rejects bad arguments', () => {
    expect(CATALOGUE.length).toBeGreaterThanOrEqual(12);
    for (const e of CATALOGUE) {
      expect(e.name).toMatch(/^[a-z_]+$/);
      expect(e.description.length).toBeGreaterThan(10);
      expect(e.args.safeParse({ nonsense: true }).success).toBe(false);
    }
    expect(() => compile(v2, { name: 'fly_to_the_moon', args: {} })).toThrow(/Unknown command/);
    expect(() => compile(v2, { name: 'resize_room', args: { room: 'Garage' } })).toThrow(/deltaM2/);
  });

  it('dry run: Garage −2 m² gives a correct diff and does not change the model until applied', () => {
    const before = JSON.stringify(v2);
    const r = dryRun(v2, parseCalls([{ name: 'resize_room', args: { room: 'Garage', deltaM2: -2 } }]));
    expect(r.ok).toBe(true);
    expect(r.steps[0]!.summary).toBe('Make Garage 2.0 m² smaller');
    // walls move in 5 cm steps: on the 5.40 m garage wall one step is 0.27 m², so −2 m² lands on 25.1 m²
    const garageArea = spaceArea(room(r.result, 'Garage'));
    expect(Math.abs(garageArea - 25.0)).toBeLessThanOrEqual(0.27 / 2 + 1e-9);
    expect(r.diff).toContain(`Garage: 27.0 → ${garageArea.toFixed(1)} m²`);
    // the room on the other side of the moved wall grows by the same area
    expect(r.diff).toContain('Kitchen: 14.0 → 15.9 m²');
    // Casa 123's street is to the east: the wall moves 0.35 m towards it
    expect(r.diff).toContain('Wall between Garage and Kitchen moved 0.35 m east');
    expect(r.checks.find((c) => c.id === 'light:SL-space-06')).toMatchObject({ before: 'pass', after: 'warn' });
    expect(JSON.stringify(v2)).toBe(before);
    // applying the dry run's command gives the same model, undoably
    const h = new History(v2);
    expect(h.run(r.commands[0]!)).toBe(true);
    expect(spaceArea(room(h.present, 'Garage'))).toBeCloseTo(garageArea, 6);
    h.undo();
    expect(spaceArea(room(h.present, 'Garage'))).toBeCloseTo(27.0, 1);
  });

  it('a failing step stops the list and says why; nothing is applied', () => {
    const r = dryRun(v2, parseCalls([
      { name: 'rename_room', args: { room: 'Kitchen', name: 'Cozinha' } },
      { name: 'resize_room', args: { room: 'Nowhere', deltaM2: 1 } },
    ]), { checks: false });
    expect(r.ok).toBe(false);
    expect(r.steps[1]!.error).toMatch(/no room “Nowhere”/);
    expect(r.commands).toHaveLength(0);
  });

  it('renames and door changes read as plain sentences', () => {
    const r = dryRun(v2, parseCalls([
      { name: 'rename_room', args: { room: 'Kitchen', name: 'Cozinha' } },
      { name: 'resize_opening', args: { id: 'SL-door-03', width: 0.9 } },
    ]), { checks: false });
    expect(r.diff).toContain('Kitchen renamed to Cozinha');
    expect(r.diff).toContain('Door SL-door-03: 0.80 → 0.90 m wide');
  });
});
