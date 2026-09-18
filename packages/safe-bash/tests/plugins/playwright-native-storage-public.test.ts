import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlaywrightPrivateTargetTransport, createPlaywrightStorageOriginPreparer, type PlaywrightBrowserSource, type PlaywrightStorageControl, type PlaywrightStorageOriginPreparer, type PlaywrightCDPTransport } from '../../src/commands/playwright/index.js';

test('public command entrypoint exports storage control factories and acquired-resource types', () => {
  const upstream: PlaywrightCDPTransport = { send() {}, close() {} };
  const shield = createPlaywrightPrivateTargetTransport(upstream);
  const control: PlaywrightStorageControl = { async send() { return {}; }, subscribe() { return () => {}; } };
  const prepare: PlaywrightStorageOriginPreparer = createPlaywrightStorageOriginPreparer(control, shield);
  const resource: Pick<Awaited<ReturnType<PlaywrightBrowserSource['acquireBrowser']>>, 'prepareStorageOrigin'> = { prepareStorageOrigin: prepare };
  assert.equal(typeof resource.prepareStorageOrigin, 'function');
  shield.transport.close();
});
