import { beforeEach, describe, expect, it, vi } from 'vitest';
import { World } from '../src/world.js';
import { Scheduler } from '../src/scheduler.js';

describe('Scheduler', () => {
  let world: World;
  let scheduler: Scheduler;
  beforeEach(() => { world = new World(); scheduler = new Scheduler(); });

  it('starts empty', () => {
    expect(scheduler.names()).toEqual([]);
  });

  it('keeps registration order rather than sorting', () => {
    scheduler.add('zeta', () => {});
    scheduler.add('alpha', () => {});
    expect(scheduler.names()).toEqual(['zeta', 'alpha']);
  });

  it('runs systems in registration order', () => {
    const calls: string[] = [];
    scheduler.add('first', () => calls.push('first'));
    scheduler.add('second', () => calls.push('second'));
    scheduler.run(world, 0.016);
    expect(calls).toEqual(['first', 'second']);
  });

  it('passes the world and delta time', () => {
    const system = vi.fn();
    scheduler.add('spy', system);
    scheduler.run(world, 0.5);
    expect(system).toHaveBeenCalledWith(world, 0.5);
  });

  it('refuses a duplicate system name', () => {
    scheduler.add('render', () => {});
    expect(() => scheduler.add('render', () => {})).toThrow(/already registered/);
  });

  it('removes a system', () => {
    scheduler.add('render', () => {});
    scheduler.remove('render');
    expect(scheduler.names()).toEqual([]);
  });

  it('ignores removing an unknown system', () => {
    expect(() => scheduler.remove('nope')).not.toThrow();
  });

  it('names the failing system when one throws', () => {
    scheduler.add('broken', () => { throw new Error('boom'); });
    expect(() => scheduler.run(world, 0)).toThrow(/system "broken" failed: boom/);
  });

  // Additional tests beyond the brief
  it('run on an empty scheduler does not throw', () => {
    expect(() => scheduler.run(world, 0.016)).not.toThrow();
  });

  it('after remove, the removed system is NOT called on the next run', () => {
    const system = vi.fn();
    scheduler.add('temp', system);
    scheduler.remove('temp');
    scheduler.run(world, 0.016);
    expect(system).not.toHaveBeenCalled();
  });

  it('removing a system does not disturb the relative order of the remaining ones', () => {
    const calls: string[] = [];
    scheduler.add('first', () => calls.push('first'));
    scheduler.add('second', () => calls.push('second'));
    scheduler.add('third', () => calls.push('third'));
    scheduler.remove('second');
    scheduler.run(world, 0.016);
    expect(calls).toEqual(['first', 'third']);
  });

  it('the cause of the rethrown error is the original error object', () => {
    const originalError = new Error('original');
    scheduler.add('broken', () => { throw originalError; });
    try {
      scheduler.run(world, 0);
      expect.fail('should have thrown');
    } catch (err) {
      if (err instanceof Error) {
        expect(err.cause).toBe(originalError);
      } else {
        expect.fail('error should be an Error instance');
      }
    }
  });

  it('a system that throws a non-Error value still produces a readable message', () => {
    scheduler.add('broken', () => { throw 'string error'; });
    expect(() => scheduler.run(world, 0)).toThrow(/system "broken" failed: string error/);
  });
});
