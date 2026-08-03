# Moteur ECS — Plan d'implémentation du package `editor-server`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire `packages/editor-server` — le seul processus qui touche le disque : lecture et écriture atomique des scènes, pipeline d'import et d'optimisation des assets `.glb`, surveillance du dossier projet, notifications WebSocket, et build d'un dossier statique autonome.

**Architecture:** Une API HTTP locale au-dessus d'un dossier projet. Le disque est manipulé par des modules purs et testables (`ProjectStore`, `AssetPipeline`, `build`) que la couche Express se contente d'exposer — les routes ne contiennent pas de logique. Les deux dépendances qu'on ne peut pas exécuter dans un test unitaire (l'optimiseur gltf-transform et le bundler Vite) sont derrière des interfaces injectables, comme `GltfSource` et `Viewport` l'ont été dans `runtime`. Tous les tests tournent sur un dossier projet temporaire réel, jamais sur un `fs` simulé.

**Tech Stack:** TypeScript 5.7, Express 5, ws 8, chokidar 4, gltf-transform 4, Vitest 3, pnpm workspaces, Node 22.

## Global Constraints

- `packages/editor-server` n'a **aucune dépendance front** : ni `three`, ni `react`, ni `@nne/runtime`. Sa seule dépendance workspace est `@nne/core`, pour le registre de composants et la validation de scène. Un test le vérifie.
- C'est le **seul** package autorisé à toucher le disque. `core` et `runtime` restent sans accès `fs`.
- Le serveur écoute sur `127.0.0.1` par défaut. Pas d'authentification, donc pas d'exposition réseau : lier `0.0.0.0` doit être un choix explicite de l'appelant, jamais le défaut.
- **Tout chemin issu d'une requête est hostile.** Aucun segment venu du réseau n'est concaténé à un chemin disque sans passer par le garde de confinement. Un nom de scène est validé contre une liste blanche de caractères, pas assaini par remplacement.
- Toute écriture de fichier est atomique : fichier temporaire dans le même dossier, puis `rename`. Un crash en cours d'écriture ne doit jamais laisser une scène tronquée.
- Le runtime charge toujours depuis `.cache/`, jamais depuis `assets/`. L'optimisation est un invariant, pas une étape de build oubliable.
- `.cache/` est entièrement dérivé : le supprimer et relancer doit reproduire le même contenu. Rien d'unique n'y vit.
- Une scène n'est jamais écrite sans avoir été validée contre le registre. Le disque ne reçoit pas de scène invalide, même si le client insiste.
- Tout le code et les commentaires en anglais ; les messages de commit en français.
- TypeScript `strict` avec `noUncheckedIndexedAccess`. Aucun `any` implicite ou explicite dans le code livré.

## Écarts assumés vis-à-vis du spec §7

Trois points où ce plan diverge du spec, chacun pour une raison technique, et chacun sans perte de fonctionnalité :

1. **gltf-transform en API programmatique, pas en CLI.** Le spec dit « optimisation via gltf-transform en CLI ». Lancer un sous-processus par asset rend le pipeline non testable sans installer un binaire global, et fait perdre les métadonnées qu'on veut de toute façon extraire du document (bounding box, animations, triangles) — la CLI les jetterait, il faudrait relire le fichier pour les recalculer. L'API `@gltf-transform/core` donne les deux en une passe. La bibliothèque est la même ; seule la façon de l'appeler change. L'optimiseur reste derrière l'interface `AssetOptimizer`, donc revenir à la CLI plus tard ne toucherait qu'un fichier.

2. **Les vignettes sont stockées et servies, mais pas rendues par le serveur.** Générer une vignette demande un contexte GPU ; Node n'en a pas sans `headless-gl`, un module natif fragile à compiler. L'éditeur, lui, a déjà un WebGL et déjà le mesh chargé. Le serveur expose donc `PUT /api/assets/thumbnail` et sert `.cache/thumbnails/`, et le rendu effectif appartient au plan 4. `AssetEntry.thumbnail` vaut `null` tant qu'aucune vignette n'a été déposée — l'éditeur affiche alors une icône de catégorie. Aucune fonctionnalité n'est perdue, elle change de processus.

3. **Le build orchestre, il ne bundle pas.** Compiler le player est le travail de Vite, et lancer Vite dans un test unitaire coûterait des dizaines de secondes par cas. `build()` fait le travail spécifique au projet — déduire le graphe d'assets depuis les champs de type `asset`, copier les scènes et les seuls assets référencés, écrire le manifeste — et délègue la compilation à un `PlayerBundler` injectable. Le bundler Vite réel est un adaptateur de quinze lignes, non testé unitairement, exactement comme `createGltfSource` dans `runtime`.

---

### Task 1: Scaffolding du package `editor-server`

**Files:**
- Create: `packages/editor-server/package.json`
- Create: `packages/editor-server/tsconfig.json`
- Create: `packages/editor-server/vitest.config.ts`
- Create: `packages/editor-server/src/types.ts`
- Test: `packages/editor-server/tests/smoke.test.ts`

**Interfaces:**
- Produces: les types partagés du package — `ProjectFile`, `PROJECT_VERSION`, `AssetCategory`, `AssetMetadata`, `AssetEntry`, `Vec3`, `ProjectEvent`.
- Consumes: rien encore.

Le package est calqué sur `packages/runtime` : mêmes scripts, même `tsconfig` étendant la base, mêmes conventions. `Vec3` est redéfini localement plutôt qu'importé de `runtime` — importer `runtime` ferait entrer `three` dans les dépendances du serveur, ce que la contrainte globale interdit. C'est trois lignes dupliquées contre une frontière d'architecture tenue.

- [ ] **Step 1: Créer le manifeste du package**

`packages/editor-server/package.json` :

```json
{
  "name": "@nne/editor-server",
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
    "@gltf-transform/core": "^4.1.0",
    "@gltf-transform/extensions": "^4.1.0",
    "@gltf-transform/functions": "^4.1.0",
    "@nne/core": "workspace:*",
    "chokidar": "^4.0.0",
    "draco3dgltf": "^1.5.7",
    "express": "^5.0.0",
    "sharp": "^0.34.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/ws": "^8.5.0"
  }
}
```

`sharp` sert au redimensionnement des textures dans `textureCompress`, `draco3dgltf` fournit l'encodeur Draco. Ce sont des dépendances de `@gltf-transform/functions`, pas des choix indépendants.

- [ ] **Step 2: Créer les configs**

`packages/editor-server/tsconfig.json` :

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src", "tests"]
}
```

`packages/editor-server/vitest.config.ts` :

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The pipeline tests write real files to a temp dir; the default 5s is
    // tight once gltf-transform runs for real.
    testTimeout: 20_000,
  },
});
```

- [ ] **Step 3: Écrire les types partagés**

`packages/editor-server/src/types.ts` :

```ts
/** A position triple, in metres. Redefined here so the server never pulls in `three`. */
export type Vec3 = [number, number, number];

/** The project manifest format. Bumped only on a breaking layout change. */
export const PROJECT_VERSION = 1;

export interface ProjectFile {
  name: string;
  version: number;
  /** Scene opened by the player and by the editor on boot. */
  startScene: string | null;
}

/** The four asset categories the naming convention allows. */
export type AssetCategory = 'CHR' | 'PRP' | 'ENV' | 'UI';

/** Extracted once at import, so the editor never parses a .glb to show a list. */
export interface AssetMetadata {
  bounds: { min: Vec3; max: Vec3 };
  animations: string[];
  triangles: number;
}

/** One optimized asset, as recorded in the cache manifest. */
export interface AssetEntry {
  /** Path relative to `assets/`, forward-slashed, e.g. "props/PRP_Chair_01.glb". */
  path: string;
  category: AssetCategory;
  /** Path relative to `.cache/`, what the runtime actually loads. */
  cached: string;
  /** Path relative to `.cache/`, or null until the editor uploads one. */
  thumbnail: string | null;
  metadata: AssetMetadata;
  /** Source mtime and size, so an unchanged file is not re-optimized. */
  sourceMtimeMs: number;
  sourceSize: number;
}

/** What the watcher broadcasts over the WebSocket. */
export type ProjectEvent =
  | { type: 'asset-changed'; path: string; entry: AssetEntry }
  | { type: 'asset-removed'; path: string }
  | { type: 'asset-failed'; path: string; message: string }
  | { type: 'scene-changed'; name: string };
```

- [ ] **Step 4: Écrire le test de fumée**

`packages/editor-server/tests/smoke.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { PROJECT_VERSION } from '../src/types.js';

describe('editor-server package', () => {
  it('is wired up', () => {
    expect(PROJECT_VERSION).toBe(1);
  });
});
```

- [ ] **Step 5: Installer et vérifier**

Run: `pnpm install && pnpm test && pnpm typecheck`
Attendu : les trois packages sont détectés par le workspace, les tests passent, typecheck propre.

- [ ] **Step 6: Commit**

```bash
git add packages/editor-server pnpm-lock.yaml
git commit -m "chore(editor-server): initialise le package avec express et gltf-transform"
```

---

### Task 2: Chemins de projet et confinement

**Files:**
- Create: `packages/editor-server/src/paths.ts`
- Test: `packages/editor-server/tests/paths.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `resolveProject(root: string): ProjectPaths`, `containedJoin(base: string, relative: string): string`, `isValidSceneName(name: string): boolean`, `toPosix(p: string): string`, `type ProjectPaths`.

C'est la tâche de sécurité du package. Tout chemin qui vient du réseau passe par ici. `containedJoin` résout puis vérifie que le résultat est bien sous la base — vérifier avant de résoudre laisserait passer `a/../../etc/passwd`, et un simple `startsWith` sur la chaîne laisserait passer `/projet-evil` quand la base est `/projet`. Le séparateur final compte.

- [ ] **Step 1: Écrire les tests en échec**

`packages/editor-server/tests/paths.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { containedJoin, isValidSceneName, resolveProject, toPosix } from '../src/paths.js';

describe('resolveProject', () => {
  it('derives every project path from the root', () => {
    const paths = resolveProject('/tmp/demo');
    expect(paths.root).toBe(resolve('/tmp/demo'));
    expect(paths.projectFile).toBe(join(resolve('/tmp/demo'), 'project.json'));
    expect(paths.scenes).toBe(join(resolve('/tmp/demo'), 'scenes'));
    expect(paths.assets).toBe(join(resolve('/tmp/demo'), 'assets'));
    expect(paths.cache).toBe(join(resolve('/tmp/demo'), '.cache'));
  });

  it('resolves a relative root against the cwd', () => {
    expect(resolveProject('demo').root).toBe(resolve('demo'));
  });
});

describe('containedJoin', () => {
  const base = resolve('/tmp/demo/assets');

  it('joins a plain relative path', () => {
    expect(containedJoin(base, 'props/PRP_Chair_01.glb'))
      .toBe(join(base, 'props', 'PRP_Chair_01.glb'));
  });

  it('rejects a traversal that climbs out', () => {
    expect(() => containedJoin(base, '../../etc/passwd')).toThrow(/escapes/);
  });

  it('rejects a traversal that climbs out and back in under another name', () => {
    // The classic prefix bug: "/tmp/demo/assets-evil" starts with the base
    // string but is not inside the base directory.
    expect(() => containedJoin(base, '../assets-evil/x.glb')).toThrow(/escapes/);
  });

  it('rejects an absolute path', () => {
    expect(() => containedJoin(base, '/etc/passwd')).toThrow(/escapes/);
  });

  it('rejects a path that only re-enters after leaving', () => {
    // Resolves back inside, but only by chance; a caller sending this is
    // probing, so it is refused rather than silently normalized.
    expect(() => containedJoin(base, '../assets/../../demo/assets/x.glb')).toThrow(/escapes/);
  });

  it('rejects an empty segment', () => {
    expect(() => containedJoin(base, '')).toThrow(/empty/);
  });

  it('rejects a NUL byte', () => {
    // Node throws on NUL in paths anyway, but failing here gives the caller a
    // real message instead of an ERR_INVALID_ARG_VALUE from deep inside fs.
    expect(() => containedJoin(base, 'a\0b.glb')).toThrow(/invalid/);
  });

  it('allows the base itself', () => {
    expect(containedJoin(base, '.')).toBe(base);
  });
});

describe('isValidSceneName', () => {
  it('accepts ordinary names', () => {
    expect(isValidSceneName('Scene_01')).toBe(true);
    expect(isValidSceneName('level-2')).toBe(true);
  });

  it('rejects anything that could reach the filesystem', () => {
    for (const bad of ['..', '.', 'a/b', 'a\\b', 'a.json', '', ' ', 'a b', 'a\0b']) {
      expect(isValidSceneName(bad), bad).toBe(false);
    }
  });

  it('rejects a name longer than the limit', () => {
    expect(isValidSceneName('a'.repeat(65))).toBe(false);
    expect(isValidSceneName('a'.repeat(64))).toBe(true);
  });
});

describe('toPosix', () => {
  it('normalizes separators so manifests are identical across platforms', () => {
    expect(toPosix('props\\PRP_Chair_01.glb')).toBe('props/PRP_Chair_01.glb');
    expect(toPosix('props/PRP_Chair_01.glb')).toBe('props/PRP_Chair_01.glb');
  });
});
```

- [ ] **Step 2: Implémenter**

`packages/editor-server/src/paths.ts` :

```ts
import { isAbsolute, join, resolve, sep } from 'node:path';

/** Every directory the server is allowed to touch, derived from one root. */
export interface ProjectPaths {
  root: string;
  projectFile: string;
  scenes: string;
  assets: string;
  cache: string;
}

export function resolveProject(root: string): ProjectPaths {
  const absolute = resolve(root);
  return {
    root: absolute,
    projectFile: join(absolute, 'project.json'),
    scenes: join(absolute, 'scenes'),
    assets: join(absolute, 'assets'),
    cache: join(absolute, '.cache'),
  };
}

/**
 * Joins a caller-supplied relative path onto a trusted base, refusing anything
 * that lands outside it.
 *
 * Resolution happens first, then containment is checked on the result: checking
 * the raw string would miss `a/../../x`, and comparing with a bare `startsWith`
 * would accept `/base-evil` for base `/base`, which is a sibling, not a child.
 * Hence the trailing separator.
 */
export function containedJoin(base: string, relative: string): string {
  if (relative.length === 0) throw new Error('path segment is empty');
  if (relative.includes('\0')) throw new Error('path segment is invalid: contains NUL');
  if (isAbsolute(relative)) throw new Error(`path "${relative}" escapes the project directory`);

  const root = resolve(base);
  const target = resolve(root, relative);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`path "${relative}" escapes the project directory`);
  }
  // A path that leaves and comes back is a probe, not a typo: `..` never has a
  // legitimate use in a request, so it is refused even when it resolves inside.
  if (relative.split(/[/\\]/).includes('..')) {
    throw new Error(`path "${relative}" escapes the project directory`);
  }
  return target;
}

/** Scene names index files directly, so they are allow-listed, never sanitized. */
const SCENE_NAME = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidSceneName(name: string): boolean {
  return SCENE_NAME.test(name);
}

/** Manifests and API payloads always use forward slashes, on every platform. */
export function toPosix(p: string): string {
  return p.split(sep).join('/').split('\\').join('/');
}
```

- [ ] **Step 3: Vérifier**

Run: `pnpm --filter @nne/editor-server test && pnpm --filter @nne/editor-server typecheck`
Attendu : tout passe.

- [ ] **Step 4: Vérifier le garde par mutation**

Casser volontairement `containedJoin`, une mutation à la fois, en restaurant entre chaque :

1. Remplacer `!target.startsWith(root + sep)` par `!target.startsWith(root)`.
2. Retirer la garde `isAbsolute`.
3. Retirer la garde sur `..`.

**Résultat attendu : seule la mutation 3 vire au rouge**, et c'est le bon résultat, pas un test manquant. Les trois gardes sont volontairement redondants, et le rejet de `..` rend les deux autres inatteignables : aucun chemin sans `..` ne peut sortir de la base par résolution, et un chemin absolu est déjà rattrapé par le test de confinement. Les deux gardes restent parce qu'ils échouent indépendamment — le jour où quelqu'un assouplit la règle sur `..` pour autoriser un chemin relatif légitime, ils sont ce qui empêche la fonction de devenir correcte par accident d'ordonnancement.

Le noter ici plutôt que de fabriquer un test artificiel : la redondance sur une frontière de sécurité est un choix, et un choix se documente.

- [ ] **Step 5: Commit**

```bash
git add packages/editor-server/src/paths.ts packages/editor-server/tests/paths.test.ts
git commit -m "feat(editor-server): chemins de projet et garde de confinement"
```

---

### Task 3: Écriture atomique

**Files:**
- Create: `packages/editor-server/src/atomic.ts`
- Test: `packages/editor-server/tests/atomic.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `writeAtomic(file: string, data: string | Uint8Array): Promise<void>`.

Le fichier temporaire vit dans le **même dossier** que la cible : `rename` n'est atomique qu'à l'intérieur d'un système de fichiers, et `/tmp` est souvent monté ailleurs — un temp global transformerait le `rename` en copie non atomique, ce qui est précisément le bug qu'on veut éviter.

- [ ] **Step 1: Écrire les tests en échec**

`packages/editor-server/tests/atomic.test.ts` :

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeAtomic } from '../src/atomic.js';

describe('writeAtomic', () => {
  let dir: string;

  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'nne-atomic-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('writes a new file', async () => {
    const file = join(dir, 'a.json');
    await writeAtomic(file, '{"a":1}');
    expect(await readFile(file, 'utf8')).toBe('{"a":1}');
  });

  it('replaces an existing file', async () => {
    const file = join(dir, 'a.json');
    await writeFile(file, 'old');
    await writeAtomic(file, 'new');
    expect(await readFile(file, 'utf8')).toBe('new');
  });

  it('leaves no temp file behind on success', async () => {
    await writeAtomic(join(dir, 'a.json'), 'x');
    expect(await readdir(dir)).toEqual(['a.json']);
  });

  it('creates the parent directory when missing', async () => {
    const file = join(dir, 'nested', 'deep', 'a.json');
    await writeAtomic(file, 'x');
    expect(await readFile(file, 'utf8')).toBe('x');
  });

  it('keeps the previous content when the write fails', async () => {
    const file = join(dir, 'a.json');
    await writeFile(file, 'original');
    // A directory where the temp file wants to go is not something we can force
    // portably, so failure is provoked with data the encoder rejects.
    await expect(writeAtomic(file, undefined as unknown as string)).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toBe('original');
  });

  it('leaves no temp file behind on failure', async () => {
    const file = join(dir, 'a.json');
    await writeFile(file, 'original');
    await expect(writeAtomic(file, undefined as unknown as string)).rejects.toThrow();
    expect(await readdir(dir)).toEqual(['a.json']);
  });

  it('writes binary data unchanged', async () => {
    const file = join(dir, 'a.bin');
    const bytes = new Uint8Array([0, 1, 2, 255]);
    await writeAtomic(file, bytes);
    expect(new Uint8Array(await readFile(file))).toEqual(bytes);
  });

  it('does not interleave two concurrent writes to the same target', async () => {
    const file = join(dir, 'a.json');
    await Promise.all([
      writeAtomic(file, 'a'.repeat(10_000)),
      writeAtomic(file, 'b'.repeat(10_000)),
    ]);
    const content = await readFile(file, 'utf8');
    // Whichever won, the file is one complete write, never a mix of both.
    expect(content === 'a'.repeat(10_000) || content === 'b'.repeat(10_000)).toBe(true);
    expect(await readdir(dir)).toEqual(['a.json']);
  });
});
```

- [ ] **Step 2: Implémenter**

`packages/editor-server/src/atomic.ts` :

```ts
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';

/**
 * Writes a file by replacing it wholesale: temp file first, then `rename`.
 *
 * A reader either sees the old file or the new one, never a half-written scene.
 * The temp file is a sibling of the target on purpose — `rename` is only atomic
 * within one filesystem, and the OS temp dir is frequently a different mount.
 */
export async function writeAtomic(file: string, data: string | Uint8Array): Promise<void> {
  const dir = dirname(file);
  await mkdir(dir, { recursive: true });

  // Random suffix rather than a pid or a counter: two concurrent writes to the
  // same target must not pick the same temp name and clobber each other.
  const temp = join(dir, `.${randomBytes(8).toString('hex')}.tmp`);
  try {
    await writeFile(temp, data);
    await rename(temp, file);
  } catch (cause) {
    // Best effort: the temp file may not exist if writeFile is what failed.
    await rm(temp, { force: true }).catch(() => undefined);
    throw cause;
  }
}
```

- [ ] **Step 3: Vérifier**

Run: `pnpm --filter @nne/editor-server test`
Attendu : tout passe.

- [ ] **Step 4: Commit**

```bash
git add packages/editor-server/src/atomic.ts packages/editor-server/tests/atomic.test.ts
git commit -m "feat(editor-server): ecriture atomique par fichier temporaire et rename"
```

---

### Task 4: Le store de projet et de scènes

**Files:**
- Create: `packages/editor-server/src/project-store.ts`
- Test: `packages/editor-server/tests/project-store.test.ts`

**Interfaces:**
- Consumes: `ProjectPaths`, `containedJoin`, `isValidSceneName` (Task 2), `writeAtomic` (Task 3), `stringifyScene`/`validateScene`/`ComponentRegistry` de `@nne/core`, `ProjectFile`/`PROJECT_VERSION` (Task 1).
- Produces: `class ProjectStore` avec `readProject`, `writeProject`, `listScenes`, `readScene`, `writeScene`, `init`, et `class HttpError`.

`writeScene` valide **avant** d'écrire. C'est la seule barrière entre un client bogué et un dossier projet corrompu, et `core` a déjà tout ce qu'il faut : `validateScene` traite son entrée comme non fiable, `stringifyScene` produit une sortie stable octet pour octet, donc un diff git lisible.

`HttpError` vit ici plutôt que dans la couche Express, pour que le store puisse distinguer « scène introuvable » (404) de « scène invalide » (400) sans connaître HTTP autrement que par un code numérique.

- [ ] **Step 1: Écrire les tests en échec**

`packages/editor-server/tests/project-store.test.ts` :

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ComponentRegistry, registerBuiltins, stringifyScene, type SceneFile } from '@nne/core';
import { resolveProject } from '../src/paths.js';
import { HttpError, ProjectStore } from '../src/project-store.js';

const scene: SceneFile = {
  version: 1,
  name: 'Scene_01',
  entities: [
    {
      id: 1,
      name: 'Chair',
      components: {
        Transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        Mesh: { asset: 'PRP_Chair_01.glb', castShadow: true },
      },
    },
  ],
};

describe('ProjectStore', () => {
  let dir: string;
  let store: ProjectStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nne-project-'));
    const registry = new ComponentRegistry();
    registerBuiltins(registry);
    store = new ProjectStore(resolveProject(dir), registry);
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  describe('init', () => {
    it('creates the project layout', async () => {
      await store.init('demo');
      const project = await store.readProject();
      expect(project).toEqual({ name: 'demo', version: 1, startScene: null });
      expect(await store.listScenes()).toEqual([]);
    });

    it('does not overwrite an existing project', async () => {
      await store.init('demo');
      await store.writeProject({ name: 'demo', version: 1, startScene: 'Scene_01' });
      await store.init('other');
      expect((await store.readProject()).startScene).toBe('Scene_01');
    });
  });

  describe('readProject', () => {
    it('reports a missing project file as 404', async () => {
      await expect(store.readProject()).rejects.toMatchObject({ status: 404 });
    });

    it('rejects a project file with the wrong version', async () => {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'project.json'), '{"name":"x","version":99,"startScene":null}');
      await expect(store.readProject()).rejects.toMatchObject({ status: 400 });
    });

    it('rejects a project file that is not an object', async () => {
      await writeFile(join(dir, 'project.json'), '[]');
      await expect(store.readProject()).rejects.toMatchObject({ status: 400 });
    });

    it('rejects a project file that is not JSON', async () => {
      await writeFile(join(dir, 'project.json'), 'not json');
      await expect(store.readProject()).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('listScenes', () => {
    it('returns an empty list when the folder does not exist', async () => {
      expect(await store.listScenes()).toEqual([]);
    });

    it('lists scene names without the extension, sorted', async () => {
      await mkdir(join(dir, 'scenes'), { recursive: true });
      for (const n of ['b', 'a', 'c']) await writeFile(join(dir, 'scenes', `${n}.json`), '{}');
      expect(await store.listScenes()).toEqual(['a', 'b', 'c']);
    });

    it('ignores files that are not .json and nested directories', async () => {
      await mkdir(join(dir, 'scenes', 'sub'), { recursive: true });
      await writeFile(join(dir, 'scenes', 'a.json'), '{}');
      await writeFile(join(dir, 'scenes', 'notes.txt'), 'x');
      expect(await store.listScenes()).toEqual(['a']);
    });

    it('ignores a file whose stem is not a valid scene name', async () => {
      await mkdir(join(dir, 'scenes'), { recursive: true });
      await writeFile(join(dir, 'scenes', 'a b.json'), '{}');
      await writeFile(join(dir, 'scenes', 'ok.json'), '{}');
      expect(await store.listScenes()).toEqual(['ok']);
    });
  });

  describe('readScene', () => {
    it('reads a scene back', async () => {
      await store.writeScene('Scene_01', scene);
      expect(await store.readScene('Scene_01')).toEqual(scene);
    });

    it('reports a missing scene as 404', async () => {
      await expect(store.readScene('Nope')).rejects.toMatchObject({ status: 404 });
    });

    it('refuses a traversal in the name', async () => {
      await expect(store.readScene('../../etc/passwd')).rejects.toMatchObject({ status: 400 });
    });

    it('refuses a name with a slash even if it would resolve inside', async () => {
      await expect(store.readScene('sub/Scene_01')).rejects.toMatchObject({ status: 400 });
    });

    it('reports a corrupt scene on disk as 400, not as a crash', async () => {
      await mkdir(join(dir, 'scenes'), { recursive: true });
      await writeFile(join(dir, 'scenes', 'Broken.json'), '{ nope');
      await expect(store.readScene('Broken')).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('writeScene', () => {
    it('writes a scene in the stable stringified form', async () => {
      await store.writeScene('Scene_01', scene);
      const onDisk = await readFile(join(dir, 'scenes', 'Scene_01.json'), 'utf8');
      expect(onDisk).toBe(stringifyScene(scene));
    });

    it('round-trips byte for byte', async () => {
      await store.writeScene('Scene_01', scene);
      const first = await readFile(join(dir, 'scenes', 'Scene_01.json'), 'utf8');
      await store.writeScene('Scene_01', await store.readScene('Scene_01'));
      expect(await readFile(join(dir, 'scenes', 'Scene_01.json'), 'utf8')).toBe(first);
    });

    it('refuses an invalid scene and writes nothing', async () => {
      const bad = { version: 1, name: 'x', entities: [{ id: 1, components: { Nope: {} } }] };
      await expect(store.writeScene('Scene_01', bad)).rejects.toMatchObject({ status: 400 });
      await expect(store.readScene('Scene_01')).rejects.toMatchObject({ status: 404 });
    });

    it('reports every validation error, not just the first', async () => {
      const bad = {
        version: 1,
        name: 'x',
        entities: [{ id: 1, components: { Nope: {} } }, { id: 2, components: { AlsoNope: {} } }],
      };
      await expect(store.writeScene('Scene_01', bad)).rejects.toThrow(/Nope[\s\S]*AlsoNope/);
    });

    it('refuses a traversal in the name and creates no file', async () => {
      await expect(store.writeScene('../evil', scene)).rejects.toMatchObject({ status: 400 });
    });

    it('does not corrupt an existing scene when the new one is invalid', async () => {
      await store.writeScene('Scene_01', scene);
      await expect(store.writeScene('Scene_01', { version: 1 })).rejects.toThrow();
      expect(await store.readScene('Scene_01')).toEqual(scene);
    });
  });
});
```

- [ ] **Step 2: Implémenter**

`packages/editor-server/src/project-store.ts` :

```ts
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type ComponentRegistry, type SceneFile, stringifyScene, validateScene,
} from '@nne/core';
import { writeAtomic } from './atomic.js';
import { containedJoin, isValidSceneName, type ProjectPaths } from './paths.js';
import { PROJECT_VERSION, type ProjectFile } from './types.js';

/** An error carrying the status the HTTP layer should answer with. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'HttpError';
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

/** Reads and writes the project manifest and its scenes. The only disk owner. */
export class ProjectStore {
  constructor(
    private readonly paths: ProjectPaths,
    private readonly registry: ComponentRegistry,
  ) {}

  /** Creates the layout for a new project, leaving an existing one untouched. */
  async init(name: string): Promise<void> {
    try {
      await this.readProject();
      return;
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 404) throw error;
    }
    await this.writeProject({ name, version: PROJECT_VERSION, startScene: null });
  }

  async readProject(): Promise<ProjectFile> {
    let text: string;
    try {
      text = await readFile(this.paths.projectFile, 'utf8');
    } catch (error) {
      if (isMissing(error)) throw new HttpError(404, 'no project.json in this folder');
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (cause) {
      throw new HttpError(400, 'project.json is not valid JSON', { cause });
    }

    // The file is on disk, but disk is not trust: a hand-edited manifest is the
    // normal case, not the exception.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new HttpError(400, 'project.json must be an object');
    }
    const file = parsed as Partial<ProjectFile>;
    if (file.version !== PROJECT_VERSION) {
      throw new HttpError(400, `project.json version ${String(file.version)} is not supported`);
    }
    if (typeof file.name !== 'string') {
      throw new HttpError(400, 'project.json is missing a string "name"');
    }
    const startScene = file.startScene ?? null;
    if (startScene !== null && typeof startScene !== 'string') {
      throw new HttpError(400, 'project.json "startScene" must be a string or null');
    }
    return { name: file.name, version: file.version, startScene };
  }

  async writeProject(file: ProjectFile): Promise<void> {
    await writeAtomic(this.paths.projectFile, `${JSON.stringify(file, null, 2)}\n`);
  }

  async listScenes(): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(this.paths.scenes, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.json'))
      .map((e) => e.name.slice(0, -'.json'.length))
      // A file the API could not address afterwards is not listed: the name is
      // what the client would send back, so it must survive the round trip.
      .filter(isValidSceneName)
      .sort();
  }

  async readScene(name: string): Promise<SceneFile> {
    const file = this.sceneFile(name);
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      if (isMissing(error)) throw new HttpError(404, `no scene named "${name}"`);
      throw error;
    }
    try {
      return JSON.parse(text) as SceneFile;
    } catch (cause) {
      throw new HttpError(400, `scene "${name}" is not valid JSON`, { cause });
    }
  }

  /** Validates against the registry before touching disk, then writes atomically. */
  async writeScene(name: string, file: unknown): Promise<void> {
    const target = this.sceneFile(name);
    const errors = validateScene(file, this.registry);
    if (errors.length > 0) {
      const detail = errors.map((e) => `${e.path}: ${e.message}`).join('\n  ');
      throw new HttpError(400, `invalid scene:\n  ${detail}`);
    }
    await writeAtomic(target, stringifyScene(file as SceneFile));
  }

  private sceneFile(name: string): string {
    if (!isValidSceneName(name)) {
      throw new HttpError(400, `invalid scene name "${name}"`);
    }
    // Belt and braces: the name is already allow-listed, so this can only fire
    // if the regex is ever loosened. It is here so that loosening it is safe.
    return containedJoin(this.paths.scenes, `${name}.json`);
  }
}
```

`sceneFile` valide **puis** confine : le regex est la vraie barrière, `containedJoin` est le filet. Les deux, parce qu'ils protègent contre des erreurs différentes — le regex contre une requête hostile, le confinement contre un futur assouplissement du regex.

- [ ] **Step 3: Vérifier**

Run: `pnpm --filter @nne/editor-server test && pnpm --filter @nne/editor-server typecheck`
Attendu : tout passe.

- [ ] **Step 4: Commit**

```bash
git add packages/editor-server/src/project-store.ts packages/editor-server/tests/project-store.test.ts
git commit -m "feat(editor-server): store de projet avec validation avant ecriture"
```

---

### Task 5: Conventions de nommage des assets

**Files:**
- Create: `packages/editor-server/src/assets/naming.ts`
- Test: `packages/editor-server/tests/naming.test.ts`

**Interfaces:**
- Consumes: `AssetCategory` (Task 1).
- Produces: `ASSET_PREFIXES`, `TEXTURE_LIMITS`, `STANDARD_ANIMATIONS`, `categoryOf(fileName: string): AssetCategory | null`, `validateAssetPath(relPath: string): string[]`.

Le spec plafonne les textures par catégorie : personnages 512–1024, props 256–512. On retient la borne haute comme plafond dur : `CHR` 1024, `PRP` 512. `ENV` et `UI` ne sont pas chiffrés dans le spec — on prend `ENV` 1024 (les décors couvrent de grandes surfaces) et `UI` 512, et on le note ici pour que le choix soit visible plutôt qu'enfoui dans le code.

`validateAssetPath` retourne une liste de messages plutôt qu'un booléen : c'est ce qui en fait un linter utilisable en pre-commit, où « pourquoi » compte plus que « non ».

- [ ] **Step 1: Écrire les tests en échec**

`packages/editor-server/tests/naming.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { TEXTURE_LIMITS, categoryOf, validateAssetPath } from '../src/assets/naming.js';

describe('categoryOf', () => {
  it('reads the category from the prefix', () => {
    expect(categoryOf('CHR_Hero.glb')).toBe('CHR');
    expect(categoryOf('PRP_Chair_01.glb')).toBe('PRP');
    expect(categoryOf('ENV_Forest.glb')).toBe('ENV');
    expect(categoryOf('UI_Button.glb')).toBe('UI');
  });

  it('takes the prefix from the file name, not the folder', () => {
    expect(categoryOf('CHR_wrong/PRP_Chair_01.glb')).toBe('PRP');
  });

  it('returns null for an unknown prefix', () => {
    expect(categoryOf('Chair.glb')).toBeNull();
    expect(categoryOf('XXX_Chair.glb')).toBeNull();
  });

  it('is case sensitive: the convention is uppercase', () => {
    expect(categoryOf('chr_Hero.glb')).toBeNull();
  });

  it('requires the underscore, so CHRome is not a character', () => {
    expect(categoryOf('CHRome.glb')).toBeNull();
  });
});

describe('validateAssetPath', () => {
  it('accepts a conforming asset', () => {
    expect(validateAssetPath('props/PRP_Chair_01.glb')).toEqual([]);
  });

  it('rejects a missing category prefix', () => {
    expect(validateAssetPath('props/Chair.glb')).toEqual([
      expect.stringContaining('CHR_'),
    ]);
  });

  it('rejects an extension other than .glb', () => {
    expect(validateAssetPath('props/PRP_Chair_01.fbx')).toEqual([
      expect.stringContaining('.glb'),
    ]);
  });

  it('reports both problems at once', () => {
    expect(validateAssetPath('props/Chair.fbx')).toHaveLength(2);
  });

  it('rejects a name with spaces', () => {
    expect(validateAssetPath('props/PRP_Chair 01.glb')[0]).toMatch(/space/i);
  });

  it('is case insensitive on the extension', () => {
    expect(validateAssetPath('props/PRP_Chair_01.GLB')).toEqual([]);
  });
});

describe('TEXTURE_LIMITS', () => {
  it('caps each category', () => {
    expect(TEXTURE_LIMITS).toEqual({ CHR: 1024, PRP: 512, ENV: 1024, UI: 512 });
  });
});
```

- [ ] **Step 2: Implémenter**

`packages/editor-server/src/assets/naming.ts` :

```ts
import type { AssetCategory } from '../types.js';

/** The four category prefixes every asset file name must start with. */
export const ASSET_PREFIXES = ['CHR', 'PRP', 'ENV', 'UI'] as const;

/**
 * Hard texture ceiling per category, in pixels.
 *
 * The spec gives ranges for characters (512-1024) and props (256-512); the top
 * of each range is the cap. ENV and UI are not specified: environments cover
 * large surfaces so they get the character budget, UI is flat so it gets the
 * prop budget.
 */
export const TEXTURE_LIMITS: Record<AssetCategory, number> = {
  CHR: 1024,
  PRP: 512,
  ENV: 1024,
  UI: 512,
};

/** Animation clip names the project standardizes on. */
export const STANDARD_ANIMATIONS = ['Idle', 'Alert', 'Action_01'] as const;

function baseName(relPath: string): string {
  const parts = relPath.split(/[/\\]/);
  return parts[parts.length - 1] ?? '';
}

/** The category a file declares through its prefix, or null if it declares none. */
export function categoryOf(relPath: string): AssetCategory | null {
  const name = baseName(relPath);
  for (const prefix of ASSET_PREFIXES) {
    if (name.startsWith(`${prefix}_`)) return prefix;
  }
  return null;
}

/**
 * Lints one asset path against the project conventions.
 * Returns every problem, not the first: this doubles as the CLI linter, where
 * a full list is the difference between one fix pass and five.
 */
export function validateAssetPath(relPath: string): string[] {
  const name = baseName(relPath);
  const problems: string[] = [];

  if (categoryOf(relPath) === null) {
    problems.push(
      `"${name}" has no category prefix: expected one of ${ASSET_PREFIXES.map((p) => `${p}_`).join(', ')}`,
    );
  }
  if (!name.toLowerCase().endsWith('.glb')) {
    problems.push(`"${name}" is not a .glb: .glb is the project's only export format`);
  }
  if (/\s/.test(name)) {
    problems.push(`"${name}" contains a space: use underscores`);
  }
  return problems;
}
```

- [ ] **Step 3: Vérifier**

Run: `pnpm --filter @nne/editor-server test`
Attendu : tout passe.

- [ ] **Step 4: Commit**

```bash
git add packages/editor-server/src/assets/naming.ts packages/editor-server/tests/naming.test.ts
git commit -m "feat(editor-server): conventions de nommage des assets"
```

---

### Task 6: L'optimiseur gltf-transform

**Files:**
- Create: `packages/editor-server/src/assets/optimizer.ts`
- Test: `packages/editor-server/tests/optimizer.test.ts`

**Interfaces:**
- Consumes: `AssetCategory`, `AssetMetadata`, `Vec3` (Task 1), `TEXTURE_LIMITS` (Task 5).
- Produces: `interface AssetOptimizer { run(request: OptimizeRequest): Promise<AssetMetadata> }`, `interface OptimizeRequest`, `createGltfTransformOptimizer(): Promise<AssetOptimizer>`, `readMetadata(document: Document): AssetMetadata`.

L'interface `AssetOptimizer` est la couture qui rend le pipeline testable : les tâches suivantes n'utilisent qu'elle, et un faux optimiseur suffit à tester tout le reste. L'implémentation gltf-transform réelle est testée ici, une fois, sur un `.glb` minimal construit en mémoire — pas de fixture binaire au dépôt.

`readMetadata` est séparée et exportée parce que c'est la seule partie de l'optimiseur qui soit du calcul pur : elle se teste sur un `Document` construit à la main, sans écrire un octet.

- [ ] **Step 1: Écrire les tests en échec**

`packages/editor-server/tests/optimizer.test.ts` :

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { createGltfTransformOptimizer, readMetadata } from '../src/assets/optimizer.js';

/** A one-triangle document, enough to exercise the real pipeline. */
function triangleDocument(): Document {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const position = doc.createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 2, 0]))
    .setBuffer(buffer);
  const indices = doc.createAccessor()
    .setType('SCALAR')
    .setArray(new Uint16Array([0, 1, 2]))
    .setBuffer(buffer);
  const primitive = doc.createPrimitive().setAttribute('POSITION', position).setIndices(indices);
  const mesh = doc.createMesh('Chair').addPrimitive(primitive);
  const node = doc.createNode('Chair').setMesh(mesh);
  doc.createScene('Scene').addChild(node);
  return doc;
}

describe('readMetadata', () => {
  it('counts triangles', () => {
    expect(readMetadata(triangleDocument()).triangles).toBe(1);
  });

  it('computes the bounding box in metres', () => {
    expect(readMetadata(triangleDocument()).bounds).toEqual({
      min: [0, 0, 0],
      max: [1, 2, 0],
    });
  });

  it('lists animation names', () => {
    const doc = triangleDocument();
    doc.createAnimation('Idle');
    doc.createAnimation('Action_01');
    expect(readMetadata(doc).animations).toEqual(['Action_01', 'Idle']);
  });

  it('returns a zero box for a document with no geometry', () => {
    const doc = new Document();
    doc.createScene('Empty');
    expect(readMetadata(doc).bounds).toEqual({ min: [0, 0, 0], max: [0, 0, 0] });
    expect(readMetadata(doc).triangles).toBe(0);
  });

  it('accounts for the node transform in the bounds', () => {
    const doc = triangleDocument();
    doc.getRoot().listNodes()[0]?.setTranslation([10, 0, 0]);
    expect(readMetadata(doc).bounds.max[0]).toBe(11);
  });
});

describe('createGltfTransformOptimizer', () => {
  let dir: string;

  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'nne-opt-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('writes an optimized glb and returns its metadata', async () => {
    const source = join(dir, 'PRP_Chair_01.glb');
    const target = join(dir, 'out', 'PRP_Chair_01.glb');
    await new NodeIO().write(source, triangleDocument());

    const optimizer = await createGltfTransformOptimizer();
    const metadata = await optimizer.run({
      source, target, category: 'PRP',
    });

    expect((await stat(target)).size).toBeGreaterThan(0);
    expect(metadata.triangles).toBe(1);
    expect(metadata.bounds.max).toEqual([1, 2, 0]);
  });

  it('creates the target directory when missing', async () => {
    const source = join(dir, 'PRP_Chair_01.glb');
    await new NodeIO().write(source, triangleDocument());
    const target = join(dir, 'deep', 'nested', 'PRP_Chair_01.glb');
    await (await createGltfTransformOptimizer()).run({ source, target, category: 'PRP' });
    expect((await stat(target)).isFile()).toBe(true);
  });

  it('reports a corrupt source as a readable error', async () => {
    const source = join(dir, 'broken.glb');
    await rm(source, { force: true });
    const optimizer = await createGltfTransformOptimizer();
    await expect(optimizer.run({
      source, target: join(dir, 'out.glb'), category: 'PRP',
    })).rejects.toThrow(/broken\.glb/);
  });
});
```

- [ ] **Step 2: Implémenter**

`packages/editor-server/src/assets/optimizer.ts` :

```ts
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { type Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, draco, prune, textureCompress } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import type { AssetCategory, AssetMetadata, Vec3 } from '../types.js';
import { TEXTURE_LIMITS } from './naming.js';

export interface OptimizeRequest {
  source: string;
  target: string;
  category: AssetCategory;
}

/**
 * The seam between the pipeline and gltf-transform.
 * Everything downstream depends on this interface, never on the library, so the
 * pipeline is testable without touching a real .glb.
 */
export interface AssetOptimizer {
  run(request: OptimizeRequest): Promise<AssetMetadata>;
}

/** Reads the facts the editor needs without re-parsing the file afterwards. */
export function readMetadata(document: Document): AssetMetadata {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  let sawVertex = false;

  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const [tx, ty, tz] = node.getWorldTranslation();

    for (const primitive of mesh.listPrimitives()) {
      const indices = primitive.getIndices();
      const position = primitive.getAttribute('POSITION');
      if (!position) continue;

      // Only triangle modes contribute triangles; mode 4 is TRIANGLES, which is
      // what the .glb export convention produces.
      const count = indices ? indices.getCount() : position.getCount();
      if (primitive.getMode() === 4) triangles += Math.floor(count / 3);

      const vertex = [0, 0, 0];
      for (let i = 0; i < position.getCount(); i++) {
        position.getElement(i, vertex);
        const world: Vec3 = [
          (vertex[0] ?? 0) + tx, (vertex[1] ?? 0) + ty, (vertex[2] ?? 0) + tz,
        ];
        for (let axis = 0; axis < 3; axis++) {
          const value = world[axis] as number;
          if (value < (min[axis] as number)) min[axis] = value;
          if (value > (max[axis] as number)) max[axis] = value;
        }
        sawVertex = true;
      }
    }
  }

  const animations = document.getRoot().listAnimations()
    .map((a) => a.getName())
    .sort();

  // A document with no geometry has no meaningful box; Infinity would poison
  // every consumer that tries to frame the asset in a viewport.
  if (!sawVertex) {
    return { bounds: { min: [0, 0, 0], max: [0, 0, 0] }, animations, triangles };
  }
  return { bounds: { min, max }, animations, triangles };
}

/**
 * The real optimizer: Draco compression, per-category texture ceiling, and a
 * purge of everything the runtime will never read.
 *
 * Not unit tested beyond the happy path — it is an adapter over a library, and
 * the library's own behaviour is not ours to re-test.
 */
export async function createGltfTransformOptimizer(): Promise<AssetOptimizer> {
  // Draco's encoder initializes asynchronously; done once, at server boot,
  // rather than per asset.
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.encoder': await draco3d.createEncoderModule(),
    });

  return {
    async run({ source, target, category }: OptimizeRequest): Promise<AssetMetadata> {
      let document: Document;
      try {
        document = await io.read(source);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`failed to read asset "${source}": ${message}`, { cause });
      }

      const limit = TEXTURE_LIMITS[category];
      await document.transform(
        // Order matters: prune and dedup first so compression never spends time
        // on data that is about to be deleted.
        prune(),
        dedup(),
        textureCompress({ encoder: sharp, resize: [limit, limit] }),
        draco(),
      );

      // Metadata is read after the transform, so the numbers describe what the
      // runtime will actually load, not what the artist exported.
      const metadata = readMetadata(document);

      await mkdir(dirname(target), { recursive: true });
      await io.write(target, document);
      return metadata;
    },
  };
}
```

> **Note d'exécution :** la fabrique est `async` parce que l'encodeur Draco s'initialise en asynchrone. Si la version installée de `NodeIO.registerDependencies` accepte directement la promesse, on peut la rendre synchrone — mais l'inverse (découvrir à l'exécution qu'il fallait `await`) coûte un debug pénible, donc on prend d'emblée la forme qui marche dans les deux cas. Le contrat `AssetOptimizer` ne dépend pas de ce choix.

- [ ] **Step 3: Vérifier**

Run: `pnpm --filter @nne/editor-server test`
Attendu : tout passe. Si le test d'optimisation réelle dépasse le timeout, c'est l'initialisation de Draco au premier appel : c'est ce que couvre le `testTimeout: 20_000` de la Task 1.

- [ ] **Step 4: Commit**

```bash
git add packages/editor-server/src/assets/optimizer.ts packages/editor-server/tests/optimizer.test.ts
git commit -m "feat(editor-server): optimiseur gltf-transform et extraction des metadonnees"
```

---

### Task 7: Le pipeline d'import et le manifeste de cache

**Files:**
- Create: `packages/editor-server/src/assets/pipeline.ts`
- Test: `packages/editor-server/tests/pipeline.test.ts`

**Interfaces:**
- Consumes: `ProjectPaths`, `containedJoin`, `toPosix` (Task 2), `writeAtomic` (Task 3), `categoryOf`/`validateAssetPath` (Task 5), `AssetOptimizer` (Task 6), `AssetEntry` (Task 1), `HttpError` (Task 4).
- Produces: `class AssetPipeline` avec `importAsset`, `removeAsset`, `entries`, `entry`, `scanAll`, `setThumbnail`.

Le manifeste `.cache/assets.json` est la mémoire du pipeline : il évite de réoptimiser un fichier inchangé au démarrage, ce qui fait la différence entre un serveur qui démarre en une seconde et un qui recompresse deux cents assets à chaque lancement. La clé de fraîcheur est `(mtimeMs, size)` — pas un hash, qui coûterait une lecture complète de chaque fichier pour économiser une réoptimisation rare.

Le manifeste reste entièrement dérivé : le perdre coûte une réoptimisation, jamais une donnée.

- [ ] **Step 1: Écrire les tests en échec**

`packages/editor-server/tests/pipeline.test.ts` :

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveProject } from '../src/paths.js';
import { AssetPipeline } from '../src/assets/pipeline.js';
import type { AssetMetadata } from '../src/types.js';
import type { AssetOptimizer, OptimizeRequest } from '../src/assets/optimizer.js';

const metadata: AssetMetadata = {
  bounds: { min: [0, 0, 0], max: [1, 1, 1] },
  animations: ['Idle'],
  triangles: 12,
};

/** Records every call and writes a stub file, so the pipeline is tested alone. */
function fakeOptimizer() {
  const calls: OptimizeRequest[] = [];
  const optimizer: AssetOptimizer = {
    async run(request) {
      calls.push(request);
      await mkdir(join(request.target, '..'), { recursive: true });
      await writeFile(request.target, 'optimized');
      return metadata;
    },
  };
  return { calls, optimizer };
}

describe('AssetPipeline', () => {
  let dir: string;
  let pipeline: AssetPipeline;
  let fake: ReturnType<typeof fakeOptimizer>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nne-pipeline-'));
    await mkdir(join(dir, 'assets', 'props'), { recursive: true });
    fake = fakeOptimizer();
    pipeline = new AssetPipeline(resolveProject(dir), fake.optimizer);
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  async function writeAsset(rel: string, content = 'source'): Promise<void> {
    const file = join(dir, 'assets', rel);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, content);
  }

  describe('importAsset', () => {
    it('optimizes into the cache and records an entry', async () => {
      await writeAsset('props/PRP_Chair_01.glb');
      const entry = await pipeline.importAsset('props/PRP_Chair_01.glb');

      expect(entry.category).toBe('PRP');
      expect(entry.cached).toBe('assets/props/PRP_Chair_01.glb');
      expect(entry.metadata).toEqual(metadata);
      expect(entry.thumbnail).toBeNull();
      expect(await readFile(join(dir, '.cache', entry.cached), 'utf8')).toBe('optimized');
    });

    it('passes the category to the optimizer so texture limits apply', async () => {
      await writeAsset('chars/CHR_Hero.glb');
      await pipeline.importAsset('chars/CHR_Hero.glb');
      expect(fake.calls[0]?.category).toBe('CHR');
    });

    it('refuses an asset that breaks the naming convention', async () => {
      await writeAsset('props/Chair.glb');
      await expect(pipeline.importAsset('props/Chair.glb')).rejects.toMatchObject({ status: 400 });
      expect(fake.calls).toHaveLength(0);
    });

    it('refuses a path that escapes the assets folder', async () => {
      await expect(pipeline.importAsset('../../etc/passwd')).rejects.toThrow(/escapes/);
    });

    it('reports a missing source as 404', async () => {
      await expect(pipeline.importAsset('props/PRP_Ghost.glb')).rejects.toMatchObject({ status: 404 });
    });

    it('persists the manifest so a new pipeline sees the entry', async () => {
      await writeAsset('props/PRP_Chair_01.glb');
      await pipeline.importAsset('props/PRP_Chair_01.glb');

      const reopened = new AssetPipeline(resolveProject(dir), fake.optimizer);
      expect((await reopened.entries())).toHaveLength(1);
    });

    it('uses posix separators in the manifest whatever the platform', async () => {
      await writeAsset('props/PRP_Chair_01.glb');
      const entry = await pipeline.importAsset('props\\PRP_Chair_01.glb');
      expect(entry.path).toBe('props/PRP_Chair_01.glb');
    });
  });

  describe('scanAll', () => {
    it('imports every asset found under assets/', async () => {
      await writeAsset('props/PRP_Chair_01.glb');
      await writeAsset('chars/CHR_Hero.glb');
      const entries = await pipeline.scanAll();
      expect(entries.map((e) => e.path).sort())
        .toEqual(['chars/CHR_Hero.glb', 'props/PRP_Chair_01.glb']);
    });

    it('skips an unchanged asset on the second scan', async () => {
      await writeAsset('props/PRP_Chair_01.glb');
      await pipeline.scanAll();
      expect(fake.calls).toHaveLength(1);
      await pipeline.scanAll();
      expect(fake.calls).toHaveLength(1);
    });

    it('re-optimizes an asset whose content changed', async () => {
      await writeAsset('props/PRP_Chair_01.glb', 'source');
      await pipeline.scanAll();
      await writeAsset('props/PRP_Chair_01.glb', 'a much longer source than before');
      await pipeline.scanAll();
      expect(fake.calls).toHaveLength(2);
    });

    it('re-optimizes an asset that was touched without changing size', async () => {
      await writeAsset('props/PRP_Chair_01.glb', 'source');
      await pipeline.scanAll();
      const later = new Date(Date.now() + 60_000);
      await utimes(join(dir, 'assets', 'props', 'PRP_Chair_01.glb'), later, later);
      await pipeline.scanAll();
      expect(fake.calls).toHaveLength(2);
    });

    it('re-optimizes when the cached file is gone even if the source is unchanged', async () => {
      await writeAsset('props/PRP_Chair_01.glb');
      await pipeline.scanAll();
      await rm(join(dir, '.cache', 'assets', 'props', 'PRP_Chair_01.glb'));
      await pipeline.scanAll();
      expect(fake.calls).toHaveLength(2);
    });

    it('drops entries whose source disappeared', async () => {
      await writeAsset('props/PRP_Chair_01.glb');
      await pipeline.scanAll();
      await rm(join(dir, 'assets', 'props', 'PRP_Chair_01.glb'));
      expect(await pipeline.scanAll()).toEqual([]);
    });

    it('reports a failing asset without aborting the whole scan', async () => {
      await writeAsset('props/PRP_Chair_01.glb');
      await writeAsset('props/PRP_Broken.glb');
      const failing: AssetOptimizer = {
        async run(request) {
          if (request.source.includes('Broken')) throw new Error('boom');
          return fake.optimizer.run(request);
        },
      };
      const onError = vi.fn();
      const p = new AssetPipeline(resolveProject(dir), failing);
      const entries = await p.scanAll(onError);

      expect(entries.map((e) => e.path)).toEqual(['props/PRP_Chair_01.glb']);
      expect(onError).toHaveBeenCalledWith('props/PRP_Broken.glb', expect.stringContaining('boom'));
    });

    it('returns an empty list when assets/ does not exist', async () => {
      await rm(join(dir, 'assets'), { recursive: true, force: true });
      expect(await pipeline.scanAll()).toEqual([]);
    });

    it('ignores non-glb files instead of failing the scan', async () => {
      await writeAsset('props/PRP_Chair_01.glb');
      await writeAsset('props/notes.txt');
      expect((await pipeline.scanAll()).map((e) => e.path)).toEqual(['props/PRP_Chair_01.glb']);
    });
  });

  describe('removeAsset', () => {
    it('drops the entry and the cached file', async () => {
      await writeAsset('props/PRP_Chair_01.glb');
      const entry = await pipeline.importAsset('props/PRP_Chair_01.glb');
      await pipeline.removeAsset('props/PRP_Chair_01.glb');

      expect(await pipeline.entries()).toEqual([]);
      await expect(readFile(join(dir, '.cache', entry.cached))).rejects.toThrow();
    });

    it('is a no-op for an unknown asset', async () => {
      await expect(pipeline.removeAsset('props/PRP_Nope.glb')).resolves.toBeUndefined();
    });
  });

  describe('setThumbnail', () => {
    it('stores the image and points the entry at it', async () => {
      await writeAsset('props/PRP_Chair_01.glb');
      await pipeline.importAsset('props/PRP_Chair_01.glb');
      const entry = await pipeline.setThumbnail(
        'props/PRP_Chair_01.glb', new Uint8Array([137, 80, 78, 71]),
      );

      expect(entry.thumbnail).toBe('thumbnails/props/PRP_Chair_01.png');
      expect(await readFile(join(dir, '.cache', entry.thumbnail as string)))
        .toEqual(Buffer.from([137, 80, 78, 71]));
    });

    it('refuses a thumbnail for an unknown asset', async () => {
      await expect(pipeline.setThumbnail('props/PRP_Nope.glb', new Uint8Array()))
        .rejects.toMatchObject({ status: 404 });
    });

    it('survives a re-import: the thumbnail is not lost', async () => {
      await writeAsset('props/PRP_Chair_01.glb');
      await pipeline.importAsset('props/PRP_Chair_01.glb');
      await pipeline.setThumbnail('props/PRP_Chair_01.glb', new Uint8Array([1]));
      await writeAsset('props/PRP_Chair_01.glb', 'changed content here');
      const entry = await pipeline.importAsset('props/PRP_Chair_01.glb');
      expect(entry.thumbnail).toBe('thumbnails/props/PRP_Chair_01.png');
    });
  });
});
```

- [ ] **Step 2: Implémenter**

`packages/editor-server/src/assets/pipeline.ts` :

```ts
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { writeAtomic } from '../atomic.js';
import { containedJoin, toPosix, type ProjectPaths } from '../paths.js';
import { HttpError } from '../project-store.js';
import type { AssetEntry } from '../types.js';
import { categoryOf, validateAssetPath } from './naming.js';
import type { AssetOptimizer } from './optimizer.js';

/** Called per failing asset during a scan, so one bad file does not stop the rest. */
export type ScanErrorHandler = (path: string, message: string) => void;

const MANIFEST = 'assets.json';

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

/**
 * Owns `.cache/`: optimizes sources into it, and remembers what it optimized.
 *
 * The manifest is pure derived state. Deleting `.cache/` costs a re-optimization
 * pass and nothing else, which is what makes the cache safe to gitignore.
 */
export class AssetPipeline {
  private manifest: Map<string, AssetEntry> | undefined;

  constructor(
    private readonly paths: ProjectPaths,
    private readonly optimizer: AssetOptimizer,
  ) {}

  async entries(): Promise<AssetEntry[]> {
    const manifest = await this.load();
    return [...manifest.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  async entry(path: string): Promise<AssetEntry | undefined> {
    return (await this.load()).get(toPosix(path));
  }

  /** Optimizes one asset and records it, replacing any previous entry. */
  async importAsset(relPath: string): Promise<AssetEntry> {
    const path = toPosix(relPath);
    const problems = validateAssetPath(path);
    if (problems.length > 0) {
      throw new HttpError(400, `asset "${path}" breaks the naming convention:\n  ${problems.join('\n  ')}`);
    }
    const category = categoryOf(path);
    if (category === null) throw new HttpError(400, `asset "${path}" has no category`);

    const source = containedJoin(this.paths.assets, path);
    let info;
    try {
      info = await stat(source);
    } catch (error) {
      if (isMissing(error)) throw new HttpError(404, `no asset at "${path}"`);
      throw error;
    }

    const cached = `assets/${path}`;
    const metadata = await this.optimizer.run({
      source,
      target: containedJoin(this.paths.cache, cached),
      category,
    });

    const manifest = await this.load();
    const entry: AssetEntry = {
      path,
      category,
      cached,
      // A re-import must not lose a thumbnail the editor already rendered.
      thumbnail: manifest.get(path)?.thumbnail ?? null,
      metadata,
      sourceMtimeMs: info.mtimeMs,
      sourceSize: info.size,
    };
    manifest.set(path, entry);
    await this.save();
    return entry;
  }

  async removeAsset(relPath: string): Promise<void> {
    const path = toPosix(relPath);
    const manifest = await this.load();
    const entry = manifest.get(path);
    if (!entry) return;

    manifest.delete(path);
    await rm(containedJoin(this.paths.cache, entry.cached), { force: true });
    if (entry.thumbnail) {
      await rm(containedJoin(this.paths.cache, entry.thumbnail), { force: true });
    }
    await this.save();
  }

  /** Brings the cache in line with `assets/`, doing the least work it can. */
  async scanAll(onError?: ScanErrorHandler): Promise<AssetEntry[]> {
    const manifest = await this.load();
    const found = await this.walk();
    let dirty = false;

    for (const path of found) {
      // The linter runs on every scan, not only on upload: a file copied into
      // assets/ by hand goes through the same gate as one that was uploaded.
      if (validateAssetPath(path).length > 0) {
        onError?.(path, `"${path}" breaks the naming convention`);
        continue;
      }
      if (await this.isFresh(manifest.get(path))) continue;
      try {
        await this.importAsset(path);
      } catch (cause) {
        onError?.(path, cause instanceof Error ? cause.message : String(cause));
      }
    }

    for (const path of [...manifest.keys()]) {
      if (found.has(path)) continue;
      manifest.delete(path);
      dirty = true;
    }
    if (dirty) await this.save();
    return this.entries();
  }

  async setThumbnail(relPath: string, image: Uint8Array): Promise<AssetEntry> {
    const path = toPosix(relPath);
    const manifest = await this.load();
    const entry = manifest.get(path);
    if (!entry) throw new HttpError(404, `no asset at "${path}"`);

    const thumbnail = `thumbnails/${path.replace(/\.glb$/i, '')}.png`;
    await writeAtomic(containedJoin(this.paths.cache, thumbnail), image);
    const updated = { ...entry, thumbnail };
    manifest.set(path, updated);
    await this.save();
    return updated;
  }

  /**
   * Fresh means: same mtime, same size, and the cached file still exists.
   * mtime alone misses a restore from backup; size alone misses an edit that
   * kept the byte count; and both miss someone deleting `.cache/` by hand.
   */
  private async isFresh(entry: AssetEntry | undefined): Promise<boolean> {
    if (!entry) return false;
    try {
      const source = await stat(containedJoin(this.paths.assets, entry.path));
      if (source.mtimeMs !== entry.sourceMtimeMs || source.size !== entry.sourceSize) return false;
      await stat(containedJoin(this.paths.cache, entry.cached));
      return true;
    } catch {
      return false;
    }
  }

  /** Every .glb under assets/, as posix paths relative to it. */
  private async walk(): Promise<Set<string>> {
    const out = new Set<string>();
    const visit = async (dir: string, prefix: string): Promise<void> => {
      let listing;
      try {
        listing = await readdir(dir, { withFileTypes: true });
      } catch (error) {
        if (isMissing(error)) return;
        throw error;
      }
      for (const item of listing) {
        const rel = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.isDirectory()) await visit(join(dir, item.name), rel);
        else if (item.name.toLowerCase().endsWith('.glb')) out.add(rel);
      }
    };
    await visit(this.paths.assets, '');
    return out;
  }

  private async load(): Promise<Map<string, AssetEntry>> {
    if (this.manifest) return this.manifest;
    let entries: AssetEntry[] = [];
    try {
      const text = await readFile(join(this.paths.cache, MANIFEST), 'utf8');
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) entries = parsed as AssetEntry[];
    } catch {
      // A missing or corrupt manifest is not an error: it is derived state, and
      // the next scan rebuilds it from the sources.
      entries = [];
    }
    this.manifest = new Map(entries.map((e) => [e.path, e]));
    return this.manifest;
  }

  private async save(): Promise<void> {
    const entries = await this.entries();
    await writeAtomic(
      join(this.paths.cache, MANIFEST),
      `${JSON.stringify(entries, null, 2)}\n`,
    );
  }
}
```

- [ ] **Step 3: Vérifier**

Run: `pnpm --filter @nne/editor-server test`
Attendu : tout passe.

- [ ] **Step 4: Vérifier la fraîcheur par mutation**

1. Dans `isFresh`, retirer la comparaison de `size` → le test « content changed » doit échouer.
2. Retirer la comparaison de `mtimeMs` → le test « touched without changing size » doit échouer.
3. Retirer le `stat` du fichier caché → le test « cached file is gone » doit échouer.

Restaurer après chaque mutation.

- [ ] **Step 5: Commit**

```bash
git add packages/editor-server/src/assets/pipeline.ts packages/editor-server/tests/pipeline.test.ts
git commit -m "feat(editor-server): pipeline d'import et manifeste de cache"
```

---

### Task 8: Le graphe d'assets et le build

**Files:**
- Create: `packages/editor-server/src/build.ts`
- Test: `packages/editor-server/tests/build.test.ts`

**Interfaces:**
- Consumes: `ProjectStore` (Task 4), `AssetPipeline` (Task 7), `ProjectPaths`/`containedJoin` (Task 2), `writeAtomic` (Task 3), `ComponentRegistry`/`SceneFile` de `@nne/core`.
- Produces: `referencedAssets(scenes: SceneFile[], registry: ComponentRegistry): string[]`, `interface PlayerBundler`, `interface BuildRequest`, `interface BuildResult`, `build(options: BuildOptions): Promise<BuildResult>`.

`referencedAssets` est le cœur intéressant : au lieu de coder en dur « le champ `asset` du composant `Mesh` », il interroge le registre pour trouver **tous** les champs de type `asset`, quel que soit le composant. Un composant custom ajouté par un projet voit ses assets embarqués sans qu'on touche au build. C'est exactement ce que le registre de schémas était censé rendre possible.

- [ ] **Step 1: Écrire les tests en échec**

`packages/editor-server/tests/build.test.ts` :

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ComponentRegistry, registerBuiltins, type SceneFile } from '@nne/core';
import { resolveProject } from '../src/paths.js';
import { ProjectStore } from '../src/project-store.js';
import { AssetPipeline } from '../src/assets/pipeline.js';
import { build, referencedAssets } from '../src/build.js';
import type { AssetOptimizer } from '../src/assets/optimizer.js';

function registry(): ComponentRegistry {
  const r = new ComponentRegistry();
  registerBuiltins(r);
  return r;
}

function sceneWith(assets: (string | null)[]): SceneFile {
  return {
    version: 1,
    name: 'Scene_01',
    entities: assets.map((asset, i) => ({
      id: i + 1,
      name: `E${i}`,
      components: { Mesh: { asset, castShadow: true } },
    })),
  };
}

describe('referencedAssets', () => {
  it('collects the asset of every Mesh', () => {
    expect(referencedAssets([sceneWith(['a.glb', 'b.glb'])], registry()))
      .toEqual(['a.glb', 'b.glb']);
  });

  it('deduplicates across entities and scenes', () => {
    const scenes = [sceneWith(['a.glb', 'a.glb']), sceneWith(['a.glb'])];
    expect(referencedAssets(scenes, registry())).toEqual(['a.glb']);
  });

  it('ignores null assets', () => {
    expect(referencedAssets([sceneWith(['a.glb', null])], registry())).toEqual(['a.glb']);
  });

  it('finds asset fields on any component, not just Mesh', () => {
    const r = registry();
    r.define('Decal', { texture: { type: 'asset', default: null, accept: '.glb' } });
    const scene: SceneFile = {
      version: 1,
      name: 'S',
      entities: [{ id: 1, name: 'D', components: { Decal: { texture: 'd.glb' } } }],
    };
    expect(referencedAssets([scene], r)).toEqual(['d.glb']);
  });

  it('ignores components the registry does not know', () => {
    const scene: SceneFile = {
      version: 1,
      name: 'S',
      entities: [{ id: 1, name: 'X', components: { Unknown: { asset: 'x.glb' } } }],
    };
    expect(referencedAssets([scene], registry())).toEqual([]);
  });

  it('ignores a non-string value in an asset field', () => {
    const scene: SceneFile = {
      version: 1,
      name: 'S',
      entities: [{ id: 1, name: 'X', components: { Mesh: { asset: 42, castShadow: true } } }],
    };
    expect(referencedAssets([scene], registry())).toEqual([]);
  });

  it('returns a sorted list, so a build is reproducible', () => {
    expect(referencedAssets([sceneWith(['b.glb', 'a.glb'])], registry()))
      .toEqual(['a.glb', 'b.glb']);
  });
});

describe('build', () => {
  let dir: string;
  let out: string;
  let store: ProjectStore;
  let pipeline: AssetPipeline;

  const optimizer: AssetOptimizer = {
    async run({ target }) {
      await mkdir(join(target, '..'), { recursive: true });
      await writeFile(target, 'optimized');
      return { bounds: { min: [0, 0, 0], max: [1, 1, 1] }, animations: [], triangles: 1 };
    },
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nne-build-'));
    out = join(dir, 'dist');
    const paths = resolveProject(dir);
    store = new ProjectStore(paths, registry());
    pipeline = new AssetPipeline(paths, optimizer);
    await store.init('demo');
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  async function addAsset(rel: string): Promise<void> {
    const file = join(dir, 'assets', rel);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, 'source');
    await pipeline.importAsset(rel);
  }

  it('copies the scenes and only the referenced assets', async () => {
    await addAsset('props/PRP_Used.glb');
    await addAsset('props/PRP_Unused.glb');
    await store.writeScene('Scene_01', sceneWith(['props/PRP_Used.glb']));

    const result = await build({
      paths: resolveProject(dir), store, pipeline, registry: registry(), request: { outDir: out },
    });

    expect(result.assets).toEqual(['props/PRP_Used.glb']);
    expect(await readFile(join(out, 'scenes', 'Scene_01.json'), 'utf8')).toContain('PRP_Used');
    expect(await readFile(join(out, 'assets', 'props', 'PRP_Used.glb'), 'utf8')).toBe('optimized');
    await expect(readFile(join(out, 'assets', 'props', 'PRP_Unused.glb'))).rejects.toThrow();
  });

  it('copies from the cache, never from the sources', async () => {
    await addAsset('props/PRP_Used.glb');
    await store.writeScene('Scene_01', sceneWith(['props/PRP_Used.glb']));
    await build({
      paths: resolveProject(dir), store, pipeline, registry: registry(), request: { outDir: out },
    });
    // "source" is what the raw file says; "optimized" is what the cache says.
    expect(await readFile(join(out, 'assets', 'props', 'PRP_Used.glb'), 'utf8')).toBe('optimized');
  });

  it('writes a manifest listing the scenes and the start scene', async () => {
    await store.writeProject({ name: 'demo', version: 1, startScene: 'Scene_01' });
    await store.writeScene('Scene_01', sceneWith([]));
    await build({
      paths: resolveProject(dir), store, pipeline, registry: registry(), request: { outDir: out },
    });
    const manifest = JSON.parse(await readFile(join(out, 'project.json'), 'utf8')) as unknown;
    expect(manifest).toMatchObject({ name: 'demo', startScene: 'Scene_01', scenes: ['Scene_01'] });
  });

  it('fails when a scene references an asset that is not in the cache', async () => {
    await store.writeScene('Scene_01', sceneWith(['props/PRP_Ghost.glb']));
    await expect(build({
      paths: resolveProject(dir), store, pipeline, registry: registry(), request: { outDir: out },
    })).rejects.toThrow(/PRP_Ghost/);
  });

  it('empties a previous build instead of merging into it', async () => {
    await mkdir(out, { recursive: true });
    await writeFile(join(out, 'stale.txt'), 'old');
    await store.writeScene('Scene_01', sceneWith([]));
    await build({
      paths: resolveProject(dir), store, pipeline, registry: registry(), request: { outDir: out },
    });
    await expect(readFile(join(out, 'stale.txt'))).rejects.toThrow();
  });

  it('refuses to build into the project root', async () => {
    await expect(build({
      paths: resolveProject(dir), store, pipeline, registry: registry(), request: { outDir: dir },
    })).rejects.toThrow(/refus/i);
  });

  it('runs the bundler and copies its output', async () => {
    await store.writeScene('Scene_01', sceneWith([]));
    const bundler = {
      async bundle(target: string): Promise<void> {
        await mkdir(target, { recursive: true });
        await writeFile(join(target, 'index.html'), '<html></html>');
      },
    };
    await build({
      paths: resolveProject(dir), store, pipeline, registry: registry(),
      request: { outDir: out }, bundler,
    });
    expect(await readFile(join(out, 'index.html'), 'utf8')).toBe('<html></html>');
  });

  it('builds without a bundler, for a data-only export', async () => {
    await store.writeScene('Scene_01', sceneWith([]));
    const result = await build({
      paths: resolveProject(dir), store, pipeline, registry: registry(), request: { outDir: out },
    });
    expect(result.scenes).toEqual(['Scene_01']);
  });
});
```

- [ ] **Step 2: Implémenter**

`packages/editor-server/src/build.ts` :

```ts
import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { ComponentRegistry, SceneFile } from '@nne/core';
import { writeAtomic } from './atomic.js';
import { containedJoin, type ProjectPaths } from './paths.js';
import type { AssetPipeline } from './assets/pipeline.js';
import type { ProjectStore } from './project-store.js';

/** Compiles the player. Injectable so a build test never has to run Vite. */
export interface PlayerBundler {
  bundle(outDir: string): Promise<void>;
}

export interface BuildRequest {
  outDir: string;
}

export interface BuildOptions {
  paths: ProjectPaths;
  store: ProjectStore;
  pipeline: AssetPipeline;
  registry: ComponentRegistry;
  request: BuildRequest;
  bundler?: PlayerBundler;
}

export interface BuildResult {
  outDir: string;
  scenes: string[];
  assets: string[];
}

/**
 * Every asset path any scene refers to, deduplicated and sorted.
 *
 * Driven by the registry rather than by a hard-coded knowledge of `Mesh.asset`:
 * a project that defines its own component with an `asset` field gets its files
 * shipped without a line changing here. That is what the schema registry is for.
 */
export function referencedAssets(scenes: SceneFile[], registry: ComponentRegistry): string[] {
  const assetFields = new Map<string, string[]>();
  for (const type of registry.list()) {
    const schema = registry.get(type);
    if (!schema) continue;
    const fields = Object.entries(schema)
      .filter(([, spec]) => spec.type === 'asset')
      .map(([field]) => field);
    if (fields.length > 0) assetFields.set(type, fields);
  }

  const found = new Set<string>();
  for (const scene of scenes) {
    for (const entity of scene.entities) {
      for (const [type, data] of Object.entries(entity.components)) {
        for (const field of assetFields.get(type) ?? []) {
          const value = (data as Record<string, unknown>)[field];
          // null is the normal "no asset yet" value; anything non-string is a
          // scene that lied, and validation is not this function's job.
          if (typeof value === 'string' && value.length > 0) found.add(value);
        }
      }
    }
  }
  return [...found].sort();
}

/**
 * Produces a self-contained static folder: the compiled player, the scenes, and
 * only the assets those scenes actually reach. Nothing of the editor ships.
 */
export async function build(options: BuildOptions): Promise<BuildResult> {
  const { paths, store, pipeline, registry, request, bundler } = options;
  const outDir = resolve(request.outDir);

  // The build empties its target, so pointing it at the project root would
  // delete the sources. Refused outright rather than made clever. A subfolder
  // such as <root>/dist stays allowed: it is the normal case.
  if (outDir === paths.root) {
    throw new Error(`refus de builder dans la racine du projet: ${outDir}`);
  }
  for (const reserved of [paths.assets, paths.scenes, paths.cache]) {
    if (outDir === reserved) {
      throw new Error(`refus de builder dans un dossier du projet: ${outDir}`);
    }
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  if (bundler) await bundler.bundle(outDir);

  const project = await store.readProject();
  const names = await store.listScenes();
  const scenes: SceneFile[] = [];
  for (const name of names) {
    const scene = await store.readScene(name);
    scenes.push(scene);
    await writeAtomic(join(outDir, 'scenes', `${name}.json`), JSON.stringify(scene));
  }

  const assets = referencedAssets(scenes, registry);
  for (const asset of assets) {
    const entry = await pipeline.entry(asset);
    if (!entry) {
      throw new Error(`scene references "${asset}", which is not in the asset cache`);
    }
    const from = containedJoin(paths.cache, entry.cached);
    try {
      await stat(from);
    } catch {
      throw new Error(`cached file for "${asset}" is missing; run a scan before building`);
    }
    const to = join(outDir, 'assets', asset);
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);
  }

  await writeAtomic(
    join(outDir, 'project.json'),
    `${JSON.stringify({ name: project.name, startScene: project.startScene, scenes: names }, null, 2)}\n`,
  );

  return { outDir, scenes: names, assets };
}
```

> **Note d'exécution :** `referencedAssets` s'appuie sur `ComponentRegistry.list()` et `.get(type)`, vérifiés présents dans `packages/core/src/registry.ts` au moment de l'écriture de ce plan. C'est la seule dépendance de `editor-server` à l'API de `core` au-delà de `validateScene`/`stringifyScene`. Ne pas utiliser `registry.validate()` ici : le build n'a pas à revalider une scène que le store a déjà refusée si elle était invalide.

- [ ] **Step 3: Vérifier**

Run: `pnpm --filter @nne/editor-server test`
Attendu : tout passe.

- [ ] **Step 4: Commit**

```bash
git add packages/editor-server/src/build.ts packages/editor-server/tests/build.test.ts
git commit -m "feat(editor-server): graphe d'assets deduit du registre et build statique"
```

---

### Task 9: Le watcher

**Files:**
- Create: `packages/editor-server/src/watcher.ts`
- Test: `packages/editor-server/tests/watcher.test.ts`

**Interfaces:**
- Consumes: `ProjectPaths` (Task 2), `AssetPipeline` (Task 7), `ProjectEvent` (Task 1).
- Produces: `createWatcher(options: WatcherOptions): Promise<ProjectWatcher>`, `interface ProjectWatcher { close(): Promise<void> }`.

Le watcher est la source du hot reload : un `.glb` réenregistré depuis Blender est réoptimisé, puis l'événement part vers l'éditeur. Deux pièges à traiter ici : Blender écrit en plusieurs passes, donc il faut attendre que le fichier soit stable (`awaitWriteFinish`) ; et une réoptimisation qui échoue ne doit pas tuer le watcher, sinon un export raté condamne la session.

- [ ] **Step 1: Écrire les tests en échec**

`packages/editor-server/tests/watcher.test.ts` :

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveProject } from '../src/paths.js';
import { AssetPipeline } from '../src/assets/pipeline.js';
import { createWatcher, type ProjectWatcher } from '../src/watcher.js';
import type { AssetOptimizer } from '../src/assets/optimizer.js';
import type { ProjectEvent } from '../src/types.js';

const optimizer: AssetOptimizer = {
  async run({ target }) {
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, 'optimized');
    return { bounds: { min: [0, 0, 0], max: [0, 0, 0] }, animations: [], triangles: 0 };
  },
};

/** Waits for a matching event, so tests never sleep on a fixed delay. */
function nextEvent(events: ProjectEvent[], match: (e: ProjectEvent) => boolean): Promise<ProjectEvent> {
  return vi.waitFor(() => {
    const found = events.find(match);
    if (!found) throw new Error(`no matching event yet in ${JSON.stringify(events)}`);
    return found;
  }, { timeout: 10_000, interval: 50 });
}

describe('createWatcher', () => {
  let dir: string;
  let watcher: ProjectWatcher;
  let events: ProjectEvent[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nne-watch-'));
    await mkdir(join(dir, 'assets', 'props'), { recursive: true });
    await mkdir(join(dir, 'scenes'), { recursive: true });
    events = [];
    const paths = resolveProject(dir);
    watcher = await createWatcher({
      paths,
      pipeline: new AssetPipeline(paths, optimizer),
      emit: (event) => events.push(event),
    });
  });
  afterEach(async () => {
    await watcher.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('emits asset-changed when a .glb appears', async () => {
    await writeFile(join(dir, 'assets', 'props', 'PRP_Chair_01.glb'), 'x');
    const event = await nextEvent(events, (e) => e.type === 'asset-changed');
    expect(event).toMatchObject({ type: 'asset-changed', path: 'props/PRP_Chair_01.glb' });
  });

  it('optimizes into the cache before emitting', async () => {
    await writeFile(join(dir, 'assets', 'props', 'PRP_Chair_01.glb'), 'x');
    const event = await nextEvent(events, (e) => e.type === 'asset-changed');
    expect(event).toMatchObject({ entry: { cached: 'assets/props/PRP_Chair_01.glb' } });
  });

  it('emits asset-removed when a .glb is deleted', async () => {
    const file = join(dir, 'assets', 'props', 'PRP_Chair_01.glb');
    await writeFile(file, 'x');
    await nextEvent(events, (e) => e.type === 'asset-changed');
    await rm(file);
    await nextEvent(events, (e) => e.type === 'asset-removed');
  });

  it('emits asset-failed and keeps watching when an asset breaks the convention', async () => {
    await writeFile(join(dir, 'assets', 'props', 'Chair.glb'), 'x');
    await nextEvent(events, (e) => e.type === 'asset-failed');

    // Still alive: a good asset after a bad one is still processed.
    await writeFile(join(dir, 'assets', 'props', 'PRP_Chair_01.glb'), 'x');
    await nextEvent(events, (e) => e.type === 'asset-changed');
  });

  it('emits scene-changed when a scene file is written', async () => {
    await writeFile(join(dir, 'scenes', 'Scene_01.json'), '{}');
    const event = await nextEvent(events, (e) => e.type === 'scene-changed');
    expect(event).toMatchObject({ type: 'scene-changed', name: 'Scene_01' });
  });

  it('ignores files inside .cache, so its own writes do not loop', async () => {
    await mkdir(join(dir, '.cache'), { recursive: true });
    await writeFile(join(dir, '.cache', 'noise.glb'), 'x');
    await new Promise((r) => setTimeout(r, 500));
    expect(events).toEqual([]);
  });

  it('ignores a non-glb file dropped in assets/', async () => {
    await writeFile(join(dir, 'assets', 'props', 'notes.txt'), 'x');
    await new Promise((r) => setTimeout(r, 500));
    expect(events).toEqual([]);
  });

  it('closes cleanly and stops emitting', async () => {
    await watcher.close();
    await writeFile(join(dir, 'assets', 'props', 'PRP_Late.glb'), 'x');
    await new Promise((r) => setTimeout(r, 500));
    expect(events.filter((e) => e.type === 'asset-changed')).toEqual([]);
  });
});
```

- [ ] **Step 2: Implémenter**

`packages/editor-server/src/watcher.ts` :

```ts
import { relative } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { toPosix, type ProjectPaths } from './paths.js';
import type { AssetPipeline } from './assets/pipeline.js';
import type { ProjectEvent } from './types.js';

export interface WatcherOptions {
  paths: ProjectPaths;
  pipeline: AssetPipeline;
  emit: (event: ProjectEvent) => void;
}

export interface ProjectWatcher {
  close(): Promise<void>;
}

/**
 * Watches `assets/` and `scenes/`, re-optimizing on the way through.
 *
 * `.cache/` is deliberately not watched: the pipeline writes there, and a
 * watcher on its own output is a feedback loop waiting to happen.
 */
export async function createWatcher(options: WatcherOptions): Promise<ProjectWatcher> {
  const { paths, pipeline, emit } = options;
  let closed = false;

  const watcher: FSWatcher = chokidar.watch([paths.assets, paths.scenes], {
    ignoreInitial: true,
    // Blender writes a .glb in several passes; reacting to the first one would
    // hand a truncated file to gltf-transform.
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 50 },
  });

  const assetPath = (file: string): string | null => {
    const rel = toPosix(relative(paths.assets, file));
    if (rel.startsWith('..') || rel.length === 0) return null;
    return rel.toLowerCase().endsWith('.glb') ? rel : null;
  };

  const scenePath = (file: string): string | null => {
    const rel = toPosix(relative(paths.scenes, file));
    if (rel.startsWith('..') || !rel.endsWith('.json') || rel.includes('/')) return null;
    return rel.slice(0, -'.json'.length);
  };

  const onUpsert = async (file: string): Promise<void> => {
    if (closed) return;
    const scene = scenePath(file);
    if (scene !== null) {
      emit({ type: 'scene-changed', name: scene });
      return;
    }
    const asset = assetPath(file);
    if (asset === null) return;
    try {
      const entry = await pipeline.importAsset(asset);
      if (!closed) emit({ type: 'asset-changed', path: asset, entry });
    } catch (cause) {
      // A failed re-optimization must not take the watcher down with it: the
      // artist fixes the export and saves again, and that save must be seen.
      const message = cause instanceof Error ? cause.message : String(cause);
      if (!closed) emit({ type: 'asset-failed', path: asset, message });
    }
  };

  const onRemove = async (file: string): Promise<void> => {
    if (closed) return;
    const asset = assetPath(file);
    if (asset === null) return;
    await pipeline.removeAsset(asset).catch(() => undefined);
    if (!closed) emit({ type: 'asset-removed', path: asset });
  };

  watcher.on('add', (file) => void onUpsert(file));
  watcher.on('change', (file) => void onUpsert(file));
  watcher.on('unlink', (file) => void onRemove(file));

  await new Promise<void>((resolve) => { watcher.once('ready', () => resolve()); });

  return {
    async close(): Promise<void> {
      closed = true;
      await watcher.close();
    },
  };
}
```

- [ ] **Step 3: Vérifier**

Run: `pnpm --filter @nne/editor-server test`
Attendu : tout passe. Les tests de watcher sont les plus lents du package (chokidar + `awaitWriteFinish`) ; c'est attendu.

- [ ] **Step 4: Commit**

```bash
git add packages/editor-server/src/watcher.ts packages/editor-server/tests/watcher.test.ts
git commit -m "feat(editor-server): watcher chokidar avec reoptimisation resiliente"
```

---

### Task 10: L'API HTTP

**Files:**
- Create: `packages/editor-server/src/server.ts`
- Test: `packages/editor-server/tests/server.test.ts`

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: `createServer(options: ServerOptions): EditorServer`, `interface ServerOptions`, `interface EditorServer { listen(port?: number): Promise<number>; close(): Promise<void>; }`.

Les routes ne contiennent pas de logique : elles traduisent une requête en appel de store, et une `HttpError` en statut. Tout ce qui pouvait être testé sans HTTP l'a déjà été ; ce qui se teste ici, c'est le câblage et les codes de retour.

`listen` par défaut sur `127.0.0.1`. C'est une décision de sécurité, pas un détail : le serveur n'a pas d'authentification, donc l'exposer sur le réseau donnerait à quiconque un accès en écriture au dossier projet.

- [ ] **Step 1: Écrire les tests en échec**

`packages/editor-server/tests/server.test.ts` :

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ComponentRegistry, registerBuiltins, type SceneFile } from '@nne/core';
import { resolveProject } from '../src/paths.js';
import { ProjectStore } from '../src/project-store.js';
import { AssetPipeline } from '../src/assets/pipeline.js';
import { createServer, type EditorServer } from '../src/server.js';
import type { AssetOptimizer } from '../src/assets/optimizer.js';

const optimizer: AssetOptimizer = {
  async run({ target }) {
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, 'optimized');
    return { bounds: { min: [0, 0, 0], max: [1, 1, 1] }, animations: [], triangles: 3 };
  },
};

const scene: SceneFile = {
  version: 1,
  name: 'Scene_01',
  entities: [{
    id: 1,
    name: 'Chair',
    components: { Mesh: { asset: 'props/PRP_Chair_01.glb', castShadow: true } },
  }],
};

describe('editor server', () => {
  let dir: string;
  let server: EditorServer;
  let base: string;
  let store: ProjectStore;
  let pipeline: AssetPipeline;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nne-server-'));
    const paths = resolveProject(dir);
    const registry = new ComponentRegistry();
    registerBuiltins(registry);
    store = new ProjectStore(paths, registry);
    pipeline = new AssetPipeline(paths, optimizer);
    await store.init('demo');

    server = createServer({ paths, store, pipeline, registry });
    base = `http://127.0.0.1:${await server.listen(0)}`;
  });
  afterEach(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  describe('GET /api/project', () => {
    it('returns the manifest and the scene list', async () => {
      await store.writeScene('Scene_01', scene);
      const response = await fetch(`${base}/api/project`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        project: { name: 'demo', version: 1 },
        scenes: ['Scene_01'],
      });
    });
  });

  describe('GET /api/scenes/:name', () => {
    it('returns a scene', async () => {
      await store.writeScene('Scene_01', scene);
      const response = await fetch(`${base}/api/scenes/Scene_01`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(scene);
    });

    it('answers 404 for a missing scene', async () => {
      expect((await fetch(`${base}/api/scenes/Nope`)).status).toBe(404);
    });

    it('answers 400 for a name that is not allow-listed', async () => {
      expect((await fetch(`${base}/api/scenes/not%20ok`)).status).toBe(400);
    });

    it('does not serve a file outside the project', async () => {
      const response = await fetch(`${base}/api/scenes/..%2F..%2Fetc%2Fpasswd`);
      expect(response.status).toBe(400);
    });
  });

  describe('PUT /api/scenes/:name', () => {
    it('saves a scene', async () => {
      const response = await fetch(`${base}/api/scenes/Scene_01`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(scene),
      });
      expect(response.status).toBe(204);
      expect(await store.readScene('Scene_01')).toEqual(scene);
    });

    it('answers 400 for an invalid scene and writes nothing', async () => {
      const response = await fetch(`${base}/api/scenes/Scene_01`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: 1, name: 'x', entities: [{ id: 1, components: { Nope: {} } }] }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: expect.stringContaining('Nope') });
      await expect(store.readScene('Scene_01')).rejects.toMatchObject({ status: 404 });
    });

    it('answers 400 for a body that is not JSON', async () => {
      const response = await fetch(`${base}/api/scenes/Scene_01`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: 'not json',
      });
      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/assets', () => {
    it('lists the cached assets with their metadata', async () => {
      await mkdir(join(dir, 'assets', 'props'), { recursive: true });
      await writeFile(join(dir, 'assets', 'props', 'PRP_Chair_01.glb'), 'x');
      await pipeline.scanAll();

      const response = await fetch(`${base}/api/assets`);
      expect(await response.json()).toMatchObject({
        assets: [{ path: 'props/PRP_Chair_01.glb', category: 'PRP', metadata: { triangles: 3 } }],
      });
    });
  });

  describe('cache files', () => {
    it('serves an optimized asset', async () => {
      await mkdir(join(dir, 'assets', 'props'), { recursive: true });
      await writeFile(join(dir, 'assets', 'props', 'PRP_Chair_01.glb'), 'x');
      await pipeline.scanAll();

      const response = await fetch(`${base}/cache/assets/props/PRP_Chair_01.glb`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('optimized');
    });

    it('does not serve a file outside the cache', async () => {
      const response = await fetch(`${base}/cache/..%2F..%2Fproject.json`);
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('POST /api/build', () => {
    it('builds into the requested folder', async () => {
      await store.writeScene('Scene_01', { ...scene, entities: [] });
      const response = await fetch(`${base}/api/build`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outDir: join(dir, 'dist') }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ scenes: ['Scene_01'] });
    });

    it('answers 400 when the build refuses the target', async () => {
      const response = await fetch(`${base}/api/build`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outDir: dir }),
      });
      expect(response.status).toBe(400);
    });
  });

  describe('binding', () => {
    it('listens on loopback only by default', async () => {
      const local = createServer({
        paths: resolveProject(dir), store, pipeline,
        registry: (() => { const r = new ComponentRegistry(); registerBuiltins(r); return r; })(),
      });
      const port = await local.listen(0);
      expect(local.address()?.address).toBe('127.0.0.1');
      expect(port).toBeGreaterThan(0);
      await local.close();
    });
  });

  describe('unknown routes', () => {
    it('answers 404 with a JSON body, not an HTML page', async () => {
      const response = await fetch(`${base}/api/nope`);
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toContain('application/json');
    });
  });
});
```

- [ ] **Step 2: Implémenter**

`packages/editor-server/src/server.ts` :

```ts
import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { ComponentRegistry } from '@nne/core';
import { build, type PlayerBundler } from './build.js';
import { HttpError, type ProjectStore } from './project-store.js';
import type { AssetPipeline } from './assets/pipeline.js';
import type { ProjectPaths } from './paths.js';

export interface ServerOptions {
  paths: ProjectPaths;
  store: ProjectStore;
  pipeline: AssetPipeline;
  registry: ComponentRegistry;
  bundler?: PlayerBundler;
  /** Defaults to loopback. Overriding it exposes an unauthenticated API. */
  host?: string;
}

export interface EditorServer {
  listen(port?: number): Promise<number>;
  close(): Promise<void>;
  address(): AddressInfo | null;
  readonly http: Server;
}

/** Wraps an async handler so a rejection reaches the error middleware. */
function route(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };
}

export function createServer(options: ServerOptions): EditorServer {
  const { paths, store, pipeline, registry, bundler } = options;
  const host = options.host ?? '127.0.0.1';
  const app = express();

  app.use(express.json({ limit: '32mb' }));
  app.use(express.raw({ type: 'image/png', limit: '4mb' }));

  app.get('/api/project', route(async (_req, res) => {
    res.json({ project: await store.readProject(), scenes: await store.listScenes() });
  }));

  app.get('/api/scenes/:name', route(async (req, res) => {
    res.json(await store.readScene(req.params.name));
  }));

  app.put('/api/scenes/:name', route(async (req, res) => {
    await store.writeScene(req.params.name, req.body);
    res.status(204).end();
  }));

  app.get('/api/assets', route(async (_req, res) => {
    res.json({ assets: await pipeline.entries() });
  }));

  app.post('/api/assets/scan', route(async (_req, res) => {
    const problems: { path: string; message: string }[] = [];
    const assets = await pipeline.scanAll((path, message) => problems.push({ path, message }));
    res.json({ assets, problems });
  }));

  app.put('/api/assets/thumbnail', route(async (req, res) => {
    const path = req.query.path;
    if (typeof path !== 'string') throw new HttpError(400, 'missing "path" query parameter');
    res.json(await pipeline.setThumbnail(path, new Uint8Array(req.body as Buffer)));
  }));

  app.post('/api/build', route(async (req, res) => {
    const outDir = (req.body as { outDir?: unknown }).outDir;
    if (typeof outDir !== 'string') throw new HttpError(400, 'missing "outDir"');
    try {
      res.json(await build({ paths, store, pipeline, registry, request: { outDir }, bundler }));
    } catch (cause) {
      // The build's own refusals are client errors, not server faults.
      throw new HttpError(400, cause instanceof Error ? cause.message : String(cause), { cause });
    }
  }));

  // The runtime loads from the cache, never from the sources: only `.cache/` is
  // ever served, and express's static handler does the containment itself.
  app.use('/cache', express.static(paths.cache, { index: false, dotfiles: 'ignore' }));

  app.use((_req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // A malformed JSON body surfaces from express's parser, not from our code.
    const status = error instanceof HttpError ? error.status
      : (error as { type?: string }).type === 'entity.parse.failed' ? 400
      : 500;
    const message = error instanceof Error ? error.message : String(error);
    if (status === 500) console.error('editor-server:', error);
    res.status(status).json({ error: message });
  });

  const http = createHttpServer(app);

  return {
    http,
    address: () => (http.address() as AddressInfo | null),
    listen(port = 5174): Promise<number> {
      return new Promise((resolve, reject) => {
        http.once('error', reject);
        http.listen(port, host, () => {
          const address = http.address() as AddressInfo;
          resolve(address.port);
        });
      });
    },
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        http.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
```

- [ ] **Step 3: Vérifier**

Run: `pnpm --filter @nne/editor-server test && pnpm --filter @nne/editor-server typecheck`
Attendu : tout passe.

- [ ] **Step 4: Commit**

```bash
git add packages/editor-server/src/server.ts packages/editor-server/tests/server.test.ts
git commit -m "feat(editor-server): API HTTP sur le dossier projet"
```

---

### Task 11: Les notifications WebSocket

**Files:**
- Modify: `packages/editor-server/src/server.ts`
- Create: `packages/editor-server/src/notifier.ts`
- Test: `packages/editor-server/tests/notifier.test.ts`

**Interfaces:**
- Consumes: `ProjectEvent` (Task 1), `EditorServer` (Task 10).
- Produces: `createNotifier(server: Server): Notifier`, `interface Notifier { broadcast(event: ProjectEvent): void; close(): Promise<void>; count(): number }`.

Le notifier est branché sur le serveur HTTP existant, pas sur un port séparé : un seul port à retenir, et pas de question de CORS entre les deux.

- [ ] **Step 1: Écrire les tests en échec**

`packages/editor-server/tests/notifier.test.ts` :

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { createNotifier, type Notifier } from '../src/notifier.js';
import type { ProjectEvent } from '../src/types.js';

const event: ProjectEvent = { type: 'scene-changed', name: 'Scene_01' };

describe('createNotifier', () => {
  let http: Server;
  let notifier: Notifier;
  let url: string;

  beforeEach(async () => {
    http = createHttpServer();
    notifier = createNotifier(http);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}/api/watch`;
  });
  afterEach(async () => {
    await notifier.close();
    await new Promise((resolve) => http.close(resolve));
  });

  function connect(path = '/api/watch'): Promise<WebSocket> {
    const socket = new WebSocket(url.replace('/api/watch', path));
    return new Promise((resolve, reject) => {
      socket.once('open', () => resolve(socket));
      socket.once('error', reject);
    });
  }

  it('delivers an event to a connected client', async () => {
    const socket = await connect();
    const received = new Promise<string>((resolve) => socket.once('message', (d) => resolve(String(d))));
    notifier.broadcast(event);
    expect(JSON.parse(await received)).toEqual(event);
    socket.close();
  });

  it('delivers to every client', async () => {
    const a = await connect();
    const b = await connect();
    const both = Promise.all([a, b].map((s) =>
      new Promise<string>((resolve) => s.once('message', (d) => resolve(String(d))))));
    notifier.broadcast(event);
    const [first, second] = await both;
    expect(JSON.parse(first)).toEqual(event);
    expect(JSON.parse(second)).toEqual(event);
    a.close(); b.close();
  });

  it('drops a disconnected client from the count', async () => {
    const socket = await connect();
    expect(notifier.count()).toBe(1);
    socket.close();
    await vi.waitFor(() => expect(notifier.count()).toBe(0), { timeout: 5000 });
  });

  it('broadcasting with no client connected is a no-op', () => {
    expect(() => notifier.broadcast(event)).not.toThrow();
  });

  it('refuses a connection on another path', async () => {
    await expect(connect('/api/other')).rejects.toThrow();
  });

  it('closes every client on close', async () => {
    const socket = await connect();
    const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
    await notifier.close();
    await closed;
  });
});
```

- [ ] **Step 2: Implémenter**

`packages/editor-server/src/notifier.ts` :

```ts
import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ProjectEvent } from './types.js';

export interface Notifier {
  broadcast(event: ProjectEvent): void;
  count(): number;
  close(): Promise<void>;
}

/**
 * Pushes disk-change events to every connected editor.
 *
 * Shares the HTTP server rather than opening a second port: one port to
 * remember, and no cross-origin question between the API and the socket.
 */
export function createNotifier(server: Server): Notifier {
  // `noServer` plus an explicit upgrade handler, so any other path is rejected
  // instead of silently upgraded.
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();

  server.on('upgrade', (request, socket, head) => {
    const path = (request.url ?? '').split('?')[0];
    if (path !== '/api/watch') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      clients.add(ws);
      ws.on('close', () => clients.delete(ws));
      ws.on('error', () => clients.delete(ws));
    });
  });

  return {
    broadcast(event: ProjectEvent): void {
      const payload = JSON.stringify(event);
      for (const client of clients) {
        // A client can die between the iteration and the send; a failed push is
        // not worth taking the pipeline down for.
        if (client.readyState === client.OPEN) {
          try {
            client.send(payload);
          } catch {
            clients.delete(client);
          }
        }
      }
    },
    count: () => clients.size,
    close(): Promise<void> {
      for (const client of clients) client.close();
      clients.clear();
      return new Promise((resolve) => wss.close(() => resolve()));
    },
  };
}
```

- [ ] **Step 3: Brancher le notifier dans le serveur**

Dans `createServer`, après la création du serveur HTTP : construire le notifier, l'exposer sur l'objet retourné, et le fermer dans `close`. Ajouter à `ServerOptions` un `watch?: boolean` (défaut `true`) et à `EditorServer` un `notifier: Notifier`, pour que la Task 12 puisse relier le watcher au notifier sans que `server.ts` connaisse chokidar.

- [ ] **Step 4: Vérifier**

Run: `pnpm --filter @nne/editor-server test`
Attendu : tout passe.

- [ ] **Step 5: Commit**

```bash
git add packages/editor-server/src/notifier.ts packages/editor-server/src/server.ts packages/editor-server/tests/notifier.test.ts
git commit -m "feat(editor-server): notifications WebSocket sur le port HTTP"
```

---

### Task 12: Le point d'entrée et le linter CLI

**Files:**
- Create: `packages/editor-server/src/main.ts`
- Create: `packages/editor-server/src/lint-assets.ts`
- Test: `packages/editor-server/tests/lint-assets.test.ts`

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: `startEditorServer(options: StartOptions): Promise<RunningServer>`, `lintAssets(root: string): Promise<string[]>`.

`startEditorServer` est la fonction que `pnpm editor` appellera : elle assemble store, pipeline, serveur, watcher et notifier, fait un scan initial, et retourne de quoi tout arrêter. Le linter CLI est la même validation exposée pour un hook de pre-commit, comme le spec le demande — il ne dépend ni d'Express ni du watcher, juste du système de fichiers et de `naming.ts`.

- [ ] **Step 1: Écrire les tests du linter**

`packages/editor-server/tests/lint-assets.test.ts` :

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintAssets } from '../src/lint-assets.js';

describe('lintAssets', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nne-lint-'));
    await mkdir(join(dir, 'assets', 'props'), { recursive: true });
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('is silent on a conforming project', async () => {
    await writeFile(join(dir, 'assets', 'props', 'PRP_Chair_01.glb'), 'x');
    expect(await lintAssets(dir)).toEqual([]);
  });

  it('reports a missing prefix with the path', async () => {
    await writeFile(join(dir, 'assets', 'props', 'Chair.glb'), 'x');
    const problems = await lintAssets(dir);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('props/Chair.glb');
  });

  it('reports every offending file, not just the first', async () => {
    await writeFile(join(dir, 'assets', 'props', 'Chair.glb'), 'x');
    await writeFile(join(dir, 'assets', 'props', 'Table.glb'), 'x');
    expect(await lintAssets(dir)).toHaveLength(2);
  });

  it('is silent on a project with no assets folder', async () => {
    await rm(join(dir, 'assets'), { recursive: true, force: true });
    expect(await lintAssets(dir)).toEqual([]);
  });

  it('ignores files that are not .glb', async () => {
    await writeFile(join(dir, 'assets', 'props', 'notes.txt'), 'x');
    expect(await lintAssets(dir)).toEqual([]);
  });
});
```

- [ ] **Step 2: Implémenter le linter**

`packages/editor-server/src/lint-assets.ts` :

```ts
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { validateAssetPath } from './assets/naming.js';
import { resolveProject } from './paths.js';

/**
 * Lints every .glb under a project's `assets/`.
 * Exposed separately from the server so a pre-commit hook can run it without
 * starting Express or touching the cache.
 */
export async function lintAssets(root: string): Promise<string[]> {
  const paths = resolveProject(root);
  const problems: string[] = [];

  const visit = async (dir: string, prefix: string): Promise<void> => {
    let listing;
    try {
      listing = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const item of listing) {
      const rel = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) {
        await visit(join(dir, item.name), rel);
      } else if (item.name.toLowerCase().endsWith('.glb')) {
        for (const problem of validateAssetPath(rel)) problems.push(`${rel}: ${problem}`);
      }
    }
  };

  await visit(paths.assets, '');
  return problems.sort();
}
```

- [ ] **Step 3: Écrire le point d'entrée**

`packages/editor-server/src/main.ts` : assemble tout, sans logique propre.

```ts
import { ComponentRegistry, registerBuiltins } from '@nne/core';
import { createGltfTransformOptimizer } from './assets/optimizer.js';
import { AssetPipeline } from './assets/pipeline.js';
import { resolveProject } from './paths.js';
import { ProjectStore } from './project-store.js';
import { createServer } from './server.js';
import { createWatcher, type ProjectWatcher } from './watcher.js';
import type { PlayerBundler } from './build.js';

export interface StartOptions {
  root: string;
  port?: number;
  host?: string;
  bundler?: PlayerBundler;
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

/** Boots the whole editor server: scan, serve, watch. What `pnpm editor` calls. */
export async function startEditorServer(options: StartOptions): Promise<RunningServer> {
  const paths = resolveProject(options.root);
  const registry = new ComponentRegistry();
  registerBuiltins(registry);

  const store = new ProjectStore(paths, registry);
  await store.init(paths.root.split(/[/\\]/).pop() ?? 'project');

  const pipeline = new AssetPipeline(paths, await createGltfTransformOptimizer());
  // One pass before serving, so the editor never sees a half-populated cache.
  await pipeline.scanAll((path, message) => console.warn(`asset "${path}": ${message}`));

  const server = createServer({ paths, store, pipeline, registry, ...(options.bundler ? { bundler: options.bundler } : {}), ...(options.host ? { host: options.host } : {}) });
  const port = await server.listen(options.port);

  let watcher: ProjectWatcher | undefined;
  try {
    watcher = await createWatcher({
      paths, pipeline, emit: (event) => server.notifier.broadcast(event),
    });
  } catch (cause) {
    // A watcher that will not start must not leave the port bound.
    await server.close();
    throw cause;
  }

  return {
    port,
    async close(): Promise<void> {
      await watcher?.close();
      await server.close();
    },
  };
}
```

- [ ] **Step 4: Vérifier**

Run: `pnpm --filter @nne/editor-server test && pnpm --filter @nne/editor-server typecheck`
Attendu : tout passe.

- [ ] **Step 5: Commit**

```bash
git add packages/editor-server/src/main.ts packages/editor-server/src/lint-assets.ts packages/editor-server/tests/lint-assets.test.ts
git commit -m "feat(editor-server): point d'entree du serveur et linter d'assets CLI"
```

---

### Task 13: API publique, gardes et test bout en bout

**Files:**
- Create: `packages/editor-server/src/index.ts`
- Test: `packages/editor-server/tests/public-api.test.ts`
- Test: `packages/editor-server/tests/integration.test.ts`

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: `packages/editor-server/src/index.ts`, seul point d'entrée public.

- [ ] **Step 1: Écrire l'API publique**

`packages/editor-server/src/index.ts` :

```ts
export { startEditorServer, type RunningServer, type StartOptions } from './main.js';
export { createServer, type EditorServer, type ServerOptions } from './server.js';
export { createNotifier, type Notifier } from './notifier.js';
export { createWatcher, type ProjectWatcher, type WatcherOptions } from './watcher.js';
export { ProjectStore, HttpError } from './project-store.js';
export { AssetPipeline, type ScanErrorHandler } from './assets/pipeline.js';
export {
  createGltfTransformOptimizer, readMetadata,
  type AssetOptimizer, type OptimizeRequest,
} from './assets/optimizer.js';
export {
  ASSET_PREFIXES, STANDARD_ANIMATIONS, TEXTURE_LIMITS, categoryOf, validateAssetPath,
} from './assets/naming.js';
export {
  build, referencedAssets,
  type BuildOptions, type BuildRequest, type BuildResult, type PlayerBundler,
} from './build.js';
export { lintAssets } from './lint-assets.js';
export { containedJoin, isValidSceneName, resolveProject, toPosix, type ProjectPaths } from './paths.js';
export { writeAtomic } from './atomic.js';
export {
  PROJECT_VERSION,
  type AssetCategory, type AssetEntry, type AssetMetadata,
  type ProjectEvent, type ProjectFile, type Vec3,
} from './types.js';
```

- [ ] **Step 2: Écrire le test d'API publique**

`packages/editor-server/tests/public-api.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import * as server from '../src/index.js';

describe('public API', () => {
  it('exports every documented symbol', () => {
    for (const name of [
      'startEditorServer', 'createServer', 'createNotifier', 'createWatcher',
      'ProjectStore', 'HttpError', 'AssetPipeline', 'createGltfTransformOptimizer',
      'readMetadata', 'categoryOf', 'validateAssetPath', 'build', 'referencedAssets',
      'lintAssets', 'resolveProject', 'containedJoin', 'writeAtomic',
    ]) {
      expect(server).toHaveProperty(name);
    }
  });
});
```

- [ ] **Step 3: Écrire le test bout en bout**

`packages/editor-server/tests/integration.test.ts` : sur un dossier projet temporaire, avec un optimiseur factice, dérouler le cycle complet — `startEditorServer` sur un dossier vide, `PUT` d'une scène, dépôt d'un `.glb` dans `assets/`, réception de l'événement WebSocket `asset-changed`, `GET /api/assets` qui le voit, `POST /api/build`, et vérification que le dossier de build contient la scène et l'asset et **pas** l'asset non référencé. Puis `close()` et vérification qu'aucun handle ne reste ouvert.

Ce test est le seul du package à exercer les composants ensemble ; les autres restent unitaires.

- [ ] **Step 4: Vérifier les gardes de dépendances**

```bash
node -e "const p=require('./packages/editor-server/package.json');const d=Object.keys(p.dependencies||{});const banned=d.filter(n=>['three','react','react-dom','@nne/runtime'].includes(n));if(banned.length){console.error('editor-server must not depend on the front:',banned);process.exit(1)}console.log('ok: editor-server has no front deps')"
grep -rn "from 'three'\|from 'react'\|@nne/runtime" packages/editor-server/src && echo "FAIL: front import in editor-server" && exit 1 || echo "ok: editor-server imports no front code"
grep -rn "from 'fs'\|from 'node:fs'" packages/core/src packages/runtime/src && echo "FAIL: fs outside editor-server" && exit 1 || echo "ok: disk stays in editor-server"
grep -rn "0\.0\.0\.0" packages/editor-server/src && echo "FAIL: server binds beyond loopback by default" && exit 1 || echo "ok: loopback only"
```

Attendu : quatre `ok`.

- [ ] **Step 5: Lancer la suite complète des trois packages**

Run: `pnpm test && pnpm typecheck`
Attendu : `core`, `runtime` et `editor-server` passent ; typecheck sans erreur.

- [ ] **Step 6: Commit**

```bash
git add packages/editor-server/src/index.ts packages/editor-server/tests/public-api.test.ts packages/editor-server/tests/integration.test.ts
git commit -m "feat(editor-server): API publique, gardes de dependances et test bout en bout"
```

---

## Self-Review

**Couverture du spec (§7, §8 partiel) :**

| Exigence du spec | Tâche |
|---|---|
| `GET /api/project` — manifeste + liste des scènes | Task 10 |
| `GET /api/scenes/:name` | Tasks 4, 10 |
| `PUT /api/scenes/:name` — écriture atomique | Tasks 3, 4, 10 |
| `GET /api/assets` — arbre + métadonnées + vignettes | Tasks 7, 10 |
| `POST /api/assets/import` | Tasks 7, 10 (`/api/assets/scan`, plus le watcher qui couvre la copie manuelle) |
| `POST /api/build` | Tasks 8, 10 |
| `WS /api/watch` | Tasks 9, 11 |
| Validation du nommage `CHR_`/`PRP_`/`ENV_`/`UI_` | Task 5 |
| Optimisation gltf-transform vers `.cache/` | Tasks 6, 7 |
| Métadonnées : bounding box, animations, triangles | Task 6 |
| Génération de vignette | Task 7 pour le stockage ; le rendu appartient au plan 4 (écart 2) |
| Le runtime charge depuis `.cache/`, jamais la source | Tasks 7, 8, 10 |
| Même validation exposée en CLI pour un pre-commit | Task 12 |
| Build : player + scènes + assets référencés seulement | Task 8 |
| Hot reload : watch, réoptimisation, push WebSocket | Tasks 9, 11 |
| Écriture atomique testée sur dossier temporaire | Task 3 |
| Pipeline d'import testé sur dossier temporaire | Task 7 |
| Express local, `localhost` uniquement, sans auth | Tasks 10, 13 |

Hors périmètre de ce plan, couvert par le plan 4 : l'app React, les viewports d'édition, les gizmos, les panneaux, et le rendu effectif des vignettes.

**Placeholders :** aucun, à deux exceptions signalées en toutes lettres — l'étape 3 de la Task 11 (branchement du notifier, décrit mais pas écrit, parce que c'est une modification de fichier existant) et l'étape 3 de la Task 13 (test d'intégration décrit scénario par scénario). Toutes les autres étapes portent le code réel.

**Cohérence des types :** `ProjectPaths` (Task 2) est consommé par les Tasks 4, 7, 8, 9, 10, 12. `AssetEntry` (Task 1) est produit par la Task 7 et consommé par les Tasks 8, 9, 10. `AssetOptimizer` (Task 6) est consommé par la Task 7 et injecté en faux dans les tests des Tasks 7, 8, 9, 10. `HttpError` (Task 4) est levée par les Tasks 4, 7, 10 et traduite en statut par la Task 10. `ProjectEvent` (Task 1) est produit par la Task 9 et diffusé par la Task 11.

**Point de vigilance pour l'exécution :** l'API `registerDependencies` de gltf-transform — la Task 6 la note explicitement : selon la version installée, l'encodeur Draco doit être `await`é avant la construction du `NodeIO`, ce qui rend la fabrique `async`. Le contrat `AssetOptimizer` ne bouge pas, seuls ses deux appelants (Tasks 12 et 13) attendent une promesse de plus. C'est la seule API externe que ce plan n'a pas pu vérifier avant l'installation des dépendances.

`ComponentRegistry.list()` et `.get()`, dont dépend la Task 8, ont été vérifiés présents dans `core` au moment de l'écriture.

**Ce que ce plan ne fait délibérément pas :** aucune authentification, aucun verrou d'écriture concurrent entre deux éditeurs ouverts sur le même projet, aucun versionnage des scènes au-delà de ce que git donne déjà. Le spec pose un outil local mono-utilisateur ; ajouter ces trois choses coûterait plus que ce qu'elles rapportent à ce stade.
