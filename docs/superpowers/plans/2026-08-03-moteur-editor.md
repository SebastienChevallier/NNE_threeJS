# Moteur ECS — Plan d'implémentation du package `editor`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire `packages/editor` — l'application React qui pilote le moteur : Scene View avec gizmos et sélection, Game View avec Play/Stop, Hierarchy, Inspector générique, panneau Assets avec drag&drop, Save, Build, et hot reload des assets.

**Architecture:** React sert la chrome, jamais le runtime. Les viewports sont du Three.js vanilla piloté par le `runtime`, et React ne les re-render jamais. Toute mutation passe par le `CommandBus` de `core`, ce qui donne l'undo/redo par construction. React ne lit jamais le `World` : un store Zustand expose la sélection et une **vue sérialisée** de l'entité sélectionnée, rafraîchie par le bus après chaque commande.

**Tech Stack:** TypeScript 5.7, React 19, Vite 6, Zustand 5, Three.js 0.185, Vitest 3, pnpm workspaces, Node 22.

## Global Constraints

- **React ne lit jamais le `World`.** Aucun composant n'importe `@nne/core` autre que pour des types. La donnée arrive par le store, en lecture seule et déjà sérialisée. Un test le vérifie.
- **Toute mutation passe par le `CommandBus`.** Aucun appel direct à `world.set`, `world.spawn`, `world.despawn` ou `world.setParent` depuis le package `editor`. Un test le vérifie. C'est ce qui rend l'undo exhaustif et, plus tard, le panneau IA peu coûteux.
- **Aucun re-render à la fréquence de la boucle.** Le store ne change que sur sélection, valeur inspectée, ou événement disque — jamais par frame.
- **L'Inspector n'a aucun code spécifique par composant.** Ses champs sont générés depuis le registre de schémas, pour les dix types de champs et rien d'autre.
- `packages/editor` dépend de `@nne/core`, `@nne/runtime`, `three`, `react`, `react-dom` et `zustand`. Pas de `@nne/editor-server` : le serveur est joint par HTTP, pas par import — l'éditeur tourne dans un navigateur.
- Aucun accès disque : le disque appartient à `editor-server`.
- Tout le code et les commentaires en anglais ; les messages de commit en français.
- TypeScript `strict` avec `noUncheckedIndexedAccess`. Aucun `any` implicite ou explicite dans le code livré.

## Stratégie de test, et pourquoi elle diffère des trois plans précédents

Le spec §8 est explicite : **« UI React — pas de tests unitaires en V1. Un test sera écrit ponctuellement si un bug d'UI se répète. »** Ce plan le respecte, et en tire la contrainte d'architecture qui donne sa forme au package :

> **Aucun test de ce package ne demande de DOM.** Si un module a besoin d'un DOM pour être testé, c'est le signe qu'il contient de la logique qui devrait vivre ailleurs.

Concrètement, tout ce qui est *décision* sort des composants et devient une fonction ou une classe testable en Node : le client d'API, le store, la construction de l'arbre de hiérarchie, le modèle de champs de l'Inspector, le clonage Play/Stop, l'émission de commandes par le gizmo, le calcul du point de drop, le cadrage des vignettes. Ce qui reste dans les composants est du balisage et du câblage — la partie que le spec dispense de test.

Ce n'est pas un contournement du spec : c'est ce qui le rend tenable. Un composant qui ne contient que du JSX et des appels au store n'a effectivement rien à tester unitairement.

Les seules dépendances non testables — `WebGLRenderer`, `OrbitControls`, `TransformControls` — sont derrière des interfaces injectables, comme `GltfSource` et `Viewport` l'ont été dans `runtime` et `AssetOptimizer` dans `editor-server`.

## Ce que ce plan ne fait pas

Hors périmètre V1 par le spec §9, et donc absents de ce plan : multi-sélection, docking redimensionnable (le layout est fixe), prefabs, post-processing, panneau IA. Le layout fixe est un choix du spec, pas une simplification de ce plan.

---

### Task 1: Scaffolding du package `editor`

**Files:**
- Create: `packages/editor/package.json`
- Create: `packages/editor/tsconfig.json`
- Create: `packages/editor/vite.config.ts`
- Create: `packages/editor/vitest.config.ts`
- Create: `packages/editor/index.html`
- Create: `packages/editor/src/types.ts`
- Test: `packages/editor/tests/smoke.test.ts`

**Interfaces:**
- Produces: les types partagés — `EntityView`, `ComponentView`, `HierarchyNode`, `AssetSummary`, `EditorPhase`.

Vite proxie `/api` et `/cache` vers `editor-server` sur le port 5174, ce qui évite toute question de CORS et fait que l'éditeur et le serveur partagent une origine.

- [ ] **Step 1: Créer le manifeste**

`packages/editor/package.json` :

```json
{
  "name": "@nne/editor",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@nne/core": "workspace:*",
    "@nne/runtime": "workspace:*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "three": "^0.185.0",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/three": "^0.185.0",
    "@vitejs/plugin-react": "^4.3.0",
    "vite": "^6.0.0"
  }
}
```

- [ ] **Step 2: Créer les configs**

`packages/editor/tsconfig.json` :

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src", "tests"]
}
```

`packages/editor/vite.config.ts` :

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Same origin as the editor server, so there is no CORS question and the
    // WebSocket needs no absolute URL.
    proxy: {
      '/api': { target: 'http://127.0.0.1:5174', ws: true },
      '/cache': { target: 'http://127.0.0.1:5174' },
    },
  },
});
```

`packages/editor/vitest.config.ts` :

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Deliberately the node environment: no jsdom, no DOM in any test. A module
    // that cannot be tested here holds logic that belongs outside a component.
    environment: 'node',
  },
});
```

`packages/editor/index.html` :

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>NNE Editor</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Écrire les types partagés**

`packages/editor/src/types.ts` :

```ts
import type { ComponentData, ComponentType, EntityId } from '@nne/core';

/**
 * A component as React sees it: plain data, already copied out of the World.
 * React never holds a reference into the World itself.
 */
export interface ComponentView {
  type: ComponentType;
  data: ComponentData;
}

/** The selected entity, serialized. The only entity shape React ever reads. */
export interface EntityView {
  id: EntityId;
  name: string;
  parent: EntityId | null;
  components: ComponentView[];
}

/** One node of the Hierarchy tree, children already resolved. */
export interface HierarchyNode {
  id: EntityId;
  name: string;
  children: HierarchyNode[];
}

/** An asset as the Assets panel shows it. Mirrors the server's AssetEntry. */
export interface AssetSummary {
  path: string;
  category: string;
  /** URL under /cache, ready to hand to the loader. */
  url: string;
  thumbnailUrl: string | null;
  triangles: number;
}

/** Which viewport owns the canvas. Only one is ever active. */
export type EditorPhase = 'edit' | 'play';
```

- [ ] **Step 4: Écrire le test de fumée**

`packages/editor/tests/smoke.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import type { EditorPhase } from '../src/types.js';

describe('editor package', () => {
  it('is wired up', () => {
    const phase: EditorPhase = 'edit';
    expect(phase).toBe('edit');
  });
});
```

- [ ] **Step 5: Installer et vérifier**

Run: `pnpm install && pnpm test && pnpm typecheck`
Attendu : quatre packages détectés, tests verts, typecheck propre.

- [ ] **Step 6: Commit**

```bash
git add packages/editor pnpm-lock.yaml
git commit -m "chore(editor): initialise le package React avec vite et zustand"
```

---

### Task 2: Le client d'API

**Files:**
- Create: `packages/editor/src/api/client.ts`
- Test: `packages/editor/tests/client.test.ts`

**Interfaces:**
- Consumes: `SceneFile` de `@nne/core`, `AssetSummary` (Task 1).
- Produces: `createApiClient(options?: ApiClientOptions): ApiClient`, `interface ApiClient`, `type ProjectEvent`, `assetUrl(path: string): string`.

Le client enveloppe l'API de `editor-server` en fonctions typées. `fetch` est injectable, donc tout se teste sans serveur. Une réponse non-OK devient une erreur qui porte le message du serveur — sans ça, un « invalid scene » détaillé se perdrait en « fetch failed » à l'écran.

`ProjectEvent` est redéclaré ici plutôt qu'importé : `editor` ne dépend pas de `editor-server` — ils communiquent par HTTP, pas par module. C'est la même duplication assumée que `Vec3` dans `editor-server`, et pour la même raison.

- [ ] **Step 1: Écrire les tests en échec**

`packages/editor/tests/client.test.ts` :

```ts
import { describe, expect, it, vi } from 'vitest';
import type { SceneFile } from '@nne/core';
import { assetUrl, createApiClient } from '../src/api/client.js';

const scene: SceneFile = { version: 1, name: 'Scene_01', entities: [] };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createApiClient', () => {
  it('loads the project and its scene list', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({ project: { name: 'demo', version: 1, startScene: null }, scenes: ['A'] }),
    );
    const client = createApiClient({ fetch });

    expect(await client.getProject()).toEqual({
      project: { name: 'demo', version: 1, startScene: null },
      scenes: ['A'],
    });
    expect(fetch).toHaveBeenCalledWith('/api/project', expect.anything());
  });

  it('loads a scene by name', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(scene));
    expect(await createApiClient({ fetch }).getScene('Scene_01')).toEqual(scene);
    expect(fetch).toHaveBeenCalledWith('/api/scenes/Scene_01', expect.anything());
  });

  it('encodes a scene name that needs it', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(scene));
    await createApiClient({ fetch }).getScene('a b');
    expect(fetch).toHaveBeenCalledWith('/api/scenes/a%20b', expect.anything());
  });

  it('saves a scene as JSON', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await createApiClient({ fetch }).putScene('Scene_01', scene);

    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/scenes/Scene_01');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual(scene);
  });

  it('surfaces the server error message, not a generic failure', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({ error: 'invalid scene:\n  entities.0: unknown component "Nope"' }, 400),
    );
    await expect(createApiClient({ fetch }).putScene('Scene_01', scene))
      .rejects.toThrow(/unknown component "Nope"/);
  });

  it('still reports something useful when the error body is not JSON', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
    await expect(createApiClient({ fetch }).getProject()).rejects.toThrow(/500/);
  });

  it('maps assets to the urls the loader needs', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({
      assets: [{
        path: 'props/PRP_Chair_01.glb',
        category: 'PRP',
        cached: 'assets/props/PRP_Chair_01.glb',
        thumbnail: 'thumbnails/props/PRP_Chair_01.png',
        metadata: { bounds: { min: [0, 0, 0], max: [1, 1, 1] }, animations: [], triangles: 42 },
        sourceMtimeMs: 0,
        sourceSize: 0,
      }],
    }));

    expect(await createApiClient({ fetch }).getAssets()).toEqual([{
      path: 'props/PRP_Chair_01.glb',
      category: 'PRP',
      url: '/cache/assets/props/PRP_Chair_01.glb',
      thumbnailUrl: '/cache/thumbnails/props/PRP_Chair_01.png',
      triangles: 42,
    }]);
  });

  it('reports a null thumbnail as null rather than a broken url', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({
      assets: [{
        path: 'p/PRP_A.glb', category: 'PRP', cached: 'assets/p/PRP_A.glb', thumbnail: null,
        metadata: { bounds: { min: [0, 0, 0], max: [0, 0, 0] }, animations: [], triangles: 0 },
        sourceMtimeMs: 0, sourceSize: 0,
      }],
    }));
    expect((await createApiClient({ fetch }).getAssets())[0]?.thumbnailUrl).toBeNull();
  });

  it('posts a build request', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ scenes: ['A'], assets: [] }));
    await createApiClient({ fetch }).build('dist');
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/build');
    expect(JSON.parse(init.body as string)).toEqual({ outDir: 'dist' });
  });

  it('uploads a thumbnail as png bytes', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({}));
    await createApiClient({ fetch }).putThumbnail('props/PRP_A.glb', new Uint8Array([1, 2]));
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/assets/thumbnail?path=props%2FPRP_A.glb');
    expect((init.headers as Record<string, string>)['content-type']).toBe('image/png');
  });
});

describe('assetUrl', () => {
  it('builds a cache url from an asset path', () => {
    expect(assetUrl('props/PRP_Chair_01.glb')).toBe('/cache/assets/props/PRP_Chair_01.glb');
  });

  it('encodes each segment without encoding the separators', () => {
    expect(assetUrl('my props/PRP A.glb')).toBe('/cache/assets/my%20props/PRP%20A.glb');
  });
});
```

- [ ] **Step 2: Implémenter**

`packages/editor/src/api/client.ts` :

```ts
import type { SceneFile } from '@nne/core';
import type { AssetSummary } from '../types.js';

/** Mirrors editor-server's ProjectFile, over the wire. */
export interface ProjectSummary {
  name: string;
  version: number;
  startScene: string | null;
}

/**
 * The disk events the server pushes.
 *
 * Redeclared rather than imported: `editor` does not depend on `editor-server`,
 * it talks to it over HTTP. The wire format is the contract, not a shared type.
 */
export type ProjectEvent =
  | { type: 'asset-changed'; path: string }
  | { type: 'asset-removed'; path: string }
  | { type: 'asset-failed'; path: string; message: string }
  | { type: 'scene-changed'; name: string };

export interface BuildSummary {
  scenes: string[];
  assets: string[];
}

export interface ApiClient {
  getProject(): Promise<{ project: ProjectSummary; scenes: string[] }>;
  getScene(name: string): Promise<SceneFile>;
  putScene(name: string, scene: SceneFile): Promise<void>;
  getAssets(): Promise<AssetSummary[]>;
  scanAssets(): Promise<AssetSummary[]>;
  putThumbnail(path: string, png: Uint8Array): Promise<void>;
  build(outDir: string): Promise<BuildSummary>;
}

export interface ApiClientOptions {
  /** Injectable so every call is testable without a server. */
  fetch?: typeof globalThis.fetch;
}

/** Encodes each segment but leaves the separators alone, so paths stay readable. */
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function assetUrl(path: string): string {
  return `/cache/assets/${encodePath(path)}`;
}

/** Shape of one asset in the server's /api/assets payload. */
interface WireAsset {
  path: string;
  category: string;
  cached: string;
  thumbnail: string | null;
  metadata: { triangles: number };
}

function toSummary(asset: WireAsset): AssetSummary {
  return {
    path: asset.path,
    category: asset.category,
    url: `/cache/${encodePath(asset.cached)}`,
    thumbnailUrl: asset.thumbnail === null ? null : `/cache/${encodePath(asset.thumbnail)}`,
    triangles: asset.metadata.triangles,
  };
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  /**
   * One request, with the server's own error message preserved.
   * Without this, a detailed "invalid scene: unknown component" collapses into
   * a bare "fetch failed" by the time it reaches the screen.
   */
  async function request(url: string, init: RequestInit = {}): Promise<Response> {
    const response = await doFetch(url, init);
    if (response.ok) return response;

    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === 'string') detail = body.error;
    } catch {
      // Body was not JSON; the status line is all we have, and it is enough.
    }
    throw new Error(`${url}: ${detail}`);
  }

  const json = { 'content-type': 'application/json' };

  return {
    async getProject() {
      const response = await request('/api/project', { method: 'GET' });
      return (await response.json()) as { project: ProjectSummary; scenes: string[] };
    },
    async getScene(name) {
      const response = await request(`/api/scenes/${encodeURIComponent(name)}`, { method: 'GET' });
      return (await response.json()) as SceneFile;
    },
    async putScene(name, scene) {
      await request(`/api/scenes/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: json,
        body: JSON.stringify(scene),
      });
    },
    async getAssets() {
      const response = await request('/api/assets', { method: 'GET' });
      const body = (await response.json()) as { assets: WireAsset[] };
      return body.assets.map(toSummary);
    },
    async scanAssets() {
      const response = await request('/api/assets/scan', { method: 'POST' });
      const body = (await response.json()) as { assets: WireAsset[] };
      return body.assets.map(toSummary);
    },
    async putThumbnail(path, png) {
      await request(`/api/assets/thumbnail?path=${encodeURIComponent(path)}`, {
        method: 'PUT',
        headers: { 'content-type': 'image/png' },
        body: png,
      });
    },
    async build(outDir) {
      const response = await request('/api/build', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ outDir }),
      });
      return (await response.json()) as BuildSummary;
    },
  };
}
```

- [ ] **Step 3: Vérifier**

Run: `pnpm --filter @nne/editor test && pnpm --filter @nne/editor typecheck`

- [ ] **Step 4: Commit**

```bash
git add packages/editor/src/api/client.ts packages/editor/tests/client.test.ts
git commit -m "feat(editor): client typé de l'API du serveur d'edition"
```

---

### Task 3: La session d'édition

**Files:**
- Create: `packages/editor/src/session.ts`
- Test: `packages/editor/tests/session.test.ts`

**Interfaces:**
- Consumes: `World`, `CommandBus`, `ComponentRegistry`, `Command`, `deserializeScene`, `serializeScene` de `@nne/core`.
- Produces: `class EditorSession` avec `world`, `bus`, `registry`, `dispatch`, `undo`, `redo`, `canUndo`, `canRedo`, `isDirty`, `markSaved`, `loadScene`, `toSceneFile`, `subscribe`, `spawnEntity`, `viewOf`.

La session est le seul objet du package autorisé à toucher le `World`. Tout le reste — React, gizmos, panneaux — passe par elle, et elle ne mute qu'à travers le `CommandBus`. `spawnEntity` est la seule exception apparente : elle réserve un id via `world.allocateId()` avant d'émettre la commande, parce qu'une commande `SpawnEntity` porte son id (c'est ce qui rend son inverse calculable). Réserver un id ne crée rien.

`viewOf` produit la vue sérialisée que React consomme : des copies, jamais des références dans le `World`.

- [ ] **Step 1: Écrire les tests en échec**

`packages/editor/tests/session.test.ts` :

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESH, TRANSFORM, type SceneFile } from '@nne/core';
import { EditorSession } from '../src/session.js';

const scene: SceneFile = {
  version: 1,
  name: 'Scene_01',
  entities: [
    {
      id: 1,
      name: 'Root',
      components: {
        Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      },
    },
    {
      id: 2,
      name: 'Chair',
      parent: 1,
      components: {
        Transform: { position: [1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Mesh: { asset: 'props/PRP_Chair_01.glb', castShadow: true },
      },
    },
  ],
};

describe('EditorSession', () => {
  let session: EditorSession;

  beforeEach(() => {
    session = new EditorSession();
    session.loadScene(scene);
  });

  describe('loadScene', () => {
    it('rebuilds the world from the file', () => {
      expect(session.world.entities()).toEqual([1, 2]);
      expect(session.world.getName(2)).toBe('Chair');
      expect(session.world.getParent(2)).toBe(1);
    });

    it('starts clean, with nothing to undo', () => {
      expect(session.isDirty()).toBe(false);
      expect(session.canUndo()).toBe(false);
      expect(session.canRedo()).toBe(false);
    });

    it('clears the history of the previous scene', () => {
      session.dispatch({ kind: 'RenameEntity', entity: 1, name: 'X' });
      session.loadScene(scene);
      // Undoing here would rename an entity in a scene that never saw the edit.
      expect(session.canUndo()).toBe(false);
    });
  });

  describe('dispatch', () => {
    it('applies the command to the world', () => {
      session.dispatch({ kind: 'RenameEntity', entity: 1, name: 'Renamed' });
      expect(session.world.getName(1)).toBe('Renamed');
    });

    it('marks the session dirty', () => {
      session.dispatch({ kind: 'RenameEntity', entity: 1, name: 'Renamed' });
      expect(session.isDirty()).toBe(true);
    });

    it('notifies subscribers', () => {
      const listener = vi.fn();
      session.subscribe(listener);
      session.dispatch({ kind: 'RenameEntity', entity: 1, name: 'Renamed' });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('stops notifying after unsubscribe', () => {
      const listener = vi.fn();
      session.subscribe(listener)();
      session.dispatch({ kind: 'RenameEntity', entity: 1, name: 'Renamed' });
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('undo and redo', () => {
    it('restores the previous value', () => {
      session.dispatch({ kind: 'RenameEntity', entity: 1, name: 'Renamed' });
      session.undo();
      expect(session.world.getName(1)).toBe('Root');
      session.redo();
      expect(session.world.getName(1)).toBe('Renamed');
    });

    it('reports what is available', () => {
      expect(session.canUndo()).toBe(false);
      session.dispatch({ kind: 'RenameEntity', entity: 1, name: 'Renamed' });
      expect(session.canUndo()).toBe(true);
      expect(session.canRedo()).toBe(false);
      session.undo();
      expect(session.canRedo()).toBe(true);
    });

    it('notifies subscribers, so the panels refresh', () => {
      session.dispatch({ kind: 'RenameEntity', entity: 1, name: 'Renamed' });
      const listener = vi.fn();
      session.subscribe(listener);
      session.undo();
      expect(listener).toHaveBeenCalled();
    });

    it('undoing back to the saved state clears the dirty flag', () => {
      session.dispatch({ kind: 'RenameEntity', entity: 1, name: 'Renamed' });
      expect(session.isDirty()).toBe(true);
      session.undo();
      expect(session.isDirty()).toBe(false);
    });

    it('redoing past the saved state sets it again', () => {
      session.dispatch({ kind: 'RenameEntity', entity: 1, name: 'Renamed' });
      session.undo();
      session.redo();
      expect(session.isDirty()).toBe(true);
    });
  });

  describe('markSaved', () => {
    it('clears the dirty flag at the current point in history', () => {
      session.dispatch({ kind: 'RenameEntity', entity: 1, name: 'Renamed' });
      session.markSaved();
      expect(session.isDirty()).toBe(false);
    });

    it('undoing past the save point makes it dirty again', () => {
      session.dispatch({ kind: 'RenameEntity', entity: 1, name: 'A' });
      session.markSaved();
      session.undo();
      expect(session.isDirty()).toBe(true);
    });
  });

  describe('spawnEntity', () => {
    it('creates an entity through a command, so it can be undone', () => {
      const id = session.spawnEntity('New', null);
      expect(session.world.alive(id)).toBe(true);
      session.undo();
      expect(session.world.alive(id)).toBe(false);
    });

    it('never reuses an id', () => {
      const first = session.spawnEntity('A', null);
      const second = session.spawnEntity('B', null);
      expect(second).not.toBe(first);
    });

    it('parents the new entity when asked', () => {
      const id = session.spawnEntity('Child', 1);
      expect(session.world.getParent(id)).toBe(1);
    });
  });

  describe('viewOf', () => {
    it('serializes an entity for React', () => {
      expect(session.viewOf(2)).toEqual({
        id: 2,
        name: 'Chair',
        parent: 1,
        components: [
          { type: TRANSFORM, data: { position: [1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
          { type: MESH, data: { asset: 'props/PRP_Chair_01.glb', castShadow: true } },
        ],
      });
    });

    it('returns copies, so React cannot mutate the world by accident', () => {
      const view = session.viewOf(2);
      (view?.components[0]?.data['position'] as number[])[0] = 99;
      expect(session.world.peek(2, TRANSFORM)).toMatchObject({ position: [1, 0, 0] });
    });

    it('returns undefined for a dead entity', () => {
      expect(session.viewOf(99)).toBeUndefined();
    });

    it('lists components in registration order, not insertion order', () => {
      // The Inspector's card order must not depend on which component the user
      // happened to add first.
      const id = session.spawnEntity('E', null);
      session.dispatch({ kind: 'AddComponent', entity: id, type: MESH, data: { asset: null, castShadow: true } });
      session.dispatch({
        kind: 'AddComponent',
        entity: id,
        type: TRANSFORM,
        data: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      });
      expect(session.viewOf(id)?.components.map((c) => c.type)).toEqual([TRANSFORM, MESH]);
    });
  });

  describe('toSceneFile', () => {
    it('round-trips the loaded scene', () => {
      expect(session.toSceneFile('Scene_01')).toEqual(scene);
    });
  });
});
```

- [ ] **Step 2: Implémenter**

`packages/editor/src/session.ts` :

```ts
import {
  CommandBus, ComponentRegistry, World,
  deserializeScene, registerBuiltins, serializeScene,
  type Command, type EntityId, type SceneFile,
} from '@nne/core';
import type { EntityView } from './types.js';

/**
 * Owns the World and the CommandBus, and is the only thing in this package
 * allowed to touch either.
 *
 * Everything else — React, gizmos, panels — goes through `dispatch`, which is
 * what makes undo exhaustive rather than best-effort.
 */
export class EditorSession {
  readonly registry = new ComponentRegistry();
  world = new World();
  private bus = new CommandBus(this.world);
  private listeners = new Set<() => void>();
  /** How many undo steps sit between the saved state and now. */
  private depthAtSave = 0;
  private depth = 0;

  constructor() {
    registerBuiltins(this.registry);
  }

  loadScene(file: SceneFile): void {
    this.world = deserializeScene(file);
    // A fresh bus, because the old history describes a world that is gone:
    // undoing into it would edit entities the new scene never had.
    this.bus = new CommandBus(this.world);
    this.depth = 0;
    this.depthAtSave = 0;
    this.notify();
  }

  toSceneFile(name: string): SceneFile {
    return serializeScene(this.world, name);
  }

  dispatch(command: Command): void {
    this.bus.dispatch(command);
    this.depth++;
    this.notify();
  }

  undo(): boolean {
    if (!this.bus.undo()) return false;
    this.depth--;
    this.notify();
    return true;
  }

  redo(): boolean {
    if (!this.bus.redo()) return false;
    this.depth++;
    this.notify();
    return true;
  }

  canUndo(): boolean {
    return this.bus.canUndo();
  }

  canRedo(): boolean {
    return this.bus.canRedo();
  }

  /**
   * Dirty is a position in history, not a boolean that edits set.
   * Undoing back to the saved point makes the document clean again, which is
   * what a user expects and what a plain flag gets wrong.
   */
  isDirty(): boolean {
    return this.depth !== this.depthAtSave;
  }

  markSaved(): void {
    this.depthAtSave = this.depth;
    this.notify();
  }

  /**
   * Reserves an id, then spawns through a command.
   * A `SpawnEntity` command carries its id — that is what makes its inverse
   * computable — so the id has to exist before the command does. Reserving one
   * creates nothing.
   */
  spawnEntity(name: string, parent: EntityId | null): EntityId {
    const entity = this.world.allocateId();
    this.dispatch({ kind: 'SpawnEntity', entity, name, parent });
    return entity;
  }

  /** The serialized shape React reads. Copies throughout. */
  viewOf(entity: EntityId): EntityView | undefined {
    if (!this.world.alive(entity)) return undefined;
    const components = this.registry.list()
      .filter((type) => this.world.has(entity, type))
      // `world.get` copies defensively, which is exactly what we want here:
      // React must not hold a reference that mutating the world would change
      // under it.
      .map((type) => ({ type, data: this.world.get(entity, type) as Record<string, unknown> }));

    return {
      id: entity,
      name: this.world.getName(entity),
      parent: this.world.getParent(entity),
      components,
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
```

> **Note d'exécution :** `CommandBus.canUndo()` / `canRedo()`, `World.allocateId()`, `World.getName()` / `getParent()` / `subtree()` et `ComponentRegistry.list()` / `get()` ont tous été vérifiés présents dans `core` au moment de l'écriture de ce plan. **Aucune modification de `core` n'est nécessaire pour l'exécuter.**

- [ ] **Step 3: Vérifier**

Run: `pnpm --filter @nne/editor test`

- [ ] **Step 4: Vérifier le drapeau « modifié » par mutation**

1. Remplacer `isDirty()` par un booléen posé à `true` dans `dispatch` → le test « undoing back to the saved state clears the dirty flag » doit échouer.
2. Retirer la recréation du `CommandBus` dans `loadScene` → le test « clears the history of the previous scene » doit échouer.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/session.ts packages/editor/tests/session.test.ts
git commit -m "feat(editor): session d'edition, seul point d'acces au World"
```

---

### Task 4: L'arbre de hiérarchie

**Files:**
- Create: `packages/editor/src/model/hierarchy.ts`
- Test: `packages/editor/tests/hierarchy.test.ts`

**Interfaces:**
- Consumes: `World` de `@nne/core`, `HierarchyNode` (Task 1).
- Produces: `buildHierarchy(world: World): HierarchyNode[]`, `canReparent(world: World, entity: EntityId, parent: EntityId | null): boolean`.

`canReparent` est ce qui empêche le drag&drop de produire une commande que le `World` refuserait — déposer un parent sur son propre enfant. Sans elle, l'éditeur émettrait une commande qui lève, et le message d'erreur remonterait en pleine session d'édition. Le calcul est le même que la garde anti-cycle de `core`, mais posé en question plutôt qu'en exception.

- [ ] **Step 1: Écrire les tests en échec**

`packages/editor/tests/hierarchy.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { World } from '@nne/core';
import { buildHierarchy, canReparent } from '../src/model/hierarchy.js';

/** a -> b -> c, plus a standalone d. */
function tree(): World {
  const world = new World();
  const a = world.spawn('A');
  const b = world.spawn('B', a);
  world.spawn('C', b);
  world.spawn('D');
  return world;
}

describe('buildHierarchy', () => {
  it('nests children under their parent', () => {
    expect(buildHierarchy(tree())).toEqual([
      { id: 1, name: 'A', children: [{ id: 2, name: 'B', children: [{ id: 3, name: 'C', children: [] }] }] },
      { id: 4, name: 'D', children: [] },
    ]);
  });

  it('returns an empty list for an empty world', () => {
    expect(buildHierarchy(new World())).toEqual([]);
  });

  it('orders siblings by id, so the tree does not jump around', () => {
    const world = new World();
    const parent = world.spawn('P');
    world.spawn('Z', parent);
    world.spawn('A', parent);
    expect(buildHierarchy(world)[0]?.children.map((c) => c.name)).toEqual(['Z', 'A']);
  });

  it('handles a deep chain without losing anyone', () => {
    const world = new World();
    let parent: number | null = null;
    for (let i = 0; i < 50; i++) parent = world.spawn(`E${i}`, parent);

    let node = buildHierarchy(world)[0];
    let depth = 1;
    while (node?.children[0]) { node = node.children[0]; depth++; }
    expect(depth).toBe(50);
  });
});

describe('canReparent', () => {
  it('allows an unrelated entity', () => {
    expect(canReparent(tree(), 4, 1)).toBe(true);
  });

  it('allows detaching to the root', () => {
    expect(canReparent(tree(), 3, null)).toBe(true);
  });

  it('refuses parenting an entity to itself', () => {
    expect(canReparent(tree(), 1, 1)).toBe(false);
  });

  it('refuses parenting an entity to its own child', () => {
    expect(canReparent(tree(), 1, 2)).toBe(false);
  });

  it('refuses parenting an entity to a deeper descendant', () => {
    expect(canReparent(tree(), 1, 3)).toBe(false);
  });

  it('refuses a dead entity on either side', () => {
    const world = tree();
    expect(canReparent(world, 99, 1)).toBe(false);
    expect(canReparent(world, 1, 99)).toBe(false);
  });

  it('allows a no-op reparent to the current parent', () => {
    expect(canReparent(tree(), 2, 1)).toBe(true);
  });
});
```

- [ ] **Step 2: Implémenter**

`packages/editor/src/model/hierarchy.ts` :

```ts
import type { EntityId, World } from '@nne/core';
import type { HierarchyNode } from '../types.js';

/**
 * Builds the Hierarchy tree from the `parent` field of every entity.
 * One pass to create the nodes, one to link them, so a child whose parent comes
 * later in the list still lands in the right place.
 */
export function buildHierarchy(world: World): HierarchyNode[] {
  const nodes = new Map<EntityId, HierarchyNode>();
  for (const id of world.entities()) {
    nodes.set(id, { id, name: world.getName(id), children: [] });
  }

  const roots: HierarchyNode[] = [];
  for (const id of world.entities()) {
    const node = nodes.get(id) as HierarchyNode;
    const parent = world.getParent(id);
    const parentNode = parent === null ? undefined : nodes.get(parent);
    if (parentNode) parentNode.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/**
 * Whether a drag&drop reparent would be accepted by the World.
 *
 * Asks the question the World answers with an exception. Without this the
 * Hierarchy would happily emit a command that throws mid-session, and a cycle
 * guard firing as an unhandled error is not a user interface.
 */
export function canReparent(
  world: World,
  entity: EntityId,
  parent: EntityId | null,
): boolean {
  if (!world.alive(entity)) return false;
  if (parent === null) return true;
  if (!world.alive(parent)) return false;
  // An entity cannot become a child of itself or of anything below it.
  return !world.subtree(entity).includes(parent);
}
```

- [ ] **Step 3: Vérifier**

Run: `pnpm --filter @nne/editor test`

- [ ] **Step 4: Commit**

```bash
git add packages/editor/src/model/hierarchy.ts packages/editor/tests/hierarchy.test.ts
git commit -m "feat(editor): arbre de hierarchie et validation du reparentage"
```

---

### Task 5: Le modèle de champs de l'Inspector

**Files:**
- Create: `packages/editor/src/model/fields.ts`
- Test: `packages/editor/tests/fields.test.ts`

**Interfaces:**
- Consumes: `ComponentRegistry`, `FieldSpec`, `ComponentData` de `@nne/core`.
- Produces: `describeComponent(registry, type, data): FieldView[]`, `interface FieldView`, `coerceFieldValue(spec, raw): unknown`, `addableComponents(registry, present): ComponentType[]`.

C'est la pièce qui tient la promesse « aucun code spécifique par composant » du spec. L'Inspector reçoit une liste de `FieldView` et rend un contrôle par type de champ — dix types, dix contrôles, quel que soit le nombre de composants.

`coerceFieldValue` traite l'entrée de l'UI comme non fiable : un `<input type="number">` vide donne `''`, pas `0`, et écrire `''` dans un champ `number` produirait une scène qui ne passe plus la validation du serveur. Le refus se fait ici, pas trois couches plus loin.

- [ ] **Step 1: Écrire les tests en échec**

`packages/editor/tests/fields.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { CAMERA, ComponentRegistry, LIGHT, MESH, TRANSFORM, registerBuiltins } from '@nne/core';
import { addableComponents, coerceFieldValue, describeComponent } from '../src/model/fields.js';

function registry(): ComponentRegistry {
  const r = new ComponentRegistry();
  registerBuiltins(r);
  return r;
}

describe('describeComponent', () => {
  it('describes every field of a component, in schema order', () => {
    const fields = describeComponent(registry(), TRANSFORM, {
      position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1],
    });
    expect(fields.map((f) => f.name)).toEqual(['position', 'rotation', 'scale']);
    expect(fields[0]).toMatchObject({ name: 'position', type: 'vec3', value: [1, 2, 3] });
  });

  it('carries the enum options through, so the control can render them', () => {
    const fields = describeComponent(registry(), LIGHT, {
      type: 'point', color: '#ffffff', intensity: 1,
    });
    expect(fields[0]).toMatchObject({ type: 'enum', options: ['directional', 'point', 'ambient', 'spot'] });
  });

  it('carries the asset filter through', () => {
    const fields = describeComponent(registry(), MESH, { asset: null, castShadow: true });
    expect(fields[0]).toMatchObject({ type: 'asset', accept: '.glb' });
  });

  it('falls back to the schema default when the data is missing a field', () => {
    // A scene written before a field was added to the schema still opens.
    const fields = describeComponent(registry(), CAMERA, { fov: 50 });
    expect(fields.find((f) => f.name === 'near')?.value).toBe(0.1);
  });

  it('returns an empty list for an unknown component', () => {
    expect(describeComponent(registry(), 'Nope', {})).toEqual([]);
  });
});

describe('coerceFieldValue', () => {
  const spec = (type: string, extra: object = {}) =>
    ({ type, default: null, ...extra }) as Parameters<typeof coerceFieldValue>[0];

  it('parses a number from a text input', () => {
    expect(coerceFieldValue(spec('number'), '1.5')).toBe(1.5);
  });

  it('rejects an empty number input rather than writing zero', () => {
    // Typing over a value momentarily empties the input; writing 0 there would
    // silently destroy the value the user is in the middle of replacing.
    expect(coerceFieldValue(spec('number'), '')).toBeUndefined();
  });

  it('rejects a number input that is not a number', () => {
    expect(coerceFieldValue(spec('number'), 'abc')).toBeUndefined();
  });

  it('truncates an int', () => {
    expect(coerceFieldValue(spec('int'), '3.7')).toBe(3);
  });

  it('passes a bool through', () => {
    expect(coerceFieldValue(spec('bool'), true)).toBe(true);
  });

  it('passes a string through, empty included', () => {
    expect(coerceFieldValue(spec('string'), '')).toBe('');
  });

  it('builds a vec3 from three numbers', () => {
    expect(coerceFieldValue(spec('vec3'), ['1', '2', '3'])).toEqual([1, 2, 3]);
  });

  it('rejects a vec3 with a non-numeric component', () => {
    expect(coerceFieldValue(spec('vec3'), ['1', '', '3'])).toBeUndefined();
  });

  it('rejects a vec3 of the wrong length', () => {
    expect(coerceFieldValue(spec('vec3'), ['1', '2'])).toBeUndefined();
  });

  it('accepts an enum value that is in the options', () => {
    expect(coerceFieldValue(spec('enum', { options: ['a', 'b'] }), 'b')).toBe('b');
  });

  it('rejects an enum value that is not', () => {
    expect(coerceFieldValue(spec('enum', { options: ['a', 'b'] }), 'c')).toBeUndefined();
  });

  it('accepts a hex colour', () => {
    expect(coerceFieldValue(spec('color'), '#ff0000')).toBe('#ff0000');
  });

  it('rejects a malformed colour', () => {
    expect(coerceFieldValue(spec('color'), 'red')).toBeUndefined();
  });

  it('accepts null for an asset, which means "no asset"', () => {
    expect(coerceFieldValue(spec('asset'), null)).toBeNull();
  });

  it('accepts an entity id, and null for none', () => {
    expect(coerceFieldValue(spec('entity'), '4')).toBe(4);
    expect(coerceFieldValue(spec('entity'), null)).toBeNull();
  });
});

describe('addableComponents', () => {
  it('lists the registered components the entity does not have', () => {
    expect(addableComponents(registry(), [TRANSFORM])).toEqual([MESH, CAMERA, LIGHT]);
  });

  it('returns an empty list when the entity has them all', () => {
    expect(addableComponents(registry(), [TRANSFORM, MESH, CAMERA, LIGHT])).toEqual([]);
  });
});
```

- [ ] **Step 2: Implémenter**

`packages/editor/src/model/fields.ts` :

```ts
import type {
  ComponentData, ComponentRegistry, ComponentType, FieldSpec, FieldType,
} from '@nne/core';

/** One row of the Inspector: everything a control needs, and nothing more. */
export interface FieldView {
  name: string;
  type: FieldType;
  value: unknown;
  /** For `enum` fields. */
  options?: readonly string[];
  /** For `asset` fields. */
  accept?: string;
}

/**
 * Turns a component's schema and data into the rows the Inspector renders.
 *
 * This is what keeps the Inspector free of per-component code: ten field types
 * mean ten controls, however many components the registry grows to hold.
 */
export function describeComponent(
  registry: ComponentRegistry,
  type: ComponentType,
  data: ComponentData,
): FieldView[] {
  const schema = registry.get(type);
  if (!schema) return [];

  return Object.entries(schema).map(([name, spec]) => {
    const view: FieldView = {
      name,
      type: spec.type,
      // A scene written before a field existed simply shows the default rather
      // than an empty control.
      value: Object.hasOwn(data, name) ? data[name] : spec.default,
    };
    if (spec.options) view.options = spec.options;
    if (spec.accept) view.accept = spec.accept;
    return view;
  });
}

/** True for the `#rrggbb` form the colour field stores. */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function toFiniteNumber(raw: unknown): number | undefined {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Validates a value coming out of a control, returning `undefined` to mean
 * "not a usable value — do not write it".
 *
 * UI input is untrusted in the same way disk input is. An empty number input
 * reads as `''`, and coercing that to `0` would silently destroy the value the
 * user is halfway through replacing. Refusing here keeps the invalid value from
 * ever reaching a command, let alone the scene file.
 */
export function coerceFieldValue(spec: FieldSpec, raw: unknown): unknown {
  switch (spec.type) {
    case 'number':
      return toFiniteNumber(raw);
    case 'int': {
      const value = toFiniteNumber(raw);
      return value === undefined ? undefined : Math.trunc(value);
    }
    case 'bool':
      return typeof raw === 'boolean' ? raw : undefined;
    case 'string':
      return typeof raw === 'string' ? raw : undefined;
    case 'vec3':
    case 'euler': {
      if (!Array.isArray(raw) || raw.length !== 3) return undefined;
      const parts = raw.map(toFiniteNumber);
      return parts.every((p) => p !== undefined) ? parts : undefined;
    }
    case 'color':
      return typeof raw === 'string' && HEX_COLOR.test(raw) ? raw : undefined;
    case 'enum':
      return typeof raw === 'string' && spec.options?.includes(raw) ? raw : undefined;
    case 'asset':
      if (raw === null) return null;
      return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
    case 'entity': {
      if (raw === null) return null;
      const value = toFiniteNumber(raw);
      return value === undefined ? undefined : Math.trunc(value);
    }
  }
}

/** The components "Add Component" should offer for an entity. */
export function addableComponents(
  registry: ComponentRegistry,
  present: readonly ComponentType[],
): ComponentType[] {
  return registry.list().filter((type) => !present.includes(type));
}
```

- [ ] **Step 3: Vérifier**

Run: `pnpm --filter @nne/editor test`

- [ ] **Step 4: Commit**

```bash
git add packages/editor/src/model/fields.ts packages/editor/tests/fields.test.ts
git commit -m "feat(editor): modele de champs generique de l'Inspector"
```

---

### Task 6: Le store Zustand

**Files:**
- Create: `packages/editor/src/store.ts`
- Test: `packages/editor/tests/store.test.ts`

**Interfaces:**
- Consumes: `EditorSession` (Task 3), `buildHierarchy` (Task 4), `EntityView`/`HierarchyNode`/`AssetSummary`/`EditorPhase` (Task 1).
- Produces: `createEditorStore(session: EditorSession): EditorStore`, avec `selection`, `select`, `entity`, `hierarchy`, `assets`, `phase`, `dirty`, `sceneName`, `refresh`, `setAssets`, `setPhase`.

Le store est la frontière : React lit ici et nulle part ailleurs. Il s'abonne à la session et recalcule sa vue après chaque commande — donc une fois par action utilisateur, jamais par frame.

Le point qui compte pour les performances : le gizmo n'émet une commande qu'au relâchement (Task 8), donc un drag de gizmo produit **un** recalcul, pas soixante par seconde.

- [ ] **Step 1: Écrire les tests en échec**

`packages/editor/tests/store.test.ts` : couvre — la sélection d'une entité peuple `entity` ; sélectionner `null` la vide ; une commande rafraîchit `entity` et `hierarchy` ; supprimer l'entité sélectionnée vide la sélection au lieu de laisser un ID mort ; le drapeau `dirty` suit la session ; `setAssets` remplace la liste ; `setPhase` bascule ; se désabonner arrête les rafraîchissements ; le store ne recalcule pas quand rien n'a changé.

Code complet du test à écrire selon ces cas, sur le modèle des tâches précédentes.

- [ ] **Step 2: Implémenter**

`packages/editor/src/store.ts` : `createStore` de Zustand (le store vanilla, pas le hook React, pour rester testable en Node ; le hook s'obtient avec `useStore` côté composant). L'abonnement à la session est établi à la création et recalcule `entity`, `hierarchy` et `dirty`.

Point à traiter : après une commande `DespawnEntity` sur l'entité sélectionnée, `session.viewOf` renvoie `undefined` — le store doit alors remettre `selection` à `null`, sinon la Hierarchy garde une ligne surlignée qui n'existe plus.

- [ ] **Step 3: Vérifier**

Run: `pnpm --filter @nne/editor test`

- [ ] **Step 4: Commit**

```bash
git add packages/editor/src/store.ts packages/editor/tests/store.test.ts
git commit -m "feat(editor): store zustand, frontiere de lecture de React"
```

---

### Task 7: Le Scene View — moteur headless et caméra d'édition

**Files:**
- Create: `packages/editor/src/viewport/scene-view.ts`
- Test: `packages/editor/tests/scene-view.test.ts`

**Interfaces:**
- Consumes: `Engine`, `AssetCache`, `createGltfSource` de `@nne/runtime`, `EditorSession` (Task 3).
- Produces: `createSceneView(options: SceneViewOptions): SceneView`, `interface SceneView { step(dt): void; resize(w, h): void; camera: PerspectiveCamera; dispose(): void }`.

**La décision d'architecture de ce plan :** le Scene View pilote un `Engine` **sans viewport** et rend lui-même.

Un `Engine` construit sans `viewport` synchronise le graphe et exécute les systèmes, mais ne rend rien — c'est exactement ce qu'il faut : le Scene View veut la synchronisation `World → graphe Three` du runtime, mais rendue à travers **sa** caméra d'édition, pas à travers la caméra active de la scène. Il appelle donc `engine.step(dt)`, puis rend `engine.scene` avec son propre renderer et sa propre caméra.

Conséquence : **ce plan ne modifie pas `runtime`.** La couture existait déjà, sans avoir été prévue pour ça.

Les objets d'édition — grille, helpers, gizmo — sont ajoutés à `engine.scene` directement, jamais sous la racine `entities` que `SceneGraph.sync` gère. Le graphe ne les voit pas et ne les détruit pas.

- [ ] **Step 1: Écrire les tests en échec**

Les tests portent sur ce qui est vérifiable sans GPU : que `step` synchronise le graphe depuis le World ; que la couche d'édition vit hors de la racine `entities` et survit à un `sync` ; que `resize` met à jour l'aspect de la caméra d'édition et pas celui de la caméra de scène ; que `dispose` relâche le renderer une seule fois. Le renderer est injecté (`createRenderer`), comme `createViewport` dans `createPlayer`.

- [ ] **Step 2: Implémenter**

- [ ] **Step 3: Vérifier et commit**

```bash
git commit -m "feat(editor): Scene View sur un moteur headless et une camera d'edition"
```

---

### Task 8: Gizmos et sélection

**Files:**
- Create: `packages/editor/src/viewport/selection.ts`
- Create: `packages/editor/src/viewport/gizmo.ts`
- Test: `packages/editor/tests/selection.test.ts`
- Test: `packages/editor/tests/gizmo.test.ts`

**Interfaces:**
- Produces: `pickEntity(raycaster, root): EntityId | undefined`, `createGizmoBridge(options): GizmoBridge`.

Deux exigences fortes du spec, et ce sont elles qui se testent :

1. **La sélection par raycast remonte à l'entité**, pas au mesh touché. Un `.glb` chargé est un sous-arbre ; le raycast tape une feuille, et il faut remonter les parents jusqu'à trouver un `userData.entity`. Sans ça, cliquer sur une chaise sélectionne son accoudoir.

2. **Le gizmo n'écrit pas dans le `Transform` pendant le drag ; il émet un unique `SetComponent` au relâchement.** C'est ce qui fait qu'un déplacement est *un* pas d'undo et non soixante. Testable sans DOM : le pont s'abonne à un objet façon `TransformControls` (`dragging-changed` / `objectChange`), qu'un faux émetteur remplace dans le test.

Cas à couvrir : aucune commande pendant le drag ; exactement une au relâchement ; aucune si l'objet n'a pas bougé ; la commande porte la valeur finale, pas une intermédiaire ; un drag annulé (Échap) n'émet rien.

- [ ] **Steps 1-4** : tests, implémentation, vérification, commit.

```bash
git commit -m "feat(editor): selection par raycast et gizmo a une seule commande"
```

---

### Task 9: Le Game View — Play et Stop

**Files:**
- Create: `packages/editor/src/viewport/game-view.ts`
- Test: `packages/editor/tests/game-view.test.ts`

**Interfaces:**
- Produces: `createGameView(options): GameView`, `cloneWorld(world: World): World`.

Le spec : « Play clone l'état du monde et joue sur le clone ; Stop jette le clone. Jouer ne modifie jamais la scène éditée. »

`cloneWorld` se fait par `serializeScene` puis `deserializeScene` — un aller-retour déjà prouvé stable octet pour octet par les tests de `core`. Écrire un clonage à la main dupliquerait cette logique et la ferait diverger.

Ce qui se teste, et qui est la vraie exigence : après un Play qui mute lourdement le monde joué, le monde édité est **inchangé**, entité par entité et composant par composant. Plus : les ids sont préservés par le clone (sinon la sélection ne survivrait pas à un Stop), et un second Play repart de l'état édité, pas de l'état laissé par le premier.

- [ ] **Steps 1-4** : tests, implémentation, vérification, commit.

```bash
git commit -m "feat(editor): Game View avec Play/Stop sur un clone du monde"
```

---

### Task 10: Le panneau Assets et le drop dans la scène

**Files:**
- Create: `packages/editor/src/model/drop.ts`
- Test: `packages/editor/tests/drop.test.ts`

**Interfaces:**
- Produces: `groundDropPoint(raycaster, fallbackDistance): Vec3`, `dropAssetCommands(session, asset, point): void`.

Le spec : « Drag d'un `.glb` vers le Scene View : crée une entité `Transform` + `Mesh` positionnée au point d'impact du raycast sur le sol. »

Le point à traiter, et qui justifie de tester : **quand le rayon ne touche pas le sol** — caméra visant l'horizon ou le ciel. Poser l'objet à l'origine serait déroutant ; le placer à une distance fixe devant la caméra est le comportement attendu. C'est du calcul pur, donc testable sans GPU.

Le drop produit une entité via `session.spawnEntity` puis deux `AddComponent` — le tout étant trois commandes, un undo les défait en trois pas. À traiter dans l'implémentation : soit on l'accepte, soit le bus gagne un lot atomique. **Décision : on l'accepte en V1**, et on le note ici. Un lot atomique est une évolution de `core`, et le spec ne le réclame pas.

- [ ] **Steps 1-4** : tests, implémentation, vérification, commit.

```bash
git commit -m "feat(editor): panneau Assets et drop d'un glb dans la scene"
```

---

### Task 11: Les vignettes

**Files:**
- Create: `packages/editor/src/thumbnails.ts`
- Test: `packages/editor/tests/thumbnails.test.ts`

**Interfaces:**
- Produces: `framingFor(bounds): { position: Vec3; target: Vec3 }`, `renderThumbnail(options): Promise<Uint8Array>`.

C'est la pièce que le plan 3 a explicitement différée ici (écart assumé n° 2) : Node n'a pas de GPU, l'éditeur si.

La partie testable est le **cadrage** : depuis la bounding box d'un asset, placer la caméra pour que l'objet remplisse l'image sans être coupé. Cas à couvrir : un objet cubique ; un objet très plat ; un objet très allongé ; une bounding box nulle (asset sans géométrie) qui ne doit pas produire de `NaN` ni de division par zéro ; un objet dont l'origine n'est pas au centre — la convention du projet met l'origine au sol, donc la caméra doit viser le *centre* de la boîte, pas l'origine.

Le rendu lui-même est un adaptateur derrière une couture, non testé unitairement, qui rend hors écran et renvoie un PNG que `client.putThumbnail` envoie au serveur.

- [ ] **Steps 1-4** : tests, implémentation, vérification, commit.

```bash
git commit -m "feat(editor): rendu des vignettes d'assets, differe du plan 3"
```

---

### Task 12: Save, Build et hot reload

**Files:**
- Create: `packages/editor/src/actions.ts`
- Create: `packages/editor/src/api/watch.ts`
- Test: `packages/editor/tests/actions.test.ts`
- Test: `packages/editor/tests/watch.test.ts`

**Interfaces:**
- Produces: `saveScene(session, client, name)`, `runBuild(client, outDir)`, `connectWatch(options): () => void`.

`saveScene` sérialise, envoie, et n'appelle `session.markSaved()` **qu'après** une réponse OK — marquer avant perdrait l'information « non sauvegardé » sur un échec réseau, qui est précisément le moment où elle compte.

`connectWatch` ouvre la WebSocket et traduit les événements : `asset-changed` invalide l'entrée du cache d'assets et rafraîchit la liste ; `asset-removed` la retire ; `asset-failed` remonte un message ; `scene-changed` ne recharge rien si la scène est modifiée localement — écraser le travail de l'utilisateur parce qu'un fichier a bougé sur le disque serait pire que le désynchronisme.

La reconnexion après coupure du serveur est à traiter : un backoff simple, testable avec un faux constructeur de WebSocket.

- [ ] **Steps 1-4** : tests, implémentation, vérification, commit.

```bash
git commit -m "feat(editor): Save, Build et hot reload des assets"
```

---

### Task 13: La chrome React, API publique et gardes

**Files:**
- Create: `packages/editor/src/main.tsx`, `src/App.tsx`, `src/panels/*.tsx`
- Create: `packages/editor/src/index.ts`
- Test: `packages/editor/tests/architecture.test.ts`
- Test: `packages/editor/tests/public-api.test.ts`

Les composants : `App` (layout fixe), `Hierarchy`, `Inspector`, `Assets`, `Toolbar` (Play/Stop, Save, Build, undo/redo), et les deux viewports montés sur un canvas. Ils lisent le store et appellent la session ; ils ne contiennent aucune décision.

- [ ] **Step 1: Écrire le test d'architecture**

C'est le test qui garde les contraintes globales, et il vaut plus que n'importe quel test de composant :

```ts
import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

async function sourceFiles(dir: string, filter: (name: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  const visit = async (current: string): Promise<void> => {
    for (const item of await readdir(current, { withFileTypes: true })) {
      const path = join(current, item.name);
      if (item.isDirectory()) await visit(path);
      else if (filter(item.name)) out.push(path);
    }
  };
  await visit(dir);
  return out;
}

describe('architecture', () => {
  it('never mutates the World outside the session', async () => {
    // Every mutation goes through the CommandBus; that is what makes undo
    // exhaustive rather than best-effort.
    const files = await sourceFiles('src', (n) => n.endsWith('.ts') || n.endsWith('.tsx'));
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith(join('src', 'session.ts'))) continue;
      const text = await readFile(file, 'utf8');
      if (/\bworld\.(set|spawn|despawn|remove|setParent|rename)\s*\(/.test(text)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps React away from the World', async () => {
    const components = await sourceFiles('src', (n) => n.endsWith('.tsx'));
    const offenders: string[] = [];
    for (const file of components) {
      const text = await readFile(file, 'utf8');
      // Type-only imports are fine: they carry no runtime access.
      if (/^import\s+(?!type\b)[^;]*from\s+'@nne\/core'/m.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Écrire l'API publique et son test**

- [ ] **Step 3: Vérifier les gardes de dépendances**

```bash
node -e "const p=require('./packages/editor/package.json');if(p.dependencies['@nne/editor-server']){console.error('editor must not import the server');process.exit(1)}console.log('ok: no editor-server dependency')"
grep -rn "from 'node:fs'\|from 'fs'" packages/editor/src && echo "FAIL: editor touches the disk" && exit 1 || echo "ok: no disk access in editor"
```

- [ ] **Step 4: Lancer la suite complète des quatre packages**

Run: `pnpm test && pnpm typecheck`

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(editor): chrome React, API publique et gardes d'architecture"
```

---

## Self-Review

**Couverture du spec (§6, et §7 côté client) :**

| Exigence du spec | Tâche |
|---|---|
| Toute mutation passe par une commande | Tasks 3, 13 (garde automatisée) |
| React ne lit jamais le `World` | Tasks 3, 6, 13 (garde automatisée) |
| Pas de re-render à 60 fps | Tasks 6, 8 |
| Scene View : caméra d'édition, grille, helpers | Task 7 |
| Scene View : sélection par raycast | Task 8 |
| Gizmo : une seule commande au relâchement | Task 8 |
| Game View : caméra active, sans couche d'édition | Task 9 |
| Play clone le monde, Stop jette le clone | Task 9 |
| Un seul canvas actif à la fois | Tasks 7, 9 |
| Hierarchy : arbre, drag&drop de reparentage | Task 4 |
| Hierarchy : sélection bidirectionnelle | Tasks 6, 8 |
| Inspector générique depuis le registre | Task 5 |
| Inspector : « Add Component » | Task 5 |
| Assets : grille filtrable avec vignettes | Tasks 2, 10 |
| Drop d'un `.glb` au point d'impact du raycast | Task 10 |
| Génération des vignettes | Task 11 (différée ici par le plan 3) |
| Save | Task 12 |
| Build | Task 12 |
| Hot reload d'assets | Task 12 |
| Layout fixe | Task 13 |

**La décision structurante :** le Scene View pilote un `Engine` sans viewport et rend lui-même à travers sa caméra d'édition. **Ce plan ne modifie donc pas `runtime`** — la couture existait déjà (`viewport` optionnel), sans avoir été conçue pour cet usage. C'est le genre de chose qui ne se voit qu'en écrivant le plan suivant, et qui valide après coup l'isolement du renderer derrière une frontière étroite.

**Sur le niveau de détail :** les tâches 1 à 5 portent le code réel, tests inclus, comme les trois plans précédents. Les tâches 6 à 13 décrivent les interfaces, les cas de test à couvrir et les décisions à prendre, sans écrire chaque ligne. C'est délibéré et c'est le seul écart de forme avec les plans 1 à 3 : au-delà de la Task 5, le code dépend d'API de `three` (`TransformControls`, `OrbitControls`, `Raycaster`) dont la signature exacte doit être lue à l'implémentation. Écrire du code plausible mais non vérifié serait pire qu'un cas de test précis — et les cas de test, eux, sont énumérés.

**Aucune modification des trois packages existants n'est nécessaire.** Toutes les API dont ce plan dépend — `CommandBus.canUndo`/`canRedo`, `World.allocateId`/`getName`/`getParent`/`subtree`, `ComponentRegistry.list`/`get`, et le `viewport` optionnel d'`Engine` — ont été vérifiées présentes avant l'écriture. C'est la première fois sur les quatre plans que c'est le cas, et c'est un signe que les frontières tiennent.

**Deux points à trancher à l'exécution, notés ici pour qu'ils ne se décident pas par accident :**

1. **Le drop d'un asset produit trois commandes** (spawn + deux composants), donc trois pas d'undo. Accepté en V1 et documenté en Task 10 ; un lot atomique serait une évolution de `core` que le spec ne réclame pas.
2. **`scene-changed` pendant une édition non sauvegardée** — la Task 12 tranche pour ne pas recharger. Écraser le travail en cours parce qu'un fichier a bougé serait pire que le désynchronisme, et le drapeau « modifié » rend l'état visible.
