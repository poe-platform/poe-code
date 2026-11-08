import { EventEmitter } from 'node:events';
import { beforeEach, expect, test, vi } from 'vitest';

const { createServer } = vi.hoisted(() => ({ createServer: vi.fn() }));
vi.mock('node:http', () => ({ createServer }));
import { serveOrigin } from './node-origin.fixture';

beforeEach(() => createServer.mockReset());

test('origin shutdown closes the listener before its connections', async () => {
  const server = new EventEmitter();
  const calls: string[] = [];
  Object.assign(server, {
    listen: () => queueMicrotask(() => server.emit('listening')),
    address: () => ({ port: 1234 }),
    close: (callback: (error?: Error) => void) => {
      calls.push('listener');
      queueMicrotask(() => callback(calls[0] === 'listener' ? undefined : new Error('Server is not running.')));
    },
    closeAllConnections: () => calls.push('connections'),
  });
  createServer.mockReturnValue(server);
  const origin = await serveOrigin();
  await expect(origin.stop()).resolves.toBeUndefined();
  expect(calls).toEqual(['listener', 'connections']);
});

test('origin shutdown preserves listener errors', async () => {
  const server = new EventEmitter();
  const failure = new Error('Listener shutdown failed');
  Object.assign(server, {
    listen: () => queueMicrotask(() => server.emit('listening')),
    address: () => ({ port: 1234 }),
    close: (callback: (error?: Error) => void) => queueMicrotask(() => callback(failure)),
    closeAllConnections: vi.fn(),
  });
  createServer.mockReturnValue(server);
  await expect((await serveOrigin()).stop()).rejects.toBe(failure);
});
