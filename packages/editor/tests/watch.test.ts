import { describe, expect, it, vi } from 'vitest';
import { connectWatch, handleProjectEvent, type WatchSocket } from '../src/api/watch.js';
import type { ProjectEvent } from '../src/api/client.js';

/** A socket we drive by hand: no server, no timers we do not control. */
function fakeSocket() {
  const sockets: {
    url: string;
    handlers: Record<string, ((event: unknown) => void)[]>;
    closed: boolean;
  }[] = [];

  const create = (url: string): WatchSocket => {
    const record = { url, handlers: {} as Record<string, ((e: unknown) => void)[]>, closed: false };
    sockets.push(record);
    return {
      addEventListener(type, listener) {
        record.handlers[type] = [...(record.handlers[type] ?? []), listener];
      },
      close() { record.closed = true; },
    };
  };

  return {
    create,
    sockets,
    latest: () => sockets[sockets.length - 1],
    emit(type: string, payload?: unknown) {
      for (const h of sockets[sockets.length - 1]?.handlers[type] ?? []) h(payload);
    },
    message(event: ProjectEvent) {
      this.emit('message', { data: JSON.stringify(event) });
    },
  };
}

describe('connectWatch', () => {
  it('connects to the watch endpoint', () => {
    const socket = fakeSocket();
    connectWatch({ createSocket: socket.create, onEvent: vi.fn() });
    expect(socket.latest()?.url).toContain('/api/watch');
  });

  it('delivers a parsed event', () => {
    const socket = fakeSocket();
    const onEvent = vi.fn();
    connectWatch({ createSocket: socket.create, onEvent });

    socket.message({ type: 'asset-changed', path: 'props/PRP_A.glb' });
    expect(onEvent).toHaveBeenCalledWith({ type: 'asset-changed', path: 'props/PRP_A.glb' });
  });

  it('ignores a malformed message instead of tearing the connection down', () => {
    // The socket is a network boundary: a garbled frame must not take out the
    // hot reload for the rest of the session.
    const socket = fakeSocket();
    const onEvent = vi.fn();
    connectWatch({ createSocket: socket.create, onEvent });

    socket.emit('message', { data: 'not json' });
    socket.message({ type: 'scene-changed', name: 'A' });
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('ignores a message that parses but is not an event', () => {
    const socket = fakeSocket();
    const onEvent = vi.fn();
    connectWatch({ createSocket: socket.create, onEvent });

    socket.emit('message', { data: '{"nope":1}' });
    socket.emit('message', { data: '[]' });
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('reconnects after the socket closes', () => {
    const socket = fakeSocket();
    const schedule = vi.fn();
    connectWatch({ createSocket: socket.create, onEvent: vi.fn(), schedule });

    socket.emit('close');
    expect(schedule).toHaveBeenCalledTimes(1);

    // Running the scheduled retry opens a new socket.
    (schedule.mock.calls[0]?.[0] as () => void)();
    expect(socket.sockets).toHaveLength(2);
  });

  it('backs off between attempts instead of hammering a dead server', () => {
    const socket = fakeSocket();
    const schedule = vi.fn();
    connectWatch({ createSocket: socket.create, onEvent: vi.fn(), schedule });

    const delays: number[] = [];
    for (let i = 0; i < 4; i++) {
      socket.emit('close');
      const call = schedule.mock.calls[i] as [() => void, number];
      delays.push(call[1]);
      call[0]();
    }
    expect(delays[1]).toBeGreaterThan(delays[0] as number);
    expect(delays[3]).toBeGreaterThan(delays[1] as number);
  });

  it('caps the backoff, so a long outage still recovers promptly', () => {
    const socket = fakeSocket();
    const schedule = vi.fn();
    connectWatch({ createSocket: socket.create, onEvent: vi.fn(), schedule });

    let last = 0;
    for (let i = 0; i < 20; i++) {
      socket.emit('close');
      const call = schedule.mock.calls[i] as [() => void, number];
      last = call[1];
      call[0]();
    }
    expect(last).toBeLessThanOrEqual(30_000);
  });

  it('resets the backoff once a connection succeeds', () => {
    const socket = fakeSocket();
    const schedule = vi.fn();
    connectWatch({ createSocket: socket.create, onEvent: vi.fn(), schedule });

    socket.emit('close');
    (schedule.mock.calls[0]?.[0] as () => void)();
    socket.emit('close');
    (schedule.mock.calls[1]?.[0] as () => void)();

    socket.emit('open');
    socket.emit('close');
    const afterSuccess = (schedule.mock.calls[2] as [() => void, number])[1];
    const firstEver = (schedule.mock.calls[0] as [() => void, number])[1];
    expect(afterSuccess).toBe(firstEver);
  });

  it('stops reconnecting once disconnected by the caller', () => {
    const socket = fakeSocket();
    const schedule = vi.fn();
    const disconnect = connectWatch({
      createSocket: socket.create, onEvent: vi.fn(), schedule,
    });

    disconnect();
    expect(socket.latest()?.closed).toBe(true);

    socket.emit('close');
    expect(schedule).not.toHaveBeenCalled();
  });

  it('delivers no event after disconnect', () => {
    const socket = fakeSocket();
    const onEvent = vi.fn();
    const disconnect = connectWatch({ createSocket: socket.create, onEvent });

    disconnect();
    socket.message({ type: 'scene-changed', name: 'A' });
    expect(onEvent).not.toHaveBeenCalled();
  });
});

describe('handleProjectEvent', () => {
  const handlers = () => ({
    isDirty: vi.fn().mockReturnValue(false),
    reloadAssets: vi.fn(),
    reloadScene: vi.fn(),
    onProblem: vi.fn(),
  });

  it('reloads the asset list when an asset changes or goes', () => {
    const h = handlers();
    handleProjectEvent({ type: 'asset-changed', path: 'a.glb' }, 'S', h);
    handleProjectEvent({ type: 'asset-removed', path: 'a.glb' }, 'S', h);
    expect(h.reloadAssets).toHaveBeenCalledTimes(2);
  });

  it('surfaces a failed import without reloading anything', () => {
    const h = handlers();
    handleProjectEvent({ type: 'asset-failed', path: 'a.glb', message: 'boom' }, 'S', h);
    expect(h.onProblem).toHaveBeenCalledWith('a.glb: boom');
    expect(h.reloadAssets).not.toHaveBeenCalled();
  });

  it('reloads the open scene when it changed on disk and nothing is unsaved', () => {
    const h = handlers();
    handleProjectEvent({ type: 'scene-changed', name: 'S' }, 'S', h);
    expect(h.reloadScene).toHaveBeenCalledWith('S');
  });

  it('never reloads over unsaved work', () => {
    // Overwriting the user's edits because a file moved on disk is worse than
    // being briefly out of step, and the dirty flag makes that visible.
    const h = handlers();
    h.isDirty.mockReturnValue(true);
    handleProjectEvent({ type: 'scene-changed', name: 'S' }, 'S', h);
    expect(h.reloadScene).not.toHaveBeenCalled();
  });

  it('ignores a change to a scene that is not open', () => {
    const h = handlers();
    handleProjectEvent({ type: 'scene-changed', name: 'Other' }, 'S', h);
    expect(h.reloadScene).not.toHaveBeenCalled();
  });
});
