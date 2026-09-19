import type { BrowserWorker } from '@cloudflare/playwright';
import { createCloudflarePlaywrightAdapter, type BrowserCodeRuntime } from '@poe-platform/safe-bash/playwright/cloudflare';
import {
  createPlaywrightCli, parseBrowserProfile, encodeBrowserProfile,
  checkpointBrowserProfile, restoreBrowserProfile,
  type PlaywrightAdapter, type PlaywrightSessionPersistence,
} from '@poe-platform/safe-bash/playwright';

declare const binding: BrowserWorker;
declare const loader: WorkerLoader;
const runtime: BrowserCodeRuntime = { ownerId: 'trusted-host-key', loader };
const adapter: PlaywrightAdapter = createCloudflarePlaywrightAdapter(binding, undefined, runtime, {maxStorageBytes: 1048576});
const limits = {maxBytes: 1048576, maxTabs: 8};
declare const host: {load(name: string, signal: AbortSignal): Promise<Uint8Array | undefined>; save(name: string, bytes: Uint8Array, signal: AbortSignal): Promise<void>; remove(name: string, signal: AbortSignal): Promise<void>};
const persistence: PlaywrightSessionPersistence = {
  async restore({name, signal}) {
    const bytes = await host.load(name, signal);
    if (!bytes) return;
    const profile = parseBrowserProfile(bytes, limits);
    encodeBrowserProfile(profile, limits);
    return restoreBrowserProfile({adapter, profile, limits, name, signal});
  },
  async checkpoint(session, signal) { await host.save(session.name, await checkpointBrowserProfile(session, limits, signal), signal); },
  async delete(name, signal) { await host.remove(name, signal); },
};
createPlaywrightCli({adapter, persistence, limits: {maxSessions: 2, maxTabs: 8}});
