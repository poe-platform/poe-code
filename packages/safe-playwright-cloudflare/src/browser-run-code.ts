import type { CDPSession } from "@cloudflare/playwright";
import { PlaywrightResourceLimitError } from "@poe-platform/safe-bash/playwright";
import { browserPageCDP } from "./browser-page-cdp.js";
import type BrowserRunCodeGuest from "./browser-run-code-guest.js";
import {
	createRunCodeCreationBudget,
	MAX_RUN_CODE_CONTEXTS,
	MAX_RUN_CODE_TARGETS,
} from "./browser-run-code-budget.js";
import { restoreRunCodeContextState } from "./browser-run-code-context-state.js";
import type {
	BrowserRunCodeInput,
	BrowserRunCodeMetadata,
	BrowserRunCodeOptions,
} from "./browser-run-code-contract.js";
import {
	captureRunCodeContextState,
	captureRunCodePageState,
	captureRunCodeTimeouts,
	forgetClosedRunCodeContext,
	restoreRunCodePageState,
	restoreRunCodeTimeouts,
	runCodeContextOptions,
	validateRunCodeInitScripts,
} from "./browser-run-code-native.js";
import { createRunCodeRelay } from "./browser-run-code-relay.js";
import { parseRunCodeState } from "./browser-run-code-state.js";

const activeOwners = new Set<string>();
const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

class RunCodeUserError extends Error {}

function validate(input: BrowserRunCodeInput) {
	input.signal.throwIfAborted();
	if (new TextEncoder().encode(input.source).byteLength > MAX_SOURCE_BYTES)
		throw new PlaywrightResourceLimitError("Run-code source limit exceeded");
	for (const [value, maximum] of [
		[input.timeoutMs, 30_000],
		[input.maxOutputBytes, MAX_OUTPUT_BYTES],
		[input.maxPages, 64],
	] as const) {
		if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
			throw new PlaywrightResourceLimitError("Invalid run-code limits");
	}
}

async function identify(
	options: BrowserRunCodeOptions,
	input: BrowserRunCodeInput,
): Promise<BrowserRunCodeMetadata> {
	const cdp = await browserPageCDP(input.page);
	const { targetInfo } = await cdp.send("Target.getTargetInfo");
	if (!targetInfo.browserContextId)
		throw new Error("Run-code requires an owned private context");
	return {
		targetId: targetInfo.targetId,
		contextId: targetInfo.browserContextId,
		contextOptions: runCodeContextOptions(options.browser, input.page),
		state: {
			context: captureRunCodeContextState(
				options.browser,
				input.page.context(),
			),
			pages: input.page
				.context()
				.pages()
				.map((page) => captureRunCodePageState(options.browser, page)),
			contextInitScripts: [],
			contextTimeouts: captureRunCodeTimeouts(input.page.context()),
		},
		maxOutputBytes: input.maxOutputBytes,
	};
}

/** One execution per trusted owner. Browser identity never comes from source. */
export function createBrowserRunCode(options: BrowserRunCodeOptions) {
	if (!options.ownerId || options.ownerId.length > 256)
		throw new Error("Invalid browser owner");
	return async (input: BrowserRunCodeInput): Promise<unknown> => {
		validate(input);
		if (activeOwners.has(options.ownerId))
			throw new PlaywrightResourceLimitError(
				"Run-code owner execution limit exceeded",
			);
		activeOwners.add(options.ownerId);
		try {
			return await execute(options, input);
		} finally {
			activeOwners.delete(options.ownerId);
		}
	};
}

async function execute(
	options: BrowserRunCodeOptions,
	input: BrowserRunCodeInput,
) {
	const abort = new AbortController();
	const failed = Promise.withResolvers<never>();
	// Observe rejection immediately while setup itself is still awaiting RPCs.
	void failed.promise.catch(() => {});
	let relay: ReturnType<typeof createRunCodeRelay> | undefined;
	let retired: Promise<void> | undefined;
	const fail = (error: unknown) => {
		if (abort.signal.aborted) return;
		abort.abort(error);
		relay?.close();
		retired = Promise.resolve().then(options.retire);
		void retired.catch(() => {});
		failed.reject(error);
	};
	const onAbort = () => fail(input.signal.reason);
	input.signal.addEventListener("abort", onAbort, { once: true });
	const deadline = AbortSignal.timeout(input.timeoutMs);
	const onDeadline = () =>
		fail(new PlaywrightResourceLimitError("Run-code deadline exceeded"));
	deadline.addEventListener("abort", onDeadline, { once: true });
	try {
		input.signal.throwIfAborted();
		return await Promise.race([
			prepareAndRun(
				options,
				input,
				abort.signal,
				(value) => {
					relay = value;
				},
				fail,
			),
			failed.promise,
		]);
	} catch (error) {
		if (!(error instanceof RunCodeUserError)) fail(error);
		throw error;
	} finally {
		deadline.removeEventListener("abort", onDeadline);
		input.signal.removeEventListener("abort", onAbort);
		void relay?.close();
		await retired;
	}
}

async function prepareAndRun(
	options: BrowserRunCodeOptions,
	input: BrowserRunCodeInput,
	signal: AbortSignal,
	setRelay: (relay: ReturnType<typeof createRunCodeRelay>) => void,
	fail: (error: unknown) => void,
) {
	const metadata = await identify(options, input);
	signal.throwIfAborted();
	const observer = await options.browser.newBrowserCDPSession();
	try {
		const { targetInfos } = await observer.send("Target.getTargets");
		const { browserContextIds } = await observer.send(
			"Target.getBrowserContexts",
		);
		const foreign = targetInfos.filter(
			(target) =>
				target.type === "page" &&
				target.browserContextId !== metadata.contextId,
		);
		if (
			foreign.some(
				(target) =>
					target.url !== "about:blank" ||
					browserContextIds.includes(target.browserContextId ?? ""),
			)
		)
			throw new Error(
				// Keep the admission census in the message: callers commonly retain only String(error).
				// URL/title content is unnecessary to explain the guard and may contain private data.
				`Run-code cannot reconnect another existing browser context: ${JSON.stringify({
					ownedTargetId: metadata.targetId,
					ownedContextId: metadata.contextId,
					browserContextIds,
					foreignTargets: foreign.map((target) => ({
						targetId: target.targetId,
						contextId: target.browserContextId ?? null,
						type: target.type,
						urlState: target.url === "" ? "empty" : target.url === "about:blank" ? "about:blank" : "other",
						isPrivateContext: browserContextIds.includes(target.browserContextId ?? ""),
					})),
				})}`,
			);
		await Promise.all(
			foreign.map((target) =>
				observer.send("Target.closeTarget", { targetId: target.targetId }),
			),
		);
		const targets = new Map(
			targetInfos
				.filter((target) => target.browserContextId === metadata.contextId)
				.map((target) => [target.targetId, target.type]),
		);
		if (
			targets.size > MAX_RUN_CODE_TARGETS ||
			browserContextIds.length > MAX_RUN_CODE_CONTEXTS
		)
			throw new PlaywrightResourceLimitError(
				"Run-code browser resource limit exceeded",
			);
		const creations = createRunCodeCreationBudget({
			maxPages: input.maxPages,
			pages: [...targets]
				.filter(([, type]) => type === "page")
				.map(([id]) => id),
			contexts: browserContextIds,
		});
		observer.on("Target.targetCreated", ({ targetInfo }) => {
			try {
				targets.set(targetInfo.targetId, targetInfo.type);
				if (targets.size > MAX_RUN_CODE_TARGETS)
					throw new PlaywrightResourceLimitError(
						"Run-code target limit exceeded",
					);
				if (targetInfo.type === "page")
					creations.pageCreated(targetInfo.targetId);
			} catch (error) {
				fail(error);
			}
		});
		observer.on("Target.targetDestroyed", ({ targetId }) => {
			targets.delete(targetId);
			creations.pageDestroyed(targetId);
		});
		await observer.send("Target.setDiscoverTargets", { discover: true });
		signal.throwIfAborted();
		const relay = createRunCodeRelay({
			signal,
			connectSocket: options.connectSocket,
			creations,
			fail,
		});
		setRelay(relay);
		try {
			return await runGuest(options, input, metadata, relay, signal);
		} catch (error) {
			// Loader compilation can fail before any guest obtains browser access.
			if (!relay.opened()) {
				const detail = String(error);
				throw new RunCodeUserError(detail.includes("SyntaxError:")
					? `${detail}\nplaywright-cli run-code expects one JavaScript function accepting page, for example: async (page) => { return await page.title(); }`
					: detail);
			}
			throw error;
		} finally {
			const closing = relay.close();
			if (!signal.aborted) {
				await closing;
				signal.throwIfAborted();
				await restoreState(options, input, metadata, observer, signal);
			}
		}
	} finally {
		await observer.detach().catch(() => {});
	}
}

async function runGuest(
	options: BrowserRunCodeOptions,
	input: BrowserRunCodeInput,
	metadata: BrowserRunCodeMetadata,
	relay: ReturnType<typeof createRunCodeRelay>,
	signal: AbortSignal,
) {
	signal.throwIfAborted();
	const worker = options.loader.load({
		compatibilityDate: "2026-07-08",
		compatibilityFlags: ["nodejs_compat"],
		mainModule: "guest.js",
		modules: {
			"guest.js": options.guestSource,
			"browser-user-code.js": `export default (${input.source}\n);`,
		},
		limits: { cpuMs: 1000, subRequests: 4096 },
	});
	const entry =
		worker.getEntrypoint<BrowserRunCodeGuest>() as Fetcher<BrowserRunCodeGuest> &
			Partial<Disposable>;
	const result = entry.run(relay.capability, metadata);
	const dispose = () => {
		(result as Promise<unknown> & Partial<Disposable>)[Symbol.dispose]?.();
		entry[Symbol.dispose]?.();
	};
	signal.addEventListener("abort", dispose, { once: true });
	try {
		const response = await result;
		signal.throwIfAborted();
		const state = parseRunCodeState(response.stateJson);
		if (state.pages.length > input.maxPages)
			throw new PlaywrightResourceLimitError(
				"Run-code page state limit exceeded",
			);
		metadata.state = state;
		if (!response.ok)
			throw new RunCodeUserError(response.message.slice(0, 4096));
		const json = response.json;
		if (
			typeof json !== "string" ||
			new TextEncoder().encode(json).byteLength > input.maxOutputBytes
		)
			throw new PlaywrightResourceLimitError("Run-code output limit exceeded");
		return JSON.parse(json) as unknown;
	} finally {
		signal.removeEventListener("abort", dispose);
		dispose();
	}
}

/** Restore after the provider confirms the guest connection has closed. */
async function restoreState(
	options: BrowserRunCodeOptions,
	input: BrowserRunCodeInput,
	metadata: BrowserRunCodeMetadata,
	observer: CDPSession,
	signal: AbortSignal,
) {
	const { browserContextIds } = await observer.send(
		"Target.getBrowserContexts",
	);
	signal.throwIfAborted();
	if (!browserContextIds.includes(metadata.contextId)) {
		await forgetClosedRunCodeContext(
			options.browser,
			input.page.context(),
			metadata.contextId,
		);
		return;
	}
	const state = metadata.state;
	if (!options.browser.contexts().includes(input.page.context())) return;
	validateRunCodeInitScripts(options.browser, input.page.context(), state);
	await restoreRunCodeContextState(input.page.context(), state.context);
	restoreRunCodeTimeouts(input.page.context(), state.contextTimeouts);
	await Promise.all(
		state.contextInitScripts.map((source) =>
			input.page.context().addInitScript(source),
		),
	);
	await Promise.all(
		input.page
			.context()
			.pages()
			.map(async (page) => {
				if (page.isClosed()) return;
				const target = captureRunCodePageState(options.browser, page).targetId;
				const pageState = state.pages.find(
					(value) => value.targetId === target,
				);
				if (!pageState) throw new Error("Run-code page state is unavailable");
				await restoreRunCodePageState(options.browser, page, pageState);
				const hasTouch =
					runCodeContextOptions(options.browser, page).hasTouch === true;
				const cdp = await browserPageCDP(page);
				await cdp.send("Emulation.setTouchEmulationEnabled", {
					enabled: hasTouch,
					maxTouchPoints: hasTouch ? 1 : undefined,
				});
			}),
	);
}
