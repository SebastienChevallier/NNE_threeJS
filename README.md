# NNE — moteur ECS Three.js

Moteur de jeu maison en TypeScript, rendu par Three.js, avec un éditeur visuel.
L'architecture est orientée composants : une scène est un fichier JSON décrivant
des entités et leurs composants, pas du code impératif.

**État actuel : `packages/core` est terminé** (191 tests). Les packages `runtime`,
`editor-server` et `editor` sont conçus mais pas encore implémentés — voir la
[feuille de route](#feuille-de-route).

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
| `pnpm test` | Tests de tous les packages |
| `pnpm typecheck` | Vérification des types de tous les packages |
| `pnpm --filter @nne/core test` | Tests du seul package `core` |
| `pnpm --filter @nne/core test:watch` | Tests en watch |
| `pnpm --filter @nne/core typecheck` | Types du seul package `core` |

Pour lancer **un seul fichier de test**, le filtre pnpm ne suffit pas — passer par
vitest directement :

```bash
cd packages/core && npx vitest run tests/inversion.test.ts
```

## Structure

```
packages/
  core/           ECS, registre de schémas, scènes, commandes — sans Three.js
  runtime/        (à venir) systèmes Three.js, boucle de jeu, player
  editor/         (à venir) app React : viewports, Hierarchy, Inspector, Assets
  editor-server/  (à venir) serveur Node local : disque, import d'assets, build
projects/
  <mon-projet>/   (à venir) project.json, scenes/, assets/, .cache/
docs/superpowers/
  specs/          documents de design validés
  plans/          plans d'implémentation
```

**Règle d'architecture centrale : `core` ne connaît pas Three.js.** Un `Transform`
stocke `position: [x, y, z]`, pas un `THREE.Vector3`. Les composants sont des
données pures, JSON par construction ; c'est `runtime` qui fera le pont vers le
graphe Three. Trois bénéfices : `core` se teste en Node sans navigateur ni GPU, le
format de scène ne peut pas dériver vers du non-sérialisable, et changer de backend
de rendu ne toucherait pas le moteur. Le package n'a **aucune dépendance runtime**,
et un test le vérifie.

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
les valeurs par défaut et la validation, et alimentera l'Inspector de l'éditeur —
c'est lui qui permet de générer un formulaire d'édition sans écrire de code par
composant.

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
conservé — ce sera l'ordre d'affichage dans l'Inspector.

Les schémas sont **gelés en profondeur** après `define()` : un consommateur ne peut
pas corrompre le registre par mégarde.

### 2. Construire un monde

```ts
const world = new World();

const camera = world.spawn('Camera principale');
world.set(camera, TRANSFORM, { position: [0, 1.6, 5], rotation: [0, 0, 0], scale: [1, 1, 1] });

const chair = world.spawn('Chaise', camera);        // enfant de camera
world.set(chair, MESH, { asset: 'assets/PRP_Chair_01.glb', castShadow: true });

world.query(TRANSFORM, MESH);   // entités possédant les deux, triées par id
world.children(camera);         // [chair]
world.despawn(camera);          // récursif : emporte chair et purge ses composants
```

`get()` et `componentsOf()` renvoient des copies défensives : muter le résultat
n'affecte pas le monde.

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

const stop = bus.subscribe((commands) => console.log(commands));
stop();            // se désabonne
```

Les sept commandes : `SpawnEntity`, `DespawnEntity`, `SetComponent`,
`AddComponent`, `RemoveComponent`, `SetParent`, `RenameEntity`. Ce sont des objets
JSON purs — donc sérialisables, rejouables, et émettables par un LLM.

`SpawnEntity` porte un `entity` explicite, alloué par l'appelant via
`world.allocateId()`. C'est ce qui rend chaque commande rejouable telle quelle.

Le listener de `subscribe` reçoit le **lot complet** appliqué, pas une seule
commande : annuler la suppression d'un sous-arbre rejoue plusieurs commandes, et un
abonné doit toutes les voir.

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

Format produit :

```json
{
  "version": 1,
  "name": "Scene_01",
  "entities": [
    {
      "id": 1,
      "name": "Camera principale",
      "components": {
        "Camera": { "fov": 60, "near": 0.1, "far": 1000, "active": true },
        "Transform": { "position": [0, 1.6, 5], "rotation": [0, 0, 0], "scale": [1, 1, 1] }
      }
    },
    {
      "id": 2,
      "name": "Chaise",
      "parent": 1,
      "components": {
        "Mesh": { "asset": "assets/PRP_Chair_01.glb", "castShadow": true }
      }
    }
  ]
}
```

La hiérarchie est un champ `parent`, pas un arbre imbriqué : le JSON reste plat, les
diffs restent lisibles, et un LLM le manipule plus fiablement. Une entité racine n'a
**pas** de clé `parent`.

`validateScene` traite son entrée comme non fiable — elle vient d'un fichier écrit à
la main ou généré. Elle collecte toutes les erreurs plutôt que de s'arrêter à la
première, chacune avec un chemin précis
(`scene.entities[1].components.Mesh.castShadow`), et rejette notamment les cycles de
parenté. Un tableau vide signifie que le fichier est chargeable.

### 5. Faire tourner des systèmes

```ts
const scheduler = new Scheduler();

scheduler.add('movement', (world, dt) => {
  for (const e of world.query(TRANSFORM)) {
    const t = world.get(e, TRANSFORM) as { position: number[] };
    t.position[1] += dt;
    world.set(e, TRANSFORM, t);
  }
});

scheduler.run(world, 1 / 60);
```

Les systèmes s'exécutent dans l'ordre d'enregistrement, jamais trié — l'ordre est
celui du tableau, lisible d'un coup d'œil. Un système qui lève relance une erreur
nommant le système fautif, l'erreur d'origine attachée en `cause`. Ajouter ou
retirer un système pendant un `run` prend effet au `run` suivant, jamais celui en
cours.

## Conventions d'assets

À respecter dès le premier asset — le pipeline d'import s'appuiera dessus.

- Format d'export unique : **`.glb`**
- Échelle : **1 unité = 1 mètre**, origine (0,0,0) au sol, à la base de l'objet
- Préfixes par catégorie : `CHR_` (personnages), `PRP_` (props), `ENV_`
  (environnement), `UI_` (éléments 3D d'interface) — ex. `CHR_Character_01.glb`
- Textures plafonnées par catégorie : personnages 512–1024, props 256–512
- Animations nommées de façon standardisée : `Idle`, `Alert`, `Action_01`

## Feuille de route

| Package | Contenu | État |
|---|---|---|
| `core` | ECS, registre, scènes, commandes | **terminé** |
| `runtime` | Systèmes Three.js, boucle de jeu, player standalone | à venir |
| `editor-server` | Serveur Node local, import gltf-transform, watch, build | à venir |
| `editor` | React : Scene View + gizmos, Game View, Hierarchy, Inspector, Assets | à venir |

Hors périmètre pour l'instant, ajoutables plus tard comme nouveaux composants et
systèmes sans toucher au cœur : physique (Rapier), networking, state machines
d'animation, post-processing, prefabs, WebGPU, audio, et le panneau IA.

Le panneau IA mérite une note : il n'est pas implémenté, mais l'architecture le rend
peu coûteux. Le registre de schémas décrit le format au modèle, la couche de
commandes lui offre une surface d'action étroite et validable — bien plus fiable que
de la génération de code Three.js — et l'undo couvre ses erreurs.

## Documentation

- [Design du moteur](docs/superpowers/specs/2026-08-03-moteur-ecs-threejs-design.md)
  — architecture, décisions de stack et écarts assumés vis-à-vis du cadrage initial
- [Plan d'implémentation de `core`](docs/superpowers/plans/2026-08-03-moteur-core-ecs.md)
