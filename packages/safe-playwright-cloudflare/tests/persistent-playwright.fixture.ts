// Consumer persistence policy with the reusable lifecycle delegated to public profile APIs.
import type { BrowserWorker } from '@cloudflare/playwright';
import {
  createPlaywrightCli, parseBrowserProfile, restoreBrowserProfile,
  checkpointBrowserProfile as encodeCheckpoint,
  type PlaywrightSessionCheckpoint,
} from '@poe-platform/safe-bash/playwright';
import type { BrowserCodeRuntime } from '../src/browser-code-executor.js';
import { createCloudflarePlaywrightAdapter } from '../src/index.js';
import type { createBrowserProfileStore } from './browser-profile-store.fixture.js';

export const SHELL_PLAYWRIGHT_LIMITS = { maxSessions: 2, maxTabs: 8, maxArtifactBytes: 16 * 1024 * 1024 };
export const PROFILE_LIMITS = { maxBytes: 2 * 1024 * 1024, maxTabs: 8 };

export function createPersistentPlaywright(options: {
  binding?: BrowserWorker; profiles: ReturnType<typeof createBrowserProfileStore>; runtime?: BrowserCodeRuntime;
}) {
  const profiles = options.profiles;
  const adapter = createCloudflarePlaywrightAdapter(options.binding, {
    async loadState(name, signal) {
      const bytes = await profiles.load(name, signal);
      return bytes ? parseBrowserProfile(bytes, PROFILE_LIMITS).state : undefined;
    },
  }, options.runtime);
  async function resumableProfile(name: string, signal: AbortSignal) {
    const bytes = await profiles.load(name, signal, { resumeOnly: true });
    if (!bytes) return;
    const profile = parseBrowserProfile(bytes, PROFILE_LIMITS);
    if (profile.expiresAt !== undefined && profile.expiresAt <= Date.now()) {
      await profiles.markClosed(name, signal);
      return;
    }
    return profile;
  }
  return createPlaywrightCli({ adapter, limits: SHELL_PLAYWRIGHT_LIMITS, persistence: {
    async list(signal) {
      const sessions: {name: string; expiresAt?: number}[] = [];
      for (const name of await profiles.list(signal)) {
        const profile = await resumableProfile(name, signal);
        if (profile) sessions.push({ name, ...(profile.expiresAt === undefined ? {} : { expiresAt: profile.expiresAt }) });
      }
      return sessions;
    },
    async restore({ name, signal }) {
      const profile = await resumableProfile(name, signal);
      return profile ? restoreBrowserProfile({ adapter, profile, limits: PROFILE_LIMITS, name, signal }) : undefined;
    },
    async checkpoint(session, signal) {
      await profiles.save(session.name, await encodeCheckpoint(session, PROFILE_LIMITS, signal), signal);
    },
    async delete(name, signal) { signal.throwIfAborted(); await profiles.remove(name); },
    async close(name, signal) { await profiles.markClosed(name, signal); },
  } });
}

// Existing consumer test call shape; persistence remains a host callback.
export async function checkpointBrowserProfile(session: PlaywrightSessionCheckpoint, profiles: Pick<ReturnType<typeof createBrowserProfileStore>, 'save'>, signal: AbortSignal) {
  await profiles.save(session.name, await encodeCheckpoint(session, PROFILE_LIMITS, signal), signal);
}
