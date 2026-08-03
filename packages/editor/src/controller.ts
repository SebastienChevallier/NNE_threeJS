import type { ComponentData, ComponentType, EntityId } from '@nne/core';
import { AssetCache, createGltfSource, createWebGLViewport } from '@nne/runtime';
import { createApiClient, type ApiClient, type BuildSummary } from './api/client.js';
import { connectWatch, handleProjectEvent } from './api/watch.js';
import { runBuild, saveScene } from './actions.js';
import { addableComponents, coerceFieldValue, describeComponent, type FieldView } from './model/fields.js';
import { canReparent } from './model/hierarchy.js';
import { EditorSession } from './session.js';
import { createEditorStore, type EditorStore } from './store.js';
import { createGameView, type GameView } from './viewport/game-view.js';
import { createSceneView, type SceneView } from './viewport/scene-view.js';
import type { AssetSummary } from './types.js';

export interface EditorController {
  readonly session: EditorSession;
  readonly store: EditorStore;

  select(entity: EntityId | null): void;
  rename(name: string): void;
  reparent(entity: EntityId, parent: EntityId | null): void;
  setField(type: ComponentType, field: string, raw: unknown): void;
  addComponent(type: ComponentType): void;
  removeComponent(type: ComponentType): void;
  describeComponent(type: ComponentType, data: ComponentData): FieldView[];
  addableComponents(present: ComponentType[]): ComponentType[];

  beginDrag(asset: AssetSummary): void;
  draggedAsset(): AssetSummary | undefined;
  endDrag(): void;

  undo(): void;
  redo(): void;
  play(): void;
  stop(): void;
  save(): Promise<void>;
  build(outDir?: string): Promise<BuildSummary>;

  loadScene(name: string): Promise<void>;
  refreshAssets(): Promise<void>;

  /** Mounts the viewports onto a real canvas and starts the loop. */
  attachCanvas(canvas: HTMLCanvasElement): void;
  detachCanvas(): void;
  dispose(): void;
}

/** Where editor-server serves optimized assets from. */
const ASSET_BASE_URL = '/cache/assets';

export interface ControllerOptions {
  client?: ApiClient;
  /** Called on a problem worth showing the user. */
  onProblem?: (message: string) => void;
  /** Injectable so the controller is testable without a socket. */
  connect?: typeof connectWatch;
}

/**
 * Everything the panels do, in one testable place.
 *
 * React forwards to these methods and renders the store; it holds no decisions
 * of its own, which is what keeps the components free of anything worth testing.
 */
export function createController(options: ControllerOptions = {}): EditorController {
  const client = options.client ?? createApiClient();
  const session = new EditorSession();
  const store = createEditorStore(session);
  // The editor loads from the server's optimized cache, never from the raw
  // sources: a Mesh component stores a project-relative path, and this is what
  // says where that path is rooted. Without it every mesh in the scene 404s.
  const assets = new AssetCache(createGltfSource(ASSET_BASE_URL));
  let dragged: AssetSummary | undefined;
  let disconnect: (() => void) | undefined;
  let sceneView: SceneView | undefined;
  let gameView: GameView | undefined;
  let frame: number | undefined;
  let detachResize: (() => void) | undefined;

  const selected = (): EntityId | null => store.getState().selection;

  const controller: EditorController = {
    session,
    store,

    select(entity) {
      store.getState().select(entity);
    },

    rename(name) {
      const entity = selected();
      if (entity === null) return;
      session.dispatch({ kind: 'RenameEntity', entity, name });
    },

    reparent(entity, parent) {
      // Asked before dispatching: the World answers an illegal reparent with an
      // exception, and a cycle guard firing mid-drag is not a user interface.
      if (!canReparent(session.world, entity, parent)) return;
      if (session.world.getParent(entity) === parent) return;
      session.dispatch({ kind: 'SetParent', entity, parent });
    },

    setField(type, field, raw) {
      const entity = selected();
      if (entity === null) return;
      const spec = session.registry.get(type)?.[field];
      if (!spec) return;

      const value = coerceFieldValue(spec, raw);
      // `undefined` means the control holds something unusable — a half-typed
      // number, an empty required field. Writing it would produce a scene the
      // server then refuses, far from the keystroke that caused it.
      if (value === undefined) return;

      const current = session.world.get(entity, type);
      if (!current) return;
      session.dispatch({
        kind: 'SetComponent',
        entity,
        type,
        data: { ...current, [field]: value },
      });
    },

    addComponent(type) {
      const entity = selected();
      if (entity === null || session.world.has(entity, type)) return;
      session.dispatch({
        kind: 'AddComponent',
        entity,
        type,
        data: session.registry.createDefault(type),
      });
    },

    removeComponent(type) {
      const entity = selected();
      if (entity === null || !session.world.has(entity, type)) return;
      session.dispatch({ kind: 'RemoveComponent', entity, type });
    },

    describeComponent(type, data) {
      return describeComponent(session.registry, type, data);
    },

    addableComponents(present) {
      return addableComponents(session.registry, present);
    },

    beginDrag(asset) {
      dragged = asset;
    },

    draggedAsset() {
      return dragged;
    },

    endDrag() {
      dragged = undefined;
    },

    undo() {
      session.undo();
    },

    redo() {
      session.redo();
    },

    play() {
      gameView?.play();
      store.getState().setPhase('play');
    },

    stop() {
      gameView?.stop();
      store.getState().setPhase('edit');
    },

    async save() {
      await saveScene(session, client, session.sceneName);
    },

    async build(outDir = 'dist') {
      return runBuild(client, outDir);
    },

    async loadScene(name) {
      session.loadScene(await client.getScene(name));
      // The old engine mirrors a world that is gone.
      sceneView?.setWorld(session.world);
    },

    async refreshAssets() {
      store.getState().setAssets(await client.getAssets());
    },

    /**
     * The one place that needs a real DOM, and so the one place with nothing
     * worth unit testing: it wires already-tested pieces onto a canvas.
     */
    attachCanvas(canvas: HTMLCanvasElement) {
      if (sceneView) return;
      const renderer = createWebGLViewport(canvas);
      sceneView = createSceneView({ session, assets, createRenderer: () => renderer });
      gameView = createGameView({ session, assets, createRenderer: () => renderer });

      let last = performance.now();
      const tick = (now: number): void => {
        const dt = Math.min((now - last) / 1000, 0.1);
        last = now;
        // Only one viewport draws at a time, as the spec requires.
        if (store.getState().phase === 'play') gameView?.step(dt);
        else sceneView?.step(dt);
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);

      const resize = (): void => {
        const { clientWidth, clientHeight } = canvas;
        sceneView?.resize(clientWidth, clientHeight);
        gameView?.resize(clientWidth, clientHeight);
      };
      resize();
      globalThis.addEventListener('resize', resize);
      detachResize = () => { globalThis.removeEventListener('resize', resize); };
    },

    detachCanvas() {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      detachResize?.();
      detachResize = undefined;
      gameView?.dispose();
      sceneView?.dispose();
      gameView = undefined;
      sceneView = undefined;
    },

    dispose() {
      this.detachCanvas();
      disconnect?.();
      store.getState().detach();
    },
  };

  const connect = options.connect ?? connectWatch;
  disconnect = connect({
    onEvent: (event) => {
      handleProjectEvent(event, session.sceneName, {
        isDirty: () => session.isDirty(),
        reloadAssets: () => void controller.refreshAssets(),
        reloadScene: (name) => void controller.loadScene(name),
        ...(options.onProblem ? { onProblem: options.onProblem } : {}),
      });
    },
  });

  return controller;
}
