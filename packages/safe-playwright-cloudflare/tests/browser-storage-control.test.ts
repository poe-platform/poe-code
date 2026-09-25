import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
	createBrowserStorageControl,
	type BrowserStorageControlLimits,
} from "../src/browser-storage-control.js";

class ControlSocket extends EventTarget {
	sent: { id: number; sessionId?: string; params?: Record<string, unknown> }[] = [];
	closed = false;
	accept() {}
	send(data: string) { this.sent.push(JSON.parse(data)); }
	close() { this.closed = true; }
	receive(value: unknown) {
		this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) }));
	}
	reply(index: number, result: Record<string, unknown> = {}) {
		const { id, sessionId } = this.sent[index]!;
		this.receive({ id, sessionId, result });
	}
}

const cleanups: (() => Promise<void>)[] = [];
function fixture(limits?: BrowserStorageControlLimits, failed = false) {
	const socket = new ControlSocket();
	const control = createBrowserStorageControl({ socket: socket as unknown as WebSocket, limits });
	cleanups.push(async () => {
		if (failed) await expect(control.close()).rejects.toThrow("cleanup failed");
		else await control.close();
	});
	return { socket, control };
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
	// AbortSignal's native clock is otherwise outside Vitest's fake timers.
	vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
		const deadline = new AbortController();
		setTimeout(() => deadline.abort(new DOMException("Timed out", "TimeoutError")), milliseconds);
		return deadline.signal;
	});
});
afterEach(async () => {
	try { await Promise.all(cleanups.splice(0).map((close) => close())); }
	finally { vi.restoreAllMocks(); vi.useRealTimers(); }
});

test("omitted storage-control limits allow messages above 32 MiB in both directions", async () => {
	const { socket, control } = fixture();
	const value = "x".repeat(33 * 1024 * 1024);
	const response = control.send("Runtime.evaluate", { expression: value });
	const outcome = response.catch((error: unknown) => error);
	expect(socket.sent).toHaveLength(1);
	expect(socket.sent[0]!.params!.expression).toBe(value);
	socket.reply(0, { value });
	expect(await outcome).toEqual({ value });
	expect(socket.closed).toBe(false);
});

test("a selected message limit leaves pending count and aggregate bytes unlimited", async () => {
	const { socket, control } = fixture({ maxMessageBytes: 6 * 1024 * 1024 });
	const outcomes = Promise.allSettled(Array.from({ length: 130 }, (_, index) =>
		control.send("Runtime.evaluate", { expression: index < 2 ? "x".repeat(3 * 1024 * 1024) : "1" })));
	expect(socket.sent).toHaveLength(130);
	for (let index = 0; index < socket.sent.length; index++) socket.reply(index);
	expect((await outcomes).every((result) => result.status === "fulfilled")).toBe(true);
});

test("omitted subscription limits deliver events to more than 128 listeners", () => {
	const { socket, control } = fixture();
	const calls: number[] = [];
	const remove = Array.from({ length: 130 }, (_, index) => control.subscribe(() => { calls.push(index); }));
	socket.receive({ method: "Target.targetCreated", params: {} });
	expect(calls).toEqual(Array.from({ length: 130 }, (_, index) => index));
	for (const unsubscribe of remove) unsubscribe();
	socket.receive({ method: "Target.targetCreated", params: {} });
	expect(calls).toHaveLength(130);
});

test("omitted command deadlines keep pending commands alive beyond ten seconds", async () => {
	const { socket, control } = fixture({ maxSubscriptions: 1 });
	let settled = false;
	const outcome = control.send("Browser.getVersion").then(
		(result) => { settled = true; return result; },
		(error: unknown) => { settled = true; return error; },
	);
	await vi.advanceTimersByTimeAsync(10001);
	expect(settled).toBe(false);
	socket.reply(0, { product: "native" });
	expect(await outcome).toEqual({ product: "native" });
});

test("a configured deadline does not cap the number of late reply identities", async () => {
	const { socket, control } = fixture({ commandTimeoutMs: 5, maxPendingCommands: 1 });
	for (let index = 0; index < 130; index++) {
		const result = control.send("Runtime.evaluate", {}, `session-${index}`).catch((error: unknown) => error);
		await vi.advanceTimersByTimeAsync(5);
		expect(String(await result)).toContain("timed out");
	}
	for (let index = 129; index >= 0; index--) socket.reply(index);
	const recovery = control.send("Browser.getVersion");
	socket.reply(130, { product: "native" });
	expect(await recovery).toEqual({ product: "native" });
	expect(socket.closed).toBe(false);
});

test("valid protocol identities have no implicit length cap", async () => {
	const { socket, control } = fixture();
	const sessionId = "s".repeat(1025);
	const response = control.send("Runtime.evaluate", {}, sessionId);
	const outcome = response.catch((error: unknown) => error);
	expect(socket.sent).toHaveLength(1);
	socket.reply(0, { value: 1 });
	expect(await outcome).toEqual({ value: 1 });
});

test("internal unlimited sentinels remain valid when every control limit is supplied", async () => {
	const { socket, control } = fixture({
		maxMessageBytes: Infinity, maxPendingCommands: Infinity, maxPendingBytes: Infinity,
		maxLateReplies: Infinity, maxSubscriptions: Infinity, commandTimeoutMs: Infinity,
	});
	const response = control.send("Browser.getVersion");
	socket.reply(0);
	expect(await response).toEqual({});
	expect(vi.getTimerCount()).toBe(0);
});

test("long selected command deadlines are not shortened by native timer overflow", async () => {
	const { socket, control } = fixture({ commandTimeoutMs: 2147483647 + 3000 });
	let settled = false;
	const outcome = control.send("Runtime.evaluate").catch((error: unknown) => { settled = true; return error; });
	await vi.advanceTimersByTimeAsync(2147483647);
	expect(settled).toBe(false);
	await vi.advanceTimersByTimeAsync(2999);
	expect(settled).toBe(false);
	await vi.advanceTimersByTimeAsync(1);
	expect(String(await outcome)).toContain("timed out: Runtime.evaluate");
	socket.reply(0);
	expect(socket.closed).toBe(false);
	expect(vi.getTimerCount()).toBe(0);
});

test("out-of-order replies leave each remaining command's original deadline intact", async () => {
	const { socket, control } = fixture({ commandTimeoutMs: 10 });
	const first = control.send("Runtime.evaluate").catch((error: unknown) => error);
	await vi.advanceTimersByTimeAsync(3);
	const second = control.send("Browser.getVersion");
	await vi.advanceTimersByTimeAsync(3);
	let thirdSettled = false;
	const third = control.send("Runtime.evaluate").catch((error: unknown) => { thirdSettled = true; return error; });
	expect(vi.getTimerCount()).toBe(1);
	socket.reply(1);
	await second;
	await vi.advanceTimersByTimeAsync(4);
	expect(String(await first)).toContain("timed out");
	expect(thirdSettled).toBe(false);
	await vi.advanceTimersByTimeAsync(5);
	expect(thirdSettled).toBe(false);
	await vi.advanceTimersByTimeAsync(1);
	expect(String(await third)).toContain("timed out");
	socket.reply(0);
	socket.reply(2);
	expect(vi.getTimerCount()).toBe(0);
});

test("closing control rejects all pending work and cancels its deadline", async () => {
	const { control, socket } = fixture({ commandTimeoutMs: 10 });
	const outcomes = Promise.allSettled([control.send("Runtime.evaluate"), control.send("Browser.getVersion")]);
	await control.close();
	expect((await outcomes).map((outcome) => outcome.status)).toEqual(["rejected", "rejected"]);
	expect(socket.closed).toBe(true);
	expect(vi.getTimerCount()).toBe(0);
	await vi.advanceTimersByTimeAsync(20);
	await expect(control.send("Browser.getVersion")).rejects.toThrow("closed");
});

test("an explicit outgoing frame byte limit admits its exact UTF-8 boundary and preserves control on refusal", async () => {
	const params = { expression: "é".repeat(20) };
	const maxMessageBytes = new TextEncoder().encode(JSON.stringify({ id: 1, method: "Runtime.evaluate", params })).length;
	const { socket, control } = fixture({ maxMessageBytes });
	const exact = control.send("Runtime.evaluate", params);
	socket.reply(0);
	await exact;
	await expect(control.send("Runtime.evaluate", { expression: params.expression + "é" })).rejects.toThrow("frame capacity exceeded");
	const recovery = control.send("Browser.getVersion");
	socket.reply(1, { product: "native" });
	expect(await recovery).toEqual({ product: "native" });
	expect(socket.closed).toBe(false);
});

test("an explicit incoming frame limit still retires control when a reply cannot be admitted", async () => {
	const { socket, control } = fixture({ maxMessageBytes: 100 }, true);
	const rejected = expect(control.send("Runtime.evaluate")).rejects.toThrow("frame");
	socket.reply(0, { value: "x".repeat(101) });
	await rejected;
	expect(socket.closed).toBe(true);
});

test.each([
	{ maxPendingCommands: 1 },
	{ maxPendingBytes: new TextEncoder().encode('{"id":1,"method":"Browser.getVersion"}').length },
])("explicit pending budgets reject excess and free capacity after a reply: %j", async (limits) => {
	const { socket, control } = fixture(limits);
	const first = control.send("Browser.getVersion");
	await expect(control.send("Browser.getVersion")).rejects.toThrow("capacity exceeded");
	socket.reply(0);
	await first;
	const second = control.send("Browser.getVersion");
	socket.reply(1);
	expect(await second).toEqual({});
});

test("explicit subscription limits free capacity after unsubscribe", () => {
	const { control } = fixture({ maxSubscriptions: 1 });
	const unsubscribe = control.subscribe(() => {});
	expect(() => control.subscribe(() => {})).toThrow("subscription capacity exceeded");
	unsubscribe();
	expect(() => control.subscribe(() => {})).not.toThrow();
});

test.each([0, -1, NaN, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])("invalid explicit limits are rejected: %s", (value) => {
	const socket = new ControlSocket();
	for (const name of ["maxMessageBytes", "maxPendingCommands", "maxPendingBytes", "maxLateReplies", "maxSubscriptions", "commandTimeoutMs"]) {
		expect(() => createBrowserStorageControl({ socket: socket as unknown as WebSocket, limits: { [name]: value } })).toThrow("Invalid storage control limit");
	}
});

test("JavaScript null limits remain invalid while undefined fields are omitted", async () => {
	const socket = new ControlSocket();
	expect(() => createBrowserStorageControl({
		socket: socket as unknown as WebSocket,
		limits: { maxMessageBytes: null } as unknown as BrowserStorageControlLimits,
	})).toThrow("Invalid storage control limit");
	const { control, socket: unlimited } = fixture({ maxMessageBytes: undefined });
	const pending = control.send("Browser.getVersion");
	unlimited.reply(0);
	expect(await pending).toEqual({});
});
