import { expect, test } from "vitest";
import {
	createBrowserPrivateTransport,
	waitForBrowserSocketClose,
} from "../src/browser-private-transport";
import {
	createRunCodeCreationBudget,
	MAX_RUN_CODE_FRAME_BYTES,
} from "../src/browser-run-code-budget";
import {
	BROWSER_RUN_CODE_URL,
	type BrowserRunCodeReceiver,
} from "../src/browser-run-code-contract";
import { createRunCodeRelay } from "../src/browser-run-code-relay";
import { createBrowserStorageControl } from "../src/browser-storage-control";

function receiver(): BrowserRunCodeReceiver {
	const callback: BrowserRunCodeReceiver = {
		async frame() {},
		async close() {},
		dup() {
			return callback;
		},
		[Symbol.dispose]() {},
	};
	return callback;
}

function relay(connectSocket: (signal: AbortSignal) => Promise<WebSocket>) {
	const failures: unknown[] = [];
	const transport = createRunCodeRelay({
		signal: new AbortController().signal,
		connectSocket,
		creations: createRunCodeCreationBudget({
			maxPages: 8,
			pages: [],
			contexts: [],
		}),
		fail(error) {
			failures.push(error);
		},
	});
	return { ...transport, failures };
}

test("run-code admits a raw public transport and awaits its actual close", async () => {
	const pair = new WebSocketPair();
	pair[1].accept();
	const requested = Promise.withResolvers<void>();
	pair[1].addEventListener("close", () => requested.resolve(), { once: true });
	const guest = relay(async () => pair[0]);
	await guest.capability.open(BROWSER_RUN_CODE_URL, receiver());
	const closing = guest.close();
	void closing.catch(() => {});
	await requested.promise;
	pair[1].close(1000);
	await closing;
	expect(guest.failures).toEqual([]);
});

test("privacy disposal waits for physical upstream acknowledgement, not the virtual close", async () => {
	const pair = new WebSocketPair();
	pair[1].accept();
	const sentClose = Promise.withResolvers<void>();
	pair[1].addEventListener("close", () => sentClose.resolve(), { once: true });
	const privacy = createBrowserPrivateTransport();
	const socket = privacy.wrap(pair[0], new AbortController().signal);
	socket.accept();
	let settled = false;
	const closing = privacy.close().then(() => {
		settled = true;
	});
	try {
		await sentClose.promise;
		expect(settled).toBe(false);
	} finally {
		pair[1].close();
		await closing;
	}
	expect(settled).toBe(true);
});

test("a timed-out noncreation command leaves trusted control available for retirement and its late reply", async () => {
	const pair = new WebSocketPair();
	pair[1].accept();
	pair[1].addEventListener("close", () => pair[1].close(), { once: true });
	const control = createBrowserStorageControl({
		socket: pair[0],
		limits: { commandTimeoutMs: 1 },
	});
	pair[1].addEventListener("message", (event: MessageEvent<string>) => {
		const command = JSON.parse(event.data);
		if (command.method === "Target.closeTarget") {
			pair[1].send(
				JSON.stringify({ id: command.id, result: { success: true } }),
			);
			pair[1].send('{"id":1,"sessionId":"scratch","result":{}}');
		}
		if (command.method === "Browser.getVersion")
			pair[1].send(
				JSON.stringify({ id: command.id, result: { product: "native" } }),
			);
	});
	try {
		await expect(
			control.send("Runtime.evaluate", {}, "scratch"),
		).rejects.toThrow("timed out");
		expect(
			await control.send("Target.closeTarget", { targetId: "private" }),
		).toEqual({ success: true });
		expect(await control.send("Browser.getVersion")).toEqual({
			product: "native",
		});
	} finally {
		await control.close().catch(() => {});
	}
});

test("run-code shutdown retains the physical upstream close join behind its virtual socket", async () => {
	const pair = new WebSocketPair();
	pair[1].accept();
	const sentClose = Promise.withResolvers<void>();
	pair[1].addEventListener("close", () => sentClose.resolve(), { once: true });
	const privacy = createBrowserPrivateTransport();
	const socket = privacy.wrap(pair[0], new AbortController().signal);
	const guest = relay(async () => socket);
	await guest.capability.open(BROWSER_RUN_CODE_URL, receiver());
	const virtualClosed = new Promise<void>((resolve) =>
		socket.addEventListener("close", () => resolve(), { once: true }),
	);
	let settled = false;
	const closing = guest.close().then(() => {
		settled = true;
	});
	try {
		await sentClose.promise;
		await virtualClosed;
		expect(settled).toBe(false);
	} finally {
		pair[1].close();
		await closing;
		await privacy.close();
	}
	expect(guest.failures).toEqual([]);
});

test("run-code revocation during acquisition waits for the late socket's actual upstream close", async () => {
	const pair = new WebSocketPair();
	pair[1].accept();
	const sentClose = Promise.withResolvers<void>();
	pair[1].addEventListener("close", () => sentClose.resolve(), { once: true });
	const privacy = createBrowserPrivateTransport();
	const socket = privacy.wrap(pair[0], new AbortController().signal);
	const connection = Promise.withResolvers<WebSocket>();
	const guest = relay(async () => connection.promise);
	const opening = guest.capability.open(BROWSER_RUN_CODE_URL, receiver());
	const rejected = expect(opening).rejects.toThrow("revoked");
	let settled = false;
	const closing = guest.close().then(() => {
		settled = true;
	});
	try {
		await Promise.resolve();
		expect(settled).toBe(false);
	} finally {
		connection.resolve(socket);
		await rejected;
		await sentClose.promise;
		pair[1].close();
		await closing;
		await privacy.close();
	}
	expect(settled).toBe(true);
});

test("unregistered sockets cannot claim upstream confirmation", async () => {
	const pair = new WebSocketPair();
	pair[0].accept();
	pair[1].accept();
	try {
		await expect(waitForBrowserSocketClose(pair[0])).rejects.toThrow(
			"Untracked",
		);
	} finally {
		pair[0].close();
		pair[1].close();
	}
});

test("abnormal physical upstream closure remains an honest failure after client stop", async () => {
	const pair = new WebSocketPair();
	pair[1].accept();
	const privacy = createBrowserPrivateTransport();
	const controller = new AbortController();
	const socket = privacy.wrap(pair[0], controller.signal);
	socket.accept();
	const sentClose = new Promise<void>((resolve) =>
		pair[1].addEventListener("close", () => resolve(), { once: true }),
	);
	controller.abort();
	await sentClose;
	pair[1].close(1008, "provider refused close");
	await expect(waitForBrowserSocketClose(socket)).rejects.toThrow(
		"1008 provider refused close",
	);
	await expect(privacy.close()).rejects.toThrow("cleanup failed");
});

test("32 MiB service frame and pending contracts admit a scaled 16-to-32 boundary without giant allocations", async () => {
	expect(MAX_RUN_CODE_FRAME_BYTES).toBe(32 * 1024 * 1024);
	const unit = 256;
	const ceiling = 32 * unit;
	const pair = new WebSocketPair();
	pair[1].accept();
	pair[1].addEventListener("close", () => pair[1].close(), { once: true });
	const privacy = createBrowserPrivateTransport({
		maxMessageBytes: ceiling,
		maxPendingBytes: ceiling,
		maxBufferedBytes: ceiling,
	});
	const socket = privacy.wrap(pair[0], new AbortController().signal);
	socket.accept();
	const frame = JSON.stringify({
		id: 1,
		method: "Runtime.evaluate",
		params: { expression: "x".repeat(20 * unit) },
	});
	expect(new TextEncoder().encode(frame).length).toBeGreaterThan(16 * unit);
	expect(new TextEncoder().encode(frame).length).toBeLessThan(ceiling);
	const receipt = new Promise<string>((resolve) =>
		pair[1].addEventListener(
			"message",
			(event: MessageEvent<string>) => resolve(event.data),
			{ once: true },
		),
	);
	try {
		socket.send(frame);
		expect(await receipt).toBe(frame);
	} finally {
		await privacy.close();
	}
});

test("failed receiver admission drains run-code closure instead of stranding its pending-open join", async () => {
	const reason = new Error("receiver duplication failed");
	const callback = receiver();
	callback.dup = () => {
		throw reason;
	};
	const guest = relay(async () => {
		throw new Error("No browser connection should be attempted");
	});
	await expect(
		guest.capability.open(BROWSER_RUN_CODE_URL, callback),
	).rejects.toBe(reason);
	const deadline = AbortSignal.timeout(1);
	const expired = Promise.withResolvers<never>();
	const abort = () =>
		expired.reject(new Error("Receiver admission left closure pending"));
	deadline.addEventListener("abort", abort, { once: true });
	try {
		await Promise.race([guest.close(), expired.promise]);
	} finally {
		deadline.removeEventListener("abort", abort);
	}
});

test("run-code closure attempts receiver close and disposal and retains both true errors", async () => {
	const pair = new WebSocketPair();
	pair[1].accept();
	pair[1].addEventListener("close", () => pair[1].close(1000), { once: true });
	const privacy = createBrowserPrivateTransport();
	const socket = privacy.wrap(pair[0], new AbortController().signal);
	const closeError = new Error("receiver close failed");
	const disposeError = new Error("receiver dispose failed");
	const callback = receiver();
	callback.close = async () => {
		throw closeError;
	};
	callback[Symbol.dispose] = () => {
		throw disposeError;
	};
	const guest = relay(async () => socket);
	await guest.capability.open(BROWSER_RUN_CODE_URL, callback);
	const failure: unknown = await guest.close().then(
		() => undefined,
		(error: unknown) => error,
	);
	await privacy.close();
	if (!(failure instanceof AggregateError))
		throw new Error("Missing transport cleanup error");
	const [receiverError] = failure.errors;
	if (!(receiverError instanceof AggregateError))
		throw new Error("Missing receiver cleanup error");
	expect(receiverError.errors).toEqual([closeError, disposeError]);
});
