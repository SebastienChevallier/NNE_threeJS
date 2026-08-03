import type { World } from './world.js';

/** A system is a plain function run once per frame, in registration order. */
export type System = (world: World, dt: number) => void;

/** Ordered list of systems. No auto-discovery: the order is the array order. */
export class Scheduler {
  private readonly systems: { name: string; run: System }[] = [];

  add(name: string, system: System): void {
    if (this.systems.some((entry) => entry.name === name)) {
      throw new Error(`system "${name}" is already registered`);
    }
    this.systems.push({ name, run: system });
  }

  remove(name: string): void {
    const index = this.systems.findIndex((entry) => entry.name === name);
    if (index !== -1) this.systems.splice(index, 1);
  }

  names(): string[] {
    return this.systems.map((entry) => entry.name);
  }

  run(world: World, dt: number): void {
    for (const entry of this.systems) {
      try {
        entry.run(world, dt);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`system "${entry.name}" failed: ${message}`, { cause });
      }
    }
  }
}
