import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlaywrightPrivateTargetTransport, createPlaywrightStorageOriginPreparer, readPlaywrightStorageState, type PlaywrightStorageOperationOptions, type PlaywrightBrowserSource, type PlaywrightStorageControl, type PlaywrightStorageOriginPreparer, type PlaywrightCDPTransport } from '../../src/commands/playwright/index.js';

test('public command entrypoint exports storage control factories and acquired-resource types', () => {
  const upstream: PlaywrightCDPTransport = { send() {}, close() {} };
  const shield = createPlaywrightPrivateTargetTransport(upstream);
  const control: PlaywrightStorageControl = { async send() { return {}; }, subscribe() { return () => {}; } };
  const prepare: PlaywrightStorageOriginPreparer = createPlaywrightStorageOriginPreparer(control, shield);
  const resource: Pick<Awaited<ReturnType<PlaywrightBrowserSource['acquireBrowser']>>, 'prepareStorageOrigin'> = { prepareStorageOrigin: prepare };
  assert.equal(typeof resource.prepareStorageOrigin, 'function');
  const options: PlaywrightStorageOperationOptions = { signal: new AbortController().signal, maxBytes: 1024, registerCleanup() {} };
  assert.equal(typeof readPlaywrightStorageState, 'function');
  assert.equal(options.maxBytes, 1024);
  shield.transport.close();
});
