import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { installPlaywrightNetworkPolicy } from '../../src/playwright/network-policy.js';

test('protocol message limits validate before effects and reject oversized UTF-8', async () => {
  const events = new EventEmitter();
  let sent = 0;
  let retired = 0;
  const socket = {
    addEventListener: events.on.bind(events),
    removeEventListener: events.off.bind(events),
    close() { events.emit('close'); },
    send(message: string) {
      sent++;
      const { id } = JSON.parse(message);
      queueMicrotask(() => events.emit('message', { data: JSON.stringify({ id, result: {} }) }));
    },
  };
  const options = { socket, directNetwork: 'blocked-by-host' as const,
    retire: async () => { retired++; }, fetch: async () => ({ status: 200, headers: [], body: new Uint8Array() }) };
  for (const cap of [0, 32 * 1024 * 1024 + 1]) {
    await assert.rejects(installPlaywrightNetworkPolicy({ ...options, maxProtocolMessageBytes: cap }), /protocol message limit/i);
  }
  assert.equal(sent, 0);
  assert.equal(retired, 0);
  const policy = await installPlaywrightNetworkPolicy({ ...options, maxProtocolMessageBytes: 256 });
  events.emit('message', { data: JSON.stringify({ method: 'ignored', params: 'é'.repeat(120) }) });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(retired, 1);
  await policy.dispose();
});
