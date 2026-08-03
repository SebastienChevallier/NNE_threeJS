# Moteur ECS — Plan d'implémentation du package `core`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire `packages/core`, le cœur ECS du moteur — entités, composants, registre de schémas, format de scène JSON, ordonnanceur de systèmes et couche de commandes inversibles — sans aucune dépendance à Three.js ni au navigateur.

**Architecture:** Un `World` stocke les entités (IDs numériques), leurs métadonnées (nom, parent) et leurs composants dans des `Map` imbriquées. Un `ComponentRegistry` déclare le schéma de chaque type de composant, ce qui pilote les valeurs par défaut, la validation et (plus tard) la génération de l'Inspector. Toute mutation destinée à l'éditeur passe par un `CommandBus` qui calcule l'inverse de chaque commande avant de l'appliquer, donnant un undo/redo exhaustif par construction.

**Tech Stack:** TypeScript 5.7, Vitest 3, pnpm workspaces, Node 22. Aucune dépendance runtime.

## Global Constraints

- `packages/core` ne doit avoir **aucune dépendance runtime**, et en particulier jamais `three`. Une seule entrée autorisée dans `dependencies` : aucune.
- Toutes les données de composant doivent être sérialisables en JSON : nombres, booléens, chaînes, `null`, et tableaux de nombres. Jamais de classe, de `Map`, de fonction ni de référence circulaire.
- Les IDs d'entités sont des entiers positifs, stables, et persistés dans le fichier de scène.
- `SCENE_VERSION = 1`.
- Types de champs autorisés, exactement ces dix : `number`, `int`, `bool`, `string`, `vec3`, `euler`, `color`, `enum`, `asset`, `entity`.
- Préfixes de nommage d'assets du projet : `CHR_`, `PRP_`, `ENV_`, `UI_` (utilisés plus tard par `editor-server`, pas par `core`).
- Tout le code et les commentaires en anglais ; les messages de commit en français.
- TypeScript en mode `strict`. Aucun `any` implicite ou explicite dans le code livré.

---

### Task 1: Scaffolding du monorepo et du package `core`

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.gitignore`
- Create: `tsconfig.base.json`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/src/types.ts`
- Test: `packages/core/tests/smoke.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: les types partagés `EntityId`, `ComponentType`, `FieldType`, `FieldSpec`, `ComponentSchema`, `ComponentData`, `ValidationError`, utilisés par toutes les tâches suivantes.

- [ ] **Step 1: Créer le manifeste racine du workspace**

`package.json` :

```json
{
  "name": "nne-engine",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "@types/node": "^22.0.0"
  }
}
```

`pnpm-workspace.yaml` :

```yaml
packages:
  - 'packages/*'
```

`.gitignore` :

```
node_modules/
dist/
.cache/
*.tsbuildinfo
```

- [ ] **Step 2: Créer la configuration TypeScript partagée**

`tsconfig.base.json` :

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": false,
    "declaration": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true
  }
}
```

- [ ] **Step 3: Créer le package `core`**

`packages/core/package.json` :

```json
{
  "name": "@nne/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```

`packages/core/tsconfig.json` :

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "." },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

`packages/core/vitest.config.ts` :

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Écrire les types partagés**

`packages/core/src/types.ts` :

```ts
/** A unique, stable, persisted identifier for an entity. */
export type EntityId = number;

/** The name a component is registered under, e.g. "Transform". */
export type ComponentType = string;

/** The ten field types the Inspector knows how to render. */
export type FieldType =
  | 'number'
  | 'int'
  | 'bool'
  | 'string'
  | 'vec3'
  | 'euler'
  | 'color'
  | 'enum'
  | 'asset'
  | 'entity';

/** The declaration of a single field inside a component schema. */
export interface FieldSpec {
  type: FieldType;
  /** Value used when the component is added, and when a field is missing. */
  default: unknown;
  /** For `asset` fields: a file extension filter such as ".glb". */
  accept?: string;
  /** For `enum` fields: the allowed values. */
  options?: readonly string[];
}

/** The full declaration of a component type: its fields, in declaration order. */
export type ComponentSchema = Record<string, FieldSpec>;

/** The runtime payload of a component instance. Always JSON-serializable. */
export type ComponentData = Record<string, unknown>;

/** A single validation failure, with a dotted path to the offending value. */
export interface ValidationError {
  path: string;
  message: string;
}
```

- [ ] **Step 5: Écrire un test de fumée**

`packages/core/tests/smoke.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import type { FieldSpec } from '../src/types.js';

describe('toolchain', () => {
  it('runs typed tests', () => {
    const spec: FieldSpec = { type: 'vec3', default: [0, 0, 0] };
    expect(spec.type).toBe('vec3');
  });
});
```

- [ ] **Step 6: Installer et lancer**

```bash
pnpm install
pnpm --filter @nne/core test
pnpm --filter @nne/core typecheck
```

Attendu : 1 test passe, typecheck sans erreur.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: initialise le monorepo pnpm et le package core"
```

---

### Task 2: Cycle de vie des entités

**Files:**
- Create: `packages/core/src/world.ts`
- Test: `packages/core/tests/world-entities.test.ts`

**Interfaces:**
- Consumes: `EntityId` (Task 1).
- Produces: `class World` avec `allocateId(): EntityId`, `spawn(name?: string, parent?: EntityId | null): EntityId`, `spawnWithId(id: EntityId, name: string, parent: EntityId | null): void`, `despawn(e: EntityId): void`, `alive(e: EntityId): boolean`, `entities(): EntityId[]`, `getName(e: EntityId): string`, `setName(e: EntityId, name: string): void`. `entities()` renvoie toujours les IDs triés par ordre croissant.

- [ ] **Step 1: Écrire les tests en échec**

`packages/core/tests/world-entities.test.ts` :

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { World } from '../src/world.js';

describe('World entity lifecycle', () => {
  let world: World;
  beforeEach(() => { world = new World(); });

  it('spawns entities with increasing ids starting at 1', () => {
    expect(world.spawn()).toBe(1);
    expect(world.spawn()).toBe(2);
  });

  it('gives spawned entities a default name', () => {
    const e = world.spawn();
    expect(world.getName(e)).toBe('Entity 1');
  });

  it('keeps the provided name', () => {
    const e = world.spawn('Chaise');
    expect(world.getName(e)).toBe('Chaise');
  });

  it('renames an entity', () => {
    const e = world.spawn('Chaise');
    world.setName(e, 'Table');
    expect(world.getName(e)).toBe('Table');
  });

  it('reports liveness', () => {
    const e = world.spawn();
    expect(world.alive(e)).toBe(true);
    world.despawn(e);
    expect(world.alive(e)).toBe(false);
  });

  it('lists live entities sorted ascending', () => {
    const a = world.spawn();
    const b = world.spawn();
    const c = world.spawn();
    world.despawn(b);
    expect(world.entities()).toEqual([a, c]);
  });

  it('never reuses an id after despawn', () => {
    const a = world.spawn();
    world.despawn(a);
    expect(world.spawn()).toBe(2);
  });

  it('allocates an id without spawning', () => {
    const id = world.allocateId();
    expect(id).toBe(1);
    expect(world.alive(id)).toBe(false);
    expect(world.spawn()).toBe(2);
  });

  it('spawns with an explicit id and advances the counter past it', () => {
    world.spawnWithId(42, 'Importee', null);
    expect(world.alive(42)).toBe(true);
    expect(world.getName(42)).toBe('Importee');
    expect(world.spawn()).toBe(43);
  });

  it('throws when spawning an id that is already live', () => {
    world.spawnWithId(7, 'A', null);
    expect(() => world.spawnWithId(7, 'B', null)).toThrow(/already live/);
  });

  it('throws when reading a dead entity', () => {
    expect(() => world.getName(99)).toThrow(/unknown entity 99/);
  });

  it('ignores despawning a dead entity', () => {
    expect(() => world.despawn(99)).not.toThrow();
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @nne/core test -- world-entities`
Attendu : ÉCHEC — `Cannot find module '../src/world.js'`.

- [ ] **Step 3: Implémenter le minimum**

`packages/core/src/world.ts` :

```ts
import type { EntityId } from './types.js';

/**
 * Holds every entity, its metadata and its components.
 * Deliberately free of any rendering concern: `core` never imports three.js.
 */
export class World {
  private nextId: EntityId = 1;
  private readonly live = new Set<EntityId>();
  private readonly names = new Map<EntityId, string>();

  /** Reserves the next id without creating an entity. Used by commands. */
  allocateId(): EntityId {
    return this.nextId++;
  }

  spawn(name?: string, parent: EntityId | null = null): EntityId {
    const id = this.allocateId();
    this.spawnWithId(id, name ?? `Entity ${id}`, parent);
    return id;
  }

  /** Creates an entity at a caller-chosen id. Used by scene loading and undo. */
  spawnWithId(id: EntityId, name: string, _parent: EntityId | null): void {
    if (this.live.has(id)) {
      throw new Error(`entity ${id} is already live`);
    }
    this.live.add(id);
    this.names.set(id, name);
    if (id >= this.nextId) this.nextId = id + 1;
  }

  despawn(entity: EntityId): void {
    this.live.delete(entity);
    this.names.delete(entity);
  }

  alive(entity: EntityId): boolean {
    return this.live.has(entity);
  }

  entities(): EntityId[] {
    return [...this.live].sort((a, b) => a - b);
  }

  getName(entity: EntityId): string {
    this.assertAlive(entity);
    return this.names.get(entity) as string;
  }

  setName(entity: EntityId, name: string): void {
    this.assertAlive(entity);
    this.names.set(entity, name);
  }

  protected assertAlive(entity: EntityId): void {
    if (!this.live.has(entity)) {
      throw new Error(`unknown entity ${entity}`);
    }
  }
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `pnpm --filter @nne/core test -- world-entities`
Attendu : PASSE (12 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/world.ts packages/core/tests/world-entities.test.ts
git commit -m "feat(core): cycle de vie des entites du World"
```

---

### Task 3: Hiérarchie parent/enfant

**Files:**
- Modify: `packages/core/src/world.ts`
- Test: `packages/core/tests/world-hierarchy.test.ts`

**Interfaces:**
- Consumes: `World` (Task 2).
- Produces: `getParent(e: EntityId): EntityId | null`, `setParent(e: EntityId, parent: EntityId | null): void`, `children(e: EntityId): EntityId[]` (triés croissants), `subtree(e: EntityId): EntityId[]` (l'entité elle-même en premier, puis ses descendants en ordre parents-avant-enfants). `despawn` devient récursif sur le sous-arbre.

- [ ] **Step 1: Écrire les tests en échec**

`packages/core/tests/world-hierarchy.test.ts` :

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { World } from '../src/world.js';

describe('World hierarchy', () => {
  let world: World;
  beforeEach(() => { world = new World(); });

  it('spawns at the root by default', () => {
    const e = world.spawn();
    expect(world.getParent(e)).toBeNull();
  });

  it('spawns under a parent', () => {
    const p = world.spawn('Parent');
    const c = world.spawn('Child', p);
    expect(world.getParent(c)).toBe(p);
    expect(world.children(p)).toEqual([c]);
  });

  it('lists children sorted ascending', () => {
    const p = world.spawn();
    const a = world.spawn('A', p);
    const b = world.spawn('B', p);
    expect(world.children(p)).toEqual([a, b]);
  });

  it('reparents an entity and updates both child lists', () => {
    const p1 = world.spawn();
    const p2 = world.spawn();
    const c = world.spawn('C', p1);
    world.setParent(c, p2);
    expect(world.getParent(c)).toBe(p2);
    expect(world.children(p1)).toEqual([]);
    expect(world.children(p2)).toEqual([c]);
  });

  it('unparents to the root', () => {
    const p = world.spawn();
    const c = world.spawn('C', p);
    world.setParent(c, null);
    expect(world.getParent(c)).toBeNull();
    expect(world.children(p)).toEqual([]);
  });

  it('refuses to parent an entity to itself', () => {
    const e = world.spawn();
    expect(() => world.setParent(e, e)).toThrow(/cycle/);
  });

  it('refuses to create a cycle through a descendant', () => {
    const a = world.spawn();
    const b = world.spawn('B', a);
    const c = world.spawn('C', b);
    expect(() => world.setParent(a, c)).toThrow(/cycle/);
  });

  it('returns the subtree with parents before children', () => {
    const a = world.spawn('A');
    const b = world.spawn('B', a);
    const c = world.spawn('C', b);
    const d = world.spawn('D', a);
    expect(world.subtree(a)).toEqual([a, b, d, c]);
  });

  it('despawns the whole subtree', () => {
    const a = world.spawn('A');
    const b = world.spawn('B', a);
    const c = world.spawn('C', b);
    const other = world.spawn('Other');
    world.despawn(a);
    expect(world.alive(a)).toBe(false);
    expect(world.alive(b)).toBe(false);
    expect(world.alive(c)).toBe(false);
    expect(world.alive(other)).toBe(true);
  });

  it('removes a despawned child from its parent list', () => {
    const p = world.spawn();
    const c = world.spawn('C', p);
    world.despawn(c);
    expect(world.children(p)).toEqual([]);
  });

  it('throws when parenting to a dead entity', () => {
    const e = world.spawn();
    expect(() => world.setParent(e, 99)).toThrow(/unknown entity 99/);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @nne/core test -- world-hierarchy`
Attendu : ÉCHEC — `world.getParent is not a function`.

- [ ] **Step 3: Implémenter**

Dans `packages/core/src/world.ts`, ajouter le champ `parents` et remplacer `spawnWithId` et `despawn` :

```ts
  private readonly parents = new Map<EntityId, EntityId | null>();

  spawnWithId(id: EntityId, name: string, parent: EntityId | null): void {
    if (this.live.has(id)) {
      throw new Error(`entity ${id} is already live`);
    }
    if (parent !== null) this.assertAlive(parent);
    this.live.add(id);
    this.names.set(id, name);
    this.parents.set(id, parent);
    if (id >= this.nextId) this.nextId = id + 1;
  }

  despawn(entity: EntityId): void {
    if (!this.live.has(entity)) return;
    // Depth-first, children before parents, so no orphan is ever left behind.
    for (const id of this.subtree(entity).reverse()) {
      this.live.delete(id);
      this.names.delete(id);
      this.parents.delete(id);
    }
  }

  getParent(entity: EntityId): EntityId | null {
    this.assertAlive(entity);
    return this.parents.get(entity) ?? null;
  }

  setParent(entity: EntityId, parent: EntityId | null): void {
    this.assertAlive(entity);
    if (parent !== null) {
      this.assertAlive(parent);
      if (this.subtree(entity).includes(parent)) {
        throw new Error(`parenting ${entity} to ${parent} would create a cycle`);
      }
    }
    this.parents.set(entity, parent);
  }

  children(entity: EntityId): EntityId[] {
    this.assertAlive(entity);
    return this.entities().filter((id) => this.parents.get(id) === entity);
  }

  /** The entity followed by all its descendants, breadth-first. */
  subtree(entity: EntityId): EntityId[] {
    this.assertAlive(entity);
    const out: EntityId[] = [entity];
    for (let i = 0; i < out.length; i++) {
      out.push(...this.children(out[i] as EntityId));
    }
    return out;
  }
```

- [ ] **Step 4: Lancer les tests**

Run: `pnpm --filter @nne/core test`
Attendu : PASSE (tous les fichiers).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/world.ts packages/core/tests/world-hierarchy.test.ts
git commit -m "feat(core): hierarchie parent/enfant avec garde anti-cycle"
```

---

### Task 4: Stockage des composants

**Files:**
- Modify: `packages/core/src/world.ts`
- Test: `packages/core/tests/world-components.test.ts`

**Interfaces:**
- Consumes: `World` (Task 3), `ComponentType`, `ComponentData` (Task 1).
- Produces: `set(e: EntityId, type: ComponentType, data: ComponentData): void`, `get(e: EntityId, type: ComponentType): ComponentData | undefined`, `has(e: EntityId, type: ComponentType): boolean`, `remove(e: EntityId, type: ComponentType): void`, `componentsOf(e: EntityId): Record<ComponentType, ComponentData>` (clés triées alphabétiquement).

- [ ] **Step 1: Écrire les tests en échec**

`packages/core/tests/world-components.test.ts` :

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { World } from '../src/world.js';

describe('World components', () => {
  let world: World;
  let e: number;
  beforeEach(() => { world = new World(); e = world.spawn(); });

  it('sets and reads a component', () => {
    world.set(e, 'Transform', { position: [1, 2, 3] });
    expect(world.get(e, 'Transform')).toEqual({ position: [1, 2, 3] });
  });

  it('returns undefined for a missing component', () => {
    expect(world.get(e, 'Mesh')).toBeUndefined();
  });

  it('reports presence', () => {
    expect(world.has(e, 'Mesh')).toBe(false);
    world.set(e, 'Mesh', { asset: null });
    expect(world.has(e, 'Mesh')).toBe(true);
  });

  it('overwrites on a second set', () => {
    world.set(e, 'Mesh', { asset: 'a.glb' });
    world.set(e, 'Mesh', { asset: 'b.glb' });
    expect(world.get(e, 'Mesh')).toEqual({ asset: 'b.glb' });
  });

  it('removes a component', () => {
    world.set(e, 'Mesh', { asset: null });
    world.remove(e, 'Mesh');
    expect(world.has(e, 'Mesh')).toBe(false);
  });

  it('ignores removing a missing component', () => {
    expect(() => world.remove(e, 'Mesh')).not.toThrow();
  });

  it('stores a defensive copy so callers cannot mutate world state', () => {
    const data = { position: [0, 0, 0] };
    world.set(e, 'Transform', data);
    data.position[0] = 99;
    expect(world.get(e, 'Transform')).toEqual({ position: [0, 0, 0] });
  });

  it('returns a defensive copy on read', () => {
    world.set(e, 'Transform', { position: [0, 0, 0] });
    const read = world.get(e, 'Transform') as { position: number[] };
    read.position[0] = 99;
    expect(world.get(e, 'Transform')).toEqual({ position: [0, 0, 0] });
  });

  it('lists components of an entity with sorted keys', () => {
    world.set(e, 'Mesh', { asset: null });
    world.set(e, 'Camera', { fov: 60 });
    expect(Object.keys(world.componentsOf(e))).toEqual(['Camera', 'Mesh']);
  });

  it('drops components when the entity is despawned', () => {
    world.set(e, 'Mesh', { asset: null });
    world.despawn(e);
    const reborn = world.spawn();
    expect(world.has(reborn, 'Mesh')).toBe(false);
  });

  it('throws when setting on a dead entity', () => {
    expect(() => world.set(99, 'Mesh', {})).toThrow(/unknown entity 99/);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @nne/core test -- world-components`
Attendu : ÉCHEC — `world.set is not a function`.

- [ ] **Step 3: Implémenter**

Dans `packages/core/src/world.ts`, importer `ComponentData` et `ComponentType`, ajouter le stockage et les méthodes, et purger les composants dans `despawn` :

```ts
  /** componentType -> entityId -> data */
  private readonly stores = new Map<ComponentType, Map<EntityId, ComponentData>>();

  set(entity: EntityId, type: ComponentType, data: ComponentData): void {
    this.assertAlive(entity);
    let store = this.stores.get(type);
    if (!store) {
      store = new Map<EntityId, ComponentData>();
      this.stores.set(type, store);
    }
    store.set(entity, structuredClone(data));
  }

  get(entity: EntityId, type: ComponentType): ComponentData | undefined {
    this.assertAlive(entity);
    const data = this.stores.get(type)?.get(entity);
    return data === undefined ? undefined : structuredClone(data);
  }

  has(entity: EntityId, type: ComponentType): boolean {
    this.assertAlive(entity);
    return this.stores.get(type)?.has(entity) ?? false;
  }

  remove(entity: EntityId, type: ComponentType): void {
    this.assertAlive(entity);
    this.stores.get(type)?.delete(entity);
  }

  componentsOf(entity: EntityId): Record<ComponentType, ComponentData> {
    this.assertAlive(entity);
    const out: Record<ComponentType, ComponentData> = {};
    for (const type of [...this.stores.keys()].sort()) {
      const data = this.stores.get(type)?.get(entity);
      if (data !== undefined) out[type] = structuredClone(data);
    }
    return out;
  }
```

Dans la boucle de `despawn`, ajouter après `this.parents.delete(id)` :

```ts
      for (const store of this.stores.values()) store.delete(id);
```

- [ ] **Step 4: Lancer les tests**

Run: `pnpm --filter @nne/core test`
Attendu : PASSE.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/world.ts packages/core/tests/world-components.test.ts
git commit -m "feat(core): stockage des composants avec copies defensives"
```

---

### Task 5: Requêtes

**Files:**
- Modify: `packages/core/src/world.ts`
- Test: `packages/core/tests/world-query.test.ts`

**Interfaces:**
- Consumes: `World` (Task 4).
- Produces: `query(...types: ComponentType[]): EntityId[]`, renvoyant les entités possédant **tous** les types demandés, triées par ID croissant. `query()` sans argument renvoie `entities()`.

- [ ] **Step 1: Écrire les tests en échec**

`packages/core/tests/world-query.test.ts` :

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { World } from '../src/world.js';

describe('World.query', () => {
  let world: World;
  beforeEach(() => { world = new World(); });

  it('returns all entities when called with no type', () => {
    const a = world.spawn();
    const b = world.spawn();
    expect(world.query()).toEqual([a, b]);
  });

  it('returns entities holding a single component', () => {
    const a = world.spawn();
    const b = world.spawn();
    world.set(a, 'Mesh', {});
    expect(world.query('Mesh')).toEqual([a]);
    expect(world.query('Mesh')).not.toContain(b);
  });

  it('intersects several components', () => {
    const a = world.spawn();
    const b = world.spawn();
    const c = world.spawn();
    world.set(a, 'Transform', {});
    world.set(a, 'Mesh', {});
    world.set(b, 'Transform', {});
    world.set(c, 'Mesh', {});
    expect(world.query('Transform', 'Mesh')).toEqual([a]);
  });

  it('returns an empty array for an unknown component', () => {
    world.spawn();
    expect(world.query('Nope')).toEqual([]);
  });

  it('returns results sorted ascending', () => {
    const a = world.spawn();
    const b = world.spawn();
    const c = world.spawn();
    for (const e of [c, a, b]) world.set(e, 'Mesh', {});
    expect(world.query('Mesh')).toEqual([a, b, c]);
  });

  it('excludes despawned entities', () => {
    const a = world.spawn();
    world.set(a, 'Mesh', {});
    world.despawn(a);
    expect(world.query('Mesh')).toEqual([]);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @nne/core test -- world-query`
Attendu : ÉCHEC — `world.query is not a function`.

- [ ] **Step 3: Implémenter**

Dans `packages/core/src/world.ts` :

```ts
  /**
   * Entities holding every requested component, sorted ascending.
   * Starts from the smallest store so the intersection stays cheap.
   */
  query(...types: ComponentType[]): EntityId[] {
    if (types.length === 0) return this.entities();

    const stores: Map<EntityId, ComponentData>[] = [];
    for (const type of types) {
      const store = this.stores.get(type);
      if (!store || store.size === 0) return [];
      stores.push(store);
    }
    stores.sort((a, b) => a.size - b.size);

    const [smallest, ...rest] = stores as [Map<EntityId, ComponentData>, ...Map<EntityId, ComponentData>[]];
    const out: EntityId[] = [];
    for (const id of smallest.keys()) {
      if (!this.live.has(id)) continue;
      if (rest.every((store) => store.has(id))) out.push(id);
    }
    return out.sort((a, b) => a - b);
  }
```

- [ ] **Step 4: Lancer les tests**

Run: `pnpm --filter @nne/core test`
Attendu : PASSE.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/world.ts packages/core/tests/world-query.test.ts
git commit -m "feat(core): requetes par intersection de composants"
```

---

### Task 6: Registre de composants et valeurs par défaut

**Files:**
- Create: `packages/core/src/registry.ts`
- Test: `packages/core/tests/registry.test.ts`

**Interfaces:**
- Consumes: `ComponentType`, `ComponentSchema`, `ComponentData`, `FieldSpec` (Task 1).
- Produces: `class ComponentRegistry` avec `define(type: ComponentType, schema: ComponentSchema): void`, `get(type: ComponentType): ComponentSchema | undefined`, `has(type: ComponentType): boolean`, `list(): ComponentType[]` (trié), `createDefault(type: ComponentType): ComponentData`.

- [ ] **Step 1: Écrire les tests en échec**

`packages/core/tests/registry.test.ts` :

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { ComponentRegistry } from '../src/registry.js';

describe('ComponentRegistry', () => {
  let registry: ComponentRegistry;
  beforeEach(() => { registry = new ComponentRegistry(); });

  it('defines and reads back a schema', () => {
    registry.define('Mesh', { asset: { type: 'asset', default: null, accept: '.glb' } });
    expect(registry.get('Mesh')).toEqual({
      asset: { type: 'asset', default: null, accept: '.glb' },
    });
  });

  it('reports presence', () => {
    expect(registry.has('Mesh')).toBe(false);
    registry.define('Mesh', {});
    expect(registry.has('Mesh')).toBe(true);
  });

  it('lists registered types sorted', () => {
    registry.define('Mesh', {});
    registry.define('Camera', {});
    expect(registry.list()).toEqual(['Camera', 'Mesh']);
  });

  it('refuses a duplicate definition', () => {
    registry.define('Mesh', {});
    expect(() => registry.define('Mesh', {})).toThrow(/already defined/);
  });

  it('refuses an unknown field type', () => {
    expect(() =>
      registry.define('Bad', { x: { type: 'quaternion' as never, default: null } }),
    ).toThrow(/unknown field type "quaternion"/);
  });

  it('refuses an enum field without options', () => {
    expect(() =>
      registry.define('Bad', { kind: { type: 'enum', default: 'a' } }),
    ).toThrow(/enum field "kind" needs options/);
  });

  it('refuses an enum whose default is not among its options', () => {
    expect(() =>
      registry.define('Bad', { kind: { type: 'enum', default: 'z', options: ['a', 'b'] } }),
    ).toThrow(/default "z" is not among options/);
  });

  it('builds default data from the schema', () => {
    registry.define('Transform', {
      position: { type: 'vec3', default: [0, 0, 0] },
      scale: { type: 'vec3', default: [1, 1, 1] },
    });
    expect(registry.createDefault('Transform')).toEqual({
      position: [0, 0, 0],
      scale: [1, 1, 1],
    });
  });

  it('returns a fresh copy of defaults each time', () => {
    registry.define('Transform', { position: { type: 'vec3', default: [0, 0, 0] } });
    const first = registry.createDefault('Transform') as { position: number[] };
    first.position[0] = 99;
    expect(registry.createDefault('Transform')).toEqual({ position: [0, 0, 0] });
  });

  it('throws when building defaults for an unknown type', () => {
    expect(() => registry.createDefault('Nope')).toThrow(/unknown component type "Nope"/);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @nne/core test -- registry`
Attendu : ÉCHEC — `Cannot find module '../src/registry.js'`.

- [ ] **Step 3: Implémenter**

`packages/core/src/registry.ts` :

```ts
import type {
  ComponentData,
  ComponentSchema,
  ComponentType,
  FieldType,
} from './types.js';

/** The only field types the engine and the Inspector understand. */
export const FIELD_TYPES: readonly FieldType[] = [
  'number', 'int', 'bool', 'string', 'vec3',
  'euler', 'color', 'enum', 'asset', 'entity',
];

/**
 * Single source of truth for component shapes.
 * Feeds the Inspector, scene validation, default values and the build's
 * asset dependency graph.
 */
export class ComponentRegistry {
  private readonly schemas = new Map<ComponentType, ComponentSchema>();

  define(type: ComponentType, schema: ComponentSchema): void {
    if (this.schemas.has(type)) {
      throw new Error(`component "${type}" is already defined`);
    }
    for (const [field, spec] of Object.entries(schema)) {
      if (!FIELD_TYPES.includes(spec.type)) {
        throw new Error(`unknown field type "${spec.type}" on "${type}.${field}"`);
      }
      if (spec.type === 'enum') {
        if (!spec.options || spec.options.length === 0) {
          throw new Error(`enum field "${field}" needs options on "${type}"`);
        }
        if (!spec.options.includes(spec.default as string)) {
          throw new Error(
            `default "${String(spec.default)}" is not among options on "${type}.${field}"`,
          );
        }
      }
    }
    this.schemas.set(type, schema);
  }

  get(type: ComponentType): ComponentSchema | undefined {
    return this.schemas.get(type);
  }

  has(type: ComponentType): boolean {
    return this.schemas.has(type);
  }

  list(): ComponentType[] {
    return [...this.schemas.keys()].sort();
  }

  createDefault(type: ComponentType): ComponentData {
    const schema = this.schemas.get(type);
    if (!schema) throw new Error(`unknown component type "${type}"`);
    const out: ComponentData = {};
    for (const [field, spec] of Object.entries(schema)) {
      out[field] = structuredClone(spec.default);
    }
    return out;
  }
}
```

- [ ] **Step 4: Lancer les tests**

Run: `pnpm --filter @nne/core test`
Attendu : PASSE.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/registry.ts packages/core/tests/registry.test.ts
git commit -m "feat(core): registre de schemas de composants"
```

---

### Task 7: Validation des données de composant

**Files:**
- Modify: `packages/core/src/registry.ts`
- Test: `packages/core/tests/registry-validate.test.ts`

**Interfaces:**
- Consumes: `ComponentRegistry` (Task 6), `ValidationError` (Task 1).
- Produces: `validate(type: ComponentType, data: unknown): ValidationError[]` — tableau vide si valide. Les `path` sont de la forme `"Transform.position"`.

- [ ] **Step 1: Écrire les tests en échec**

`packages/core/tests/registry-validate.test.ts` :

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { ComponentRegistry } from '../src/registry.js';

describe('ComponentRegistry.validate', () => {
  let registry: ComponentRegistry;
  beforeEach(() => {
    registry = new ComponentRegistry();
    registry.define('Sample', {
      num: { type: 'number', default: 0 },
      count: { type: 'int', default: 0 },
      flag: { type: 'bool', default: false },
      label: { type: 'string', default: '' },
      position: { type: 'vec3', default: [0, 0, 0] },
      rotation: { type: 'euler', default: [0, 0, 0] },
      tint: { type: 'color', default: '#ffffff' },
      kind: { type: 'enum', default: 'a', options: ['a', 'b'] },
      asset: { type: 'asset', default: null, accept: '.glb' },
      target: { type: 'entity', default: null },
    });
  });

  const valid = {
    num: 1.5, count: 3, flag: true, label: 'hi',
    position: [1, 2, 3], rotation: [0, 0, 0], tint: '#ff0000',
    kind: 'b', asset: 'assets/PRP_Chair_01.glb', target: 7,
  };

  it('accepts fully valid data', () => {
    expect(registry.validate('Sample', valid)).toEqual([]);
  });

  it('accepts null for asset and entity fields', () => {
    expect(registry.validate('Sample', { ...valid, asset: null, target: null })).toEqual([]);
  });

  it('rejects an unknown component type', () => {
    expect(registry.validate('Nope', {})).toEqual([
      { path: 'Nope', message: 'unknown component type' },
    ]);
  });

  it('rejects non-object data', () => {
    expect(registry.validate('Sample', 42)).toEqual([
      { path: 'Sample', message: 'expected an object' },
    ]);
  });

  it('reports a missing field', () => {
    const { num: _num, ...rest } = valid;
    expect(registry.validate('Sample', rest)).toContainEqual({
      path: 'Sample.num', message: 'missing field',
    });
  });

  it('reports an unknown field', () => {
    expect(registry.validate('Sample', { ...valid, extra: 1 })).toContainEqual({
      path: 'Sample.extra', message: 'unknown field',
    });
  });

  it('rejects a non-finite number', () => {
    expect(registry.validate('Sample', { ...valid, num: Number.NaN })).toContainEqual({
      path: 'Sample.num', message: 'expected a finite number',
    });
  });

  it('rejects a non-integer int', () => {
    expect(registry.validate('Sample', { ...valid, count: 1.5 })).toContainEqual({
      path: 'Sample.count', message: 'expected an integer',
    });
  });

  it('rejects a wrong-typed boolean', () => {
    expect(registry.validate('Sample', { ...valid, flag: 'yes' })).toContainEqual({
      path: 'Sample.flag', message: 'expected a boolean',
    });
  });

  it('rejects a vec3 of the wrong length', () => {
    expect(registry.validate('Sample', { ...valid, position: [1, 2] })).toContainEqual({
      path: 'Sample.position', message: 'expected an array of 3 finite numbers',
    });
  });

  it('rejects a malformed color', () => {
    expect(registry.validate('Sample', { ...valid, tint: 'red' })).toContainEqual({
      path: 'Sample.tint', message: 'expected a hex color such as #ff0000',
    });
  });

  it('rejects an enum value outside its options', () => {
    expect(registry.validate('Sample', { ...valid, kind: 'z' })).toContainEqual({
      path: 'Sample.kind', message: 'expected one of: a, b',
    });
  });

  it('rejects a non-integer entity reference', () => {
    expect(registry.validate('Sample', { ...valid, target: 'x' })).toContainEqual({
      path: 'Sample.target', message: 'expected an entity id or null',
    });
  });

  it('collects several errors at once', () => {
    expect(registry.validate('Sample', { ...valid, num: 'x', flag: 'y' })).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @nne/core test -- registry-validate`
Attendu : ÉCHEC — `registry.validate is not a function`.

- [ ] **Step 3: Implémenter**

Dans `packages/core/src/registry.ts`, importer `ValidationError` et `FieldSpec`, puis ajouter :

```ts
  /** Returns every problem found in `data`. An empty array means valid. */
  validate(type: ComponentType, data: unknown): ValidationError[] {
    const schema = this.schemas.get(type);
    if (!schema) return [{ path: type, message: 'unknown component type' }];
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return [{ path: type, message: 'expected an object' }];
    }

    const errors: ValidationError[] = [];
    const record = data as Record<string, unknown>;

    for (const [field, spec] of Object.entries(schema)) {
      const path = `${type}.${field}`;
      if (!(field in record)) {
        errors.push({ path, message: 'missing field' });
        continue;
      }
      const message = checkField(spec, record[field]);
      if (message) errors.push({ path, message });
    }
    for (const field of Object.keys(record)) {
      if (!(field in schema)) {
        errors.push({ path: `${type}.${field}`, message: 'unknown field' });
      }
    }
    return errors;
  }
```

Puis, au niveau module (hors de la classe) :

```ts
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function isTriple(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

/** Returns an error message, or null when the value fits the spec. */
function checkField(spec: FieldSpec, value: unknown): string | null {
  switch (spec.type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? null : 'expected a finite number';
    case 'int':
      return typeof value === 'number' && Number.isInteger(value)
        ? null : 'expected an integer';
    case 'bool':
      return typeof value === 'boolean' ? null : 'expected a boolean';
    case 'string':
      return typeof value === 'string' ? null : 'expected a string';
    case 'vec3':
    case 'euler':
      return isTriple(value) ? null : 'expected an array of 3 finite numbers';
    case 'color':
      return typeof value === 'string' && HEX_COLOR.test(value)
        ? null : 'expected a hex color such as #ff0000';
    case 'enum':
      return (spec.options ?? []).includes(value as string)
        ? null : `expected one of: ${(spec.options ?? []).join(', ')}`;
    case 'asset':
      return value === null || typeof value === 'string'
        ? null : 'expected an asset path or null';
    case 'entity':
      return value === null || (typeof value === 'number' && Number.isInteger(value))
        ? null : 'expected an entity id or null';
  }
}
```

- [ ] **Step 4: Lancer les tests**

Run: `pnpm --filter @nne/core test`
Attendu : PASSE.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/registry.ts packages/core/tests/registry-validate.test.ts
git commit -m "feat(core): validation des donnees de composant contre leur schema"
```

---

### Task 8: Composants fournis

**Files:**
- Create: `packages/core/src/builtins.ts`
- Test: `packages/core/tests/builtins.test.ts`

**Interfaces:**
- Consumes: `ComponentRegistry` (Task 7).
- Produces: `registerBuiltins(registry: ComponentRegistry): void`, et les constantes `TRANSFORM`, `MESH`, `CAMERA`, `LIGHT` (valeurs `'Transform'`, `'Mesh'`, `'Camera'`, `'Light'`) réutilisées par `runtime` et `editor`.

- [ ] **Step 1: Écrire les tests en échec**

`packages/core/tests/builtins.test.ts` :

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { ComponentRegistry } from '../src/registry.js';
import { CAMERA, LIGHT, MESH, TRANSFORM, registerBuiltins } from '../src/builtins.js';

describe('builtin components', () => {
  let registry: ComponentRegistry;
  beforeEach(() => {
    registry = new ComponentRegistry();
    registerBuiltins(registry);
  });

  it('registers exactly the four builtin components', () => {
    expect(registry.list()).toEqual(['Camera', 'Light', 'Mesh', 'Transform']);
  });

  it('exposes the component names as constants', () => {
    expect([TRANSFORM, MESH, CAMERA, LIGHT]).toEqual(['Transform', 'Mesh', 'Camera', 'Light']);
  });

  it('defaults Transform to identity', () => {
    expect(registry.createDefault(TRANSFORM)).toEqual({
      position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    });
  });

  it('defaults Mesh to no asset', () => {
    expect(registry.createDefault(MESH)).toEqual({ asset: null, castShadow: true });
  });

  it('defaults Camera to a 60 degree perspective', () => {
    expect(registry.createDefault(CAMERA)).toEqual({
      fov: 60, near: 0.1, far: 1000, active: true,
    });
  });

  it('defaults Light to a white directional light', () => {
    expect(registry.createDefault(LIGHT)).toEqual({
      type: 'directional', color: '#ffffff', intensity: 1,
    });
  });

  it('accepts the four light types', () => {
    for (const type of ['directional', 'point', 'ambient', 'spot']) {
      const data = { ...registry.createDefault(LIGHT), type };
      expect(registry.validate(LIGHT, data)).toEqual([]);
    }
  });

  it('rejects an unknown light type', () => {
    const data = { ...registry.createDefault(LIGHT), type: 'laser' };
    expect(registry.validate(LIGHT, data)).toContainEqual({
      path: 'Light.type',
      message: 'expected one of: directional, point, ambient, spot',
    });
  });

  it('validates every builtin default against its own schema', () => {
    for (const type of registry.list()) {
      expect(registry.validate(type, registry.createDefault(type))).toEqual([]);
    }
  });

  it('restricts Mesh assets to .glb', () => {
    expect(registry.get(MESH)?.asset?.accept).toBe('.glb');
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @nne/core test -- builtins`
Attendu : ÉCHEC — `Cannot find module '../src/builtins.js'`.

- [ ] **Step 3: Implémenter**

`packages/core/src/builtins.ts` :

```ts
import type { ComponentRegistry } from './registry.js';

export const TRANSFORM = 'Transform';
export const MESH = 'Mesh';
export const CAMERA = 'Camera';
export const LIGHT = 'Light';

export const LIGHT_TYPES = ['directional', 'point', 'ambient', 'spot'] as const;

/** Defines the four components every project starts with. */
export function registerBuiltins(registry: ComponentRegistry): void {
  registry.define(TRANSFORM, {
    position: { type: 'vec3', default: [0, 0, 0] },
    rotation: { type: 'euler', default: [0, 0, 0] },
    scale: { type: 'vec3', default: [1, 1, 1] },
  });

  registry.define(MESH, {
    asset: { type: 'asset', default: null, accept: '.glb' },
    castShadow: { type: 'bool', default: true },
  });

  registry.define(CAMERA, {
    fov: { type: 'number', default: 60 },
    near: { type: 'number', default: 0.1 },
    far: { type: 'number', default: 1000 },
    active: { type: 'bool', default: true },
  });

  registry.define(LIGHT, {
    type: { type: 'enum', default: 'directional', options: LIGHT_TYPES },
    color: { type: 'color', default: '#ffffff' },
    intensity: { type: 'number', default: 1 },
  });
}
```

- [ ] **Step 4: Lancer les tests**

Run: `pnpm --filter @nne/core test`
Attendu : PASSE.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/builtins.ts packages/core/tests/builtins.test.ts
git commit -m "feat(core): composants Transform, Mesh, Camera et Light"
```

---

### Task 9: Sérialisation de scène

**Files:**
- Create: `packages/core/src/scene.ts`
- Test: `packages/core/tests/scene.test.ts`

**Interfaces:**
- Consumes: `World` (Task 5), `ComponentRegistry` (Task 7), `registerBuiltins` (Task 8).
- Produces: `SCENE_VERSION`, `interface SceneEntity`, `interface SceneFile`, `serializeScene(world: World, name: string): SceneFile`, `deserializeScene(file: SceneFile): World`, `stringifyScene(file: SceneFile): string`.

Le `World` n'a besoin d'aucun registre pour être construit ; la validation est une étape séparée (Task 10).

- [ ] **Step 1: Écrire les tests en échec**

`packages/core/tests/scene.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.js';
import {
  SCENE_VERSION, deserializeScene, serializeScene, stringifyScene,
} from '../src/scene.js';

function sampleWorld(): World {
  const world = new World();
  const cam = world.spawn('Camera principale');
  world.set(cam, 'Transform', { position: [0, 1.6, 5], rotation: [0, 0, 0], scale: [1, 1, 1] });
  world.set(cam, 'Camera', { fov: 60, near: 0.1, far: 1000, active: true });
  const chair = world.spawn('Chaise', cam);
  world.set(chair, 'Mesh', { asset: 'assets/PRP_Chair_01.glb', castShadow: true });
  return world;
}

describe('scene serialization', () => {
  it('writes the current scene version', () => {
    expect(serializeScene(new World(), 'Empty').version).toBe(SCENE_VERSION);
  });

  it('writes the scene name', () => {
    expect(serializeScene(new World(), 'Scene_01').name).toBe('Scene_01');
  });

  it('serializes entities with id, name and components', () => {
    const file = serializeScene(sampleWorld(), 'Scene_01');
    expect(file.entities[0]).toEqual({
      id: 1,
      name: 'Camera principale',
      components: {
        Camera: { fov: 60, near: 0.1, far: 1000, active: true },
        Transform: { position: [0, 1.6, 5], rotation: [0, 0, 0], scale: [1, 1, 1] },
      },
    });
  });

  it('omits parent for root entities and writes it for children', () => {
    const file = serializeScene(sampleWorld(), 'Scene_01');
    expect(file.entities[0]).not.toHaveProperty('parent');
    expect(file.entities[1]?.parent).toBe(1);
  });

  it('sorts entities by id', () => {
    const file = serializeScene(sampleWorld(), 'Scene_01');
    expect(file.entities.map((e) => e.id)).toEqual([1, 2]);
  });

  it('restores entities, names, hierarchy and components', () => {
    const world = deserializeScene(serializeScene(sampleWorld(), 'Scene_01'));
    expect(world.entities()).toEqual([1, 2]);
    expect(world.getName(1)).toBe('Camera principale');
    expect(world.getParent(2)).toBe(1);
    expect(world.get(2, 'Mesh')).toEqual({ asset: 'assets/PRP_Chair_01.glb', castShadow: true });
  });

  it('advances the id counter past the loaded entities', () => {
    const world = deserializeScene(serializeScene(sampleWorld(), 'Scene_01'));
    expect(world.spawn()).toBe(3);
  });

  it('restores a child declared before its parent', () => {
    const world = deserializeScene({
      version: SCENE_VERSION,
      name: 'OutOfOrder',
      entities: [
        { id: 2, name: 'Child', parent: 1, components: {} },
        { id: 1, name: 'Parent', components: {} },
      ],
    });
    expect(world.getParent(2)).toBe(1);
  });

  it('round-trips byte for byte', () => {
    const once = stringifyScene(serializeScene(sampleWorld(), 'Scene_01'));
    const twice = stringifyScene(serializeScene(deserializeScene(JSON.parse(once)), 'Scene_01'));
    expect(twice).toBe(once);
  });

  it('stringifies with sorted component keys and two-space indent', () => {
    const text = stringifyScene(serializeScene(sampleWorld(), 'Scene_01'));
    expect(text.indexOf('"Camera"')).toBeLessThan(text.indexOf('"Transform"'));
    expect(text).toContain('\n  "version": 1');
    expect(text.endsWith('\n')).toBe(true);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @nne/core test -- scene`
Attendu : ÉCHEC — `Cannot find module '../src/scene.js'`.

- [ ] **Step 3: Implémenter**

`packages/core/src/scene.ts` :

```ts
import { World } from './world.js';
import type { ComponentData, ComponentType, EntityId } from './types.js';

export const SCENE_VERSION = 1;

export interface SceneEntity {
  id: EntityId;
  name: string;
  /** Absent when the entity sits at the scene root. */
  parent?: EntityId;
  components: Record<ComponentType, ComponentData>;
}

export interface SceneFile {
  version: number;
  name: string;
  entities: SceneEntity[];
}

export function serializeScene(world: World, name: string): SceneFile {
  const entities: SceneEntity[] = world.entities().map((id) => {
    const parent = world.getParent(id);
    const entity: SceneEntity = {
      id,
      name: world.getName(id),
      components: world.componentsOf(id),
    };
    if (parent !== null) entity.parent = parent;
    return entity;
  });
  return { version: SCENE_VERSION, name, entities };
}

export function deserializeScene(file: SceneFile): World {
  const world = new World();
  // Two passes: every entity must exist before any parent link is set,
  // because a child may be declared before its parent in the file.
  const sorted = [...file.entities].sort((a, b) => a.id - b.id);
  for (const entity of sorted) {
    world.spawnWithId(entity.id, entity.name, null);
    for (const [type, data] of Object.entries(entity.components)) {
      world.set(entity.id, type, data);
    }
  }
  for (const entity of sorted) {
    if (entity.parent !== undefined) world.setParent(entity.id, entity.parent);
  }
  return world;
}

/**
 * Deterministic JSON: sorted component keys, stable field order, two-space
 * indent, trailing newline. Keeps git diffs on scenes small and readable.
 */
export function stringifyScene(file: SceneFile): string {
  const normalized: SceneFile = {
    version: file.version,
    name: file.name,
    entities: [...file.entities]
      .sort((a, b) => a.id - b.id)
      .map((entity) => {
        const components: Record<ComponentType, ComponentData> = {};
        for (const type of Object.keys(entity.components).sort()) {
          components[type] = entity.components[type] as ComponentData;
        }
        const out: SceneEntity = { id: entity.id, name: entity.name, components };
        if (entity.parent !== undefined) {
          return { id: out.id, name: out.name, parent: entity.parent, components };
        }
        return out;
      }),
  };
  return `${JSON.stringify(normalized, null, 2)}\n`;
}
```

- [ ] **Step 4: Lancer les tests**

Run: `pnpm --filter @nne/core test`
Attendu : PASSE.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/scene.ts packages/core/tests/scene.test.ts
git commit -m "feat(core): serialisation de scene JSON stable et round-trip"
```

---

### Task 10: Validation d'un fichier de scène

**Files:**
- Modify: `packages/core/src/scene.ts`
- Test: `packages/core/tests/scene-validate.test.ts`

**Interfaces:**
- Consumes: `SceneFile` (Task 9), `ComponentRegistry.validate` (Task 7).
- Produces: `validateScene(file: unknown, registry: ComponentRegistry): ValidationError[]`.

- [ ] **Step 1: Écrire les tests en échec**

`packages/core/tests/scene-validate.test.ts` :

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { ComponentRegistry } from '../src/registry.js';
import { registerBuiltins } from '../src/builtins.js';
import { SCENE_VERSION, validateScene } from '../src/scene.js';

describe('validateScene', () => {
  let registry: ComponentRegistry;
  beforeEach(() => {
    registry = new ComponentRegistry();
    registerBuiltins(registry);
  });

  const good = {
    version: SCENE_VERSION,
    name: 'Scene_01',
    entities: [
      { id: 1, name: 'Root', components: {} },
      {
        id: 2, name: 'Chair', parent: 1,
        components: { Mesh: { asset: 'a.glb', castShadow: true } },
      },
    ],
  };

  it('accepts a valid scene', () => {
    expect(validateScene(good, registry)).toEqual([]);
  });

  it('rejects a non-object file', () => {
    expect(validateScene(null, registry)).toEqual([
      { path: 'scene', message: 'expected an object' },
    ]);
  });

  it('rejects an unsupported version', () => {
    expect(validateScene({ ...good, version: 99 }, registry)).toContainEqual({
      path: 'scene.version', message: `expected version ${SCENE_VERSION}`,
    });
  });

  it('rejects a missing name', () => {
    const { name: _name, ...rest } = good;
    expect(validateScene(rest, registry)).toContainEqual({
      path: 'scene.name', message: 'expected a string',
    });
  });

  it('rejects entities that are not an array', () => {
    expect(validateScene({ ...good, entities: {} }, registry)).toContainEqual({
      path: 'scene.entities', message: 'expected an array',
    });
  });

  it('rejects a non-integer id', () => {
    const file = { ...good, entities: [{ id: 'x', name: 'A', components: {} }] };
    expect(validateScene(file, registry)).toContainEqual({
      path: 'scene.entities[0].id', message: 'expected a positive integer',
    });
  });

  it('rejects a duplicate id', () => {
    const file = {
      ...good,
      entities: [
        { id: 1, name: 'A', components: {} },
        { id: 1, name: 'B', components: {} },
      ],
    };
    expect(validateScene(file, registry)).toContainEqual({
      path: 'scene.entities[1].id', message: 'duplicate entity id 1',
    });
  });

  it('rejects a parent that does not exist', () => {
    const file = { ...good, entities: [{ id: 1, name: 'A', parent: 42, components: {} }] };
    expect(validateScene(file, registry)).toContainEqual({
      path: 'scene.entities[0].parent', message: 'unknown parent entity 42',
    });
  });

  it('rejects an unknown component type', () => {
    const file = { ...good, entities: [{ id: 1, name: 'A', components: { Nope: {} } }] };
    expect(validateScene(file, registry)).toContainEqual({
      path: 'scene.entities[0].components.Nope', message: 'unknown component type',
    });
  });

  it('reports component field errors with the entity path', () => {
    const file = {
      ...good,
      entities: [{ id: 1, name: 'A', components: { Mesh: { asset: 'a.glb', castShadow: 'yes' } } }],
    };
    expect(validateScene(file, registry)).toContainEqual({
      path: 'scene.entities[0].components.Mesh.castShadow',
      message: 'expected a boolean',
    });
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @nne/core test -- scene-validate`
Attendu : ÉCHEC — `validateScene is not exported`.

- [ ] **Step 3: Implémenter**

Dans `packages/core/src/scene.ts`, importer les types nécessaires puis ajouter :

```ts
import type { ComponentRegistry } from './registry.js';
import type { ValidationError } from './types.js';

/**
 * Checks a parsed scene file before it is loaded into a World.
 * Returns every problem found; an empty array means the file is safe to load.
 */
export function validateScene(file: unknown, registry: ComponentRegistry): ValidationError[] {
  if (typeof file !== 'object' || file === null || Array.isArray(file)) {
    return [{ path: 'scene', message: 'expected an object' }];
  }
  const errors: ValidationError[] = [];
  const scene = file as Record<string, unknown>;

  if (scene.version !== SCENE_VERSION) {
    errors.push({ path: 'scene.version', message: `expected version ${SCENE_VERSION}` });
  }
  if (typeof scene.name !== 'string') {
    errors.push({ path: 'scene.name', message: 'expected a string' });
  }
  if (!Array.isArray(scene.entities)) {
    errors.push({ path: 'scene.entities', message: 'expected an array' });
    return errors;
  }

  const seen = new Set<number>();
  const raw = scene.entities as unknown[];

  for (const [index, value] of raw.entries()) {
    const base = `scene.entities[${index}]`;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      errors.push({ path: base, message: 'expected an object' });
      continue;
    }
    const entity = value as Record<string, unknown>;

    if (typeof entity.id !== 'number' || !Number.isInteger(entity.id) || entity.id < 1) {
      errors.push({ path: `${base}.id`, message: 'expected a positive integer' });
    } else if (seen.has(entity.id)) {
      errors.push({ path: `${base}.id`, message: `duplicate entity id ${entity.id}` });
    } else {
      seen.add(entity.id);
    }

    if (typeof entity.name !== 'string') {
      errors.push({ path: `${base}.name`, message: 'expected a string' });
    }

    const components = entity.components;
    if (typeof components !== 'object' || components === null || Array.isArray(components)) {
      errors.push({ path: `${base}.components`, message: 'expected an object' });
      continue;
    }
    for (const [type, data] of Object.entries(components as Record<string, unknown>)) {
      if (!registry.has(type)) {
        errors.push({ path: `${base}.components.${type}`, message: 'unknown component type' });
        continue;
      }
      for (const error of registry.validate(type, data)) {
        // registry paths look like "Mesh.castShadow"; re-anchor them on the entity.
        const suffix = error.path.slice(type.length);
        errors.push({ path: `${base}.components.${type}${suffix}`, message: error.message });
      }
    }
  }

  // Parents are checked last, once every declared id is known.
  for (const [index, value] of raw.entries()) {
    if (typeof value !== 'object' || value === null) continue;
    const entity = value as Record<string, unknown>;
    if (entity.parent === undefined) continue;
    if (typeof entity.parent !== 'number' || !seen.has(entity.parent)) {
      errors.push({
        path: `scene.entities[${index}].parent`,
        message: `unknown parent entity ${String(entity.parent)}`,
      });
    }
  }

  return errors;
}
```

- [ ] **Step 4: Lancer les tests**

Run: `pnpm --filter @nne/core test`
Attendu : PASSE.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/scene.ts packages/core/tests/scene-validate.test.ts
git commit -m "feat(core): validation d'un fichier de scene contre le registre"
```

---

### Task 11: Ordonnanceur de systèmes

**Files:**
- Create: `packages/core/src/scheduler.ts`
- Test: `packages/core/tests/scheduler.test.ts`

**Interfaces:**
- Consumes: `World` (Task 5).
- Produces: `type System = (world: World, dt: number) => void`, `class Scheduler` avec `add(name: string, system: System): void`, `remove(name: string): void`, `names(): string[]` (dans l'ordre d'ajout), `run(world: World, dt: number): void`.

- [ ] **Step 1: Écrire les tests en échec**

`packages/core/tests/scheduler.test.ts` :

```ts
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
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @nne/core test -- scheduler`
Attendu : ÉCHEC — `Cannot find module '../src/scheduler.js'`.

- [ ] **Step 3: Implémenter**

`packages/core/src/scheduler.ts` :

```ts
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
```

- [ ] **Step 4: Lancer les tests**

Run: `pnpm --filter @nne/core test`
Attendu : PASSE.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/scheduler.ts packages/core/tests/scheduler.test.ts
git commit -m "feat(core): ordonnanceur de systemes"
```

---

### Task 12: Commandes et undo/redo

**Files:**
- Create: `packages/core/src/commands.ts`
- Test: `packages/core/tests/commands.test.ts`

**Interfaces:**
- Consumes: `World` (Task 5), `ComponentType`, `ComponentData`, `EntityId` (Task 1).
- Produces: `type Command` (union des sept variantes ci-dessous), `applyCommand(world: World, cmd: Command): void`, `invertCommand(world: World, cmd: Command): Command[]`, `class CommandBus` avec `dispatch(cmd: Command): void`, `undo(): boolean`, `redo(): boolean`, `canUndo(): boolean`, `canRedo(): boolean`, `subscribe(listener: (cmd: Command) => void): () => void`.

`SpawnEntity` porte un `entity` explicite, alloué par l'appelant via `world.allocateId()`. Ce choix rend toute commande sérialisable et rejouable telle quelle — c'est ce qui permettra au panneau IA d'en émettre.

- [ ] **Step 1: Écrire les tests en échec**

`packages/core/tests/commands.test.ts` :

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { World } from '../src/world.js';
import { CommandBus } from '../src/commands.js';

describe('CommandBus', () => {
  let world: World;
  let bus: CommandBus;
  beforeEach(() => { world = new World(); bus = new CommandBus(world); });

  it('spawns an entity at the allocated id', () => {
    const id = world.allocateId();
    bus.dispatch({ kind: 'SpawnEntity', entity: id, name: 'Chaise', parent: null });
    expect(world.alive(id)).toBe(true);
    expect(world.getName(id)).toBe('Chaise');
  });

  it('undoes a spawn', () => {
    const id = world.allocateId();
    bus.dispatch({ kind: 'SpawnEntity', entity: id, name: 'Chaise', parent: null });
    expect(bus.undo()).toBe(true);
    expect(world.alive(id)).toBe(false);
  });

  it('redoes a spawn at the same id', () => {
    const id = world.allocateId();
    bus.dispatch({ kind: 'SpawnEntity', entity: id, name: 'Chaise', parent: null });
    bus.undo();
    expect(bus.redo()).toBe(true);
    expect(world.alive(id)).toBe(true);
    expect(world.getName(id)).toBe('Chaise');
  });

  it('undoes a component change back to its previous data', () => {
    const e = world.spawn();
    world.set(e, 'Mesh', { asset: 'a.glb' });
    bus.dispatch({ kind: 'SetComponent', entity: e, type: 'Mesh', data: { asset: 'b.glb' } });
    expect(world.get(e, 'Mesh')).toEqual({ asset: 'b.glb' });
    bus.undo();
    expect(world.get(e, 'Mesh')).toEqual({ asset: 'a.glb' });
  });

  it('undoes a component that did not exist by removing it', () => {
    const e = world.spawn();
    bus.dispatch({ kind: 'SetComponent', entity: e, type: 'Mesh', data: { asset: 'a.glb' } });
    bus.undo();
    expect(world.has(e, 'Mesh')).toBe(false);
  });

  it('undoes a component removal', () => {
    const e = world.spawn();
    world.set(e, 'Mesh', { asset: 'a.glb' });
    bus.dispatch({ kind: 'RemoveComponent', entity: e, type: 'Mesh' });
    bus.undo();
    expect(world.get(e, 'Mesh')).toEqual({ asset: 'a.glb' });
  });

  it('undoes a reparent', () => {
    const p1 = world.spawn();
    const p2 = world.spawn();
    const c = world.spawn('C', p1);
    bus.dispatch({ kind: 'SetParent', entity: c, parent: p2 });
    bus.undo();
    expect(world.getParent(c)).toBe(p1);
  });

  it('undoes a rename', () => {
    const e = world.spawn('Avant');
    bus.dispatch({ kind: 'RenameEntity', entity: e, name: 'Apres' });
    bus.undo();
    expect(world.getName(e)).toBe('Avant');
  });

  it('restores a despawned subtree with its components and hierarchy', () => {
    const a = world.spawn('A');
    const b = world.spawn('B', a);
    world.set(b, 'Mesh', { asset: 'a.glb' });
    bus.dispatch({ kind: 'DespawnEntity', entity: a });
    expect(world.alive(b)).toBe(false);
    bus.undo();
    expect(world.alive(a)).toBe(true);
    expect(world.getName(b)).toBe('B');
    expect(world.getParent(b)).toBe(a);
    expect(world.get(b, 'Mesh')).toEqual({ asset: 'a.glb' });
  });

  it('reports whether undo and redo are available', () => {
    expect(bus.canUndo()).toBe(false);
    expect(bus.canRedo()).toBe(false);
    const id = world.allocateId();
    bus.dispatch({ kind: 'SpawnEntity', entity: id, name: 'A', parent: null });
    expect(bus.canUndo()).toBe(true);
    bus.undo();
    expect(bus.canUndo()).toBe(false);
    expect(bus.canRedo()).toBe(true);
  });

  it('returns false when there is nothing to undo or redo', () => {
    expect(bus.undo()).toBe(false);
    expect(bus.redo()).toBe(false);
  });

  it('clears the redo stack on a new dispatch', () => {
    const a = world.allocateId();
    bus.dispatch({ kind: 'SpawnEntity', entity: a, name: 'A', parent: null });
    bus.undo();
    const b = world.allocateId();
    bus.dispatch({ kind: 'SpawnEntity', entity: b, name: 'B', parent: null });
    expect(bus.canRedo()).toBe(false);
  });

  it('notifies subscribers on dispatch, undo and redo', () => {
    const listener = vi.fn();
    bus.subscribe(listener);
    const id = world.allocateId();
    bus.dispatch({ kind: 'SpawnEntity', entity: id, name: 'A', parent: null });
    bus.undo();
    bus.redo();
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = bus.subscribe(listener);
    unsubscribe();
    const id = world.allocateId();
    bus.dispatch({ kind: 'SpawnEntity', entity: id, name: 'A', parent: null });
    expect(listener).not.toHaveBeenCalled();
  });

  it('adds a component with the provided data', () => {
    const e = world.spawn();
    bus.dispatch({ kind: 'AddComponent', entity: e, type: 'Mesh', data: { asset: null } });
    expect(world.get(e, 'Mesh')).toEqual({ asset: null });
    bus.undo();
    expect(world.has(e, 'Mesh')).toBe(false);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `pnpm --filter @nne/core test -- commands`
Attendu : ÉCHEC — `Cannot find module '../src/commands.js'`.

- [ ] **Step 3: Implémenter**

`packages/core/src/commands.ts` :

```ts
import type { World } from './world.js';
import type { ComponentData, ComponentType, EntityId } from './types.js';

/**
 * Every mutation the editor can perform. Commands are plain JSON so they can
 * be logged, replayed, and later emitted by the AI panel.
 */
export type Command =
  | { kind: 'SpawnEntity'; entity: EntityId; name: string; parent: EntityId | null }
  | { kind: 'DespawnEntity'; entity: EntityId }
  | { kind: 'SetComponent'; entity: EntityId; type: ComponentType; data: ComponentData }
  | { kind: 'AddComponent'; entity: EntityId; type: ComponentType; data: ComponentData }
  | { kind: 'RemoveComponent'; entity: EntityId; type: ComponentType }
  | { kind: 'SetParent'; entity: EntityId; parent: EntityId | null }
  | { kind: 'RenameEntity'; entity: EntityId; name: string };

export function applyCommand(world: World, command: Command): void {
  switch (command.kind) {
    case 'SpawnEntity':
      world.spawnWithId(command.entity, command.name, command.parent);
      return;
    case 'DespawnEntity':
      world.despawn(command.entity);
      return;
    case 'SetComponent':
    case 'AddComponent':
      world.set(command.entity, command.type, command.data);
      return;
    case 'RemoveComponent':
      world.remove(command.entity, command.type);
      return;
    case 'SetParent':
      world.setParent(command.entity, command.parent);
      return;
    case 'RenameEntity':
      world.setName(command.entity, command.name);
      return;
  }
}

/**
 * The commands that undo `command`, computed against the world state BEFORE
 * it is applied. Returned in the order they must be replayed.
 */
export function invertCommand(world: World, command: Command): Command[] {
  switch (command.kind) {
    case 'SpawnEntity':
      return [{ kind: 'DespawnEntity', entity: command.entity }];

    case 'DespawnEntity': {
      // Rebuild the whole subtree: parents first, then their components.
      const restore: Command[] = [];
      for (const id of world.subtree(command.entity)) {
        restore.push({
          kind: 'SpawnEntity',
          entity: id,
          name: world.getName(id),
          parent: world.getParent(id),
        });
        for (const [type, data] of Object.entries(world.componentsOf(id))) {
          restore.push({ kind: 'SetComponent', entity: id, type, data });
        }
      }
      return restore;
    }

    case 'SetComponent':
    case 'AddComponent': {
      const previous = world.get(command.entity, command.type);
      return previous === undefined
        ? [{ kind: 'RemoveComponent', entity: command.entity, type: command.type }]
        : [{ kind: 'SetComponent', entity: command.entity, type: command.type, data: previous }];
    }

    case 'RemoveComponent': {
      const previous = world.get(command.entity, command.type);
      return previous === undefined
        ? []
        : [{ kind: 'SetComponent', entity: command.entity, type: command.type, data: previous }];
    }

    case 'SetParent':
      return [{
        kind: 'SetParent',
        entity: command.entity,
        parent: world.getParent(command.entity),
      }];

    case 'RenameEntity':
      return [{
        kind: 'RenameEntity',
        entity: command.entity,
        name: world.getName(command.entity),
      }];
  }
}

interface HistoryEntry {
  redo: Command[];
  undo: Command[];
}

/**
 * The single route through which the editor mutates the world.
 * Because the inverse is captured on every dispatch, undo covers every
 * mutation by construction — a new command kind cannot forget to support it.
 */
export class CommandBus {
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
  private readonly listeners = new Set<(command: Command) => void>();

  constructor(private readonly world: World) {}

  dispatch(command: Command): void {
    const undo = invertCommand(this.world, command);
    applyCommand(this.world, command);
    this.undoStack.push({ redo: [command], undo });
    this.redoStack.length = 0;
    this.notify(command);
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    for (const command of entry.undo) applyCommand(this.world, command);
    this.redoStack.push(entry);
    this.notify(entry.undo[0] ?? entry.redo[0] as Command);
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    for (const command of entry.redo) applyCommand(this.world, command);
    this.undoStack.push(entry);
    this.notify(entry.redo[0] as Command);
    return true;
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  subscribe(listener: (command: Command) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(command: Command): void {
    for (const listener of this.listeners) listener(command);
  }
}
```

- [ ] **Step 4: Lancer les tests**

Run: `pnpm --filter @nne/core test`
Attendu : PASSE.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/commands.ts packages/core/tests/commands.test.ts
git commit -m "feat(core): couche de commandes inversibles avec undo/redo"
```

---

### Task 13: Propriété d'inversion et API publique

**Files:**
- Create: `packages/core/src/index.ts`
- Test: `packages/core/tests/inversion.test.ts`
- Test: `packages/core/tests/public-api.test.ts`

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: `packages/core/src/index.ts`, seul point d'entrée public du package, réexportant `World`, `ComponentRegistry`, `FIELD_TYPES`, `registerBuiltins`, `TRANSFORM`, `MESH`, `CAMERA`, `LIGHT`, `LIGHT_TYPES`, `Scheduler`, `CommandBus`, `applyCommand`, `invertCommand`, `SCENE_VERSION`, `serializeScene`, `deserializeScene`, `stringifyScene`, `validateScene`, et les types de `types.ts`, `commands.ts` et `scene.ts`.

Le test d'inversion est le filet de sécurité central du moteur : il garantit que pour **toute** commande, `dispatch` puis `undo` restaure un monde strictement identique.

- [ ] **Step 1: Écrire le test d'inversion en échec**

`packages/core/tests/inversion.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.js';
import { CommandBus, type Command } from '../src/commands.js';
import { serializeScene, stringifyScene } from '../src/scene.js';

/** A world with a hierarchy and components, rebuilt fresh for each case. */
function fixture(): World {
  const world = new World();
  const root = world.spawn('Root');
  world.set(root, 'Transform', { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
  const child = world.spawn('Child', root);
  world.set(child, 'Transform', { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] });
  world.set(child, 'Mesh', { asset: 'assets/PRP_Chair_01.glb', castShadow: true });
  const grandchild = world.spawn('Grandchild', child);
  world.set(grandchild, 'Mesh', { asset: null, castShadow: false });
  world.spawn('Sibling', root);
  return world;
}

function snapshot(world: World): string {
  return stringifyScene(serializeScene(world, 'snapshot'));
}

const cases: { name: string; command: (world: World) => Command }[] = [
  { name: 'SpawnEntity at root',
    command: (w) => ({ kind: 'SpawnEntity', entity: w.allocateId(), name: 'New', parent: null }) },
  { name: 'SpawnEntity under a parent',
    command: (w) => ({ kind: 'SpawnEntity', entity: w.allocateId(), name: 'New', parent: 1 }) },
  { name: 'DespawnEntity leaf',
    command: () => ({ kind: 'DespawnEntity', entity: 3 }) },
  { name: 'DespawnEntity with a subtree',
    command: () => ({ kind: 'DespawnEntity', entity: 2 }) },
  { name: 'SetComponent over an existing one',
    command: () => ({ kind: 'SetComponent', entity: 2, type: 'Mesh', data: { asset: 'x.glb', castShadow: false } }) },
  { name: 'SetComponent creating a new one',
    command: () => ({ kind: 'SetComponent', entity: 1, type: 'Mesh', data: { asset: null, castShadow: true } }) },
  { name: 'AddComponent',
    command: () => ({ kind: 'AddComponent', entity: 4, type: 'Mesh', data: { asset: null, castShadow: true } }) },
  { name: 'RemoveComponent present',
    command: () => ({ kind: 'RemoveComponent', entity: 2, type: 'Mesh' }) },
  { name: 'RemoveComponent absent',
    command: () => ({ kind: 'RemoveComponent', entity: 4, type: 'Mesh' }) },
  { name: 'SetParent to another entity',
    command: () => ({ kind: 'SetParent', entity: 3, parent: 4 }) },
  { name: 'SetParent to root',
    command: () => ({ kind: 'SetParent', entity: 2, parent: null }) },
  { name: 'RenameEntity',
    command: () => ({ kind: 'RenameEntity', entity: 2, name: 'Renamed' }) },
];

describe('command inversion', () => {
  for (const { name, command } of cases) {
    it(`restores the world exactly after undoing: ${name}`, () => {
      const world = fixture();
      const before = snapshot(world);
      const bus = new CommandBus(world);

      bus.dispatch(command(world));
      expect(bus.undo()).toBe(true);

      expect(snapshot(world)).toBe(before);
    });

    it(`reapplies identically after redo: ${name}`, () => {
      const world = fixture();
      const bus = new CommandBus(world);

      bus.dispatch(command(world));
      const afterDispatch = snapshot(world);
      bus.undo();
      bus.redo();

      expect(snapshot(world)).toBe(afterDispatch);
    });
  }

  it('restores the world after undoing a long sequence', () => {
    const world = fixture();
    const before = snapshot(world);
    const bus = new CommandBus(world);

    // Hand-ordered so every command stays valid against the previous one:
    // nothing targets an entity a prior despawn removed.
    const spawned = world.allocateId();
    bus.dispatch({ kind: 'SpawnEntity', entity: spawned, name: 'New', parent: 1 });
    bus.dispatch({ kind: 'RenameEntity', entity: 2, name: 'Renamed' });
    bus.dispatch({ kind: 'SetComponent', entity: 2, type: 'Mesh', data: { asset: 'x.glb', castShadow: false } });
    bus.dispatch({ kind: 'AddComponent', entity: 4, type: 'Mesh', data: { asset: null, castShadow: true } });
    bus.dispatch({ kind: 'SetParent', entity: 3, parent: 4 });
    bus.dispatch({ kind: 'RemoveComponent', entity: 2, type: 'Mesh' });
    bus.dispatch({ kind: 'DespawnEntity', entity: 4 });
    bus.dispatch({ kind: 'SetParent', entity: 2, parent: null });

    while (bus.canUndo()) bus.undo();

    expect(snapshot(world)).toBe(before);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue ou révèle un défaut**

Run: `pnpm --filter @nne/core test -- inversion`
Attendu : ÉCHEC. Si des cas échouent, corriger `invertCommand` — c'est précisément le rôle de ce test. Cas connu à traiter : la commande `SetParent` doit être rejouable même quand l'ancien parent a changé de place entre-temps.

- [ ] **Step 3: Écrire l'API publique**

`packages/core/src/index.ts` :

```ts
export { World } from './world.js';
export { ComponentRegistry, FIELD_TYPES } from './registry.js';
export {
  CAMERA, LIGHT, LIGHT_TYPES, MESH, TRANSFORM, registerBuiltins,
} from './builtins.js';
export { Scheduler, type System } from './scheduler.js';
export {
  CommandBus, applyCommand, invertCommand, type Command,
} from './commands.js';
export {
  SCENE_VERSION, deserializeScene, serializeScene, stringifyScene, validateScene,
  type SceneEntity, type SceneFile,
} from './scene.js';
export type {
  ComponentData, ComponentSchema, ComponentType, EntityId,
  FieldSpec, FieldType, ValidationError,
} from './types.js';
```

- [ ] **Step 4: Écrire le test d'API publique**

`packages/core/tests/public-api.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import * as core from '../src/index.js';

describe('public API', () => {
  it('exports every documented symbol', () => {
    for (const name of [
      'World', 'ComponentRegistry', 'FIELD_TYPES', 'registerBuiltins',
      'TRANSFORM', 'MESH', 'CAMERA', 'LIGHT', 'LIGHT_TYPES',
      'Scheduler', 'CommandBus', 'applyCommand', 'invertCommand',
      'SCENE_VERSION', 'serializeScene', 'deserializeScene',
      'stringifyScene', 'validateScene',
    ]) {
      expect(core).toHaveProperty(name);
    }
  });

  it('builds a working world from the public API alone', () => {
    const registry = new core.ComponentRegistry();
    core.registerBuiltins(registry);

    const world = new core.World();
    const bus = new core.CommandBus(world);
    const id = world.allocateId();
    bus.dispatch({ kind: 'SpawnEntity', entity: id, name: 'Chaise', parent: null });
    bus.dispatch({
      kind: 'AddComponent', entity: id, type: core.TRANSFORM,
      data: registry.createDefault(core.TRANSFORM),
    });

    const file = core.serializeScene(world, 'Scene_01');
    expect(core.validateScene(file, registry)).toEqual([]);
    expect(core.deserializeScene(file).getName(id)).toBe('Chaise');
  });
});
```

- [ ] **Step 5: Vérifier que le package n'a aucune dépendance runtime**

Run:

```bash
node -e "const p=require('./packages/core/package.json');if(p.dependencies&&Object.keys(p.dependencies).length){console.error('core must have no runtime dependencies');process.exit(1)}console.log('ok')"
grep -rn "from 'three'" packages/core/src && echo "FAIL: three imported in core" && exit 1 || echo "ok: no three import"
```

Attendu : `ok` deux fois.

- [ ] **Step 6: Lancer la suite complète**

Run: `pnpm --filter @nne/core test && pnpm --filter @nne/core typecheck`
Attendu : tous les tests passent, typecheck sans erreur.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/index.ts packages/core/tests/inversion.test.ts packages/core/tests/public-api.test.ts packages/core/src/commands.ts
git commit -m "feat(core): propriete d'inversion des commandes et API publique"
```

---

## Self-Review

**Couverture du spec (§2 à §5, §8) :**

| Exigence du spec | Tâche |
|---|---|
| `core` sans dépendance à Three.js | Task 13, step 5 (vérification automatisée) |
| `World`, entités en IDs, `Map` imbriquées | Tasks 2, 4 |
| Hiérarchie par champ `parent` | Task 3 |
| Requêtes par intersection, plus petit store d'abord | Task 5 |
| IDs stables et persistés | Tasks 2, 9 |
| Registre de schémas, dix types de champs | Tasks 6, 7 |
| Valeurs par défaut à l'ajout d'un composant | Task 6 |
| Validation avec erreur lisible | Tasks 7, 10 |
| Composants `Transform`, `Mesh`, `Camera`, `Light` | Task 8 |
| Format de scène JSON plat, `version: 1` | Task 9 |
| Écriture stable pour diffs git lisibles | Task 9 |
| Round-trip de sérialisation identique | Tasks 9, 13 |
| Systèmes en ordre explicite | Task 11 |
| Sept commandes, `CommandBus`, undo/redo | Task 12 |
| Propriété d'inversion sur chaque commande | Task 13 |

Hors périmètre de ce plan, couverts par les plans 2 à 4 : systèmes Three.js et player (`runtime`), API disque et pipeline gltf-transform (`editor-server`), viewports et panneaux (`editor`).

**Placeholders :** aucun. Chaque étape porte le code réel à écrire et la commande exacte à lancer.

**Cohérence des types :** `EntityId`, `ComponentType`, `ComponentData`, `ValidationError` sont définis en Task 1 et utilisés sans variante. `world.subtree()` (Task 3) est consommé par `despawn` (Task 3), `setParent` (Task 3) et `invertCommand` (Task 12). `world.allocateId()` (Task 2) est consommé par `spawn` (Task 2) et par les commandes `SpawnEntity` (Task 12). `world.componentsOf()` (Task 4) est consommé par `serializeScene` (Task 9) et `invertCommand` (Task 12). `registry.validate()` (Task 7) est consommé par `validateScene` (Task 10). `spawnWithId` a la même signature en Tasks 2, 3, 9 et 12.
