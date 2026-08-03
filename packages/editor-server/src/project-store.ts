import { readFile, readdir } from 'node:fs/promises';
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

  /**
   * Validates the name, then confines the path.
   *
   * The allow-list is the real barrier; `containedJoin` is the net underneath.
   * Both, because they guard different mistakes — the regex against a hostile
   * request, the containment against a future loosening of the regex.
   */
  private sceneFile(name: string): string {
    if (!isValidSceneName(name)) {
      throw new HttpError(400, `invalid scene name "${name}"`);
    }
    return containedJoin(this.paths.scenes, `${name}.json`);
  }
}
