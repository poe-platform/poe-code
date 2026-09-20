import type { Browser, BrowserContext, Page } from "@cloudflare/playwright";
import { PlaywrightResourceLimitError } from "@poe-platform/safe-bash/playwright";
import { browserPageCDP } from "./browser-page-cdp.js";
import type { RunCodeContextState } from "./browser-run-code-context-state.js";
import type {
	BrowserRunCodeMetadata,
	RunCodeNativeContextOptions,
} from "./browser-run-code-contract.js";
import {
	MAX_PAGE_STATE_BYTES,
	MAX_RUN_CODE_INIT_SCRIPTS,
	type RunCodePageState,
	type RunCodeState,
	type RunCodeTimeouts,
} from "./browser-run-code-state.js";

interface NativeInitScript {
	source: string;
}

// Pinned @cloudflare/playwright 1.3.6 server/page.js InitScript wraps each source.
// Transferred sources already have the guest wrapper; host registration adds one.
const NATIVE_INIT_SCRIPT_WRAPPER_BYTES = new TextEncoder().encode(
	"(() => {\n      \n    })();",
).byteLength;

interface NativeContext {
	_browserContextId: string;
	_browserClosed(): void;
	_options: RunCodeNativeContextOptions;
	initScripts: NativeInitScript[];
	bindingsInitScript?: NativeInitScript;
  removeInitScripts(scripts: NativeInitScript[]): Promise<void>;
}
interface NativeBrowser {
	_defaultContext: NativeContext;
	_contexts: Map<string, NativeContext>;
}
interface NativePage {
	initScripts: NativeInitScript[];
	delegate: {
		_targetId: string;
		_mainFrameSession: {
			_metricsOverride?: {
				width: number;
				height: number;
				screenWidth: number;
				screenHeight: number;
				mobile: boolean;
				deviceScaleFactor: number;
				screenOrientation: {
					angle: number;
					type: "portraitPrimary" | "landscapePrimary";
				};
				dontSetVisibleSize?: boolean;
			};
		};
		updateEmulatedViewportSize(
			preserveWindowBoundaries: boolean,
		): Promise<void>;
		updateEmulateMedia(): Promise<void>;
		updateUserAgent(): Promise<void>;
	};
	emulatedSize(): RunCodePageState["size"];
	_setEmulatedSize(value: RunCodePageState["size"]): void;
	_emulatedMedia: RunCodePageState["media"];
}
interface NativeConnection {
	toImpl(value: Browser): NativeBrowser;
	toImpl(value: BrowserContext): NativeContext;
	toImpl(value: Page): NativePage;
}

function connection(browser: Browser) {
	return (browser as Browser & { _connection: NativeConnection })._connection;
}

/** CDP has no context-disposed event for another connection. Call only after
 * Target.getBrowserContexts confirms this owned context no longer exists. */
export async function forgetClosedRunCodeContext(
	browser: Browser,
	context: BrowserContext,
	contextId: string,
) {
	if (!browser.contexts().includes(context)) return;
	const nativeBrowser = connection(browser).toImpl(browser);
	const nativeContext = connection(browser).toImpl(context);
	if (nativeBrowser._contexts.get(contextId) !== nativeContext)
		throw new Error("Native Playwright context identity changed");
	const closed = context.waitForEvent("close", { timeout: 0 });
	nativeBrowser._contexts.delete(contextId);
	nativeContext.initScripts = [];
	nativeContext._browserClosed();
	await closed;
}

/** Native defaults live on the client, independently of browser context options. */
function timeoutSettings(value: BrowserContext | Page) {
	return (
		value as typeof value & {
			_timeoutSettings: {
				defaultTimeout(): number | undefined;
				defaultNavigationTimeout(): number | undefined;
				setDefaultTimeout(value: number | undefined): void;
				setDefaultNavigationTimeout(value: number | undefined): void;
			};
		}
	)._timeoutSettings;
}
export function captureRunCodeTimeouts(
	value: BrowserContext | Page,
): RunCodeTimeouts {
	const settings = timeoutSettings(value);
	return {
		action: settings.defaultTimeout() ?? null,
		navigation: settings.defaultNavigationTimeout() ?? null,
	};
}
export function restoreRunCodeTimeouts(
	value: BrowserContext | Page,
	timeouts: RunCodeTimeouts,
) {
	// The pinned native setters accept undefined to restore inheritance.
	const settings = timeoutSettings(value);
	settings.setDefaultTimeout(timeouts.action ?? undefined);
	settings.setDefaultNavigationTimeout(timeouts.navigation ?? undefined);
}

/** Pinned @cloudflare/playwright 1.3.6 reconnects incognito pages as default. */
export function adoptRunCodeContext(
	browser: Browser,
	metadata: BrowserRunCodeMetadata,
) {
	const native = connection(browser).toImpl(browser);
	if (!native._defaultContext || !(native._contexts instanceof Map))
		throw new Error("Unsupported native Playwright context implementation");
	const context = native._defaultContext;
	context._browserContextId = metadata.contextId;
	context._options = metadata.contextOptions;
	native._contexts.set(metadata.contextId, context);
	const client = browser.contexts()[0];
	if (!client) throw new Error("Native Playwright context missing");
	(
		client as BrowserContext & { _options: RunCodeNativeContextOptions }
	)._options = metadata.contextOptions;
	restoreRunCodeTimeouts(client, metadata.state.contextTimeouts);
}

export function captureRunCodePageState(
	browser: Browser,
	page: Page,
): RunCodePageState {
	const native = connection(browser).toImpl(page);
	return {
		targetId: native.delegate._targetId,
		viewport: page.viewportSize(),
		size: native.emulatedSize() ?? null,
		media: native._emulatedMedia,
		timeouts: captureRunCodeTimeouts(page),
		// Existing registrations belong to the retained connection. Reinstalling
		// them in the guest would execute each script twice on navigation.
		initScripts: [],
	};
}

/** Only scripts newly registered on the guest connection need transferring. */
export function captureRunCodeState(
	browser: Browser,
	context: BrowserContext,
): RunCodeState {
	if (!browser.contexts().includes(context))
		return {
			// Closed contexts have no native mapping and will not be restored.
			context: { headers: [], offline: false, geolocation: null },
			pages: [],
			contextInitScripts: [],
			contextTimeouts: captureRunCodeTimeouts(context),
		};
	const native = connection(browser).toImpl(context);
	return {
		context: captureRunCodeContextState(browser, context),
		pages: context.pages().map((page) => ({
			...captureRunCodePageState(browser, page),
			initScripts: connection(browser)
				.toImpl(page)
				.initScripts.map((script) => script.source),
		})),
		contextTimeouts: captureRunCodeTimeouts(context),
		contextInitScripts: native.initScripts
			.filter((script) => script !== native.bindingsInitScript)
			.map((script) => script.source),
	};
}

export function captureRunCodeContextState(
	browser: Browser,
	context: BrowserContext,
): RunCodeContextState {
	const options = connection(browser).toImpl(context)._options;
	return {
		headers:
			options.extraHTTPHeaders?.map(({ name, value }) => ({ name, value })) ??
			[],
		offline: options.offline ?? false,
		geolocation: options.geolocation ?? null,
	};
}

/** Replace configured registrations with their captured dynamic equivalents. */
export async function replaceRunCodeContextInitScripts(browser: Browser, context: BrowserContext, sources: readonly string[]) {
  const native = connection(browser).toImpl(context);
  await native.removeInitScripts(native.initScripts.filter(script => script !== native.bindingsInitScript));
  for (const source of sources) await context.addInitScript(source);
}

/** Admit the entire batch against live native registrations before transferring it.
 * Closed pages/contexts release capacity naturally; no lifetime counter is kept. */
export function validateRunCodeInitScripts(
	browser: Browser,
	context: BrowserContext,
	state: RunCodeState,
) {
	let count = 0;
	let bytes = 0;
	const encoder = new TextEncoder();
	const include = (source: string, wrapperBytes = 0) => {
		count++;
		bytes += encoder.encode(source).byteLength + wrapperBytes;
		if (count > MAX_RUN_CODE_INIT_SCRIPTS || bytes > MAX_PAGE_STATE_BYTES)
			throw new PlaywrightResourceLimitError(
				"Run-code retained init script limit exceeded",
			);
	};
	const native = connection(browser).toImpl(context);
	for (const script of native.initScripts)
		if (script !== native.bindingsInitScript) include(script.source);
	for (const source of state.contextInitScripts)
		include(source, NATIVE_INIT_SCRIPT_WRAPPER_BYTES);
	for (const page of context.pages())
		includePageInitScripts(browser, page, state.pages, include);
}

function includePageInitScripts(
	browser: Browser,
	page: Page,
	pages: RunCodePageState[],
	include: (source: string, wrapperBytes?: number) => void,
) {
	if (page.isClosed()) return;
	const retained = connection(browser).toImpl(page);
	for (const script of retained.initScripts) include(script.source);
	const incoming = pages.find(
		(value) => value.targetId === retained.delegate._targetId,
	);
	if (!incoming) throw new Error("Run-code page state is unavailable");
	for (const source of incoming.initScripts)
		include(source, NATIVE_INIT_SCRIPT_WRAPPER_BYTES);
}

/** Reconnecting CDP clients reset emulation on detach. Reapply the native state,
 * including user changes, and invalidate Chromium's now-stale metrics cache. */
export async function restoreRunCodePageState(
	browser: Browser,
	page: Page,
	state: RunCodePageState,
) {
	const native = connection(browser).toImpl(page);
	restoreRunCodeTimeouts(page, state.timeouts);
	(
		page as Page & { _viewportSize: RunCodePageState["viewport"] }
	)._viewportSize = state.viewport;
	native._setEmulatedSize(state.size);
	native._emulatedMedia = state.media;
	native.delegate._mainFrameSession._metricsOverride = undefined;
	const cdp = await browserPageCDP(page);

	await Promise.all([
		...state.initScripts.map((source) => page.addInitScript(source)),
		native.delegate.updateEmulatedViewportSize(true),
		native.delegate.updateEmulateMedia(),
		native.delegate.updateUserAgent(),
	]);
	const metrics = native.delegate._mainFrameSession._metricsOverride;
	if (metrics) {
		// Another CDP client's detach clears renderer emulation, but Chromium
		// retains this session's last metrics and ignores an identical override.
		// Clear that protocol cache before restoring repeated guest executions.
		await cdp.send("Emulation.clearDeviceMetricsOverride");
		await cdp.send("Emulation.setDeviceMetricsOverride", metrics);
	}
}

export function runCodeContextOptions(browser: Browser, page: Page) {
	const options = connection(browser).toImpl(page.context())._options;
	const { storageState: ignoredStorageState, ...result } = options;
	return result;
}

/** Pinned native target identity avoids page CDP detach resetting touch. */
export function runCodePageTarget(browser: Browser, page: Page) {
	const targetId = connection(browser).toImpl(page).delegate._targetId;
	if (typeof targetId !== "string" || !targetId)
		throw new Error("Unsupported native Playwright page implementation");
	return targetId;
}
