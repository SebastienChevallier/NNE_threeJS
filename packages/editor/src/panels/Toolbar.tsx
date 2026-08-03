import type { ReactElement } from 'react';
import { useStore } from 'zustand';
import type { EditorStore } from '../store.js';

interface Props {
  store: EditorStore;
  onSave: () => void;
  onBuild: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onPlay: () => void;
  onStop: () => void;
}

export function Toolbar(props: Props): ReactElement {
  const { store } = props;
  const dirty = useStore(store, (s) => s.dirty);
  const canUndo = useStore(store, (s) => s.canUndo);
  const canRedo = useStore(store, (s) => s.canRedo);
  const phase = useStore(store, (s) => s.phase);
  const sceneName = useStore(store, (s) => s.sceneName);

  return (
    <header className="toolbar">
      <span className="scene-name">
        {sceneName}
        {dirty ? ' •' : ''}
      </span>
      <button type="button" onClick={props.onUndo} disabled={!canUndo}>Undo</button>
      <button type="button" onClick={props.onRedo} disabled={!canRedo}>Redo</button>
      {phase === 'edit'
        ? <button type="button" onClick={props.onPlay}>Play</button>
        : <button type="button" onClick={props.onStop}>Stop</button>}
      <button type="button" onClick={props.onSave} disabled={!dirty}>Save</button>
      <button type="button" onClick={props.onBuild}>Build</button>
    </header>
  );
}
