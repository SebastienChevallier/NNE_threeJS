import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { useStore } from 'zustand';
import type { ComponentType, EntityId } from '@nne/core';
import { Assets } from './panels/Assets.js';
import { Hierarchy } from './panels/Hierarchy.js';
import { Inspector } from './panels/Inspector.js';
import { Toolbar } from './panels/Toolbar.js';
import type { EditorController } from './controller.js';

interface Props {
  controller: EditorController;
}

/**
 * The fixed V1 layout: toolbar on top, hierarchy left, viewport centre,
 * inspector right, assets below. No docking — the spec puts that out of scope.
 *
 * Holds no decisions: every handler forwards to the controller, which is where
 * the logic and the tests live.
 */
export function App({ controller }: Props): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phase = useStore(controller.store, (s) => s.phase);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    controller.attachCanvas(canvas);
    return () => controller.detachCanvas();
  }, [controller]);

  return (
    <div className="app">
      <Toolbar
        store={controller.store}
        onSave={() => void controller.save()}
        onBuild={() => void controller.build()}
        onUndo={() => controller.undo()}
        onRedo={() => controller.redo()}
        onPlay={() => controller.play()}
        onStop={() => controller.stop()}
      />

      <main>
        <Hierarchy
          store={controller.store}
          onSelect={(entity: EntityId | null) => controller.select(entity)}
          onReparent={(entity, parent) => controller.reparent(entity, parent)}
        />

        <div className="viewport" data-phase={phase}>
          <canvas ref={canvasRef} />
        </div>

        <Inspector
          store={controller.store}
          describe={(type, data) => controller.describeComponent(type, data)}
          addable={(present: ComponentType[]) => controller.addableComponents(present)}
          onFieldChange={(type, field, raw) => controller.setField(type, field, raw)}
          onAddComponent={(type) => controller.addComponent(type)}
          onRemoveComponent={(type) => controller.removeComponent(type)}
          onRename={(name) => controller.rename(name)}
        />
      </main>

      <Assets store={controller.store} onDragStart={(asset) => controller.beginDrag(asset)} />
    </div>
  );
}
