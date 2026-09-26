import { expect, it, vi } from 'vitest';
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

it('prepares independent upload bytes without the Node Buffer global', async () => {
  const adapter = createCloudflarePlaywrightAdapter({} as never);
  const resource = await adapter.acquire({ signal: new AbortController().signal } as never) as unknown as {
    prepareFileBytes(bytes: Uint8Array): Uint8Array;
  };
  vi.stubGlobal('Buffer', undefined);
  try {
    const original = new Uint8Array([0, 128, 255]);
    const prepared = resource.prepareFileBytes(original);
    expect(prepared).toEqual(original);
    original[0] = 42;
    expect(prepared[0]).toBe(0);
  } finally { vi.unstubAllGlobals(); }
});
