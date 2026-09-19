import type { Browser, BrowserWorker } from "@cloudflare/playwright";
import { createPlaywrightStorageOriginPreparer } from "@poe-platform/safe-bash/playwright";
import {
	createBrowserPrivateTransport,
	waitForBrowserSocketClose,
} from "./browser-private-transport.js";
import { MAX_RUN_CODE_FRAME_BYTES } from "./browser-run-code-budget.js";
import {
	beginBrowserOwnerShutdown,
	closeBrowserSocket,
	finalizeBrowserOwnerTermination,
	registerBrowserSocketClose,
} from "./browser-socket-closure.js";
import { createBrowserStorageControl } from "./browser-storage-control.js";

const BROWSER_IDLE_MS = 600_000;
const BROWSER_RELEASE_MS = 5_000;

/** O(1): retain only the session created by this acquisition, never guest aliases. */
export async function acquireCloudflareBrowser(options: {
	binding: BrowserWorker;
	signal: AbortSignal;
}) {
	const { binding, signal } = options;
	signal.throwIfAborted();
	const { acquire, connect } = await import("@cloudflare/playwright");
	signal.throwIfAborted();
	const { sessionId } = await acquire(binding, { keep_alive: BROWSER_IDLE_MS });
	const owned = createOwnedConnections(binding, sessionId);
	const canceled = Promise.withResolvers<never>();
	const onAbort = () => {
		canceled.reject(signal.reason);
		owned.disconnect(signal.reason);
	};
	signal.addEventListener("abort", onAbort, { once: true });
	try {
		signal.throwIfAborted();
		const resource = await Promise.race([
			owned.setup(connect, signal),
			canceled.promise,
		]);
		signal.throwIfAborted();
		return resource;
	} catch (error) {
		try {
			await owned.release();
		} catch (cleanup) {
			throw new AggregateError(
				[error, cleanup],
				"Browser acquisition and cleanup failed",
			);
		}
		throw error;
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
}

function createOwnedConnections(binding: BrowserWorker, sessionId: string) {
	const sessionURL = `http://fake.host/v1/devtools/browser/${encodeURIComponent(sessionId)}`;
	const protocolLimits = {
		maxMessageBytes: MAX_RUN_CODE_FRAME_BYTES,
		maxPendingBytes: MAX_RUN_CODE_FRAME_BYTES,
	};
	const privacy = createBrowserPrivateTransport({
		...protocolLimits,
		maxBufferedBytes: MAX_RUN_CODE_FRAME_BYTES,
	});
	const upstreams = new Set<WebSocket>();
	const clients = new AbortController();
	const deleteBrowser = createCloudflareBrowserRelease({ binding, sessionId });
	let control: ReturnType<typeof createBrowserStorageControl> | undefined;
	let browser: Browser | undefined;
	let released = false;
	let releasing: Promise<void> | undefined;

	async function rawSocket(signal: AbortSignal, init?: RequestInit) {
		signal.throwIfAborted();
		if (released) throw new Error("Owned browser resource released");
		const headers = new Headers(init?.headers);
		headers.set("Upgrade", "websocket");
		const handshake = new AbortController();
		const aborted = () => handshake.abort(signal.reason);
		signal.addEventListener("abort", aborted, { once: true });
		let response: Response;
		try {
			response = await binding.fetch(sessionURL, {
				...init,
				headers,
				signal: handshake.signal,
			});
		} finally {
			signal.removeEventListener("abort", aborted);
		}
		const socket = response.webSocket;
		if (!socket) {
			await response.body?.cancel();
			throw new Error(
				`Owned browser connection failed: HTTP ${response.status}`,
			);
		}
		const closed = registerBrowserSocketClose(socket);
		upstreams.add(socket);
		void closed.then(
			() => upstreams.delete(socket),
			() => {},
		);
		if (signal.aborted || released) {
			closeBrowserSocket(socket);
			await response.body?.cancel();
			signal.throwIfAborted();
			throw new Error("Owned browser resource released");
		}
		return socket;
	}
	async function connectSocket(signal: AbortSignal) {
		const lifetime = AbortSignal.any([signal, clients.signal]);
		return privacy.wrap(await rawSocket(lifetime), lifetime);
	}
	function disconnect(reason?: unknown) {
		clients.abort(reason ?? new Error("Owned browser clients interrupted"));
	}
	function attempt(operation: () => void | Promise<void>): Promise<void> {
		try {
			return Promise.resolve(operation());
		} catch (error) {
			return Promise.reject(error);
		}
	}
	function release() {
		if (releasing) return releasing;
		released = true;
		beginBrowserOwnerShutdown(upstreams);
		disconnect();
		releasing = finishOwnedBrowserCleanup(
			[
				attempt(() => control?.close()),
				attempt(() => privacy.close()),
				attempt(() => browser?.close()),
				attempt(async () => {
					try {
						await deleteBrowser();
						finalizeBrowserOwnerTermination(upstreams, true);
					} catch (error) {
						finalizeBrowserOwnerTermination(upstreams, false);
						throw error;
					}
				}),
				attempt(async () => {
					const outcomes = await Promise.allSettled(
						[...upstreams].map(waitForBrowserSocketClose),
					);
					const failures = outcomes
						.filter((outcome) => outcome.status === "rejected")
						.map((outcome) => outcome.reason);
					if (failures.length)
						throw new AggregateError(
							failures,
							"Owned browser upstream closure failed",
						);
				}),
			],
			AbortSignal.timeout(BROWSER_RELEASE_MS),
		);
		return releasing;
	}
	async function setup(
		connect: typeof import("@cloudflare/playwright").connect,
		signal: AbortSignal,
	) {
		control = createBrowserStorageControl({
			socket: await rawSocket(signal),
			onEvent: privacy.observe,
			limits: protocolLimits,
		});
		await control.send("Browser.getVersion");
		signal.throwIfAborted();
		const primaryBinding = {
      fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
					const socket = privacy.wrap(
						await rawSocket(signal, init),
						clients.signal,
					);
					return new Response(null, { status: 101, webSocket: socket });
        },
		};
		browser = await connect(primaryBinding, sessionId);
		signal.throwIfAborted();
		return {
			browser,
			connectSocket,
			prepareStorageOrigin: createPlaywrightStorageOriginPreparer(
				control,
				privacy,
			),
			async interrupt() {
				disconnect();
				await browser?.close();
			},
			release,
		};
	}
	return { setup, disconnect, release };
}

async function finishOwnedBrowserCleanup(
	operations: Promise<void>[],
	signal: AbortSignal,
): Promise<void> {
	const outcomes: PromiseSettledResult<void>[] = [];
	const completed = operations.map((operation, index) =>
		operation.then(
			() => {
				outcomes[index] = { status: "fulfilled", value: undefined };
			},
			(reason) => {
				outcomes[index] = { status: "rejected", reason };
			},
		),
	);
	const expired = Promise.withResolvers<void>();
	const onAbort = () => {
		outcomes[operations.length] = {
			status: "rejected",
			reason: new Error("Owned browser release deadline exceeded", {
				cause: signal.reason,
			}),
		};
		expired.resolve();
	};
	signal.addEventListener("abort", onAbort, { once: true });
	try {
		if (signal.aborted) onAbort();
		await Promise.race([Promise.all(completed), expired.promise]);
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
	const failures = outcomes
		.filter((outcome) => outcome.status === "rejected")
		.map((outcome) => outcome.reason);
	if (failures.length)
		throw new AggregateError(failures, "Owned browser release failed");
}

/** Concurrent cleanup paths share one deletion and the same provider outcome. */
export function createCloudflareBrowserRelease(options: {
	binding: BrowserWorker;
	sessionId: string;
}) {
	let releasing: Promise<void> | undefined;
	return () => {
		releasing ??= deleteOwnedBrowser(options);
		return releasing;
	};
}

async function deleteOwnedBrowser(options: {
	binding: BrowserWorker;
	sessionId: string;
}) {
	const response = await options.binding.fetch(
		`http://fake.host/v1/devtools/browser/${encodeURIComponent(options.sessionId)}`,
		{ method: "DELETE", signal: AbortSignal.timeout(BROWSER_RELEASE_MS) },
	);
	await response.body?.cancel();
	if (!response.ok)
		throw new Error(`Owned browser release failed: HTTP ${response.status}`);
}
