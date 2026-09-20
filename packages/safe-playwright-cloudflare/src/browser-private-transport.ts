import {
	createPlaywrightPrivateTargetTransport,
	type PlaywrightCDPTransport,
	type PlaywrightPrivateTargetCreation,
	type PlaywrightPrivateTargetTransportLimits,
	type PlaywrightStorageControlEvent,
} from "@poe-platform/safe-bash/playwright";
import {
	closeBrowserSocket,
	registerBrowserSocketClose,
} from "./browser-socket-closure.js";

export { waitForBrowserSocketClose } from "./browser-socket-closure.js";

export interface BrowserPrivateTransportOptions
	extends PlaywrightPrivateTargetTransportLimits {
	maxClients?: number;
}

interface PrivateClient {
	guard: ReturnType<typeof createPlaywrightPrivateTargetTransport>;
	upstream: PlaywrightCDPTransport;
	stop(error?: unknown): void;
}

interface Creation {
	active: boolean;
	failed?: boolean;
	tokens: Map<PrivateClient, PlaywrightPrivateTargetCreation>;
	destroyed: Set<string>;
	deadline: AbortSignal;
	expire(): void;
}

function targetIdentity(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 1024 &&
		!value.includes("\0")
	);
}

function protocolObject(data: unknown, maxBytes: number): object {
	if (
		typeof data !== "string" ||
		new TextEncoder().encode(data).length > maxBytes
	)
		throw new Error("Private browser frame limit or type violation");
	const value: unknown = JSON.parse(data);
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("Invalid private browser protocol frame");
	return value;
}

export function createBrowserPrivateTransport(
	options: BrowserPrivateTransportOptions = {},
) {
	const { maxClients = 8, ...guardOptions } = options;
	const maxTargets = options.maxPrivateTargets ?? 256;
	const maxBytes = options.maxMessageBytes ?? 16 * 1024 * 1024;
	const creationTimeoutMs = options.creationTimeoutMs ?? 2000;
	for (const [name, value] of Object.entries({
		...guardOptions,
		maxClients,
		maxTargets,
		maxBytes,
		creationTimeoutMs,
	})) {
		if (
			!Number.isSafeInteger(value) ||
			value <= 0 ||
			(name.endsWith("TimeoutMs") && value > 2147483647)
		)
			throw new TypeError(`Invalid private browser limit: ${name}`);
	}
	const clients = new Set<PrivateClient>();
	const rawClosures = new Set<Promise<void>>();
	const active = new Set<string>();
	const retired = new Set<string>();
	const errors: unknown[] = [];
	let creation: Creation | undefined;
	let closed: Error | undefined;
	let closing: Promise<void> | undefined;

	function check() {
		if (closed) throw closed;
	}
	function closeClients(reason: Error) {
		if (closed) return;
		closed = reason;
		if (creation) {
			creation.deadline.removeEventListener("abort", creation.expire);
			creation.active = false;
			creation.failed = true;
			creation = undefined;
		}
		for (const client of [...clients]) client.stop();
		active.clear();
		retired.clear();
	}
	function fail(error: unknown) {
		if (closed) return;
		const reason = error instanceof Error ? error : new Error(String(error));
		errors.push(reason);
		closeClients(reason);
	}
	function seed(client: PrivateClient) {
		for (const targetId of retired) {
			client.guard.beginCreation().commit(targetId);
			client.upstream.onmessage?.({
				method: "Target.targetDestroyed",
				params: { targetId },
			});
		}
		for (const targetId of active)
			client.guard.beginCreation().commit(targetId);
		if (creation) creation.tokens.set(client, client.guard.beginCreation());
	}
	function closeRejected(socket: WebSocket, error: unknown): never {
		try {
			registerBrowserSocketClose(socket);
			closeBrowserSocket(socket);
		} catch (cleanup) {
			throw new AggregateError(
				[error, cleanup],
				"Private client admission and cleanup failed",
			);
		}
		throw error;
	}
	function wrap(socket: WebSocket, signal: AbortSignal): WebSocket {
		try {
			check();
			signal.throwIfAborted();
		} catch (error) {
			return closeRejected(socket, error);
		}
		if (rawClosures.size >= maxClients)
			return closeRejected(
				socket,
				new Error("Private browser client capacity exceeded"),
			);
		const pair = new WebSocketPair();
		const rawClosed = registerBrowserSocketClose(socket, pair[0]);
		rawClosures.add(rawClosed);
		void rawClosed.then(
			() => rawClosures.delete(rawClosed),
			(error: unknown) => {
				rawClosures.delete(rawClosed);
				errors.push(error);
			},
		);
		const bridge = pair[1];
		let stopped = false;
		const upstream: PlaywrightCDPTransport = {
			open() {
				socket.accept();
			},
			send(message) {
				socket.send(JSON.stringify(message));
			},
			close() {
				client.stop();
			},
		};
		const guard = createPlaywrightPrivateTargetTransport(
			upstream,
			guardOptions,
		);
		const cleanup = (operation: () => void) => {
			try {
				operation();
			} catch (error) {
				errors.push(error);
			}
		};
		const client: PrivateClient = {
			guard,
			upstream,
			stop(error) {
				if (stopped) return;
				stopped = true;
				if (error !== undefined) errors.push(error);
				clients.delete(client);
				creation?.tokens.delete(client);
				signal.removeEventListener("abort", aborted);
				socket.removeEventListener("message", incoming);
				socket.removeEventListener("close", disconnected);
				socket.removeEventListener("error", socketFailed);
				bridge.removeEventListener("message", outgoing);
				bridge.removeEventListener("close", clientClosed);
				bridge.removeEventListener("error", socketFailed);
				cleanup(() => guard.transport.close());
				cleanup(() => closeBrowserSocket(socket));
				cleanup(() => bridge.close());
			},
		};
		function incoming(event: MessageEvent) {
			try {
				upstream.onmessage?.(protocolObject(event.data, maxBytes));
			} catch (error) {
				client.stop(error);
			}
		}
		function outgoing(event: MessageEvent) {
			try {
				guard.transport.send(protocolObject(event.data, maxBytes));
			} catch (error) {
				client.stop(error);
			}
		}
		function aborted() {
			client.stop();
		}
		function disconnected(event: CloseEvent) {
			client.stop(
				event.code === 1000
					? undefined
					: new Error(
							`Private browser disconnected: ${event.code} ${event.reason}`,
						),
			);
		}
		function socketFailed() {
			client.stop(new Error("Private browser socket failed"));
		}
		function clientClosed() {
			client.stop();
		}
		guard.transport.onmessage = (message) => {
			try {
				bridge.send(JSON.stringify(message));
			} catch (error) {
				client.stop(error);
			}
		};
		guard.transport.onclose = (reason) =>
			client.stop(new Error(reason ?? "Private browser transport failed"));
		try {
			bridge.accept();
			clients.add(client);
			seed(client);
			signal.addEventListener("abort", aborted, { once: true });
			socket.addEventListener("message", incoming);
			socket.addEventListener("close", disconnected);
			socket.addEventListener("error", socketFailed);
			bridge.addEventListener("message", outgoing);
			bridge.addEventListener("close", clientClosed);
			bridge.addEventListener("error", socketFailed);
			signal.throwIfAborted();
			guard.transport.open?.();
			if (stopped) throw new Error("Private browser closed during admission");
			return pair[0];
		} catch (error) {
			client.stop();
			throw error;
		}
	}
	function admitIdentity(entry: Creation, targetId: string) {
		if (
			!targetIdentity(targetId) ||
			active.has(targetId) ||
			retired.has(targetId) ||
			entry.destroyed.has(targetId)
		) {
			const error = new Error(
				"Invalid, reused or destroyed private target identity",
			);
			fail(error);
			throw error;
		}
		active.add(targetId);
	}
	function settleTokens(entry: Creation, targetId?: string) {
		for (const token of entry.tokens.values()) {
			if (targetId === undefined) token.rollback();
			else token.commit(targetId);
		}
	}
	function finish(entry: Creation, targetId?: string) {
		check();
		if (!entry.active || creation !== entry)
			throw new Error("Private creation is no longer active");
		if (targetId !== undefined) admitIdentity(entry, targetId);
		entry.deadline.removeEventListener("abort", entry.expire);
		entry.active = false;
		creation = undefined;
		try {
			settleTokens(entry, targetId);
		} catch (error) {
			entry.failed = true;
			fail(error);
			throw error;
		}
	}
	function beginCreation(): PlaywrightPrivateTargetCreation {
		check();
		if (creation) throw new Error("Private target creation already pending");
		if (active.size >= maxTargets)
			throw new Error("Private target active capacity exceeded");
		const entry: Creation = {
			active: true,
			tokens: new Map(),
			destroyed: new Set(),
			deadline: AbortSignal.timeout(creationTimeoutMs),
			expire: () =>
				fail(new Error("Private target creation identity timed out")),
		};
		creation = entry;
		entry.deadline.addEventListener("abort", entry.expire, { once: true });
		try {
			for (const client of clients)
				entry.tokens.set(client, client.guard.beginCreation());
		} catch (error) {
			fail(error);
			throw error;
		}
		return {
			commit(targetId) {
				finish(entry, targetId);
			},
			rollback() {
				finish(entry);
			},
			fail(error) {
				if (entry.failed) return;
				if (!entry.active || creation !== entry)
					throw new Error("Private creation is no longer active");
				fail(error);
			},
		};
	}
	function rememberDestroyed(targetId: string) {
		if (!creation) return;
		if (creation.destroyed.size >= maxTargets) {
			const error = new Error("Private creation retirement capacity exceeded");
			fail(error);
			throw error;
		}
		creation.destroyed.add(targetId);
	}
	function observe(event: PlaywrightStorageControlEvent) {
		check();
		if (event.method !== "Target.targetDestroyed") return;
		const targetId = event.params?.["targetId"];
		if (!targetIdentity(targetId)) {
			const error = new Error("Invalid native private retirement identity");
			fail(error);
			throw error;
		}
		if (!active.delete(targetId)) {
			rememberDestroyed(targetId);
			return;
		}
		retired.add(targetId);
		if (retired.size > maxTargets)
			retired.delete(retired.values().next().value!);
		for (const client of clients)
			client.upstream.onmessage?.({
				method: event.method,
				params: { targetId },
			});
	}
	return {
		wrap,
		beginCreation,
		observe,
		close(): Promise<void> {
			closeClients(new Error("Private browser coordinator closed"));
			closing ??= Promise.allSettled([...rawClosures]).then(() => {
				if (errors.length)
					throw new AggregateError(
						[...errors],
						"Private browser transport cleanup failed",
					);
			});
			return closing;
		},
	};
}
