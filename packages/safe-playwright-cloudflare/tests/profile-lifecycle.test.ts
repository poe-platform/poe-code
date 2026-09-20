import { expect, test, vi } from 'vitest';
import { encodeBrowserProfile, parseBrowserProfile, restoreBrowserProfile } from '../../safe-bash/src/playwright/profile.js';
import type { PlaywrightAdapter, PlaywrightLease, PlaywrightPage } from '../../safe-bash/src/playwright/adapter.js';

const limits = { maxBytes: 4096, maxTabs: 2 };
const profile = { state: { cookies: [], origins: [] }, tabs: ['https://example.com', 'about:blank'], selected: 1 };

test('profile serialization roundtrips and enforces host byte and tab limits', () => {
  expect(parseBrowserProfile(encodeBrowserProfile(profile, limits), limits)).toEqual(profile);
  expect(() => encodeBrowserProfile(profile, { ...limits, maxBytes: 8 })).toThrow('byte limit');
  expect(() => parseBrowserProfile(Uint8Array.of(255), limits)).toThrow();
  expect(() => encodeBrowserProfile(profile, { ...limits, maxTabs: 1 })).toThrow();
});

function fixture() {
  const navigations: string[] = [];
  const pages = profile.tabs.map(() => ({ goto: vi.fn(async (url: string) => { navigations.push(url); }) }) as unknown as PlaywrightPage);
  let index = 0;
  const lease = { context: { pages: () => pages.slice(0, index), newPage: vi.fn(async () => pages[index++]!) }, release: vi.fn(async () => {}) } as unknown as PlaywrightLease;
  const adapter = { acquire: vi.fn(async () => lease) } as unknown as PlaywrightAdapter;
  return { lease, adapter, pages, navigations };
}

test('restoration retains selection and defers navigation until controller initialization', async () => {
  const f = fixture();
  const signal = new AbortController().signal;
  const restored = await restoreBrowserProfile({ adapter: f.adapter, profile, limits, name: 'host-owned', signal });
  expect(restored.selectedPage).toBe(f.pages[1]);
  expect(f.navigations).toEqual([]);
  await restored.initialize!({ signal });
  expect(f.navigations).toEqual(profile.tabs);
});

test('failed allocation retires the lease and preserves cleanup errors', async () => {
  const f = fixture();
  const failure = new Error('new page failed');
  const cleanup = new Error('release failed');
  vi.mocked(f.lease.context.newPage).mockRejectedValue(failure);
  vi.mocked(f.lease.release).mockRejectedValue(cleanup);
  const error = await restoreBrowserProfile({ adapter: f.adapter, profile, limits, name: 'host-owned', signal: new AbortController().signal }).catch(error => error);
  expect(error).toBeInstanceOf(AggregateError);
  expect(error.errors).toEqual([failure, cleanup]);
  expect(f.lease.release).toHaveBeenCalledOnce();
});

test('provider profile state is restored before any saved tab navigation', async () => {
  const f = fixture();
  const state = { provider: 'qualified-provider', settings: { timeout: 1234 } };
  const restore = vi.fn(async () => { expect(f.navigations).toEqual([]); });
  Object.assign(f.lease.context, { browserProfile: { restore } });
  const signal = new AbortController().signal;
  const restored = await restoreBrowserProfile({ adapter: f.adapter, profile: { ...profile, runtimeState: state }, limits, name: 'host-owned', signal });
  await restored.initialize!({ signal });
  expect(restore).toHaveBeenCalledWith(state, signal);
  expect(f.navigations).toEqual(profile.tabs);
});

test('unsupported provider settings fail restoration before navigation', async () => {
  const f = fixture();
  const signal = new AbortController().signal;
  const restored = await restoreBrowserProfile({ adapter: f.adapter, profile: { ...profile, runtimeState: {} }, limits, name: 'host-owned', signal });
  await expect(restored.initialize!({ signal })).rejects.toThrow('cannot restore');
  expect(f.navigations).toEqual([]);
});

test('interrupted profile recovery creates one inert page without replaying URLs or provider scripts', async () => {
  const f = fixture();
  const signal = new AbortController().signal;
  const restored = await restoreBrowserProfile({ adapter: f.adapter,
    profile: { ...profile, runtimeState: { scripts: ['sideEffect()'] }, configuration: { initPages: [{ filename: 'init.js', source: 'sideEffect()' }] } },
    limits, name: 'host-owned', signal, recovery: true });
  expect(restored.recovery).toBe('saved-storage');
  expect(f.lease.context.newPage).toHaveBeenCalledOnce();
  expect(restored.selectedPage).toBe(f.pages[0]);
  expect(restored.initialize).toBeUndefined();
  expect(restored.configuration).toBeUndefined();
  expect(f.navigations).toEqual([]);
});
