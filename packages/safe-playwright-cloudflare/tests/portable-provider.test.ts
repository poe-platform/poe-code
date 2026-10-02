import { expect, test } from 'vitest';
import { transportZone, WebSocketTransport } from '../scripts/portable-provider/transport.js';

test('a held handshake does not block or select another owner transport', async () => {
  const socket = () => ({ addEventListener() {}, send() {}, close() {} }) as unknown as WebSocket;
  const first = new WebSocketTransport(socket(), 'first');
  const second = new WebSocketTransport(socket(), 'second');
  const held = Promise.withResolvers<void>();
  let secondStarted = false;
  const pending = transportZone.run(first, async () => {
    await held.promise;
    expect(await WebSocketTransport.connect(undefined, first.endpoint)).toBe(first);
  });
  const independent = transportZone.run(second, async () => {
    secondStarted = true;
    expect(await WebSocketTransport.connect(undefined, second.endpoint + '?persistent=true')).toBe(second);
  });
  try {
    await Promise.resolve();
    await Promise.resolve();
    expect(secondStarted).toBe(true);
  } finally {
    held.resolve();
    await Promise.all([pending, independent]);
  }
  await expect(WebSocketTransport.connect(undefined, first.endpoint)).rejects.toThrow('unavailable');
});
