import { describe, expect, it } from 'vitest';
import * as editor from '../src/index.js';

describe('public API', () => {
  it('exports every documented symbol', () => {
    for (const name of [
      'createController', 'EditorSession', 'createEditorStore',
      'createApiClient', 'assetUrl', 'connectWatch', 'handleProjectEvent',
      'saveScene', 'runBuild', 'buildHierarchy', 'canReparent',
      'describeComponent', 'coerceFieldValue', 'addableComponents',
      'dropAsset', 'groundDropPoint', 'createSceneView', 'createGameView',
      'cloneWorld', 'entityOf', 'pickEntity', 'createGizmoBridge',
      'framingFor', 'renderThumbnails',
    ]) {
      expect(editor).toHaveProperty(name);
    }
  });

  it('exports no React component: the chrome is not a library', () => {
    // App and the panels are the application, not its public surface. Exporting
    // them would invite importing the editor's UI into something else.
    for (const name of ['App', 'Hierarchy', 'Inspector', 'Assets', 'Toolbar']) {
      expect(editor).not.toHaveProperty(name);
    }
  });
});
