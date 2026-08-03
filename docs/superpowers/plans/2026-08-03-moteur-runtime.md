# Moteur ECS — Plan d'implémentation du package `runtime`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire `packages/runtime` — le pont entre l'ECS de `@nne/core` et Three.js : chargement d'assets `.glb`, synchronisation du graphe Three depuis les composants, systèmes de rendu, caméra et lumières, boucle de jeu, et un player autonome capable de charger une scène JSON sans éditeur.

**Architecture:** `core` ne connaît pas Three.js ; `runtime` fait la traduction dans un seul sens — les composants sont la source de vérité, le graphe Three en est le reflet. Un `SceneGraph` maintient une `Map<EntityId, THREE.Object3D>` et réconcilie création, hiérarchie et destruction à chaque frame. Le `WebGLRenderer` est isolé derrière une frontière étroite pour que tout le reste soit testable en Node sans GPU.

**Tech Stack:** TypeScript 5.7, Three.js 0.185 (WebGL2), Vitest 3, pnpm workspaces, Node 22.

## Global Constraints

- `packages/runtime` dépend de `@nne/core` (workspace) et de `three` — et de rien d'autre en `dependencies`.
- `packages/core` reste sans dépendance runtime et sans import de `three`. Aucune tâche de ce plan n'ajoute de dépendance à `core`.
- Les composants restent la source de vérité. Aucun système n'écrit dans le graphe Three une valeur qu'il ne relit pas depuis un composant, et rien ne réécrit un composant depuis un `Object3D` — le flux est unidirectionnel.
- 1 unité Three = 1 mètre. Origine des assets au sol, à la base de l'objet.
- Rotations stockées en `euler` `[x, y, z]` **en radians**, ordre `XYZ`.
- WebGL2 uniquement. Pas de WebGPU, pas de post-processing.
- Aucun accès disque dans `runtime` : les assets sont chargés par URL via `fetch`/`GLTFLoader`. Le disque est le domaine de `editor-server`.
- Tout le code et les commentaires en anglais ; les messages de commit en français.
- TypeScript `strict` avec `noUncheckedIndexedAccess`. Aucun `any` implicite ou explicite dans le code livré.
- Tests en Node, sans `WebGLRenderer` : `THREE.Object3D`, `Scene`, `PerspectiveCamera` et les lumières fonctionnent sans contexte GPU. Seule la création du renderer exige un canvas, d'où son isolement.

---

### Task 1: Ajouter `World.peek()` à `core`

**Files:**
- Modify: `packages/core/src/world.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/world-peek.test.ts`

**Interfaces:**
- Consumes: `World` de `@nne/core`.
- Produces: `peek(entity: EntityId, type: ComponentType): Readonly<ComponentData> | undefined` — lecture **sans copie**, réservée aux boucles par frame. `get()` est inchangé et reste la lecture par défaut.

La review finale de `core` a mesuré `structuredClone` sur chaque `get()` à ~8,7 ms/frame pour 2000 entités, soit plus de la moitié d'un budget 60 fps. Les systèmes de rendu lisent les composants à chaque frame ; il leur faut un accès sans allocation. L'ajout est purement additif : aucun appelant existant ne change.

- [ ] **Step 1: Écrire les tests en échec**

`packages/core/tests/world-peek.test.ts` :

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { World } from '../src/world.js';

describe('World.peek', () => {
  let world: World;
  let e: number;
  beforeEach(() => { world = new World(); e = world.spawn(); });

  it('reads the same value as get', () => {
    world.set(e, 'Transform', { position: [1, 2, 3] });
    expect(world.peek(e, 'Transform')).toEqual(world.get(e, 'Transform'));
  });

  it('returns undefined for a missing component', () => {
    expect(world.peek(e, 'Mesh')).toBeUndefined();
  });

  it('does NOT copy: two peeks return the same object', () => {
    world.set(e, 'Transform', { position: [0, 0, 0] });
    expect(world.peek(e, 'Transform')).toBe(world.peek(e, 'Transform'));
  });

  it('get still copies, unlike peek', () => {
    world.set(e, 'Transform', { position: [0, 0, 0] });
    expect(world.get(e, 'Transform')).not.toBe(world.get(e, 'Transform'));
  });

  it('throws on a dead entity', () => {
    expect(() => world.peek(99, 'Transform')).toThrow(/unknown entity 99/);
  });

  it('reflects a later set without re-peeking', () => {
    world.set(e, 'Transform', { position: [0, 0, 0] });
    world.set(e, 'Transform', { position: [9, 9, 9] });
    expect(world.peek(e, 'Transform')).toEqual({ position: [9, 9, 9] });
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd packages/core && npx vitest run tests/world-peek.test.ts`
Attendu : ÉCHEC — `world.peek is not a function`.

- [ ] **Step 3: Implémenter**

Dans `packages/core/src/world.ts`, à côté de `get` :

```ts
  /**
   * Reads component data WITHOUT copying it.
   *
   * `get` deep-copies on every call, which is the right default for editor code
   * but costs about 8.7 ms per frame at 2000 entities — over half a 60 fps
   * budget. Per-frame systems use this instead.
   *
   * The returned object aliases live world state. Never mutate it: write through
   * `set` so the copy-on-write discipline holds.
   */
  peek(entity: EntityId, type: ComponentType): Readonly<ComponentData> | undefined {
    this.assertAlive(entity);
    return this.stores.get(type)?.get(entity);
  }
```

- [ ] **Step 4: Exporter et lancer la suite**

`packages/core/src/index.ts` n'exporte que des symboles, pas des méthodes — aucun changement nécessaire. Vérifier tout de même que rien ne casse.

Run: `pnpm --filter @nne/core test && pnpm --filter @nne/core typecheck`
Attendu : les 191 tests précédents passent, plus les 6 nouveaux.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/world.ts packages/core/tests/world-peek.test.ts
git commit -m "feat(core): ajoute World.peek pour la lecture sans copie par frame"
```

---

### Task 2: Scaffolding du package `runtime`

**Files:**
- Create: `packages/runtime/package.json`
- Create: `packages/runtime/tsconfig.json`
- Create: `packages/runtime/vitest.config.ts`
- Create: `packages/runtime/src/types.ts`
- Test: `packages/runtime/tests/smoke.test.ts`

**Interfaces:**
- Consumes: `@nne/core` (workspace).
- Produces: le package `@nne/runtime`, et les types partagés `Vec3`, `Euler`, `TransformData`, `MeshData`, `CameraData`, `LightData` utilisés par toutes les tâches suivantes.

- [ ] **Step 1: Créer le package**

`packages/runtime/package.json` :

```json
{
  "name": "@nne/runtime",
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
  },
  "dependencies": {
    "@nne/core": "workspace:*",
    "three": "^0.185.0"
  },
  "devDependencies": {
    "@types/three": "^0.185.0"
  }
}
```

`packages/runtime/tsconfig.json` :

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "." },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

`packages/runtime/vitest.config.ts` :

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 2: Écrire les types des composants**

`packages/runtime/src/types.ts` :

```ts
import type { EntityId } from '@nne/core';

/** A position or scale triple, in metres. 1 unit = 1 metre. */
export type Vec3 = [number, number, number];

/** Rotation triple in RADIANS, applied in XYZ order. */
export type Euler = [number, number, number];

export interface TransformData {
  position: Vec3;
  rotation: Euler;
  scale: Vec3;
}

export interface MeshData {
  asset: string | null;
  castShadow: boolean;
}

export interface CameraData {
  fov: number;
  near: number;
  far: number;
  active: boolean;
}

export interface LightData {
  type: 'directional' | 'point' | 'ambient' | 'spot';
  color: string;
  intensity: number;
}

/** Identifies which entity an Object3D mirrors. */
export interface EntityUserData {
  entity: EntityId;
}
```

- [ ] **Step 3: Écrire le test de fumée**

`packages/runtime/tests/smoke.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { Object3D } from 'three';
import { World } from '@nne/core';
import type { TransformData } from '../src/types.js';

describe('runtime toolchain', () => {
  it('constructs a three Object3D in node without a GPU', () => {
    const object = new Object3D();
    object.position.set(1, 2, 3);
    expect(object.position.toArray()).toEqual([1, 2, 3]);
  });

  it('resolves @nne/core from the workspace', () => {
    expect(new World().spawn()).toBe(1);
  });

  it('types component data', () => {
    const t: TransformData = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
    expect(t.scale).toEqual([1, 1, 1]);
  });
});
```

- [ ] **Step 4: Installer et lancer**

```bash
pnpm install
pnpm --filter @nne/runtime test
pnpm --filter @nne/runtime typecheck
```

Attendu : 3 tests passent, typecheck sans erreur. Si `three` n'expose pas ses types correctement en `moduleResolution: bundler`, vérifier que `@types/three` est bien installé — ne pas ajouter de `skipLibCheck` supplémentaire, il est déjà dans la base.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime pnpm-lock.yaml
git commit -m "chore(runtime): initialise le package runtime avec three"
```

---

### Task 3: Conversion des données de composant vers Three

**Files:**
- Create: `packages/runtime/src/convert.ts`
- Test: `packages/runtime/tests/convert.test.ts`

**Interfaces:**
- Consumes: `TransformData`, `LightData`, `Vec3`, `Euler` (Task 2).
- Produces: `applyTransform(object: Object3D, data: TransformData): void`, `createLight(data: LightData): Light`, `applyLight(light: Light, data: LightData): boolean` — renvoie `false` si le type de lumière a changé et qu'il faut recréer l'objet.

Fonctions pures, sans état : c'est la couche la plus facile à tester et la plus facile à casser silencieusement.

- [ ] **Step 1: Écrire les tests en échec**

`packages/runtime/tests/convert.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { AmbientLight, DirectionalLight, Object3D, PointLight, SpotLight } from 'three';
import { applyLight, applyTransform, createLight } from '../src/convert.js';
import type { LightData, TransformData } from '../src/types.js';

const transform = (over: Partial<TransformData> = {}): TransformData => ({
  position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], ...over,
});

describe('applyTransform', () => {
  it('writes position, rotation and scale', () => {
    const object = new Object3D();
    applyTransform(object, transform({ position: [1, 2, 3], rotation: [0.1, 0.2, 0.3], scale: [2, 2, 2] }));
    expect(object.position.toArray()).toEqual([1, 2, 3]);
    expect([object.rotation.x, object.rotation.y, object.rotation.z]).toEqual([0.1, 0.2, 0.3]);
    expect(object.scale.toArray()).toEqual([2, 2, 2]);
  });

  it('uses XYZ euler order', () => {
    const object = new Object3D();
    applyTransform(object, transform({ rotation: [1, 2, 3] }));
    expect(object.rotation.order).toBe('XYZ');
  });

  it('overwrites a previous transform rather than accumulating', () => {
    const object = new Object3D();
    applyTransform(object, transform({ position: [5, 5, 5] }));
    applyTransform(object, transform({ position: [1, 1, 1] }));
    expect(object.position.toArray()).toEqual([1, 1, 1]);
  });

  it('does not allocate a new object', () => {
    const object = new Object3D();
    const position = object.position;
    applyTransform(object, transform({ position: [1, 2, 3] }));
    expect(object.position).toBe(position);
  });
});

describe('createLight', () => {
  const light = (over: Partial<LightData> = {}): LightData => ({
    type: 'directional', color: '#ffffff', intensity: 1, ...over,
  });

  it('creates each light type', () => {
    expect(createLight(light({ type: 'directional' }))).toBeInstanceOf(DirectionalLight);
    expect(createLight(light({ type: 'point' }))).toBeInstanceOf(PointLight);
    expect(createLight(light({ type: 'ambient' }))).toBeInstanceOf(AmbientLight);
    expect(createLight(light({ type: 'spot' }))).toBeInstanceOf(SpotLight);
  });

  it('applies colour and intensity', () => {
    const created = createLight(light({ color: '#ff0000', intensity: 2.5 }));
    expect(created.color.getHexString()).toBe('ff0000');
    expect(created.intensity).toBe(2.5);
  });
});

describe('applyLight', () => {
  const light = (over: Partial<LightData> = {}): LightData => ({
    type: 'directional', color: '#ffffff', intensity: 1, ...over,
  });

  it('updates colour and intensity in place and reports success', () => {
    const existing = createLight(light());
    expect(applyLight(existing, light({ color: '#00ff00', intensity: 3 }))).toBe(true);
    expect(existing.color.getHexString()).toBe('00ff00');
    expect(existing.intensity).toBe(3);
  });

  it('reports failure when the light type changed', () => {
    const existing = createLight(light({ type: 'directional' }));
    expect(applyLight(existing, light({ type: 'point' }))).toBe(false);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd packages/runtime && npx vitest run tests/convert.test.ts`
Attendu : ÉCHEC — `Cannot find module '../src/convert.js'`.

- [ ] **Step 3: Implémenter**

`packages/runtime/src/convert.ts` :

```ts
import {
  AmbientLight, Color, DirectionalLight, type Light, Object3D, PointLight, SpotLight,
} from 'three';
import type { LightData, TransformData } from './types.js';

/**
 * Writes a Transform component onto an Object3D, in place.
 * Called once per entity per frame, so it must not allocate.
 */
export function applyTransform(object: Object3D, data: TransformData): void {
  object.position.set(data.position[0], data.position[1], data.position[2]);
  object.rotation.set(data.rotation[0], data.rotation[1], data.rotation[2], 'XYZ');
  object.scale.set(data.scale[0], data.scale[1], data.scale[2]);
}

export function createLight(data: LightData): Light {
  const color = new Color(data.color);
  switch (data.type) {
    case 'directional': return new DirectionalLight(color, data.intensity);
    case 'point':       return new PointLight(color, data.intensity);
    case 'ambient':     return new AmbientLight(color, data.intensity);
    case 'spot':        return new SpotLight(color, data.intensity);
  }
}

/**
 * Updates a light in place. Returns false when the component's light type no
 * longer matches the object's class, meaning the caller must recreate it —
 * three.js light types are separate classes, not a mutable property.
 */
export function applyLight(light: Light, data: LightData): boolean {
  if (!matchesType(light, data.type)) return false;
  light.color.set(data.color);
  light.intensity = data.intensity;
  return true;
}

function matchesType(light: Light, type: LightData['type']): boolean {
  switch (type) {
    case 'directional': return light instanceof DirectionalLight;
    case 'point':       return light instanceof PointLight;
    case 'ambient':     return light instanceof AmbientLight;
    case 'spot':        return light instanceof SpotLight;
  }
}
```

- [ ] **Step 4: Lancer les tests**

Run: `pnpm --filter @nne/runtime test && pnpm --filter @nne/runtime typecheck`
Attendu : PASSE.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/convert.ts packages/runtime/tests/convert.test.ts
git commit -m "feat(runtime): conversion des donnees de composant vers three"
```

---

### Task 4: Chargeur d'assets avec cache

**Files:**
- Create: `packages/runtime/src/assets.ts`
- Test: `packages/runtime/tests/assets.test.ts`

**Interfaces:**
- Consumes: rien de `core`.
- Produces: `interface GltfSource { load(url: string): Promise<Object3D> }`, `class AssetCache` avec `constructor(source: GltfSource)`, `get(url: string): Promise<Object3D>`, `size(): number`, `clear(): void`, et `createGltfSource(): GltfSource` (adaptateur `GLTFLoader`, non testé unitairement).

Le chargement passe par une interface injectable pour que le cache soit testable sans réseau ni GPU. `get` renvoie un **clone** : plusieurs entités peuvent référencer le même `.glb` sans partager de transform.

- [ ] **Step 1: Écrire les tests en échec**

`packages/runtime/tests/assets.test.ts` :

```ts
import { describe, expect, it, vi } from 'vitest';
import { Mesh, Object3D } from 'three';
import { AssetCache, type GltfSource } from '../src/assets.js';

function sourceOf(make: () => Object3D = () => new Mesh()): GltfSource & { calls: number } {
  const source = {
    calls: 0,
    async load(_url: string) { source.calls++; return make(); },
  };
  return source;
}

describe('AssetCache', () => {
  it('loads an asset', async () => {
    const cache = new AssetCache(sourceOf());
    expect(await cache.get('a.glb')).toBeInstanceOf(Object3D);
  });

  it('loads each url only once', async () => {
    const source = sourceOf();
    const cache = new AssetCache(source);
    await cache.get('a.glb');
    await cache.get('a.glb');
    expect(source.calls).toBe(1);
  });

  it('does not double-load on concurrent requests for the same url', async () => {
    const source = sourceOf();
    const cache = new AssetCache(source);
    await Promise.all([cache.get('a.glb'), cache.get('a.glb'), cache.get('a.glb')]);
    expect(source.calls).toBe(1);
  });

  it('returns a distinct clone per call', async () => {
    const cache = new AssetCache(sourceOf());
    const first = await cache.get('a.glb');
    const second = await cache.get('a.glb');
    expect(first).not.toBe(second);
  });

  it('clones deeply so children are not shared', async () => {
    const cache = new AssetCache(sourceOf(() => {
      const root = new Object3D();
      root.add(new Mesh());
      return root;
    }));
    const first = await cache.get('a.glb');
    const second = await cache.get('a.glb');
    expect(first.children[0]).not.toBe(second.children[0]);
  });

  it('reports how many urls are cached', async () => {
    const cache = new AssetCache(sourceOf());
    await cache.get('a.glb');
    await cache.get('b.glb');
    expect(cache.size()).toBe(2);
  });

  it('clears the cache', async () => {
    const source = sourceOf();
    const cache = new AssetCache(source);
    await cache.get('a.glb');
    cache.clear();
    await cache.get('a.glb');
    expect(source.calls).toBe(2);
    expect(cache.size()).toBe(1);
  });

  it('does not cache a failed load, so a retry can succeed', async () => {
    let attempt = 0;
    const cache = new AssetCache({
      async load(_url: string) {
        attempt++;
        if (attempt === 1) throw new Error('network');
        return new Mesh();
      },
    });
    await expect(cache.get('a.glb')).rejects.toThrow('network');
    expect(await cache.get('a.glb')).toBeInstanceOf(Object3D);
  });

  it('names the failing url when a load rejects', async () => {
    const cache = new AssetCache({ async load() { throw new Error('404'); } });
    await expect(cache.get('missing.glb')).rejects.toThrow(/missing\.glb/);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd packages/runtime && npx vitest run tests/assets.test.ts`
Attendu : ÉCHEC — `Cannot find module '../src/assets.js'`.

- [ ] **Step 3: Implémenter**

`packages/runtime/src/assets.ts` :

```ts
import type { Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Injectable loader, so the cache is testable without network or GPU. */
export interface GltfSource {
  load(url: string): Promise<Object3D>;
}

/**
 * Loads each .glb once and hands out a deep clone per request, so several
 * entities can share an asset without sharing its transform.
 */
export class AssetCache {
  private readonly pending = new Map<string, Promise<Object3D>>();
  private readonly loaded = new Map<string, Object3D>();

  constructor(private readonly source: GltfSource) {}

  async get(url: string): Promise<Object3D> {
    const cached = this.loaded.get(url);
    if (cached) return cached.clone(true);

    let inFlight = this.pending.get(url);
    if (!inFlight) {
      inFlight = this.source
        .load(url)
        .catch((cause: unknown) => {
          // Drop the entry so a later call can retry rather than replaying the failure.
          this.pending.delete(url);
          const message = cause instanceof Error ? cause.message : String(cause);
          throw new Error(`failed to load asset "${url}": ${message}`, { cause });
        });
      this.pending.set(url, inFlight);
    }

    const root = await inFlight;
    this.loaded.set(url, root);
    this.pending.delete(url);
    return root.clone(true);
  }

  size(): number {
    return this.loaded.size;
  }

  clear(): void {
    this.loaded.clear();
    this.pending.clear();
  }
}

/** Browser-side adapter. Not unit tested: it needs a real network and DOM. */
export function createGltfSource(): GltfSource {
  const loader = new GLTFLoader();
  return {
    async load(url: string): Promise<Object3D> {
      const gltf = await loader.loadAsync(url);
      return gltf.scene;
    },
  };
}
```

- [ ] **Step 4: Lancer les tests**

Run: `pnpm --filter @nne/runtime test && pnpm --filter @nne/runtime typecheck`
Attendu : PASSE.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/assets.ts packages/runtime/tests/assets.test.ts
git commit -m "feat(runtime): cache d'assets glb avec chargement injectable"
```

---

### Task 5: Le graphe de scène

**Files:**
- Create: `packages/runtime/src/scene-graph.ts`
- Test: `packages/runtime/tests/scene-graph.test.ts`

**Interfaces:**
- Consumes: `World`, `EntityId` de `@nne/core`.
- Produces: `class SceneGraph` avec `constructor(root: Object3D)`, `objectOf(entity: EntityId): Object3D | undefined`, `attach(entity: EntityId, object: Object3D): void`, `detach(entity: EntityId): void`, `sync(world: World): void`, `entities(): EntityId[]`.

`sync` réconcilie trois choses : les entités disparues du monde voient leur `Object3D` retiré ; les entités présentes sans objet en reçoivent un vide ; et le parentage Three est réaligné sur les champs `parent` du monde.

- [ ] **Step 1: Écrire les tests en échec**

`packages/runtime/tests/scene-graph.test.ts` :

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { Object3D } from 'three';
import { World } from '@nne/core';
import { SceneGraph } from '../src/scene-graph.js';

describe('SceneGraph', () => {
  let root: Object3D;
  let graph: SceneGraph;
  let world: World;

  beforeEach(() => {
    root = new Object3D();
    graph = new SceneGraph(root);
    world = new World();
  });

  it('creates an object for each live entity', () => {
    const a = world.spawn('A');
    graph.sync(world);
    expect(graph.objectOf(a)).toBeInstanceOf(Object3D);
  });

  it('parents root entities under the graph root', () => {
    const a = world.spawn('A');
    graph.sync(world);
    expect(graph.objectOf(a)?.parent).toBe(root);
  });

  it('mirrors the world hierarchy', () => {
    const parent = world.spawn('Parent');
    const child = world.spawn('Child', parent);
    graph.sync(world);
    expect(graph.objectOf(child)?.parent).toBe(graph.objectOf(parent));
  });

  it('reparents when the world reparents', () => {
    const p1 = world.spawn('P1');
    const p2 = world.spawn('P2');
    const child = world.spawn('C', p1);
    graph.sync(world);
    world.setParent(child, p2);
    graph.sync(world);
    expect(graph.objectOf(child)?.parent).toBe(graph.objectOf(p2));
    expect(graph.objectOf(p1)?.children).toHaveLength(0);
  });

  it('removes objects for despawned entities', () => {
    const a = world.spawn('A');
    graph.sync(world);
    world.despawn(a);
    graph.sync(world);
    expect(graph.objectOf(a)).toBeUndefined();
    expect(root.children).toHaveLength(0);
  });

  it('removes a whole despawned subtree', () => {
    const a = world.spawn('A');
    const b = world.spawn('B', a);
    graph.sync(world);
    world.despawn(a);
    graph.sync(world);
    expect(graph.objectOf(a)).toBeUndefined();
    expect(graph.objectOf(b)).toBeUndefined();
  });

  it('keeps the same object across syncs', () => {
    const a = world.spawn('A');
    graph.sync(world);
    const first = graph.objectOf(a);
    graph.sync(world);
    expect(graph.objectOf(a)).toBe(first);
  });

  it('tags each object with its entity id', () => {
    const a = world.spawn('A');
    graph.sync(world);
    expect(graph.objectOf(a)?.userData.entity).toBe(a);
  });

  it('names each object after its entity, for debugging', () => {
    const a = world.spawn('Chaise');
    graph.sync(world);
    expect(graph.objectOf(a)?.name).toBe('Chaise');
  });

  it('attach replaces the existing object and keeps the parent link', () => {
    const parent = world.spawn('P');
    const child = world.spawn('C', parent);
    graph.sync(world);
    const replacement = new Object3D();
    graph.attach(child, replacement);
    graph.sync(world);
    expect(graph.objectOf(child)).toBe(replacement);
    expect(replacement.parent).toBe(graph.objectOf(parent));
  });

  it('detach removes an object from the graph and its parent', () => {
    const a = world.spawn('A');
    graph.sync(world);
    graph.detach(a);
    expect(graph.objectOf(a)).toBeUndefined();
    expect(root.children).toHaveLength(0);
  });

  it('lists tracked entities ascending', () => {
    const a = world.spawn('A');
    const b = world.spawn('B');
    graph.sync(world);
    expect(graph.entities()).toEqual([a, b]);
  });

  it('parents a child created before its parent in the same sync', () => {
    // Ids ascend, but the world may hand back a child whose parent is created
    // in the same pass; the graph must still link them.
    const parent = world.spawn('Parent');
    const child = world.spawn('Child', parent);
    graph.sync(world);
    expect(graph.objectOf(child)?.parent).toBe(graph.objectOf(parent));
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd packages/runtime && npx vitest run tests/scene-graph.test.ts`
Attendu : ÉCHEC — `Cannot find module '../src/scene-graph.js'`.

- [ ] **Step 3: Implémenter**

`packages/runtime/src/scene-graph.ts` :

```ts
import { Object3D } from 'three';
import type { EntityId, World } from '@nne/core';

/**
 * Mirrors the ECS hierarchy into a three.js object tree.
 *
 * The world is the source of truth: `sync` only ever reads it and writes the
 * graph, never the other way round.
 */
export class SceneGraph {
  private readonly objects = new Map<EntityId, Object3D>();

  constructor(private readonly root: Object3D) {}

  objectOf(entity: EntityId): Object3D | undefined {
    return this.objects.get(entity);
  }

  entities(): EntityId[] {
    return [...this.objects.keys()].sort((a, b) => a - b);
  }

  /** Replaces the object mirroring an entity, e.g. once its .glb has loaded. */
  attach(entity: EntityId, object: Object3D): void {
    const previous = this.objects.get(entity);
    if (previous) {
      previous.removeFromParent();
      // Carry the children over, so a loaded asset does not orphan child entities.
      for (const child of [...previous.children]) object.add(child);
    }
    object.userData.entity = entity;
    this.objects.set(entity, object);
  }

  detach(entity: EntityId): void {
    const object = this.objects.get(entity);
    if (!object) return;
    object.removeFromParent();
    this.objects.delete(entity);
  }

  sync(world: World): void {
    // 1. Drop objects whose entity is gone.
    for (const entity of [...this.objects.keys()]) {
      if (!world.alive(entity)) this.detach(entity);
    }

    // 2. Create a placeholder for every entity we do not track yet.
    for (const entity of world.entities()) {
      if (!this.objects.has(entity)) {
        const object = new Object3D();
        object.userData.entity = entity;
        this.objects.set(entity, object);
      }
    }

    // 3. Realign parenting. Done after every object exists, so a child whose
    //    parent was created in this same pass still finds it.
    for (const entity of world.entities()) {
      const object = this.objects.get(entity) as Object3D;
      object.name = world.getName(entity);

      const parentId = world.getParent(entity);
      const target = parentId === null ? this.root : this.objects.get(parentId) as Object3D;
      if (object.parent !== target) target.add(object);
    }
  }
}
```

- [ ] **Step 4: Lancer les tests**

Run: `pnpm --filter @nne/runtime test && pnpm --filter @nne/runtime typecheck`
Attendu : PASSE.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/scene-graph.ts packages/runtime/tests/scene-graph.test.ts
git commit -m "feat(runtime): graphe de scene miroir de la hierarchie ECS"
```

---

### Task 6: Système de transform

**Files:**
- Create: `packages/runtime/src/systems/transform-system.ts`
- Test: `packages/runtime/tests/transform-system.test.ts`

**Interfaces:**
- Consumes: `SceneGraph` (Task 5), `applyTransform` (Task 3), `World.peek` (Task 1), `TRANSFORM` de `@nne/core`.
- Produces: `createTransformSystem(graph: SceneGraph): System` — la signature `System` vient de `@nne/core` : `(world: World, dt: number) => void`.

- [ ] **Step 1: Écrire les tests en échec**

`packages/runtime/tests/transform-system.test.ts` :

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { Object3D } from 'three';
import { TRANSFORM, World } from '@nne/core';
import { SceneGraph } from '../src/scene-graph.js';
import { createTransformSystem } from '../src/systems/transform-system.js';

describe('transform system', () => {
  let root: Object3D;
  let graph: SceneGraph;
  let world: World;
  let system: ReturnType<typeof createTransformSystem>;

  beforeEach(() => {
    root = new Object3D();
    graph = new SceneGraph(root);
    world = new World();
    system = createTransformSystem(graph);
  });

  const identity = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };

  it('writes the transform onto the mirrored object', () => {
    const e = world.spawn('A');
    world.set(e, TRANSFORM, { ...identity, position: [1, 2, 3] });
    graph.sync(world);
    system(world, 0.016);
    expect(graph.objectOf(e)?.position.toArray()).toEqual([1, 2, 3]);
  });

  it('ignores entities without a Transform', () => {
    const e = world.spawn('A');
    graph.sync(world);
    expect(() => system(world, 0.016)).not.toThrow();
    expect(graph.objectOf(e)?.position.toArray()).toEqual([0, 0, 0]);
  });

  it('ignores entities the graph does not track', () => {
    const e = world.spawn('A');
    world.set(e, TRANSFORM, identity);
    expect(() => system(world, 0.016)).not.toThrow();
  });

  it('follows a component change on the next run', () => {
    const e = world.spawn('A');
    world.set(e, TRANSFORM, identity);
    graph.sync(world);
    system(world, 0.016);
    world.set(e, TRANSFORM, { ...identity, position: [9, 9, 9] });
    system(world, 0.016);
    expect(graph.objectOf(e)?.position.toArray()).toEqual([9, 9, 9]);
  });

  it('never writes back into the component', () => {
    const e = world.spawn('A');
    world.set(e, TRANSFORM, identity);
    graph.sync(world);
    const object = graph.objectOf(e) as Object3D;
    object.position.set(7, 7, 7);
    system(world, 0.016);
    expect(world.get(e, TRANSFORM)).toEqual(identity);
  });

  it('applies transforms to a whole hierarchy', () => {
    const parent = world.spawn('P');
    const child = world.spawn('C', parent);
    world.set(parent, TRANSFORM, { ...identity, position: [1, 0, 0] });
    world.set(child, TRANSFORM, { ...identity, position: [0, 1, 0] });
    graph.sync(world);
    system(world, 0.016);
    expect(graph.objectOf(parent)?.position.toArray()).toEqual([1, 0, 0]);
    expect(graph.objectOf(child)?.position.toArray()).toEqual([0, 1, 0]);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd packages/runtime && npx vitest run tests/transform-system.test.ts`
Attendu : ÉCHEC — module introuvable.

- [ ] **Step 3: Implémenter**

`packages/runtime/src/systems/transform-system.ts` :

```ts
import { TRANSFORM, type System } from '@nne/core';
import type { SceneGraph } from '../scene-graph.js';
import { applyTransform } from '../convert.js';
import type { TransformData } from '../types.js';

/**
 * Copies Transform components onto their mirrored objects, once per frame.
 * Uses `peek` rather than `get`: this runs for every entity, every frame, and
 * `get`'s defensive copy would dominate the frame budget.
 */
export function createTransformSystem(graph: SceneGraph): System {
  return (world) => {
    for (const entity of world.query(TRANSFORM)) {
      const object = graph.objectOf(entity);
      if (!object) continue;
      applyTransform(object, world.peek(entity, TRANSFORM) as unknown as TransformData);
    }
  };
}
```

- [ ] **Step 4: Lancer les tests**

Run: `pnpm --filter @nne/runtime test && pnpm --filter @nne/runtime typecheck`
Attendu : PASSE.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/systems packages/runtime/tests/transform-system.test.ts
git commit -m "feat(runtime): systeme de transform"
```

---

### Task 7: Système de mesh

**Files:**
- Create: `packages/runtime/src/systems/mesh-system.ts`
- Test: `packages/runtime/tests/mesh-system.test.ts`

**Interfaces:**
- Consumes: `SceneGraph` (Task 5), `AssetCache` (Task 4), `MESH` de `@nne/core`.
- Produces: `createMeshSystem(graph: SceneGraph, assets: AssetCache): System`.

Le chargement est asynchrone mais le système est synchrone : il déclenche le chargement, marque l'entité comme en cours, et attache l'objet quand la promesse se résout. Une entité dont l'asset change doit repasser par un chargement ; une entité despawnée pendant le chargement ne doit rien attacher.

- [ ] **Step 1: Écrire les tests en échec**

`packages/runtime/tests/mesh-system.test.ts` :

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { Mesh, Object3D } from 'three';
import { MESH, World } from '@nne/core';
import { AssetCache } from '../src/assets.js';
import { SceneGraph } from '../src/scene-graph.js';
import { createMeshSystem } from '../src/systems/mesh-system.js';

/** Resolves loads only when we say so, to test the async seam deterministically. */
function controllableSource() {
  const resolvers: (() => void)[] = [];
  let calls = 0;
  return {
    get calls() { return calls; },
    flush: async () => { for (const r of resolvers.splice(0)) r(); await Promise.resolve(); },
    async load(_url: string) {
      calls++;
      await new Promise<void>((resolve) => resolvers.push(resolve));
      return new Mesh() as Object3D;
    },
  };
}

describe('mesh system', () => {
  let root: Object3D;
  let graph: SceneGraph;
  let world: World;
  let source: ReturnType<typeof controllableSource>;
  let system: ReturnType<typeof createMeshSystem>;

  beforeEach(() => {
    root = new Object3D();
    graph = new SceneGraph(root);
    world = new World();
    source = controllableSource();
    system = createMeshSystem(graph, new AssetCache(source));
  });

  it('requests the asset for a Mesh component', () => {
    const e = world.spawn('A');
    world.set(e, MESH, { asset: 'a.glb', castShadow: true });
    graph.sync(world);
    system(world, 0.016);
    expect(source.calls).toBe(1);
  });

  it('attaches the loaded object once it resolves', async () => {
    const e = world.spawn('A');
    world.set(e, MESH, { asset: 'a.glb', castShadow: true });
    graph.sync(world);
    system(world, 0.016);
    await source.flush();
    expect(graph.objectOf(e)).toBeInstanceOf(Mesh);
  });

  it('does not request the same asset twice for one entity', () => {
    const e = world.spawn('A');
    world.set(e, MESH, { asset: 'a.glb', castShadow: true });
    graph.sync(world);
    system(world, 0.016);
    system(world, 0.016);
    expect(source.calls).toBe(1);
  });

  it('ignores a Mesh with a null asset', () => {
    const e = world.spawn('A');
    world.set(e, MESH, { asset: null, castShadow: true });
    graph.sync(world);
    system(world, 0.016);
    expect(source.calls).toBe(0);
  });

  it('reloads when the asset path changes', async () => {
    const e = world.spawn('A');
    world.set(e, MESH, { asset: 'a.glb', castShadow: true });
    graph.sync(world);
    system(world, 0.016);
    await source.flush();
    world.set(e, MESH, { asset: 'b.glb', castShadow: true });
    system(world, 0.016);
    expect(source.calls).toBe(2);
  });

  it('applies castShadow to the loaded object and its descendants', async () => {
    const e = world.spawn('A');
    world.set(e, MESH, { asset: 'a.glb', castShadow: true });
    graph.sync(world);
    system(world, 0.016);
    await source.flush();
    expect(graph.objectOf(e)?.castShadow).toBe(true);
  });

  it('attaches nothing when the entity was despawned during the load', async () => {
    const e = world.spawn('A');
    world.set(e, MESH, { asset: 'a.glb', castShadow: true });
    graph.sync(world);
    system(world, 0.016);
    world.despawn(e);
    graph.sync(world);
    await source.flush();
    expect(graph.objectOf(e)).toBeUndefined();
  });

  it('keeps child entities attached when the asset replaces the placeholder', async () => {
    const parent = world.spawn('P');
    const child = world.spawn('C', parent);
    world.set(parent, MESH, { asset: 'a.glb', castShadow: true });
    graph.sync(world);
    system(world, 0.016);
    await source.flush();
    graph.sync(world);
    expect(graph.objectOf(child)?.parent).toBe(graph.objectOf(parent));
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd packages/runtime && npx vitest run tests/mesh-system.test.ts`
Attendu : ÉCHEC — module introuvable.

- [ ] **Step 3: Implémenter**

`packages/runtime/src/systems/mesh-system.ts` :

```ts
import { MESH, type EntityId, type System } from '@nne/core';
import type { AssetCache } from '../assets.js';
import type { SceneGraph } from '../scene-graph.js';
import type { MeshData } from '../types.js';

/**
 * Loads .glb assets for Mesh components and swaps them into the graph.
 *
 * The system itself stays synchronous: it starts a load, remembers which url is
 * in flight per entity, and attaches the result when the promise settles. An
 * entity despawned mid-load attaches nothing.
 */
export function createMeshSystem(graph: SceneGraph, assets: AssetCache): System {
  const resolved = new Map<EntityId, string>();

  return (world) => {
    for (const entity of world.query(MESH)) {
      const data = world.peek(entity, MESH) as unknown as MeshData;
      if (data.asset === null) continue;
      if (resolved.get(entity) === data.asset) continue;

      resolved.set(entity, data.asset);
      const url = data.asset;

      void assets.get(url).then((object) => {
        // The entity may have been despawned, or pointed at another asset,
        // while the load was in flight.
        if (!world.alive(entity) || resolved.get(entity) !== url) return;
        object.castShadow = data.castShadow;
        object.traverse((child) => { child.castShadow = data.castShadow; });
        graph.attach(entity, object);
      });
    }

    for (const entity of resolved.keys()) {
      if (!world.alive(entity)) resolved.delete(entity);
    }
  };
}
```

- [ ] **Step 4: Lancer les tests**

Run: `pnpm --filter @nne/runtime test && pnpm --filter @nne/runtime typecheck`
Attendu : PASSE.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/systems/mesh-system.ts packages/runtime/tests/mesh-system.test.ts
git commit -m "feat(runtime): systeme de mesh avec chargement asynchrone"
```

---

### Task 8: Systèmes de caméra et de lumières

**Files:**
- Create: `packages/runtime/src/systems/camera-system.ts`
- Create: `packages/runtime/src/systems/light-system.ts`
- Test: `packages/runtime/tests/camera-system.test.ts`
- Test: `packages/runtime/tests/light-system.test.ts`

**Interfaces:**
- Consumes: `SceneGraph` (Task 5), `createLight`/`applyLight` (Task 3), `CAMERA`/`LIGHT` de `@nne/core`.
- Produces: `createCameraSystem(graph: SceneGraph): System & { active(): PerspectiveCamera | undefined }` et `createLightSystem(graph: SceneGraph): System`.

Le système de caméra expose la caméra active, dont le renderer a besoin. Quand plusieurs caméras sont marquées `active`, celle au plus petit ID gagne — un choix arbitraire mais déterministe, à documenter.

- [ ] **Step 1: Écrire les tests en échec**

`packages/runtime/tests/camera-system.test.ts` :

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { Object3D, PerspectiveCamera } from 'three';
import { CAMERA, World } from '@nne/core';
import { SceneGraph } from '../src/scene-graph.js';
import { createCameraSystem } from '../src/systems/camera-system.js';

describe('camera system', () => {
  let graph: SceneGraph;
  let world: World;
  let system: ReturnType<typeof createCameraSystem>;

  beforeEach(() => {
    graph = new SceneGraph(new Object3D());
    world = new World();
    system = createCameraSystem(graph);
  });

  const camera = { fov: 60, near: 0.1, far: 1000, active: true };

  it('has no active camera before running', () => {
    expect(system.active()).toBeUndefined();
  });

  it('attaches a PerspectiveCamera for a Camera component', () => {
    const e = world.spawn('Cam');
    world.set(e, CAMERA, camera);
    graph.sync(world);
    system(world, 0.016);
    expect(graph.objectOf(e)).toBeInstanceOf(PerspectiveCamera);
  });

  it('exposes the active camera', () => {
    const e = world.spawn('Cam');
    world.set(e, CAMERA, camera);
    graph.sync(world);
    system(world, 0.016);
    expect(system.active()).toBe(graph.objectOf(e));
  });

  it('applies fov, near and far', () => {
    const e = world.spawn('Cam');
    world.set(e, CAMERA, { fov: 75, near: 0.5, far: 500, active: true });
    graph.sync(world);
    system(world, 0.016);
    const active = system.active() as PerspectiveCamera;
    expect([active.fov, active.near, active.far]).toEqual([75, 0.5, 500]);
  });

  it('follows a fov change without recreating the camera', () => {
    const e = world.spawn('Cam');
    world.set(e, CAMERA, camera);
    graph.sync(world);
    system(world, 0.016);
    const first = system.active();
    world.set(e, CAMERA, { ...camera, fov: 30 });
    system(world, 0.016);
    expect(system.active()).toBe(first);
    expect((system.active() as PerspectiveCamera).fov).toBe(30);
  });

  it('ignores an inactive camera', () => {
    const e = world.spawn('Cam');
    world.set(e, CAMERA, { ...camera, active: false });
    graph.sync(world);
    system(world, 0.016);
    expect(system.active()).toBeUndefined();
  });

  it('picks the lowest entity id when several are active', () => {
    const first = world.spawn('Cam1');
    const second = world.spawn('Cam2');
    world.set(second, CAMERA, camera);
    world.set(first, CAMERA, camera);
    graph.sync(world);
    system(world, 0.016);
    expect(system.active()).toBe(graph.objectOf(first));
  });

  it('drops the active camera when its entity is despawned', () => {
    const e = world.spawn('Cam');
    world.set(e, CAMERA, camera);
    graph.sync(world);
    system(world, 0.016);
    world.despawn(e);
    graph.sync(world);
    system(world, 0.016);
    expect(system.active()).toBeUndefined();
  });
});
```

`packages/runtime/tests/light-system.test.ts` :

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { DirectionalLight, Object3D, PointLight } from 'three';
import { LIGHT, World } from '@nne/core';
import { SceneGraph } from '../src/scene-graph.js';
import { createLightSystem } from '../src/systems/light-system.js';

describe('light system', () => {
  let graph: SceneGraph;
  let world: World;
  let system: ReturnType<typeof createLightSystem>;

  beforeEach(() => {
    graph = new SceneGraph(new Object3D());
    world = new World();
    system = createLightSystem(graph);
  });

  const light = { type: 'directional', color: '#ffffff', intensity: 1 };

  it('attaches a light object', () => {
    const e = world.spawn('L');
    world.set(e, LIGHT, light);
    graph.sync(world);
    system(world, 0.016);
    expect(graph.objectOf(e)).toBeInstanceOf(DirectionalLight);
  });

  it('applies colour and intensity', () => {
    const e = world.spawn('L');
    world.set(e, LIGHT, { ...light, color: '#ff0000', intensity: 4 });
    graph.sync(world);
    system(world, 0.016);
    const created = graph.objectOf(e) as DirectionalLight;
    expect(created.color.getHexString()).toBe('ff0000');
    expect(created.intensity).toBe(4);
  });

  it('updates in place when only intensity changes', () => {
    const e = world.spawn('L');
    world.set(e, LIGHT, light);
    graph.sync(world);
    system(world, 0.016);
    const first = graph.objectOf(e);
    world.set(e, LIGHT, { ...light, intensity: 9 });
    system(world, 0.016);
    expect(graph.objectOf(e)).toBe(first);
    expect((graph.objectOf(e) as DirectionalLight).intensity).toBe(9);
  });

  it('recreates the object when the light type changes', () => {
    const e = world.spawn('L');
    world.set(e, LIGHT, light);
    graph.sync(world);
    system(world, 0.016);
    world.set(e, LIGHT, { ...light, type: 'point' });
    system(world, 0.016);
    expect(graph.objectOf(e)).toBeInstanceOf(PointLight);
  });

  it('ignores entities the graph does not track', () => {
    const e = world.spawn('L');
    world.set(e, LIGHT, light);
    expect(() => system(world, 0.016)).not.toThrow();
  });
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd packages/runtime && npx vitest run tests/camera-system.test.ts tests/light-system.test.ts`
Attendu : ÉCHEC — modules introuvables.

- [ ] **Step 3: Implémenter la caméra**

`packages/runtime/src/systems/camera-system.ts` :

```ts
import { PerspectiveCamera } from 'three';
import { CAMERA, type EntityId, type System, type World } from '@nne/core';
import type { SceneGraph } from '../scene-graph.js';
import type { CameraData } from '../types.js';

export interface CameraSystem extends System {
  /** The camera the renderer should draw through, if any. */
  active(): PerspectiveCamera | undefined;
}

/**
 * Keeps a PerspectiveCamera in sync with each Camera component, and tracks
 * which one is active. When several are active the lowest entity id wins:
 * arbitrary, but deterministic, so a scene renders the same way every load.
 */
export function createCameraSystem(graph: SceneGraph): CameraSystem {
  const cameras = new Map<EntityId, PerspectiveCamera>();
  let activeEntity: EntityId | undefined;

  const system = ((world: World) => {
    activeEntity = undefined;

    for (const entity of world.query(CAMERA)) {
      if (!graph.objectOf(entity)) continue;
      const data = world.peek(entity, CAMERA) as unknown as CameraData;

      let camera = cameras.get(entity);
      if (!camera) {
        camera = new PerspectiveCamera(data.fov, 1, data.near, data.far);
        cameras.set(entity, camera);
        graph.attach(entity, camera);
      }

      camera.fov = data.fov;
      camera.near = data.near;
      camera.far = data.far;
      camera.updateProjectionMatrix();

      if (data.active && (activeEntity === undefined || entity < activeEntity)) {
        activeEntity = entity;
      }
    }

    for (const entity of [...cameras.keys()]) {
      if (!world.alive(entity)) cameras.delete(entity);
    }
  }) as CameraSystem;

  system.active = () =>
    (activeEntity === undefined ? undefined : cameras.get(activeEntity));

  return system;
}
```

- [ ] **Step 4: Implémenter les lumières**

`packages/runtime/src/systems/light-system.ts` :

```ts
import type { Light } from 'three';
import { LIGHT, type EntityId, type System } from '@nne/core';
import { applyLight, createLight } from '../convert.js';
import type { SceneGraph } from '../scene-graph.js';
import type { LightData } from '../types.js';

/**
 * Keeps a three.js light in sync with each Light component.
 * Light types are separate classes, so changing `type` recreates the object
 * rather than mutating it.
 */
export function createLightSystem(graph: SceneGraph): System {
  const lights = new Map<EntityId, Light>();

  return (world) => {
    for (const entity of world.query(LIGHT)) {
      if (!graph.objectOf(entity)) continue;
      const data = world.peek(entity, LIGHT) as unknown as LightData;

      const existing = lights.get(entity);
      if (existing && applyLight(existing, data)) continue;

      const light = createLight(data);
      lights.set(entity, light);
      graph.attach(entity, light);
    }

    for (const entity of [...lights.keys()]) {
      if (!world.alive(entity)) lights.delete(entity);
    }
  };
}
```

- [ ] **Step 5: Lancer les tests**

Run: `pnpm --filter @nne/runtime test && pnpm --filter @nne/runtime typecheck`
Attendu : PASSE.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/systems packages/runtime/tests/camera-system.test.ts packages/runtime/tests/light-system.test.ts
git commit -m "feat(runtime): systemes de camera et de lumieres"
```

---

### Task 9: Le moteur — assemblage et boucle

**Files:**
- Create: `packages/runtime/src/engine.ts`
- Test: `packages/runtime/tests/engine.test.ts`

**Interfaces:**
- Consumes: tout ce qui précède, plus `Scheduler` de `@nne/core`.
- Produces: `interface Viewport { render(scene: Scene, camera: PerspectiveCamera): void; resize(width: number, height: number): void; dispose(): void }`, `class Engine` avec `constructor(options: EngineOptions)`, `readonly world`, `readonly graph`, `readonly scheduler`, `readonly scene`, `step(dt: number): void`, `start(): void`, `stop(): void`, `dispose(): void`. `EngineOptions = { world: World; assets: AssetCache; viewport?: Viewport; now?: () => number; schedule?: (cb: () => void) => number; cancel?: (handle: number) => void }`.

Le `WebGLRenderer` est derrière `Viewport` : sans lui, `Engine` tourne intégralement en Node. `schedule`/`cancel` sont injectables pour tester la boucle sans `requestAnimationFrame`.

- [ ] **Step 1: Écrire les tests en échec**

`packages/runtime/tests/engine.test.ts` :

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Mesh, type Object3D, type PerspectiveCamera, type Scene } from 'three';
import { CAMERA, LIGHT, MESH, TRANSFORM, World } from '@nne/core';
import { AssetCache } from '../src/assets.js';
import { Engine, type Viewport } from '../src/engine.js';

function fakeViewport() {
  return {
    frames: [] as { scene: Scene; camera: PerspectiveCamera }[],
    resized: [] as [number, number][],
    disposed: false,
    render(scene: Scene, camera: PerspectiveCamera) { this.frames.push({ scene, camera }); },
    resize(w: number, h: number) { this.resized.push([w, h]); },
    dispose() { this.disposed = true; },
  } satisfies Viewport & Record<string, unknown>;
}

const assets = () => new AssetCache({ async load() { return new Mesh() as Object3D; } });

describe('Engine', () => {
  let world: World;
  beforeEach(() => { world = new World(); });

  it('exposes the world, graph, scheduler and scene', () => {
    const engine = new Engine({ world, assets: assets() });
    expect(engine.world).toBe(world);
    expect(engine.graph).toBeDefined();
    expect(engine.scheduler.names().length).toBeGreaterThan(0);
    expect(engine.scene).toBeDefined();
  });

  it('registers its systems in a documented order', () => {
    const engine = new Engine({ world, assets: assets() });
    expect(engine.scheduler.names()).toEqual(['mesh', 'camera', 'light', 'transform']);
  });

  it('syncs the graph before running systems', () => {
    const engine = new Engine({ world, assets: assets() });
    const e = world.spawn('A');
    world.set(e, TRANSFORM, { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] });
    engine.step(0.016);
    expect(engine.graph.objectOf(e)?.position.toArray()).toEqual([1, 2, 3]);
  });

  it('renders through the active camera when a viewport is given', () => {
    const viewport = fakeViewport();
    const engine = new Engine({ world, assets: assets(), viewport });
    const cam = world.spawn('Cam');
    world.set(cam, CAMERA, { fov: 60, near: 0.1, far: 1000, active: true });
    engine.step(0.016);
    expect(viewport.frames).toHaveLength(1);
    expect(viewport.frames[0]?.scene).toBe(engine.scene);
  });

  it('does not render when there is no active camera', () => {
    const viewport = fakeViewport();
    const engine = new Engine({ world, assets: assets(), viewport });
    engine.step(0.016);
    expect(viewport.frames).toHaveLength(0);
  });

  it('runs headlessly without a viewport', () => {
    const engine = new Engine({ world, assets: assets() });
    expect(() => engine.step(0.016)).not.toThrow();
  });

  it('drives frames through the injected scheduler', () => {
    let pending: (() => void) | undefined;
    let time = 0;
    const engine = new Engine({
      world, assets: assets(),
      now: () => time,
      schedule: (cb) => { pending = cb; return 1; },
      cancel: () => { pending = undefined; },
    });
    const spy = vi.spyOn(engine, 'step');

    engine.start();
    time = 16;
    pending?.();
    expect(spy).toHaveBeenCalledWith(0.016);
  });

  it('stops scheduling after stop()', () => {
    let pending: (() => void) | undefined;
    const engine = new Engine({
      world, assets: assets(),
      now: () => 0,
      schedule: (cb) => { pending = cb; return 1; },
      cancel: () => { pending = undefined; },
    });
    engine.start();
    engine.stop();
    expect(pending).toBeUndefined();
  });

  it('clamps a long frame so physics-free logic does not jump', () => {
    let pending: (() => void) | undefined;
    let time = 0;
    const engine = new Engine({
      world, assets: assets(),
      now: () => time,
      schedule: (cb) => { pending = cb; return 1; },
      cancel: () => {},
    });
    const spy = vi.spyOn(engine, 'step');
    engine.start();
    time = 5000;                       // tab was backgrounded for five seconds
    pending?.();
    expect(spy).toHaveBeenCalledWith(0.1);
  });

  it('forwards resize to the viewport', () => {
    const viewport = fakeViewport();
    const engine = new Engine({ world, assets: assets(), viewport });
    engine.resize(800, 600);
    expect(viewport.resized).toEqual([[800, 600]]);
  });

  it('updates the active camera aspect on resize', () => {
    const viewport = fakeViewport();
    const engine = new Engine({ world, assets: assets(), viewport });
    const cam = world.spawn('Cam');
    world.set(cam, CAMERA, { fov: 60, near: 0.1, far: 1000, active: true });
    engine.step(0.016);
    engine.resize(800, 400);
    expect(engine.activeCamera()?.aspect).toBe(2);
  });

  it('disposes the viewport and stops the loop', () => {
    const viewport = fakeViewport();
    const engine = new Engine({ world, assets: assets(), viewport, now: () => 0, schedule: () => 1, cancel: () => {} });
    engine.start();
    engine.dispose();
    expect(viewport.disposed).toBe(true);
  });

  it('renders lights and meshes together without throwing', () => {
    const engine = new Engine({ world, assets: assets() });
    const cam = world.spawn('Cam');
    world.set(cam, CAMERA, { fov: 60, near: 0.1, far: 1000, active: true });
    const light = world.spawn('L');
    world.set(light, LIGHT, { type: 'ambient', color: '#ffffff', intensity: 1 });
    const mesh = world.spawn('M');
    world.set(mesh, MESH, { asset: 'a.glb', castShadow: true });
    world.set(mesh, TRANSFORM, { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
    expect(() => { engine.step(0.016); engine.step(0.016); }).not.toThrow();
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd packages/runtime && npx vitest run tests/engine.test.ts`
Attendu : ÉCHEC — module introuvable.

- [ ] **Step 3: Implémenter**

`packages/runtime/src/engine.ts` :

```ts
import { Object3D, type PerspectiveCamera, Scene } from 'three';
import { Scheduler, type World } from '@nne/core';
import type { AssetCache } from './assets.js';
import { SceneGraph } from './scene-graph.js';
import { createCameraSystem, type CameraSystem } from './systems/camera-system.js';
import { createLightSystem } from './systems/light-system.js';
import { createMeshSystem } from './systems/mesh-system.js';
import { createTransformSystem } from './systems/transform-system.js';

/** Everything that needs a real GPU context, behind one narrow interface. */
export interface Viewport {
  render(scene: Scene, camera: PerspectiveCamera): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

export interface EngineOptions {
  world: World;
  assets: AssetCache;
  /** Omit to run headlessly, e.g. in tests. */
  viewport?: Viewport;
  now?: () => number;
  schedule?: (callback: () => void) => number;
  cancel?: (handle: number) => void;
}

/** A frame longer than this is clamped, so a backgrounded tab cannot jump state. */
const MAX_DELTA_SECONDS = 0.1;

export class Engine {
  readonly world: World;
  readonly graph: SceneGraph;
  readonly scheduler = new Scheduler();
  readonly scene = new Scene();

  private readonly assets: AssetCache;
  private readonly viewport: Viewport | undefined;
  private readonly camera: CameraSystem;
  private readonly now: () => number;
  private readonly schedule: (callback: () => void) => number;
  private readonly cancel: (handle: number) => void;

  private handle: number | undefined;
  private lastTime = 0;
  private width = 1;
  private height = 1;

  constructor(options: EngineOptions) {
    this.world = options.world;
    this.assets = options.assets;
    this.viewport = options.viewport;
    this.now = options.now ?? (() => performance.now());
    this.schedule = options.schedule ?? ((cb) => requestAnimationFrame(cb));
    this.cancel = options.cancel ?? ((h) => cancelAnimationFrame(h));

    const root = new Object3D();
    root.name = 'entities';
    this.scene.add(root);
    this.graph = new SceneGraph(root);

    this.camera = createCameraSystem(this.graph);

    // Order matters and is deliberate: meshes and cameras and lights may all
    // attach new objects, and transform runs last so it writes onto whatever
    // object each entity ended the frame with.
    this.scheduler.add('mesh', createMeshSystem(this.graph, this.assets));
    this.scheduler.add('camera', this.camera);
    this.scheduler.add('light', createLightSystem(this.graph));
    this.scheduler.add('transform', createTransformSystem(this.graph));
  }

  activeCamera(): PerspectiveCamera | undefined {
    return this.camera.active();
  }

  step(dt: number): void {
    this.graph.sync(this.world);
    this.scheduler.run(this.world, dt);

    const camera = this.camera.active();
    if (this.viewport && camera) this.viewport.render(this.scene, camera);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.viewport?.resize(width, height);
    const camera = this.camera.active();
    if (camera) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
  }

  start(): void {
    if (this.handle !== undefined) return;
    this.lastTime = this.now();
    const frame = (): void => {
      const time = this.now();
      const dt = Math.min((time - this.lastTime) / 1000, MAX_DELTA_SECONDS);
      this.lastTime = time;
      this.step(dt);
      this.handle = this.schedule(frame);
    };
    this.handle = this.schedule(frame);
  }

  stop(): void {
    if (this.handle === undefined) return;
    this.cancel(this.handle);
    this.handle = undefined;
  }

  dispose(): void {
    this.stop();
    this.viewport?.dispose();
  }
}
```

- [ ] **Step 4: Lancer les tests**

Run: `pnpm --filter @nne/runtime test && pnpm --filter @nne/runtime typecheck`
Attendu : PASSE.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/engine.ts packages/runtime/tests/engine.test.ts
git commit -m "feat(runtime): moteur, assemblage des systemes et boucle de jeu"
```

---

### Task 10: Viewport WebGL et player

**Files:**
- Create: `packages/runtime/src/webgl-viewport.ts`
- Create: `packages/runtime/src/player.ts`
- Test: `packages/runtime/tests/player.test.ts`

**Interfaces:**
- Consumes: `Engine`, `Viewport`, `AssetCache`, `createGltfSource`.
- Produces: `createWebGLViewport(canvas: HTMLCanvasElement): Viewport` (non testé unitairement — il lui faut un GPU) et `loadSceneIntoWorld(json: unknown, registry: ComponentRegistry): World`, `createPlayer(options: PlayerOptions): Promise<Engine>` avec `PlayerOptions = { canvas: HTMLCanvasElement; sceneUrl: string; fetchJson?: (url: string) => Promise<unknown> }`.

`loadSceneIntoWorld` est la fonction que la review finale de `core` réclamait : elle valide puis désérialise en une étape, et lève une erreur agrégée lisible plutôt que de forcer chaque appelant à écrire `as SceneFile`.

- [ ] **Step 1: Écrire les tests en échec**

`packages/runtime/tests/player.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { ComponentRegistry, MESH, TRANSFORM, registerBuiltins } from '@nne/core';
import { loadSceneIntoWorld } from '../src/player.js';

function registry(): ComponentRegistry {
  const r = new ComponentRegistry();
  registerBuiltins(r);
  return r;
}

const valid = {
  version: 1,
  name: 'Scene_01',
  entities: [
    { id: 1, name: 'Root', components: {} },
    {
      id: 2, name: 'Chair', parent: 1,
      components: {
        Mesh: { asset: 'a.glb', castShadow: true },
        Transform: { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] },
      },
    },
  ],
};

describe('loadSceneIntoWorld', () => {
  it('builds a world from a valid scene', () => {
    const world = loadSceneIntoWorld(valid, registry());
    expect(world.entities()).toEqual([1, 2]);
    expect(world.getName(2)).toBe('Chair');
    expect(world.getParent(2)).toBe(1);
    expect(world.get(2, MESH)).toEqual({ asset: 'a.glb', castShadow: true });
    expect(world.get(2, TRANSFORM)).toEqual({ position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] });
  });

  it('throws on an invalid scene rather than returning a broken world', () => {
    const broken = { ...valid, version: 99 };
    expect(() => loadSceneIntoWorld(broken, registry())).toThrow(/version/);
  });

  it('reports every validation error, not just the first', () => {
    const broken = {
      version: 1, name: 'X',
      entities: [{ id: 1, name: 'A', components: { Mesh: { asset: 1, castShadow: 'no' } } }],
    };
    try {
      loadSceneIntoWorld(broken, registry());
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as Error).message).toMatch(/asset/);
      expect((error as Error).message).toMatch(/castShadow/);
    }
  });

  it('includes the error paths in the message', () => {
    const broken = { ...valid, name: 42 };
    expect(() => loadSceneIntoWorld(broken, registry())).toThrow(/scene\.name/);
  });

  it('rejects a cyclic scene before it reaches the world', () => {
    const cyclic = {
      version: 1, name: 'Cycle',
      entities: [
        { id: 1, name: 'A', parent: 2, components: {} },
        { id: 2, name: 'B', parent: 1, components: {} },
      ],
    };
    expect(() => loadSceneIntoWorld(cyclic, registry())).toThrow(/cycle/);
  });

  it('advances the id counter past the loaded entities', () => {
    const world = loadSceneIntoWorld(valid, registry());
    expect(world.spawn()).toBe(3);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd packages/runtime && npx vitest run tests/player.test.ts`
Attendu : ÉCHEC — module introuvable.

- [ ] **Step 3: Implémenter le viewport WebGL**

`packages/runtime/src/webgl-viewport.ts` :

```ts
import { PCFSoftShadowMap, type PerspectiveCamera, type Scene, WebGLRenderer } from 'three';
import type { Viewport } from './engine.js';

/**
 * The only place a GPU context is created. Everything else in this package runs
 * headlessly, which is what makes the systems testable in node.
 */
export function createWebGLViewport(canvas: HTMLCanvasElement): Viewport {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  return {
    render(scene: Scene, camera: PerspectiveCamera): void {
      renderer.render(scene, camera);
    },
    resize(width: number, height: number): void {
      renderer.setSize(width, height, false);
    },
    dispose(): void {
      renderer.dispose();
    },
  };
}
```

- [ ] **Step 4: Implémenter le player**

`packages/runtime/src/player.ts` :

```ts
import {
  type ComponentRegistry, type SceneFile, type World,
  deserializeScene, registerBuiltins, validateScene, ComponentRegistry as Registry,
} from '@nne/core';
import { AssetCache, createGltfSource } from './assets.js';
import { Engine } from './engine.js';
import { createWebGLViewport } from './webgl-viewport.js';

/**
 * Validates then deserializes in one step.
 *
 * Without this, every consumer writes `JSON.parse(text) as SceneFile` after
 * validating — an unchecked cast at exactly the seam validation exists to
 * protect.
 */
export function loadSceneIntoWorld(json: unknown, registry: ComponentRegistry): World {
  const errors = validateScene(json, registry);
  if (errors.length > 0) {
    const detail = errors.map((e) => `${e.path}: ${e.message}`).join('\n  ');
    throw new Error(`invalid scene file:\n  ${detail}`);
  }
  return deserializeScene(json as SceneFile);
}

export interface PlayerOptions {
  canvas: HTMLCanvasElement;
  sceneUrl: string;
  fetchJson?: (url: string) => Promise<unknown>;
}

/** Boots a standalone player: no editor, no build step beyond Vite. */
export async function createPlayer(options: PlayerOptions): Promise<Engine> {
  const fetchJson = options.fetchJson ?? (async (url: string) => (await fetch(url)).json());

  const registry = new Registry();
  registerBuiltins(registry);

  const world = loadSceneIntoWorld(await fetchJson(options.sceneUrl), registry);
  const engine = new Engine({
    world,
    assets: new AssetCache(createGltfSource()),
    viewport: createWebGLViewport(options.canvas),
  });

  engine.resize(options.canvas.clientWidth || 1, options.canvas.clientHeight || 1);
  engine.start();
  return engine;
}
```

- [ ] **Step 5: Lancer les tests**

Run: `pnpm --filter @nne/runtime test && pnpm --filter @nne/runtime typecheck`
Attendu : PASSE.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/webgl-viewport.ts packages/runtime/src/player.ts packages/runtime/tests/player.test.ts
git commit -m "feat(runtime): viewport WebGL et player autonome"
```

---

### Task 11: API publique et gardes

**Files:**
- Create: `packages/runtime/src/index.ts`
- Test: `packages/runtime/tests/public-api.test.ts`
- Test: `packages/runtime/tests/integration.test.ts`

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: `packages/runtime/src/index.ts`, seul point d'entrée public, réexportant `Engine`, `type EngineOptions`, `type Viewport`, `SceneGraph`, `AssetCache`, `type GltfSource`, `createGltfSource`, `createWebGLViewport`, `createPlayer`, `type PlayerOptions`, `loadSceneIntoWorld`, `applyTransform`, `createLight`, `applyLight`, les quatre `create*System`, et les types de `types.ts`.

- [ ] **Step 1: Écrire l'API publique**

`packages/runtime/src/index.ts` :

```ts
export { Engine, type EngineOptions, type Viewport } from './engine.js';
export { SceneGraph } from './scene-graph.js';
export { AssetCache, createGltfSource, type GltfSource } from './assets.js';
export { createWebGLViewport } from './webgl-viewport.js';
export { createPlayer, loadSceneIntoWorld, type PlayerOptions } from './player.js';
export { applyLight, applyTransform, createLight } from './convert.js';
export { createCameraSystem, type CameraSystem } from './systems/camera-system.js';
export { createLightSystem } from './systems/light-system.js';
export { createMeshSystem } from './systems/mesh-system.js';
export { createTransformSystem } from './systems/transform-system.js';
export type {
  CameraData, Euler, EntityUserData, LightData, MeshData, TransformData, Vec3,
} from './types.js';
```

- [ ] **Step 2: Écrire le test d'API publique**

`packages/runtime/tests/public-api.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import * as runtime from '../src/index.js';

describe('public API', () => {
  it('exports every documented symbol', () => {
    for (const name of [
      'Engine', 'SceneGraph', 'AssetCache', 'createGltfSource',
      'createWebGLViewport', 'createPlayer', 'loadSceneIntoWorld',
      'applyTransform', 'createLight', 'applyLight',
      'createCameraSystem', 'createLightSystem', 'createMeshSystem', 'createTransformSystem',
    ]) {
      expect(runtime).toHaveProperty(name);
    }
  });
});
```

- [ ] **Step 3: Écrire le test d'intégration bout en bout**

`packages/runtime/tests/integration.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { Mesh, type Object3D, PerspectiveCamera } from 'three';
import { ComponentRegistry, registerBuiltins } from '@nne/core';
import { AssetCache } from '../src/assets.js';
import { Engine } from '../src/engine.js';
import { loadSceneIntoWorld } from '../src/player.js';

const sceneFile = {
  version: 1,
  name: 'Scene_01',
  entities: [
    {
      id: 1, name: 'Camera',
      components: {
        Camera: { fov: 60, near: 0.1, far: 1000, active: true },
        Transform: { position: [0, 1.6, 5], rotation: [0, 0, 0], scale: [1, 1, 1] },
      },
    },
    {
      id: 2, name: 'Sun',
      components: { Light: { type: 'directional', color: '#ffffff', intensity: 1 } },
    },
    {
      id: 3, name: 'Chair', parent: 1,
      components: {
        Mesh: { asset: 'PRP_Chair_01.glb', castShadow: true },
        Transform: { position: [1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      },
    },
  ],
};

describe('scene file to rendered graph', () => {
  it('loads a scene and builds the matching three graph', async () => {
    const registry = new ComponentRegistry();
    registerBuiltins(registry);

    const world = loadSceneIntoWorld(sceneFile, registry);
    const engine = new Engine({
      world,
      assets: new AssetCache({ async load() { return new Mesh() as Object3D; } }),
    });

    engine.step(0.016);
    await Promise.resolve();
    engine.step(0.016);

    // The camera component produced a real camera, and it is active.
    expect(engine.activeCamera()).toBeInstanceOf(PerspectiveCamera);
    expect(engine.activeCamera()?.fov).toBe(60);

    // Transforms reached the graph.
    expect(engine.graph.objectOf(1)?.position.toArray()).toEqual([0, 1.6, 5]);
    expect(engine.graph.objectOf(3)?.position.toArray()).toEqual([1, 0, 0]);

    // The hierarchy from the scene file is mirrored.
    expect(engine.graph.objectOf(3)?.parent).toBe(engine.graph.objectOf(1));

    // The mesh asset was loaded and swapped in.
    expect(engine.graph.objectOf(3)).toBeInstanceOf(Mesh);
  });

  it('keeps the world as the source of truth after a component change', () => {
    const registry = new ComponentRegistry();
    registerBuiltins(registry);
    const world = loadSceneIntoWorld(sceneFile, registry);
    const engine = new Engine({ world, assets: new AssetCache({ async load() { return new Mesh() as Object3D; } }) });

    engine.step(0.016);
    world.set(1, 'Transform', { position: [7, 7, 7], rotation: [0, 0, 0], scale: [1, 1, 1] });
    engine.step(0.016);

    expect(engine.graph.objectOf(1)?.position.toArray()).toEqual([7, 7, 7]);
  });
});
```

- [ ] **Step 4: Vérifier les gardes de dépendances**

Run:

```bash
node -e "const p=require('./packages/core/package.json');if(p.dependencies&&Object.keys(p.dependencies).length){console.error('core must have no runtime dependencies');process.exit(1)}console.log('ok: core has no deps')"
grep -rn "from 'three'" packages/core/src && echo "FAIL: three imported in core" && exit 1 || echo "ok: core imports no three"
node -e "const p=require('./packages/runtime/package.json');const d=Object.keys(p.dependencies||{}).sort();const want=['@nne/core','three'];if(JSON.stringify(d)!==JSON.stringify(want)){console.error('runtime deps must be exactly',want,'got',d);process.exit(1)}console.log('ok: runtime deps')"
grep -rn "require('fs')\|from 'fs'\|from 'node:fs'\|from 'path'\|from 'node:path'" packages/runtime/src && echo "FAIL: runtime touches the filesystem" && exit 1 || echo "ok: runtime has no fs access"
```

Attendu : quatre `ok`. Le dernier garde la frontière du spec — le disque appartient à `editor-server`, pas à `runtime`.

- [ ] **Step 5: Lancer la suite complète des deux packages**

Run: `pnpm test && pnpm typecheck`
Attendu : les 197 tests de `core` et tous ceux de `runtime` passent ; typecheck sans erreur.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/index.ts packages/runtime/tests/public-api.test.ts packages/runtime/tests/integration.test.ts
git commit -m "feat(runtime): API publique, gardes de dependances et test d'integration"
```

---

## Self-Review

**Couverture du spec (§2, §3, §6 partiel) :**

| Exigence du spec | Tâche |
|---|---|
| `runtime` fait le pont `core` ↔ Three.js | Tasks 3, 5, 6 |
| `RenderSystem` maintient une `Map<EntityId, Object3D>` | Task 5 |
| Le graphe Three se synchronise depuis les composants | Tasks 5, 6 |
| Chargement des `.glb` | Tasks 4, 7 |
| Composant `Camera` → caméra active | Task 8 |
| Composant `Light` → lumières Three | Tasks 3, 8 |
| Boucle de jeu | Task 9 |
| Player autonome, chargeant une scène JSON sans éditeur | Task 10 |
| Preview sans build | Task 10 (le player EST la preview) |
| Chargement et lecture des clips glTF, sans blending | hors périmètre V1, cf. spec §9 |
| Accès lecture sans copie pour les boucles par frame | Task 1 |
| `loadScene` réclamé par la review finale de `core` | Task 10 |

Hors périmètre de ce plan, couverts par les plans 3 et 4 : API disque et pipeline gltf-transform (`editor-server`), viewports d'édition, gizmos et panneaux (`editor`).

**Placeholders :** aucun. Chaque étape porte le code réel et la commande exacte.

**Cohérence des types :** `Vec3`, `Euler`, `TransformData`, `MeshData`, `CameraData`, `LightData` sont définis en Task 2 et utilisés sans variante. `SceneGraph.objectOf`/`attach` (Task 5) sont consommés par les Tasks 6, 7, 8. `AssetCache.get` (Task 4) est consommé par la Task 7. `CameraSystem.active()` (Task 8) est consommé par `Engine.step` et `Engine.resize` (Task 9). `Viewport` est défini en Task 9 et implémenté en Task 10. `System` vient de `@nne/core` et vaut `(world: World, dt: number) => void` partout.

**Point de vigilance pour l'exécution :** les composants sont typés `ComponentData` (`Record<string, unknown>`) côté `core`, d'où les `as unknown as TransformData` dans les systèmes. C'est le prix du découplage — `core` ne peut pas connaître les types de `runtime`. Si une tâche trouve une façon plus propre de faire ce pont sans faire remonter les types dans `core`, elle est bienvenue, mais elle ne doit pas ajouter de dépendance à `core`.
