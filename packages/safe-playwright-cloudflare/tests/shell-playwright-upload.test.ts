import { expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createCloudflarePlaywrightAdapter } from '../src/shell-playwright.js';

vi.mock('@poe-platform/safe-bash/playwright', () => ({
  createPlaywrightAdapter: (options: { chromium: { acquireBrowser(options: { signal: AbortSignal }): Promise<unknown> } }) => ({
    acquire: options.chromium.acquireBrowser,
  }),
  replacePlaywrightStorageState: vi.fn(),
}));
vi.mock('../src/shell-browser-resource.js', () => ({
  acquireCloudflareBrowser: async () => ({
    browser: { isConnected() { return true; }, on() {}, off() {} },
    prepareSnapshots() {}, interrupt() {}, release() {},
  }),
}));
vi.mock('../src/browser-codegen.js', () => ({ generateBrowserActionCode: vi.fn() }));
vi.mock('../src/browser-code-executor.js', () => ({ createBrowserCodeExecutor: vi.fn() }));

// Exercise the installed provider's actual protocol validator; do not duplicate it.
const provider = pathToFileURL(createRequire(import.meta.url).resolve('@cloudflare/playwright'));
await import(new URL('./playwright-core/src/protocol/validator.js', provider).href);
const { findValidator } = await import(new URL('./playwright-core/src/protocol/validatorPrimitives.js', provider).href);
const validateUpload = findValidator('ElementHandle', 'setInputFiles', 'Params');

it.each(['toBase64', 'buffer'])('prepares independent upload bytes accepted by the real SDK (%s)', async binary => {
  const adapter = createCloudflarePlaywrightAdapter({} as never);
  const resource = await adapter.acquire({ signal: new AbortController().signal } as never) as unknown as {
    prepareFileBytes(bytes: Uint8Array): Uint8Array;
  };
  const original = new Uint8Array([7, 0, 128, 255, 9]).subarray(1, 4);
  let prepared: Uint8Array;
  vi.stubGlobal('Buffer', undefined);
  try {
    prepared = resource.prepareFileBytes(original);
  } finally { vi.unstubAllGlobals(); }
  expect(Array.from(prepared)).toEqual([0, 128, 255]);
  original[0] = 42;
  expect(prepared[0]).toBe(0);

  // The SDK itself requires its normal Buffer global; only preparation promises
  // independence from that ambient global, not the whole native provider.
  const result = validateUpload({ payloads: [{ name: 'binary.bin', mimeType: '', buffer: prepared }], timeout: 5000 }, '', {
    binary, isUnderTest: () => false,
    tChannelImpl() { throw new Error('This payload must not contain a channel'); },
  });
  expect(result.payloads[0].buffer).toEqual(binary === 'toBase64' ? 'AID/' : prepared);
  prepared[1] = 33;
  expect(original[1]).toBe(128);
});
