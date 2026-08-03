import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { createNotifier, type Notifier } from '../src/notifier.js';
import type { ProjectEvent } from '../src/types.js';

const event: ProjectEvent = { type: 'scene-changed', name: 'Scene_01' };

describe('createNotifier', () => {
  let http: Server;
  let notifier: Notifier;
  let url: string;

  beforeEach(async () => {
    http = createHttpServer();
    notifier = createNotifier(http);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}/api/watch`;
  });
  afterEach(async () => {
    await notifier.close();
    await new Promise((resolve) => http.close(resolve));
  });

  function connect(path = '/api/watch'): Promise<WebSocket> {
    const socket = new WebSocket(url.replace('/api/watch', path));
    return new Promise((resolve, reject) => {
      socket.once('open', () => resolve(socket));
      socket.once('error', reject);
    });
  }

  it('delivers an event to a connected client', async () => {
    const socket = await connect();
    const received = new Promise<string>((resolve) =>
      socket.once('message', (d) => resolve(String(d))));
    notifier.broadcast(event);
    expect(JSON.parse(await received)).toEqual(event);
    socket.close();
  });

  it('delivers to every client', async () => {
    const a = await connect();
    const b = await connect();
    const both = Promise.all([a, b].map((s) =>
      new Promise<string>((resolve) => s.once('message', (d) => resolve(String(d))))));
    notifier.broadcast(event);
    const messages = await both;
    expect(messages.map((m) => JSON.parse(m) as ProjectEvent)).toEqual([event, event]);
    a.close();
    b.close();
  });

  it('drops a disconnected client from the count', async () => {
    const socket = await connect();
    expect(notifier.count()).toBe(1);
    socket.close();
    await vi.waitFor(() => expect(notifier.count()).toBe(0), { timeout: 5000 });
  });

  it('broadcasting with no client connected is a no-op', () => {
    expect(() => notifier.broadcast(event)).not.toThrow();
  });

  it('refuses a connection on another path', async () => {
    await expect(connect('/api/other')).rejects.toThrow();
  });

  it('closes every client on close', async () => {
    const socket = await connect();
    const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
    await notifier.close();
    await closed;
  });
});
