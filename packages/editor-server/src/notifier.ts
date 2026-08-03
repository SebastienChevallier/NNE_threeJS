import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ProjectEvent } from './types.js';

export interface Notifier {
  broadcast(event: ProjectEvent): void;
  count(): number;
  close(): Promise<void>;
}

/**
 * Pushes disk-change events to every connected editor.
 *
 * Shares the HTTP server rather than opening a second port: one port to
 * remember, and no cross-origin question between the API and the socket.
 */
export function createNotifier(server: Server): Notifier {
  // `noServer` plus an explicit upgrade handler, so any other path is rejected
  // instead of silently upgraded.
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();

  server.on('upgrade', (request, socket, head) => {
    const path = (request.url ?? '').split('?')[0];
    if (path !== '/api/watch') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      clients.add(ws);
      ws.on('close', () => clients.delete(ws));
      ws.on('error', () => clients.delete(ws));
    });
  });

  return {
    broadcast(event: ProjectEvent): void {
      const payload = JSON.stringify(event);
      for (const client of clients) {
        // A client can die between the iteration and the send; a failed push is
        // not worth taking the pipeline down for.
        if (client.readyState === client.OPEN) {
          try {
            client.send(payload);
          } catch {
            clients.delete(client);
          }
        }
      }
    },
    count: () => clients.size,
    close(): Promise<void> {
      for (const client of clients) client.close();
      clients.clear();
      return new Promise((resolve) => wss.close(() => resolve()));
    },
  };
}
