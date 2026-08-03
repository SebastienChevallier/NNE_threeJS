import type { ProjectEvent } from './client.js';

/** The part of WebSocket this module uses. Injectable, so it tests without one. */
export interface WatchSocket {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  close(): void;
}

export interface WatchOptions {
  onEvent: (event: ProjectEvent) => void;
  createSocket?: (url: string) => WatchSocket;
  /** Injectable timer, so backoff is testable without waiting for it. */
  schedule?: (run: () => void, delayMs: number) => void;
  url?: string;
}

const FIRST_RETRY_MS = 500;
const MAX_RETRY_MS = 30_000;

const EVENT_TYPES = new Set([
  'asset-changed', 'asset-removed', 'asset-failed', 'scene-changed',
]);

/** True only for a payload that really is one of the four events. */
function isProjectEvent(value: unknown): value is ProjectEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === 'string' && EVENT_TYPES.has(type);
}

function defaultSocket(url: string): WatchSocket {
  return new WebSocket(url) as unknown as WatchSocket;
}

/**
 * Keeps a live connection to the server's disk watcher, reconnecting when it
 * drops.
 *
 * The socket is a network boundary, so its payloads are untrusted in the same
 * way disk and UI input are: a garbled frame is dropped rather than allowed to
 * take out hot reload for the rest of the session.
 *
 * Reconnection backs off — restarting the server should not be met with a tight
 * retry loop — but caps, so a long outage still recovers within half a minute
 * of the server coming back.
 *
 * Returns a function that disconnects and stops retrying.
 */
export function connectWatch(options: WatchOptions): () => void {
  const createSocket = options.createSocket ?? defaultSocket;
  const schedule = options.schedule
    ?? ((run: () => void, delay: number) => { setTimeout(run, delay); });
  const url = options.url ?? '/api/watch';

  let socket: WatchSocket | undefined;
  let retryMs = FIRST_RETRY_MS;
  let stopped = false;

  const open = (): void => {
    if (stopped) return;
    socket = createSocket(url);

    socket.addEventListener('open', () => {
      // The connection worked, so the next outage starts from a short delay
      // again rather than inheriting the last one's backoff.
      retryMs = FIRST_RETRY_MS;
    });

    socket.addEventListener('message', (event: unknown) => {
      if (stopped) return;
      const data = (event as { data?: unknown }).data;
      if (typeof data !== 'string') return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      if (isProjectEvent(parsed)) options.onEvent(parsed);
    });

    socket.addEventListener('close', () => {
      if (stopped) return;
      const delay = retryMs;
      retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
      schedule(open, delay);
    });
  };

  open();

  return () => {
    stopped = true;
    socket?.close();
  };
}

export interface AssetEventHandlers {
  /** The scene has unsaved changes; used to decide whether to reload it. */
  isDirty: () => boolean;
  reloadAssets: () => void;
  reloadScene: (name: string) => void;
  onProblem?: (message: string) => void;
}

/**
 * Turns a disk event into an editor action.
 *
 * The one real decision: a `scene-changed` for the open scene does **not**
 * reload it while there are unsaved edits. Overwriting the user's work because
 * a file moved on disk is worse than being briefly out of step, and the dirty
 * flag already makes the divergence visible.
 */
export function handleProjectEvent(
  event: ProjectEvent,
  openScene: string,
  handlers: AssetEventHandlers,
): void {
  switch (event.type) {
    case 'asset-changed':
    case 'asset-removed':
      handlers.reloadAssets();
      return;
    case 'asset-failed':
      handlers.onProblem?.(`${event.path}: ${event.message}`);
      return;
    case 'scene-changed':
      if (event.name !== openScene) return;
      if (handlers.isDirty()) return;
      handlers.reloadScene(event.name);
  }
}
