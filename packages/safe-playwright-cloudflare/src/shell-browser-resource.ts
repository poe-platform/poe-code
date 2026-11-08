import type { Browser, BrowserWorker } from "@cloudflare/playwright";
import { createPlaywrightStorageOriginPreparer } from "@poe-platform/safe-bash/playwright";
import {
	createBrowserPrivateTransport,
  type BrowserPrivateTransportOptions,
	waitForBrowserSocketClose,
} from "./browser-private-transport.js";
import {
	beginBrowserOwnerShutdown,
	closeBrowserSocket,
	finalizeBrowserOwnerTermination,
	registerBrowserSocketClose,
} from "./browser-socket-closure.js";
import { createBrowserStorageControl } from "./browser-storage-control.js";
import { createBrowserSnapshotScheduler } from "./browser-snapshot-scheduler.js";

const BROWSER_IDLE_MS = 600_000;

/** Local deadlines are disabled unless explicitly configured. */
export interface BrowserResourceLimits {
	releaseTimeoutMs?: number;
	storageTimeoutMs?: number;
}

function validateDeadline(value: number | undefined): void {
	if (value !== undefined && value !== Infinity && (!Number.isSafeInteger(value) || value < 1 || value > 2147483647))
		throw new RangeError("Invalid browser resource deadline");
}

/** O(1): retain only the session created by this acquisition, never guest aliases. */
export async function acquireCloudflareBrowser(options: {
	binding: BrowserWorker;
	signal: AbortSignal;
  transportLimits?: BrowserPrivateTransportOptions;
  limits?: BrowserResourceLimits;
}) {
	const { binding, signal } = options;
	signal.throwIfAborted();
	validateDeadline(options.limits?.releaseTimeoutMs);
	validateDeadline(options.limits?.storageTimeoutMs);
	const { acquire, connect, prepareFileBytes, artifactFileSystem } = await import("#safe-playwright-provider");
	signal.throwIfAborted();
	const { sessionId } = await acquire(binding, { keep_alive: BROWSER_IDLE_MS });
	const owned = createOwnedConnections(binding, sessionId, options.transportLimits, options.limits);
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
		return { ...resource, prepareFileBytes, artifactFileSystem };
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

function createOwnedConnections(binding: BrowserWorker, sessionId: string, transportLimits: BrowserPrivateTransportOptions = {}, limits: BrowserResourceLimits = {}) {
	const sessionURL = `http://fake.host/v1/devtools/browser/${encodeURIComponent(sessionId)}`;
	const privacy = createBrowserPrivateTransport(transportLimits);
	const upstreams = new Set<WebSocket>();
	const clients = new AbortController();
	const snapshots = createBrowserSnapshotScheduler();
	const releaseTimeoutMs = limits.releaseTimeoutMs ?? Infinity;
	const storageTimeoutMs = limits.storageTimeoutMs ?? Infinity;
	const deleteBrowser = createCloudflareBrowserRelease({ binding, sessionId, releaseTimeoutMs });
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
		const interruption = reason ?? new Error("Owned browser clients interrupted");
		snapshots.stop(interruption);
		clients.abort(interruption);
	}
	// Keep successful and uncertain work across caller deadlines. Only a settled
	// failure permits another attempt at that phase.
	const cleanup = new Map<string, Promise<void>>();
	function attempt(phase: string, operation: () => void | Promise<void>): Promise<void> {
		const existing = cleanup.get(phase);
		if (existing) return existing;
		const completion = Promise.resolve().then(operation).catch(error => {
			cleanup.delete(phase);
			throw error;
		});
		cleanup.set(phase, completion);
		return completion;
	}
	function release() {
		if (releasing) return releasing;
		if (!released) {
			released = true;
			beginBrowserOwnerShutdown(upstreams);
			disconnect();
		}
		releasing = finishOwnedBrowserCleanup(
			[
				["snapshot capture", attempt("snapshot capture", () => snapshots.settled())],
				["storage control", attempt("storage control", () => control?.close())],
				["private transport", attempt("private transport", () => privacy.close())],
				["public connection", attempt("public connection", () => browser?.close())],
				["provider deletion", attempt("provider deletion", async () => {
					try {
						await deleteBrowser();
						finalizeBrowserOwnerTermination(upstreams, true);
					} catch (error) {
						finalizeBrowserOwnerTermination(upstreams, false);
						throw error;
					}
				})],
				["upstream closure", attempt("upstream closure", async () => {
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
				})],
			],
			releaseTimeoutMs === Infinity ? new AbortController().signal : AbortSignal.timeout(releaseTimeoutMs),
		).catch(error => {
			releasing = undefined;
			throw error;
		});
		return releasing;
	}
	async function setup(
		connect: typeof import("@cloudflare/playwright").connect,
		signal: AbortSignal,
	) {
		control = createBrowserStorageControl({
			socket: await rawSocket(signal),
			onEvent: privacy.observe,
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
			prepareSnapshots: snapshots.prepare,
			connectSocket,
			prepareStorageOrigin: createPlaywrightStorageOriginPreparer(
				control,
				privacy,
				{ timeoutMs: storageTimeoutMs },
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
	operations: [phase: string, completion: Promise<void>][],
	signal: AbortSignal,
): Promise<void> {
	const outcomes: PromiseSettledResult<void>[] = [];
	const completed = operations.map(([, operation], index) =>
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
	if (failures.length) {
		const failed = operations
			.filter((_, index) => outcomes[index]?.status === "rejected")
			.map(([phase]) => phase);
		const pending = operations
			.filter((_, index) => outcomes[index] === undefined)
			.map(([phase]) => phase);
		const details = [
			...(failed.length ? [`failed: ${failed.join(", ")}`] : []),
			...(pending.length ? [`pending: ${pending.join(", ")}`] : []),
		];
		throw new AggregateError(
			failures,
			`Owned browser release failed (${details.join("; ")})`,
		);
	}
}

/** Share in-flight deletion and retain success; settled failures permit retry. */
export function createCloudflareBrowserRelease(options: {
	binding: BrowserWorker;
	sessionId: string;
	releaseTimeoutMs?: number;
}) {
	validateDeadline(options.releaseTimeoutMs);
	let releasing: Promise<void> | undefined;
	return () => {
		releasing ??= deleteOwnedBrowser(options).catch(error => {
			releasing = undefined;
			throw error;
		});
		return releasing;
	};
}

async function deleteOwnedBrowser(options: {
	binding: BrowserWorker;
	sessionId: string;
	releaseTimeoutMs?: number;
}) {
	const timeout = options.releaseTimeoutMs ?? Infinity;
	const response = await options.binding.fetch(
		`http://fake.host/v1/devtools/browser/${encodeURIComponent(options.sessionId)}`,
		{ method: "DELETE", signal: timeout === Infinity ? new AbortController().signal : AbortSignal.timeout(timeout) },
	);
	await response.body?.cancel();
	// A previous DELETE may have succeeded despite a lost response.
	if (!response.ok && response.status !== 404)
		throw new Error(`Owned browser release failed: HTTP ${response.status}`);
}
