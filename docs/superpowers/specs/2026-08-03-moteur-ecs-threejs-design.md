# Moteur ECS Three.js + éditeur — Design

Date : 2026-08-03
Statut : validé, prêt pour le plan d'implémentation
Branche : `claude/stack-technique-brainstorm-w2m34l`

## 1. Objectif et périmètre

Poser la base architecturale d'un moteur ECS en TypeScript, rendu par Three.js,
accompagné d'un éditeur visuel minimal. L'objet du projet est le moteur lui-même,
pas un jeu particulier : aucun premier projet n'est ciblé.

Périmètre de la V1 :

- Cœur ECS (entités, composants, systèmes, requêtes).
- Registre de schémas de composants.
- Format de scène JSON sérialisable et versionnable.
- Éditeur : Scene View avec gizmos de transform, Game View, Hierarchy, Inspector,
  panneau Assets, Save, Build, Import d'assets.
- Composants fournis : `Transform`, `Mesh`, `Camera`, `Light`.

Le panneau de dialogue IA est hors V1, mais l'architecture est conçue pour
l'accueillir sans refonte (voir §9).

### Décisions de stack

| Décision | Choix | Raison |
|---|---|---|
| Langage | TypeScript | Le registre de schémas et l'Inspector générique reposent sur l'introspection typée. |
| Build / dev | Vite | Hot reload quasi instantané, configuration minimale. |
| Rendu | Three.js, WebGL2 | WebGPU écarté en V1 : écosystème TSL/NodeMaterial parallèle, sans bénéfice à cette échelle. |
| Hébergement du projet | Serveur Node local, projet = dossier disque | Seule option où Save, Build et Import d'assets ont un sens complet, et où le pipeline gltf-transform est automatisable. |
| UI de l'éditeur | React (chrome) + Three.js vanilla (viewports) | Découpage type Unity. React sert l'outil, jamais le runtime du jeu. |
| ECS | Implémentation maison | La valeur est dans le couple registre-de-schémas / format de scène, qu'aucune lib ne fournit. |
| Store éditeur | Zustand | Découple React du World ; re-render sur sélection, pas à 60 fps. |
| Monorepo | pnpm workspaces | Frontières de dépendances explicites entre packages. |

ECS écartés : `bitECS` (composants numériques uniquement, incompatible avec des
scènes JSON contenant strings et références) ; `miniplex` (ergonomique mais sans
système de schéma, donc l'essentiel du travail resterait à faire).

React-Three-Fiber écarté pour les viewports et le runtime : imposerait React au
runtime du jeu et enfermerait le Game View dans le cycle de rendu de R3F.

## 2. Architecture d'ensemble

Trois processus, quatre packages.

```
packages/
  core/           ECS pur + registre de schémas — aucune dépendance à Three.js
  runtime/        Systèmes Three.js, boucle de jeu, player standalone
  editor/         App React (chrome + viewports)
  editor-server/  Node : accès disque, watch, import d'assets, build
projects/
  <mon-projet>/
    project.json
    scenes/*.json
    assets/       sources (.glb)
    .cache/       assets optimisés générés
```

Dépendances : `runtime → core` ; `editor → core, runtime` ; `editor-server`
n'a aucune dépendance front. Aucune dépendance ne remonte : `core` ignore
l'existence de l'éditeur.

**Décision centrale : `core` ne connaît pas Three.js.** Un `Transform` stocke
`position: [x, y, z]`, pas un `THREE.Vector3`. Les composants sont des données
pures, JSON par construction. `runtime` fait le pont : le `RenderSystem`
maintient une `Map<EntityId, THREE.Object3D>` et synchronise le graphe Three
depuis les composants.

Bénéfices :

1. `core` est testable en Node sans navigateur ni WebGL.
2. Le format de scène ne peut pas dériver vers du non-sérialisable.
3. Changer de backend de rendu remplace `runtime`, pas le moteur.

Deux points de sortie : l'éditeur (`pnpm editor`) et le player
(`pnpm play <scene>`, charge une scène JSON sans éditeur). Le player est ce que
produit le Build, et sert aussi de preview sans build.

## 3. Cœur ECS

```ts
type EntityId = number;
type ComponentType = string;

class World {
  spawn(name?: string): EntityId
  despawn(e: EntityId): void
  set<T>(e: EntityId, type: ComponentType, data: T): void
  get<T>(e: EntityId, type: ComponentType): T | undefined
  remove(e: EntityId, type: ComponentType): void
  query(...types: ComponentType[]): EntityId[]
}
```

Stockage : `Map<ComponentType, Map<EntityId, unknown>>`. `query` intersecte les
sets en partant du plus petit. Pas d'archétypes tant qu'un profilage ne les
réclame pas — l'ordre de grandeur visé est 200 à 2000 entités.

Un système est une fonction `(world, dt) => void`, enregistrée dans un tableau
d'ordre explicite. Pas de découverte automatique.

Les IDs d'entités sont stables et persistés, sinon aucune référence
inter-entités ne survit à un rechargement.

## 4. Registre de schémas

Chaque composant se déclare une fois :

```ts
defineComponent('Transform', {
  position: { type: 'vec3',  default: [0, 0, 0] },
  rotation: { type: 'euler', default: [0, 0, 0] },
  scale:    { type: 'vec3',  default: [1, 1, 1] },
});

defineComponent('Mesh', {
  asset:      { type: 'asset', accept: '.glb', default: null },
  castShadow: { type: 'bool',  default: true },
});
```

Cette déclaration unique alimente quatre consommateurs :

- **Inspector** : génération automatique des champs.
- **Validation** : rejet d'une scène malformée au chargement, avec erreur lisible.
- **Valeurs par défaut** : ajout d'un composant en un clic.
- **Build** : le graphe de dépendances d'assets se déduit des champs de type `asset`.

Types de champs de la V1 : `number`, `int`, `bool`, `string`, `vec3`, `euler`,
`color`, `enum`, `asset`, `entity`. L'Inspector est un `switch` sur ces dix cas.

### Composants fournis

| Composant | Champs |
|---|---|
| `Transform` | `position: vec3`, `rotation: euler`, `scale: vec3` |
| `Mesh` | `asset: asset(.glb)`, `castShadow: bool` |
| `Camera` | `fov: number`, `near: number`, `far: number`, `active: bool` |
| `Light` | `type: enum[directional\|point\|ambient\|spot]`, `color: color`, `intensity: number` |

`Transform` est requis pour qu'une entité apparaisse dans les viewports.

## 5. Format de scène

```json
{
  "version": 1,
  "name": "Scene_01",
  "entities": [
    { "id": 1, "name": "Camera principale",
      "components": {
        "Transform": { "position": [0, 1.6, 5], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
        "Camera": { "fov": 60, "near": 0.1, "far": 1000, "active": true }
      }
    },
    { "id": 2, "name": "Chaise", "parent": 1,
      "components": {
        "Transform": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1] },
        "Mesh": { "asset": "assets/PRP_Chair_01.glb", "castShadow": true }
      }
    }
  ]
}
```

- **La hiérarchie est un champ `parent`**, pas un arbre imbriqué : JSON plat,
  meilleurs diffs git, manipulation plus fiable par un LLM. Le `RenderSystem`
  reconstruit le graphe Three.
- **Écriture stable** : indentation et ordre des clés déterministes, pour qu'un
  déplacement d'objet produise un diff de quelques lignes.
- Le champ `version` autorise les migrations de format futures.

## 6. Éditeur

### Couche de commandes

Toute mutation passe par une commande, sans exception.

```ts
type Command =
  | { kind: 'SpawnEntity';   name: string; parent?: EntityId }
  | { kind: 'DespawnEntity'; entity: EntityId }
  | { kind: 'SetComponent';  entity: EntityId; type: ComponentType; data: unknown }
  | { kind: 'AddComponent';  entity: EntityId; type: ComponentType }
  | { kind: 'RemoveComponent'; entity: EntityId; type: ComponentType }
  | { kind: 'SetParent';     entity: EntityId; parent: EntityId | null }
  | { kind: 'RenameEntity';  entity: EntityId; name: string };
```

Un `CommandBus` applique la commande au `World` et empile son inverse. Le gizmo,
l'Inspector, le drag&drop de la Hierarchy, le drop d'un `.glb` et, plus tard, le
panneau IA émettent tous ces mêmes objets.

Conséquences : undo/redo gratuit et exhaustif par construction ; flag « projet
modifié » trivial ; intégration IA réduite à la production de JSON de commandes.

### Flux de données

React ne lit jamais le `World` directement. Un store Zustand expose la sélection
courante et une vue sérialisée de l'entité sélectionnée ; le bus notifie le store
après chaque commande. React ne re-render que sur changement de sélection ou de
valeur inspectée, jamais à la fréquence de la boucle de rendu.

### Panneaux

- **Scene View** — canvas Three.js, caméra d'édition (`OrbitControls`), le
  `RenderSystem` de `runtime`, plus une couche d'édition absente du runtime :
  `TransformControls` (translate/rotate/scale, raccourcis W/E/R), grille, helpers
  de lumières et caméras, sélection par raycast. Le gizmo n'écrit pas dans le
  `Transform` pendant le drag ; il émet un unique `SetComponent` au relâchement,
  pour que l'undo enregistre un seul pas.
- **Game View** — même `World`, mêmes systèmes, caméra active de la scène, sans
  couche d'édition. Play clone l'état du monde et joue sur le clone ; Stop jette
  le clone. Jouer ne modifie jamais la scène éditée. Un seul canvas actif à la fois.
- **Hierarchy** — arbre construit depuis les champs `parent`, drag&drop de
  reparentage (`SetParent`), sélection bidirectionnelle avec le Scene View,
  renommage inline.
- **Inspector** — nom et ID, puis une carte dépliable par composant avec champs
  générés depuis le registre, et un bouton « Add Component » listant les
  composants enregistrés absents de l'entité. Aucun code spécifique par composant.
- **Assets** — grille filtrable avec vignettes, alimentée par le serveur. Drag
  d'un `.glb` vers le Scene View : crée une entité `Transform` + `Mesh`
  positionnée au point d'impact du raycast sur le sol.

Layout fixe en V1 (pas de docking redimensionnable).

## 7. Serveur d'édition, assets, Save et Build

Express local (~250 lignes), lancé par `pnpm editor`, sert l'app React via Vite
et expose une API sur le dossier projet. Écoute sur `localhost` uniquement. Pas
de base de données, pas d'authentification.

```
GET  /api/project           project.json + liste des scènes
GET  /api/scenes/:name      charge une scène
PUT  /api/scenes/:name      sauvegarde (écriture atomique : fichier temp + rename)
GET  /api/assets            arbre des assets + métadonnées + vignettes
POST /api/assets/import     import de fichiers
POST /api/build             déclenche le build
WS   /api/watch             notifications de changement disque
```

### Pipeline d'import

Déclenché à l'upload comme à la copie manuelle dans `assets/` (chokidar détecte
les deux) :

1. Validation du nommage selon les conventions du projet (`CHR_`, `PRP_`, `ENV_`, `UI_`).
2. Optimisation via **gltf-transform** en CLI vers `.cache/` : compression Draco,
   redimensionnement des textures selon la catégorie, purge des données inutiles.
3. Extraction des métadonnées : bounding box, liste des animations, nombre de triangles.
4. Génération d'une vignette.

Le runtime charge toujours depuis `.cache/`, jamais depuis la source :
l'optimisation est un invariant, pas une étape de build oubliable.

La même validation est exposée en CLI, ce qui tient lieu de linter d'assets pour
un hook de pre-commit.

### Conventions d'assets

- Format d'export unique : `.glb`.
- Échelle : 1 unité = 1 mètre. Origine (0,0,0) au sol, à la base de l'objet.
- Préfixes de catégorie : `CHR_`, `PRP_`, `ENV_`, `UI_`.
- Résolution de textures plafonnée par catégorie : personnages 512–1024, props 256–512.
- Noms d'animations standardisés dans chaque `.glb` : `Idle`, `Alert`, `Action_01`.

### Build

Produit un dossier statique autonome : le player `runtime` compilé par Vite, les
scènes JSON, et uniquement les assets référencés par les scènes du projet (graphe
déduit des champs de type `asset`). Déployable tel quel sur hébergement statique.
Ni éditeur ni React dans le build.

### Hot reload d'assets

Le watcher détecte un `.glb` réenregistré depuis Blender, réoptimise, et pousse
l'événement par WebSocket. Le `RenderSystem` recharge le mesh en place, sans
rechargement de page ni perte de l'état de la scène.

## 8. Tests

Vitest, avec une répartition volontairement asymétrique.

**`core`** — testé sérieusement, car pur et fondateur : cycle de vie des entités,
correction des requêtes, `defineComponent` et application des défauts, validation
de schéma sur JSON malformé, et surtout **l'inversion des commandes** : pour
chaque type de commande, appliquer puis annuler doit produire un monde
strictement identique à l'original.

**`runtime`** — ce qui est vérifiable sans GPU : round-trip de sérialisation
(charger puis resauvegarder une scène produit un JSON identique), ordonnancement
des systèmes, reconstruction de la hiérarchie parent/enfant. Le rendu n'est pas
testé unitairement.

**`editor-server`** — pipeline d'import et écriture atomique, sur un dossier
projet temporaire.

**UI React** — pas de tests unitaires en V1. Un test sera écrit ponctuellement si
un bug d'UI se répète.

## 9. Hors périmètre V1

Chacun de ces points reste ajoutable comme un nouveau composant et son système,
sans modification du cœur :

physique et collisions (Rapier) · networking · animations avec state machine (les
clips glTF sont chargés et joués, sans blending sophistiqué) · post-processing ·
prefabs et instances · multi-sélection · docking de panneaux redimensionnables ·
WebGPU · audio · panneau IA.

### Note sur le panneau IA

Non implémenté en V1, mais l'architecture le rend peu coûteux à ajouter :

- le **registre de schémas** décrit le format de scène au modèle ;
- la **couche de commandes** lui offre une surface d'action étroite et validable,
  bien plus fiable que de la génération de code Three.js ;
- l'**undo** couvre ses erreurs.

Ces trois pièces sont construites pour d'autres raisons, ce qui est la
justification de leur place centrale dans le design.

## 10. Écarts assumés vis-à-vis du document de cadrage initial

- **ECS retenu malgré une charge de travail modeste au départ** : justifié ici non
  par la performance, mais parce que le format de scène déclaratif — donc
  l'éditeur et l'IA — en découle.
- **React introduit**, alors que le document l'écartait. La distinction : React
  sert la chrome de l'éditeur, jamais le runtime du jeu, qui reste Three.js
  vanilla. Construire Hierarchy, Inspector générique et gestionnaire d'assets en
  vanilla + tweakpane reviendrait à réécrire un framework UI.
- **TypeScript**, absent du document, retenu pour l'introspection du registre.
- **PlayCanvas et Needle Engine** : non retenus. Adopter l'un ou l'autre
  remplacerait la stack (leur éditeur impose leur runtime et leur format de
  scène), ce qui contredit l'objectif de posséder la base architecturale.
- **Multijoueur** : hors périmètre, sans structure d'événements anticipée en V1.
