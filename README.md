# NNE — moteur ECS Three.js

Moteur de jeu maison en TypeScript, rendu par Three.js, avec un éditeur visuel.
L'architecture est orientée composants : une scène est un fichier JSON décrivant
des entités et leurs composants, pas du code impératif.

**État : les quatre packages de la V1 sont implémentés** — 718 tests, typecheck
propre. Double-clique sur `lancer-editeur.bat` (Windows) ou
`lancer-editeur.command` (macOS/Linux) pour tout installer et démarrer, voir
[Lancer l'éditeur](#lancer-léditeur).

| Package | Contenu | Tests |
|---|---|---|
| `core` | ECS, registre de schémas, scènes, ordonnanceur, commandes | 197 |
| `runtime` | Systèmes Three.js, boucle de jeu, player standalone | 114 |
| `editor-server` | Serveur Node local : disque, import gltf-transform, watch, build | 173 |
| `editor` | React : Scene View + gizmos, Game View, Hierarchy, Inspector, Assets | 234 |

## Prérequis

- **Node.js ≥ 22**
- **pnpm ≥ 10** — `npm install -g pnpm`

## Installation

```bash
git clone https://github.com/SebastienChevallier/NNE_threeJS.git
cd NNE_threeJS
pnpm install
```

## Commandes

| Commande | Effet |
|---|---|
| `pnpm test` | Tests des quatre packages |
| `pnpm typecheck` | Vérification des types des quatre packages |
| `pnpm --filter @nne/core test` | Tests d'un seul package (`core`, `runtime`, `editor-server`, `editor`) |
| `pnpm --filter @nne/core test:watch` | Tests en watch |
| `pnpm --filter @nne/editor dev` | Serveur de dev Vite de l'éditeur |
| `pnpm --filter @nne/editor build` | Bundle statique de l'éditeur |

Pour lancer **un seul fichier de test**, le filtre pnpm ne suffit pas — passer par
vitest directement :

```bash
cd packages/core && npx vitest run tests/inversion.test.ts
```

## Lancer l'éditeur

**Le plus simple : double-clique sur un fichier.**

- **Windows** — `lancer-editeur.bat`
- **macOS** — `lancer-editeur.command` (au premier lancement, clic droit → Ouvrir,
  pour passer la protection Gatekeeper sur un fichier non signé)
- **Linux** — `./lancer-editeur.sh` depuis un terminal, ou double-clic selon
  l'environnement de bureau

Chacun installe les dépendances (`pnpm install`) puis démarre le serveur d'édition
et l'éditeur, et ouvre `http://127.0.0.1:5173` dans le navigateur par défaut dès
que les deux répondent. La fenêtre du terminal doit rester ouverte : Ctrl+C
l'arrête. Seul prérequis : **Node.js ≥ 22** et **pnpm** (`npm install -g pnpm`) —
les lanceurs le signalent clairement s'il manque plutôt que d'échouer en silence.

Au premier lancement, un projet de démonstration est créé dans `projects/demo/`
(une caméra, une lumière, une scène de départ) — c'est ce qui évite d'ouvrir un
éditeur vide sur rien. `projects/` n'est pas suivi par git : ce sont des données de
projet, pas du code du moteur.

Depuis un terminal, l'équivalent est `pnpm run start` à la racine. Deux variantes
plus fines :

| Commande | Effet |
|---|---|
| `pnpm run start` | Installe, démarre serveur + éditeur, ouvre le navigateur |
| `pnpm run editor` | Démarre serveur + éditeur, sans réinstaller ni ouvrir le navigateur |
| `pnpm --filter @nne/editor-server start` | Le serveur d'édition seul, sur `--port` et `--host` au choix |

Le serveur accepte un dossier de projet en argument positionnel :

```bash
pnpm --filter @nne/editor-server start projects/mon-jeu --port 6000
```

Il écoute sur `127.0.0.1` par défaut — il n'a pas d'authentification, donc
l'exposer au-delà du loopback (`--host 0.0.0.0`) est un choix explicite, jamais le
défaut.

Le serveur s'utilise aussi directement depuis du code :

```ts
import { startEditorServer } from '@nne/editor-server';

const server = await startEditorServer({ root: 'projects/mon-projet' });
console.log(`http://127.0.0.1:${server.port}`);
```

## Structure

```
packages/
  core/           ECS, registre de schémas, scènes, commandes — sans Three.js
  runtime/        systèmes Three.js, graphe de scène, boucle de jeu, player
  editor-server/  serveur Node local : disque, import d'assets, watch, build
  editor/         app React : viewports, Hierarchy, Inspector, Assets
projects/
  <mon-projet>/   project.json, scenes/, assets/, .cache/
docs/superpowers/
  specs/          documents de design validés
  plans/          plans d'implémentation
```

## Frontières d'architecture

Quatre règles, chacune tenue par un test automatisé plutôt que par la discipline :

**`core` ne connaît pas Three.js.** Un `Transform` stocke `position: [x, y, z]`,
pas un `THREE.Vector3`. Les composants sont des données pures, JSON par
construction ; c'est `runtime` qui fait le pont vers le graphe Three. Le package
n'a **aucune dépendance runtime**.

**Le disque appartient à `editor-server`.** Ni `core` ni `runtime` ne lisent un
fichier : le runtime charge par URL, le serveur est le seul à toucher un chemin.

**`editor-server` ignore le front.** Pas de `three`, pas de `react`, pas
d'`@nne/runtime`. Il écoute sur `127.0.0.1` par défaut — il n'a pas
d'authentification, donc l'exposer serait donner un accès en écriture au dossier
projet.

**React ne lit jamais le `World`.** Les composants lisent un store Zustand qui leur
sert des copies sérialisées, et **toute** mutation passe par le `CommandBus`. C'est
ce qui rend l'undo exhaustif par construction, et ce qui rendra le panneau IA peu
coûteux : produire du JSON de commandes plutôt que du code Three.js.

Trois bénéfices : tout se teste en Node sans navigateur ni GPU, le format de scène
ne peut pas dériver vers du non-sérialisable, et changer de backend de rendu ne
toucherait pas le moteur.

## Utiliser `@nne/core`

Un seul point d'entrée :

```ts
import {
  World, ComponentRegistry, CommandBus, Scheduler,
  registerBuiltins, TRANSFORM, MESH,
  serializeScene, deserializeScene, stringifyScene, validateScene,
} from '@nne/core';
```

### 1. Déclarer les composants

Le registre est la source de vérité unique des formes de composants. Il alimente
les valeurs par défaut, la validation, et l'Inspector de l'éditeur — c'est lui qui
permet de générer un formulaire d'édition sans écrire une ligne par composant.

```ts
const registry = new ComponentRegistry();
registerBuiltins(registry);          // Transform, Mesh, Camera, Light

registry.list();                     // ['Camera', 'Light', 'Mesh', 'Transform']
registry.createDefault(TRANSFORM);   // { position: [0,0,0], rotation: [0,0,0], scale: [1,1,1] }
```

Un composant maison se déclare de la même façon :

```ts
registry.define('Interactable', {
  label:  { type: 'string', default: '' },
  radius: { type: 'number', default: 1.5 },
  target: { type: 'entity', default: null },
});
```

Les dix types de champs disponibles : `number`, `int`, `bool`, `string`, `vec3`,
`euler`, `color`, `enum`, `asset`, `entity`. L'ordre de déclaration des champs est
conservé — c'est l'ordre d'affichage dans l'Inspector.

Un composant maison portant un champ de type `asset` voit ses fichiers embarqués
par le build **sans toucher à une ligne du build** : le graphe d'assets est déduit
du registre, pas d'une connaissance codée en dur de `Mesh.asset`.

Les schémas sont **gelés en profondeur** après `define()` : un consommateur ne peut
pas corrompre le registre par mégarde.

### 2. Construire un monde

```ts
const world = new World();

const camera = world.spawn('Camera principale');
world.set(camera, TRANSFORM, { position: [0, 1.6, 5], rotation: [0, 0, 0], scale: [1, 1, 1] });

const chair = world.spawn('Chaise', camera);        // enfant de camera
world.set(chair, MESH, { asset: 'props/PRP_Chair_01.glb', castShadow: true });

world.query(TRANSFORM, MESH);   // entités possédant les deux, triées par id
world.children(camera);         // [chair]
world.despawn(camera);          // récursif : emporte chair et purge ses composants
```

`get()` renvoie une copie défensive : muter le résultat n'affecte pas le monde.
`peek()` renvoie une lecture sans copie, pour les boucles par frame où la copie
dominerait le budget.

### 3. Muter via des commandes (undo/redo gratuit)

Dans l'éditeur, **toute** mutation passe par le `CommandBus`. L'inverse de chaque
commande est capturé avant application, donc l'undo couvre tout par construction :
une nouvelle commande ne peut pas oublier d'être annulable.

```ts
const bus = new CommandBus(world);

const id = world.allocateId();
bus.dispatch({ kind: 'SpawnEntity', entity: id, name: 'Lampe', parent: null });
bus.dispatch({ kind: 'AddComponent', entity: id, type: MESH,
               data: registry.createDefault(MESH) });

bus.undo();        // true
bus.redo();        // true
bus.canUndo();     // false
```

Les sept commandes : `SpawnEntity`, `DespawnEntity`, `SetComponent`,
`AddComponent`, `RemoveComponent`, `SetParent`, `RenameEntity`. Ce sont des objets
JSON purs — donc sérialisables, rejouables, et émettables par un LLM.

### 4. Sauvegarder et charger une scène

```ts
const file = serializeScene(world, 'Scene_01');
const text = stringifyScene(file);        // JSON déterministe, prêt pour git

const errors = validateScene(JSON.parse(text), registry);
if (errors.length > 0) throw new Error(errors[0].message);

const restored = deserializeScene(JSON.parse(text));
```

`stringifyScene` normalise : entités triées par id, types de composants triés
alphabétiquement, indentation de deux espaces, retour à la ligne final. Déplacer un
objet produit donc un diff de quelques lignes, pas de plusieurs centaines.

La hiérarchie est un champ `parent`, pas un arbre imbriqué : le JSON reste plat, les
diffs restent lisibles, et un LLM le manipule plus fiablement. Une entité racine n'a
**pas** de clé `parent`.

`validateScene` traite son entrée comme non fiable — elle vient d'un fichier écrit à
la main ou généré. Elle collecte toutes les erreurs plutôt que de s'arrêter à la
première, chacune avec un chemin précis
(`scene.entities[1].components.Mesh.castShadow`), et rejette notamment les cycles de
parenté.

## Utiliser `@nne/runtime`

`runtime` traduit les composants vers Three.js dans **un seul sens** : les
composants sont la source de vérité, le graphe Three en est le reflet. Rien ne
réécrit jamais un composant depuis un `Object3D`.

```ts
import { Engine, AssetCache, createGltfSource, createWebGLViewport } from '@nne/runtime';

const engine = new Engine({
  world,
  assets: new AssetCache(createGltfSource('/cache/assets')),
  viewport: createWebGLViewport(canvas),
});

engine.resize(canvas.clientWidth, canvas.clientHeight);
engine.start();
```

Un composant `Mesh` stocke un **chemin relatif au projet**, pas une URL, pour que la
scène reste portable. C'est l'argument de `createGltfSource` qui dit où ce chemin
est enraciné : `/cache/assets` dans l'éditeur, `assets` dans un build.

**Un `Engine` construit sans `viewport` synchronise le graphe et exécute les
systèmes sans rien dessiner.** C'est ce que fait le Scene View de l'éditeur, pour
rendre lui-même à travers sa caméra d'édition.

Le player autonome charge une scène JSON sans éditeur :

```ts
import { createPlayer } from '@nne/runtime';

await createPlayer({ canvas, sceneUrl: 'scenes/Scene_01.json' });
```

## Conventions d'assets

Tenues par le pipeline d'import : un fichier qui les enfreint est signalé, pas
importé. La même validation est exposée en CLI (`lintAssets`) pour un hook de
pre-commit.

- Format d'export unique : **`.glb`**
- Échelle : **1 unité = 1 mètre**, origine (0,0,0) au sol, à la base de l'objet
- Préfixes par catégorie : `CHR_` (personnages), `PRP_` (props), `ENV_`
  (environnement), `UI_` (éléments 3D d'interface) — ex. `CHR_Character_01.glb`
- Textures plafonnées par catégorie : `CHR` et `ENV` 1024, `PRP` et `UI` 512
- Animations nommées de façon standardisée : `Idle`, `Alert`, `Action_01`

Le runtime charge **toujours** depuis `.cache/`, jamais depuis `assets/` :
l'optimisation (Draco, plafond de textures, purge) est un invariant, pas une étape
de build oubliable. `.cache/` est entièrement dérivé — le supprimer coûte une passe
de réoptimisation, jamais une donnée.

## Hors périmètre V1

Ajoutables plus tard comme nouveaux composants et systèmes sans toucher au cœur :
physique (Rapier), networking, state machines d'animation, post-processing, prefabs,
multi-sélection, docking redimensionnable, WebGPU, audio, et le panneau IA.

Le panneau IA mérite une note : il n'est pas implémenté, mais l'architecture le rend
peu coûteux. Le registre de schémas décrit le format au modèle, la couche de
commandes lui offre une surface d'action étroite et validable — bien plus fiable que
de la génération de code Three.js — et l'undo couvre ses erreurs. Ces trois pièces
sont construites pour d'autres raisons, ce qui justifie leur place centrale.

## Documentation

- [Design du moteur](docs/superpowers/specs/2026-08-03-moteur-ecs-threejs-design.md)
  — architecture, décisions de stack et écarts assumés vis-à-vis du cadrage initial
- [Plan `core`](docs/superpowers/plans/2026-08-03-moteur-core-ecs.md)
- [Plan `runtime`](docs/superpowers/plans/2026-08-03-moteur-runtime.md)
- [Plan `editor-server`](docs/superpowers/plans/2026-08-03-moteur-editor-server.md)
- [Plan `editor`](docs/superpowers/plans/2026-08-03-moteur-editor.md)

Chaque plan porte une section « écarts assumés » qui documente où et pourquoi
l'implémentation diverge du spec.
