import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { installPlaywrightNetworkPolicy, type PlaywrightNetworkPolicyOptions } from '../../src/playwright/network-policy.js';

test('HTTP host denial is explicit and retains WebSocket blocking and retirement', async () => {
  const events = new EventEmitter();
  const sent: { method: string; params: { urls?: string[] } }[] = [];
  let retired = 0;
  const socket = {
    addEventListener: events.on.bind(events),
    removeEventListener: events.off.bind(events),
    close() { events.emit('close'); },
    send(message: string) {
      const command = JSON.parse(message);
      sent.push(command);
      queueMicrotask(() => events.emit('message', { data: JSON.stringify({ id: command.id, result: {} }) }));
    },
  };
  const options = { socket, retire: async () => { retired++; },
    fetch: async () => ({ status: 200, headers: [], body: new Uint8Array() }) };
  for (const directNetwork of [undefined, 'allowed-by-host']) {
    await assert.rejects(installPlaywrightNetworkPolicy({ ...options, directNetwork } as PlaywrightNetworkPolicyOptions), /independent.*denial/i);
  }
  assert.equal(sent.length, 0);
  assert.equal(retired, 0);
  const policy = await installPlaywrightNetworkPolicy({ ...options, directNetwork: 'http-blocked-by-host' });
  events.emit('message', { data: JSON.stringify({ method: 'Target.attachedToTarget', params: {
    sessionId: 'page', waitingForDebugger: true, targetInfo: { targetId: 'page', type: 'page', url: '' },
  } }) });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(sent.find(command => command.method === 'Network.setBlockedURLs')?.params.urls, ['ws://*', 'wss://*']);
  socket.close();
  await policy.dispose();
  assert.equal(retired, 1);
});
