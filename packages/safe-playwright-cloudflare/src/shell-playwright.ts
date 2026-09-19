import type {
	Browser,
	BrowserContext,
	BrowserWorker,
	Frame,
	Page,
} from "@cloudflare/playwright";
import {
  createPlaywrightAdapter,
  replacePlaywrightStorageState,
  type PlaywrightPage,
  type PlaywrightAdapter,
} from "@poe-platform/safe-bash/playwright";
import { captureBrowserArtifact } from "./browser-artifact.js";
import {
	type BrowserCodeRuntime,
	createBrowserCodeExecutor,
} from "./browser-code-executor.js";
import { captureBrowserSnapshotJSON } from "./browser-snapshot-json.js";
import { captureBrowserTrace } from "./browser-trace.js";
import { acquireCloudflareBrowser } from "./shell-browser-resource.js";
import { browserProfileRuntime } from './browser-profile-runtime.js';

/** Cloudflare owns Chromium; the released CLI owns sessions, refs and artifacts. */
type BrowserStorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
type StorageContext = Omit<BrowserContext, "newCDPSession"> & {
	newCDPSession(
		page: PlaywrightPage | Frame,
	): ReturnType<BrowserContext["newCDPSession"]>;
};

export function createCloudflarePlaywrightAdapter(
  binding?: BrowserWorker,
	profiles?: {
		loadState(
			name: string,
			signal: AbortSignal,
		): Promise<BrowserStorageState | undefined>;
	},
  runtime?: BrowserCodeRuntime,
  limits: { maxStorageBytes: number } = { maxStorageBytes: 2 * 1024 * 1024 },
): PlaywrightAdapter {
  if (!Number.isSafeInteger(limits.maxStorageBytes) || limits.maxStorageBytes < 1) throw new TypeError('Invalid Cloudflare storage byte limit');
	const adapter = createPlaywrightAdapter({
		chromium: {
			headed: false,
			async acquireBrowser({ signal }) {
				signal.throwIfAborted();
				if (!binding)
					throw new Error("Playwright is unavailable: BROWSER binding missing");
				const { generateBrowserActionCode } = await import("./browser-codegen.js");
				const resource = await acquireCloudflareBrowser({ binding, signal });
				return {
					prepareStorageOrigin: resource.prepareStorageOrigin,
					executeCode: createBrowserCodeExecutor(resource, runtime),
					generateActionCode: generateBrowserActionCode,
					captureSnapshotJSON: captureBrowserSnapshotJSON,
					browser: publicBrowser(resource.browser),
					captureArtifact: captureBrowserArtifact,
					captureTrace: captureBrowserTrace,
					async captureDownload() {
						// Cloudflare's download APIs read a Worker-local path, while the
						// file lives in remote Chromium. CDP exposes no file-byte stream.
						throw new Error(
							"Cloudflare Browser Run does not support download artifact retrieval",
						);
					},
					prepareFileBytes: (bytes: Uint8Array) => Buffer.from(bytes),
					interrupt: resource.interrupt,
					release: resource.release,
				};
			},
		},
	});
	return {
		...adapter,
    async acquire(options: Parameters<typeof adapter.acquire>[0]) {
      options.signal.throwIfAborted();
      const state = options.contextOptions?.storageState ?? await profiles?.loadState(options.session, options.signal);
      options.signal.throwIfAborted();
      const lease = await adapter.acquire(
				state
					? {
							...options,
							contextOptions: {
								...options.contextOptions,
								storageState: state,
							},
						}
					: options,
      );
      if (!state) return lease;
      const cleanups: (() => Promise<void>)[] = [];
      const [result] = await Promise.allSettled([replacePlaywrightStorageState(lease.context, state, {
        signal: options.signal, maxBytes: limits.maxStorageBytes, registerCleanup: cleanup => cleanups.push(cleanup),
      })]);
      const outcomes = await Promise.allSettled(cleanups.map(cleanup => Promise.resolve().then(cleanup)));
      const failures = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected').map(outcome => outcome.reason);
      if (result!.status === 'rejected') failures.unshift(result!.reason);
      if (options.signal.aborted && result!.status === 'fulfilled') failures.unshift(options.signal.reason);
      if (!failures.length) return lease;
      try { await lease.release(); } catch (error) { failures.push(error); }
      if (failures.length === 1) throw failures[0];
      throw new AggregateError(failures, 'Cloudflare storage restoration and cleanup failed');
		},
	};
}

function publicBrowser(browser: Browser) {
	return {
    isConnected: browser.isConnected.bind(browser),
		on: browser.on.bind(browser),
		off: browser.off.bind(browser),
		async newContext(
			options?: Parameters<Browser["newContext"]>[0],
		): Promise<StorageContext> {
      // Provider restoration resolves record requests before transaction completion.
      // The acquired portable lease restores origins through held private targets.
      const { storageState: ignoredStorageState, ...contextOptions } = options ?? {};
      const context = await browser.newContext(contextOptions);
      Object.defineProperty(context, 'browserProfile', { value: browserProfileRuntime(browser, context) });
			const acquireCDP = context.newCDPSession.bind(context);
			return Object.assign(context, {
				async newCDPSession(page: PlaywrightPage | Frame) {
					return acquireCDP(ownedCDPTarget(context, page));
				},
			});
		},
	};
}

function ownedCDPTarget(
	context: BrowserContext,
	page: PlaywrightPage | Frame,
): Page | Frame {
	for (const nativePage of context.pages()) {
		if (nativePage === page) return nativePage;
		const frame = nativePage.frames().find((candidate) => candidate === page);
		if (frame) return frame;
	}
	throw new Error(
		"Native CDP requires a live page or frame owned by this context",
	);
}
