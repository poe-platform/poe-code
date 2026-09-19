import type { Browser, BrowserContext } from '@cloudflare/playwright';
import { expect, test, vi } from 'vitest';
import { encodeBrowserProfile, parseBrowserProfile } from '../../safe-bash/src/playwright/profile.js';
import { browserProfileRuntime } from '../src/browser-profile-runtime.js';
import { parseRunCodeState, serializeRunCodeState } from '../src/browser-run-code-state.js';
import { captureRunCodeState, replaceRunCodeContextInitScripts } from '../src/browser-run-code-native.js';

vi.mock('../src/browser-run-code-native.js', () => ({
  captureRunCodeState: vi.fn(),
  replaceRunCodeContextInitScripts: vi.fn(),
  restoreRunCodePageState: vi.fn(),
  restoreRunCodeTimeouts: vi.fn(),
}));
vi.mock('../src/browser-run-code-context-state.js', async importOriginal => ({
  ...await importOriginal<object>(),
  restoreRunCodeContextState: vi.fn(),
}));
const signal = new AbortController().signal;
const browser = {} as Browser;
const context = { pages: () => [] } as unknown as BrowserContext;
const script = `globalThis.profileInitialized = true; /*${'a'.repeat(70 * 1024)}*/`;
const state = {
  context: { headers: [], offline: false, geolocation: null },
  contextTimeouts: { action: null, navigation: null },
  contextInitScripts: [script],
  pages: [],
};
const limits = { maxBytes: 2 * 1024 * 1024, maxTabs: 8 };

test('profile checkpoint and cold restoration preserve configured scripts above 64 KiB', async () => {
  vi.mocked(captureRunCodeState).mockReturnValue(state);
  const saved = await browserProfileRuntime(browser, context).capture(signal);
  const bytes = encodeBrowserProfile({ state: { cookies: [], origins: [] }, tabs: [], selected: 0, runtimeState: saved }, limits);
  const restored = parseBrowserProfile(bytes, limits);
  await browserProfileRuntime(browser, context).restore(restored.runtimeState, signal);
  expect(replaceRunCodeContextInitScripts).toHaveBeenLastCalledWith(browser, context, [script]);
});

test('portable profile total budget still rejects oversized provider scripts', async () => {
  vi.mocked(captureRunCodeState).mockReturnValue({ ...state, contextInitScripts: ['a'.repeat(limits.maxBytes)] });
  const saved = await browserProfileRuntime(browser, context).capture(signal);
  expect(() => encodeBrowserProfile({ state: { cookies: [], origins: [] }, tabs: [], selected: 0, runtimeState: saved }, limits)).toThrow('Browser profile byte limit exceeded');
});

test('run-code transfer retains its 64 KiB cap', () => {
  expect(() => serializeRunCodeState(state)).toThrow('Run-code page state byte limit exceeded');
  expect(() => parseRunCodeState(JSON.stringify(state))).toThrow('Run-code page state byte limit exceeded');
});

test('profile capture and restoration retain script schema validation', async () => {
  const invalid = { ...state, contextInitScripts: [42] };
  vi.mocked(captureRunCodeState).mockReturnValue(invalid as unknown as typeof state);
  await expect(browserProfileRuntime(browser, context).capture(signal)).rejects.toThrow('Invalid run-code page state');
  await expect(browserProfileRuntime(browser, context).restore({ provider: '@cloudflare/playwright@1.3.6', state: invalid }, signal)).rejects.toThrow('Invalid run-code page state');
});
