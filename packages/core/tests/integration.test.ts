import { describe, expect, it } from 'vitest';
import { World } from '../src/world.js';
import { ComponentRegistry } from '../src/registry.js';
import { registerBuiltins, TRANSFORM } from '../src/builtins.js';
import { Scheduler } from '../src/scheduler.js';

describe('Scheduler + World integration', () => {
  it('advances every entity\'s Transform position along x by dt each frame, over several frames', () => {
    const registry = new ComponentRegistry();
    registerBuiltins(registry);

    const world = new World();
    const entities = [world.spawn('A'), world.spawn('B'), world.spawn('C')];
    for (const id of entities) {
      world.set(id, TRANSFORM, registry.createDefault(TRANSFORM));
    }

    const scheduler = new Scheduler();
    scheduler.add('move', (w, dt) => {
      for (const id of w.query(TRANSFORM)) {
        const transform = w.get(id, TRANSFORM) as { position: [number, number, number] };
        transform.position[0] += dt;
        w.set(id, TRANSFORM, transform);
      }
    });

    const dt = 0.1;
    for (let frame = 0; frame < 10; frame++) {
      scheduler.run(world, dt);
    }

    for (const id of entities) {
      const transform = world.get(id, TRANSFORM) as { position: [number, number, number] };
      expect(transform.position[0]).toBeCloseTo(1.0, 10);
      expect(transform.position[1]).toBe(0);
      expect(transform.position[2]).toBe(0);
    }
  });
});
