import type { PlaywrightAdapter, PlaywrightPage, PlaywrightContext, PlaywrightContextOptions, PlaywrightStorageState } from './adapter.js';
import type { PlaywrightSessionCheckpoint, PlaywrightSessionPersistence } from './controller.js';
import { readPlaywrightStorageState } from './native-storage-replacement.js';
import { parsePlaywrightContextOptions } from './open-options.js';
import { type PlaywrightSessionConfiguration, parsePlaywrightSessionConfiguration } from './session-configuration.js';
import { parsePlaywrightStorageState } from './storage-state.js';

export interface BrowserProfile {
	state: PlaywrightStorageState;
	tabs: string[];
	selected: number;
	expiresAt?: number;
	idleTimeoutMs?: number;
	contextOptions?: PlaywrightContextOptions;
	configuration?: PlaywrightSessionConfiguration;
  /** Provider-qualified dynamic settings, validated by the restoring context. */
  runtimeState?: unknown;
}

export interface BrowserProfileContext extends PlaywrightContext {
  readonly browserProfile?: {
    capture(signal: AbortSignal): Promise<unknown>;
    restore(state: unknown, signal: AbortSignal): Promise<void>;
  };
}

/** Validate persisted JSON before it can allocate or navigate a browser. */
export function parseBrowserProfile(bytes: Uint8Array, limits: BrowserProfileLimits): BrowserProfile {
	validateProfileLimits(limits);
	if (bytes.byteLength > limits.maxBytes) throw new Error("Browser profile byte limit exceeded");
	const value: unknown = JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(bytes),
	);
	if (
		!value ||
		typeof value !== "object" ||
		!("state" in value) ||
		!("tabs" in value) ||
		!Array.isArray(value.tabs) ||
		value.tabs.length > limits.maxTabs ||
		!("selected" in value) ||
		typeof value.selected !== "number" ||
		!Number.isSafeInteger(value.selected) ||
		value.selected < 0 ||
		value.selected >= Math.max(1, value.tabs.length)
	)
		throw new Error("Invalid stored browser profile");
	const tabs: string[] = [];
	for (const tab of value.tabs) {
		if (typeof tab !== "string" || !URL.canParse(tab))
			throw new Error("Invalid stored browser tab");
		tabs.push(tab);
	}
	return {
		...profileSettings(value),
    state: parsePlaywrightStorageState(value.state, { maxBytes: limits.maxBytes }),
		tabs,
		selected: value.selected,
    ...('runtimeState' in value ? { runtimeState: value.runtimeState } : {}),
	};
}

function profileSettings(value: object) {
	const settings: Pick<
		BrowserProfile,
		"expiresAt" | "idleTimeoutMs" | "contextOptions" | "configuration"
	> = {};
	if ("expiresAt" in value) settings.expiresAt = timing(value.expiresAt);
	if ("idleTimeoutMs" in value)
		settings.idleTimeoutMs = timing(value.idleTimeoutMs);
	if ("contextOptions" in value) {
		settings.contextOptions = parsePlaywrightContextOptions(
			value.contextOptions,
		);
		if (settings.contextOptions.storageState)
			throw new Error(
				"Stored context options must use the current profile state",
			);
	}
	if ("configuration" in value)
		settings.configuration = parsePlaywrightSessionConfiguration(
			value.configuration,
		);
	return settings;
}

function timing(value: unknown) {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
		throw new Error("Invalid stored browser expiry");
	return value;
}

export interface BrowserProfileLimits { readonly maxBytes: number; readonly maxTabs: number; }

function validateProfileLimits(limits: BrowserProfileLimits) {
 if (!limits || !Number.isSafeInteger(limits.maxBytes) || limits.maxBytes <= 0 || !Number.isSafeInteger(limits.maxTabs) || limits.maxTabs <= 0) throw new TypeError("Invalid browser profile limits");
}

export function encodeBrowserProfile(profile: BrowserProfile, limits: BrowserProfileLimits): Uint8Array {
 validateProfileLimits(limits);
 const tabs = Object.getOwnPropertyDescriptor(profile, 'tabs')?.value;
 if (Array.isArray(tabs) && tabs.length > limits.maxTabs) throw new Error('Browser profile tab limit exceeded');
 const serialized = JSON.stringify(profile);
 let byteLength = 0;
 for (const character of serialized) {
  const point = character.codePointAt(0)!;
  byteLength += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  if (byteLength > limits.maxBytes) throw new Error('Browser profile byte limit exceeded');
 }
 const bytes = new TextEncoder().encode(serialized);
 parseBrowserProfile(bytes, limits);
 return bytes;
}

/** Return an initializer so the standard controller installs configuration before navigation. */
export async function restoreBrowserProfile(options: {
  adapter: PlaywrightAdapter; profile: BrowserProfile; limits: BrowserProfileLimits;
  name: string; signal: AbortSignal;
  /** Interrupted-owner recovery: storage only, one blank page, no script or URL replay. */
  recovery?: boolean;
}): Promise<NonNullable<Awaited<ReturnType<PlaywrightSessionPersistence['restore']>>>> {
  const { adapter, limits, name, signal } = options;
  signal.throwIfAborted();
  const profile = parseBrowserProfile(encodeBrowserProfile(options.profile, limits), limits);
  const lease = await adapter.acquire({
    acquisitionId: crypto.randomUUID(), session: name,
    browser: profile.configuration?.browserName ?? 'chromium',
    headless: profile.configuration?.headless ?? true,
    contextOptions: { ...profile.contextOptions, storageState: profile.state }, signal,
  });
  try {
    signal.throwIfAborted();
    const pages: PlaywrightPage[] = [];
    const urls = options.recovery ? ['about:blank'] : profile.tabs.length ? profile.tabs : ['about:blank'];
    if (lease.context.pages().length + urls.length > limits.maxTabs) throw new Error('Browser profile tab limit exceeded');
    for (const ignoredUrl of urls) {
      signal.throwIfAborted();
      pages.push(await lease.context.newPage());
    }
    signal.throwIfAborted();
    if (options.recovery) return {
      lease, selectedPage: pages[0]!, recovery: 'saved-storage', livePageStateLost: true,
      ...(profile.expiresAt === undefined ? {} : { expiresAt: profile.expiresAt }),
      ...(profile.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: profile.idleTimeoutMs }),
    };
    return {
      lease, selectedPage: pages[profile.selected]!, livePageStateLost: true,
      ...(profile.configuration === undefined ? {} : { configuration: profile.configuration }),
      ...(profile.contextOptions === undefined ? {} : { contextOptions: profile.contextOptions }),
      ...(profile.expiresAt === undefined ? {} : { expiresAt: profile.expiresAt }),
      ...(profile.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: profile.idleTimeoutMs }),
      async initialize({ signal }) {
        // The controller owns retirement after adoption, including failed navigation.
        if (profile.runtimeState !== undefined) {
          const runtime = (lease.context as BrowserProfileContext).browserProfile;
          if (!runtime) throw new Error('Browser adapter cannot restore provider profile settings');
          await runtime.restore(profile.runtimeState, signal);
        }
        for (let i = 0; i < pages.length; i++) {
          signal.throwIfAborted();
          await pages[i]!.goto(urls[i]!);
        }
      },
    };
  } catch (error) {
    try { await lease.release(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'Browser profile restoration and cleanup failed'); }
    throw error;
  }
}

/** Read closed-origin IndexedDB using isolated targets and settle every registered reader cleanup. */
export async function checkpointBrowserProfile(session: PlaywrightSessionCheckpoint, limits: BrowserProfileLimits, signal: AbortSignal): Promise<Uint8Array> {
  validateProfileLimits(limits);
  signal.throwIfAborted();
  checkpointPages(session, limits);
  const cleanups: (() => Promise<void>)[] = [];
  const [result] = await Promise.allSettled([readPlaywrightStorageState(session.context, {
    signal, indexedDB: true, maxBytes: limits.maxBytes, registerCleanup: cleanup => cleanups.push(cleanup),
  })]);
  const outcomes = await Promise.allSettled(cleanups.map(cleanup => Promise.resolve().then(cleanup)));
  const failures = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected').map(outcome => outcome.reason);
  if (result!.status === 'rejected' || signal.aborted) failures.unshift(result!.status === 'rejected' ? result!.reason : signal.reason);
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Browser profile checkpoint and cleanup failed');
  if (result!.status !== 'fulfilled') throw new Error('Browser profile checkpoint failed');
  const contextOptions = { ...session.contextOptions };
  delete contextOptions.storageState;
  const runtime = (session.context as BrowserProfileContext).browserProfile;
  const runtimeState = await runtime?.capture(signal);
  signal.throwIfAborted();
  const { pages, selected } = checkpointPages(session, limits);
  return encodeBrowserProfile({
    state: result!.value, contextOptions,
    tabs: pages.map(page => page.url()), selected,
    ...(session.configuration === undefined ? {} : { configuration: session.configuration }),
    ...(session.expiresAt === undefined ? {} : { expiresAt: session.expiresAt }),
    ...(session.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: session.idleTimeoutMs }),
    ...(runtimeState === undefined ? {} : { runtimeState }),
  }, limits);
}

function checkpointPages(session: PlaywrightSessionCheckpoint, limits: BrowserProfileLimits) {
  const pages = session.context.pages();
  if (pages.length > limits.maxTabs) throw new Error('Browser profile tab limit exceeded');
  const selected = session.selectedPage === undefined ? 0 : pages.indexOf(session.selectedPage);
  if (selected < 0) throw new Error('Browser profile selected page does not belong to the context');
  return { pages, selected };
}
