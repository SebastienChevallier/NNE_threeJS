import type { ApiClient, BuildSummary } from './api/client.js';
import type { EditorSession } from './session.js';

/**
 * Saves the open scene.
 *
 * `markSaved` runs only after the server has accepted the write. Marking first
 * would clear the "unsaved" state at exactly the moment it matters most — a
 * failed save is when the user most needs to know the work is still only in
 * the browser.
 */
export async function saveScene(
  session: EditorSession,
  client: ApiClient,
  name: string,
): Promise<void> {
  await client.putScene(name, session.toSceneFile(name));
  session.markSaved();
}

/** Triggers a build. Any refusal from the server reaches the caller intact. */
export async function runBuild(client: ApiClient, outDir: string): Promise<BuildSummary> {
  return client.build(outDir);
}
