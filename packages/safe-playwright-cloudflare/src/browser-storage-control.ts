import type {
	PlaywrightStorageControl,
	PlaywrightStorageControlEvent,
} from "@poe-platform/safe-bash/playwright";

/** Omitted limits are unlimited. Positive safe integers opt into individual budgets. */
export interface BrowserStorageControlLimits {
	maxMessageBytes?: number;
	maxPendingCommands?: number;
	maxPendingBytes?: number;
	maxLateReplies?: number;
	maxSubscriptions?: number;
	commandTimeoutMs?: number;
}

interface ControlMessage extends PlaywrightStorageControlEvent {
	id?: number;
	result?: Record<string, unknown>;
	error?: { message: string };
}

interface PendingCommand {
	sessionId: string | undefined;
	bytes: number;
	method: string;
	started: number;
	resolve(result: Record<string, unknown>): void;
	reject(error: unknown): void;
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function identifier(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		!value.includes("\0")
	);
}

function parseMessage(data: unknown, maxBytes: number): ControlMessage {
	if (
		typeof data !== "string" ||
		(Number.isFinite(maxBytes) && new TextEncoder().encode(data).length > maxBytes)
	)
		throw new Error("Owned storage control frame limit or type violation");
	const value: unknown = JSON.parse(data);
	if (!record(value)) throw new Error("Invalid owned storage control frame");
	if (value["sessionId"] !== undefined && !identifier(value["sessionId"]))
		throw new Error("Invalid owned storage control session");
	if (value["id"] !== undefined) return parseReply(value);
	if (
		!identifier(value["method"]) ||
		(value["params"] !== undefined && !record(value["params"]))
	)
		throw new Error("Invalid owned storage control event");
	return {
		method: value["method"],
		params: value["params"],
		sessionId: value["sessionId"],
	};
}

function parseReply(value: Record<string, unknown>): ControlMessage {
	if (
		typeof value["id"] !== "number" ||
		!Number.isSafeInteger(value["id"]) ||
		value["id"] <= 0
	)
		throw new Error("Invalid owned storage control reply ID");
	if (value["result"] !== undefined && !record(value["result"]))
		throw new Error("Invalid owned storage control result");
	const error = parseError(value["error"]);
	if ((value["result"] === undefined) === (value["error"] === undefined))
		throw new Error("Ambiguous owned storage control reply");
	return {
		method: "",
		id: value["id"],
		result: record(value["result"]) ? value["result"] : undefined,
		error,
		sessionId: identifier(value["sessionId"]) ? value["sessionId"] : undefined,
	};
}

function parseError(value: unknown): { message: string } | undefined {
	if (value === undefined) return;
	if (!record(value) || typeof value["message"] !== "string")
		throw new Error("Invalid owned storage control error");
	return { message: value["message"] };
}

export function createBrowserStorageControl(options: {
	socket: WebSocket;
	onEvent?(event: PlaywrightStorageControlEvent): void;
	limits?: BrowserStorageControlLimits;
}): PlaywrightStorageControl & { close(): Promise<void> } {
	for (const [name, value] of Object.entries(options.limits ?? {})) {
		if (value !== undefined && value !== Infinity && (!Number.isSafeInteger(value) || value <= 0))
			throw new TypeError(`Invalid storage control limit: ${name}`);
	}
	const limits = {
		maxMessageBytes: options.limits?.maxMessageBytes ?? Infinity,
		maxPendingCommands: options.limits?.maxPendingCommands ?? Infinity,
		maxPendingBytes: options.limits?.maxPendingBytes ?? Infinity,
		maxLateReplies: options.limits?.maxLateReplies ?? Infinity,
		maxSubscriptions: options.limits?.maxSubscriptions ?? Infinity,
		commandTimeoutMs: options.limits?.commandTimeoutMs ?? Infinity,
	};
	const { socket } = options;
	const pending = new Map<number, PendingCommand>();
	const lateReplies = new Map<number, string | undefined>();
	const listeners = new Set<(event: PlaywrightStorageControlEvent) => void>();
	const errors: unknown[] = [];
	let pendingBytes = 0;
	let sequence = 0;
	let closed: Error | undefined;
	let closing: Promise<void> | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let timedCommandId: number | undefined;

	function scheduleDeadline() {
		if (!Number.isFinite(limits.commandTimeoutMs) || closed) return;
		// One clock follows the oldest command; all commands share the selected timeout.
		const first = pending.entries().next().value;
		if (first?.[0] === timedCommandId) return;
		clearTimeout(timer);
		timer = undefined;
		timedCommandId = first?.[0];
		if (!first) return;
		const [id, command] = first;
		const remaining = limits.commandTimeoutMs - (performance.now() - command.started);
		timer = setTimeout(() => {
			timer = undefined;
			timedCommandId = undefined;
			if (performance.now() - command.started >= limits.commandTimeoutMs)
				expireCommand(id, command.method);
			// Long deadlines are chunked to avoid the native timer's signed-int overflow.
			scheduleDeadline();
		}, Math.min(Math.max(0, remaining), 2147483647));
	}

	function notifyDetached(reason: Error) {
		const event: PlaywrightStorageControlEvent = {
			method: "Inspector.detached",
			params: { reason: reason.message },
		};
		for (const listener of [options.onEvent, ...listeners]) {
			try {
				listener?.(event);
			} catch (error) {
				errors.push(error);
			}
		}
	}
	function shutdown(reason: Error) {
		if (closed) return;
		closed = reason;
		clearTimeout(timer);
		timer = undefined;
		timedCommandId = undefined;
		socket.removeEventListener("message", receive);
		socket.removeEventListener("close", disconnected);
		socket.removeEventListener("error", failed);
		notifyDetached(reason);
		for (const command of pending.values()) {
			command.reject(reason);
		}
		pending.clear();
		lateReplies.clear();
		pendingBytes = 0;
		listeners.clear();
		try {
			socket.close();
		} catch (error) {
			errors.push(error);
		}
	}
	function fail(error: unknown) {
		if (closed) return;
		const reason = error instanceof Error ? error : new Error(String(error));
		errors.push(reason);
		shutdown(reason);
	}
	function disconnected(event: CloseEvent) {
		fail(
			new Error(
				`Owned storage control disconnected: ${event.code} ${event.reason}`,
			),
		);
	}
	function failed() {
		fail(new Error("Owned storage control socket failed"));
	}
	function receive(event: MessageEvent) {
		try {
			const message = parseMessage(event.data, limits.maxMessageBytes);
			if (message.id !== undefined) {
				settle(message);
				return;
			}
			options.onEvent?.(message);
			for (const listener of [...listeners]) {
				if (closed) break;
				listener(message);
			}
		} catch (error) {
			fail(error);
		}
	}
	function settleLateReply(message: ControlMessage) {
		if (!lateReplies.has(message.id!))
			throw new Error("Unexpected owned storage control reply identity");
		if (lateReplies.get(message.id!) !== message.sessionId)
			throw new Error("Unexpected owned storage control late reply session");
		lateReplies.delete(message.id!);
	}
	function settle(message: ControlMessage) {
		const command = pending.get(message.id!);
		if (!command) {
			settleLateReply(message);
			return;
		}
		if (command.sessionId !== message.sessionId)
			throw new Error("Unexpected owned storage control reply identity");
		pending.delete(message.id!);
		pendingBytes -= command.bytes;
		scheduleDeadline();
		if (message.error) command.reject(new Error(message.error.message));
		else command.resolve(message.result!);
	}

	socket.addEventListener("message", receive);
	socket.addEventListener("close", disconnected);
	socket.addEventListener("error", failed);
	try {
		socket.accept();
	} catch (error) {
		fail(error);
	}
	function encodeCommand(
		method: string,
		params?: Record<string, unknown>,
		sessionId?: string,
	) {
		if (
			!identifier(method) ||
			(sessionId !== undefined && !identifier(sessionId))
		)
			throw new TypeError("Invalid owned storage control command identity");
		if (params !== undefined && !record(params))
			throw new TypeError("Invalid owned storage control command parameters");
		if (sequence >= Number.MAX_SAFE_INTEGER)
			throw new Error("Storage control ID capacity exceeded");
		const id = ++sequence;
		const data = JSON.stringify({ id, method, params, sessionId });
		const bytes = Number.isFinite(limits.maxMessageBytes) || Number.isFinite(limits.maxPendingBytes)
			? new TextEncoder().encode(data).length : 0;
		return { id, data, bytes };
	}
	function admitCommand(bytes: number) {
		if (bytes > limits.maxMessageBytes)
			throw new Error(`Owned storage control frame capacity exceeded (maxMessageBytes: ${limits.maxMessageBytes})`);
		if (pending.size >= limits.maxPendingCommands)
			throw new Error(`Owned storage control pending command capacity exceeded (maxPendingCommands: ${limits.maxPendingCommands})`);
		if (bytes > limits.maxPendingBytes - pendingBytes)
			throw new Error(`Owned storage control pending byte capacity exceeded (maxPendingBytes: ${limits.maxPendingBytes})`);
	}
	function expireCommand(id: number, method: string) {
		const command = pending.get(id);
		if (!command) return;
		const reason = new Error(
			`Owned storage control command timed out: ${method} (${limits.commandTimeoutMs}ms)`,
		);
		if (
			method === "Target.createTarget" ||
			lateReplies.size >= limits.maxLateReplies
		) {
			fail(
				method === "Target.createTarget"
					? reason
					: new Error(`Owned storage control late reply capacity exceeded (maxLateReplies: ${limits.maxLateReplies})`),
			);
			return;
		}
		pending.delete(id);
		pendingBytes -= command.bytes;
		lateReplies.set(id, command.sessionId);
		command.reject(reason);
	}

	return {
		async send(method, params, sessionId) {
			if (closed) throw closed;
			const { id, data, bytes } = encodeCommand(method, params, sessionId);
			admitCommand(bytes);
			const response = Promise.withResolvers<Record<string, unknown>>();
			pending.set(id, {
				...response,
				bytes,
				sessionId,
				method,
				started: performance.now(),
			});
			pendingBytes += bytes;
			scheduleDeadline();
			try {
				socket.send(data);
			} catch (error) {
				fail(error);
			}
			return await response.promise;
		},
		subscribe(listener) {
			if (closed) throw closed;
			if (listeners.size >= limits.maxSubscriptions)
				throw new Error(`Owned storage control subscription capacity exceeded (maxSubscriptions: ${limits.maxSubscriptions})`);
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		close() {
			shutdown(new Error("Owned storage control closed"));
			closing ??= Promise.resolve().then(() => {
				if (errors.length)
					throw new AggregateError(
						[...errors],
						"Owned storage control cleanup failed",
					);
			});
			return closing;
		},
	};
}
