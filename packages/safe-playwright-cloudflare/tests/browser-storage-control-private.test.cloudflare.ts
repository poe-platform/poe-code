import type { PlaywrightStorageControlEvent } from "@poe-platform/safe-bash/playwright";
import { afterEach, expect, test } from "vitest";
import {
	type BrowserStorageControlLimits,
	createBrowserStorageControl,
} from "../src/browser-storage-control";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((close) => close()));
});

function peer(
	failure = false,
	onEvent?: (event: PlaywrightStorageControlEvent) => void,
	limits?: BrowserStorageControlLimits,
) {
	const pair = new WebSocketPair();
	pair[1].accept();
	pair[1].addEventListener("close", () => pair[1].close(), { once: true });
	const observed: PlaywrightStorageControlEvent[] = [];
	const control = createBrowserStorageControl({
		socket: pair[0],
		limits,
		onEvent(event) {
			observed.push(event);
			onEvent?.(event);
		},
	});
	cleanups.push(async () => {
		if (failure)
			await expect(control.close()).rejects.toThrow("cleanup failed");
		else await control.close();
	});
	return { server: pair[1], control, observed };
}

test("trusted socket EOF notifies every subscriber of root detach without inventing target destruction", async () => {
	const owned = peer(true);
	const events: PlaywrightStorageControlEvent[] = [];
	owned.control.subscribe((event) => {
		events.push(event);
	});
	const pending = owned.control.send("Target.closeTarget", {
		targetId: "private",
	});
	owned.server.close(1000, "browser retired");
	await expect(pending).rejects.toThrow("disconnected: 1000 browser retired");
	expect(events).toEqual([
		{
			method: "Inspector.detached",
			params: {
				reason: "Owned storage control disconnected: 1000 browser retired",
			},
		},
	]);
	expect(owned.observed).toEqual(events);
	await expect(owned.control.send("Browser.getVersion")).rejects.toThrow(
		"disconnected",
	);
});

test("EOF reaches retirement subscribers even when there is no pending CDP command", async () => {
	const owned = peer(true);
	const events: PlaywrightStorageControlEvent[] = [];
	owned.control.subscribe((event) => {
		events.push(event);
	});
	const eof = new Promise<void>((resolve) =>
		owned.server.addEventListener("close", () => resolve(), { once: true }),
	);
	owned.server.close(1000, "retirement interrupted");
	await eof;
	expect(events.map((event) => event.method)).toEqual(["Inspector.detached"]);
});

test("session-scoped Inspector detach remains scoped and leaves root and other sessions usable", async () => {
	const owned = peer();
	const events: PlaywrightStorageControlEvent[] = [];
	owned.control.subscribe((event) => {
		events.push(event);
	});
	const root = owned.control.send("Browser.getVersion");
	const other = owned.control.send("Runtime.evaluate", {}, "other-session");
	const detached = {
		method: "Inspector.detached",
		params: { reason: "target_closed" },
		sessionId: "private-session",
	};
	owned.server.send(JSON.stringify(detached));
	owned.server.send('{"id":1,"result":{"product":"native"}}');
	owned.server.send(
		'{"id":2,"result":{"value":1},"sessionId":"other-session"}',
	);
	expect(await root).toEqual({ product: "native" });
	expect(await other).toEqual({ value: 1 });
	expect(events).toEqual([detached]);
	expect(owned.observed).toEqual(events);
});

test("callback failures cannot hide actual EOF from remaining retirement subscribers", async () => {
	const observerError = new Error("trusted observer failed");
	const listenerError = new Error("first subscriber failed");
	const owned = peer(true, () => {
		throw observerError;
	});
	owned.control.subscribe(() => {
		throw listenerError;
	});
	const events: PlaywrightStorageControlEvent[] = [];
	owned.control.subscribe((event) => {
		events.push(event);
	});
	const pending = owned.control.send("Browser.getVersion");
	owned.server.close(1000, "gone");
	await expect(pending).rejects.toThrow("disconnected");
	expect(events.map((event) => event.method)).toEqual(["Inspector.detached"]);
	const failure = await owned.control.close().then(
		() => undefined,
		(error: unknown) => error,
	);
	if (!(failure instanceof AggregateError))
		throw new Error("Missing truthful control cleanup failure");
	expect(failure.errors).toContain(observerError);
	expect(failure.errors).toContain(listenerError);
});

test("explicit owned control disposal notifies retirement subscribers once and drains pending commands", async () => {
	const owned = peer();
	const events: PlaywrightStorageControlEvent[] = [];
	owned.control.subscribe((event) => {
		events.push(event);
	});
	const pending = owned.control.send("Target.closeTarget", {
		targetId: "private",
	});
	const rejection = expect(pending).rejects.toThrow("closed");
	const closing = owned.control.close();
	expect(owned.control.close()).toBe(closing);
	await closing;
	await rejection;
	expect(events).toEqual([
		{
			method: "Inspector.detached",
			params: { reason: "Owned storage control closed" },
		},
	]);
});

test("fail-closed malformed input notifies root retirement while preserving its actual error", async () => {
	const owned = peer(true);
	const events: PlaywrightStorageControlEvent[] = [];
	owned.control.subscribe((event) => {
		events.push(event);
	});
	const pending = owned.control.send("Browser.getVersion");
	owned.server.send("[]");
	await expect(pending).rejects.toThrow("Invalid owned storage control frame");
	expect(events).toEqual([
		{
			method: "Inspector.detached",
			params: { reason: "Invalid owned storage control frame" },
		},
	]);
});

test("reentrant subscriber disposal retains errors from every remaining detach observer", async () => {
	const owned = peer(true);
	const listenerError = new Error("late detach subscriber failed");
	let closing: Promise<void> | undefined;
	owned.control.subscribe(() => {
		closing = owned.control.close();
		closing.catch(() => {});
	});
	owned.control.subscribe(() => {
		throw listenerError;
	});
	const pending = owned.control.send("Browser.getVersion");
	owned.server.close(1000, "gone");
	await expect(pending).rejects.toThrow("disconnected");
	if (!closing) throw new Error("Detach observer did not dispose control");
	const failure = await closing.then(
		() => undefined,
		(error: unknown) => error,
	);
	if (!(failure instanceof AggregateError))
		throw new Error("Missing truthful observer disposal failure");
	expect(failure.errors).toContain(listenerError);
});

test.each([
	['{"id":1,"sessionId":"wrong","result":{}}', "late reply session"],
	['{"id":99,"sessionId":"scratch","result":{}}', "reply identity"],
	[
		'{"id":1,"sessionId":"scratch","result":"invalid"}',
		"Invalid owned storage control result",
	],
])("timed-out commands retain strict late reply validation: %s", async (frame, reason) => {
	const owned = peer(true, undefined, { commandTimeoutMs: 1 });
	await expect(
		owned.control.send("Runtime.evaluate", {}, "scratch"),
	).rejects.toThrow("timed out");
	const retirement = owned.control.send("Target.closeTarget", {
		targetId: "private",
	});
	const rejected = expect(retirement).rejects.toThrow(reason);
	owned.server.send(frame);
	await rejected;
	expect(owned.observed.at(-1)?.method).toBe("Inspector.detached");
});

test("bounded late reply overflow fails explicitly rather than forgetting an unconfirmed command", async () => {
	const owned = peer(true, undefined, {
		commandTimeoutMs: 1,
		maxLateReplies: 1,
	});
	await expect(
		owned.control.send("Runtime.evaluate", {}, "first"),
	).rejects.toThrow("timed out");
	await expect(
		owned.control.send("DOMStorage.getDOMStorageItems", {}, "second"),
	).rejects.toThrow("late reply capacity exceeded");
	await expect(owned.control.send("Target.closeTarget")).rejects.toThrow(
		"late reply capacity exceeded",
	);
	expect(owned.observed.map((event) => event.method)).toEqual([
		"Inspector.detached",
	]);
});

test("consuming an exact late reply frees tombstone capacity but cannot authorize its duplicate", async () => {
	const owned = peer(true, undefined, {
		commandTimeoutMs: 1,
		maxLateReplies: 1,
	});
	await expect(
		owned.control.send("Runtime.evaluate", {}, "scratch"),
	).rejects.toThrow("timed out");
	const version = owned.control.send("Browser.getVersion");
	owned.server.send('{"id":1,"sessionId":"scratch","result":{}}');
	owned.server.send('{"id":2,"result":{"product":"native"}}');
	expect(await version).toEqual({ product: "native" });
	await expect(
		owned.control.send("Runtime.evaluate", {}, "next"),
	).rejects.toThrow("timed out");
	const retirement = owned.control.send("Target.closeTarget");
	const rejected = expect(retirement).rejects.toThrow("reply identity");
	owned.server.send('{"id":1,"sessionId":"scratch","result":{}}');
	await rejected;
});

test("unknown Target.createTarget identity remains terminal even with spare tombstone capacity", async () => {
	const owned = peer(true, undefined, {
		commandTimeoutMs: 1,
		maxLateReplies: 2,
	});
	await expect(
		owned.control.send("Target.createTarget", { url: "about:blank" }),
	).rejects.toThrow("timed out: Target.createTarget");
	await expect(owned.control.send("Browser.getVersion")).rejects.toThrow(
		"timed out: Target.createTarget",
	);
	expect(owned.observed.map((event) => event.method)).toEqual([
		"Inspector.detached",
	]);
});

test("timed-out command bytes and pending slot are freed while exact late identity remains bounded", async () => {
	const owned = peer(false, undefined, {
		commandTimeoutMs: 1,
		maxPendingCommands: 1,
		maxPendingBytes: 128,
	});
	await expect(
		owned.control.send("Runtime.evaluate", {}, "scratch"),
	).rejects.toThrow("timed out");
	const retirement = owned.control.send("Target.closeTarget", {
		targetId: "private",
	});
	owned.server.send('{"id":2,"result":{"success":true}}');
	expect(await retirement).toEqual({ success: true });
});

test("scaled standard restore frames above the former 16 boundary fit 32 while aggregate pending bytes stay bounded", async () => {
	const unit = 256;
	const owned = peer(false, undefined, {
		maxMessageBytes: 32 * unit,
		maxPendingBytes: 32 * unit,
	});
	const received = new Promise<string>((resolve) =>
		owned.server.addEventListener(
			"message",
			(event: MessageEvent<string>) => resolve(event.data),
			{ once: true },
		),
	);
	const restore = owned.control.send(
		"Runtime.evaluate",
		{ expression: "x".repeat(20 * unit) },
		"scratch",
	);
	const bytes = new TextEncoder().encode(await received).length;
	expect(bytes).toBeGreaterThan(16 * unit);
	expect(bytes).toBeLessThan(32 * unit);
	await expect(
		owned.control.send(
			"Runtime.evaluate",
			{ expression: "x".repeat(17 * unit) },
			"scratch",
		),
	).rejects.toThrow("capacity");
	owned.server.send('{"id":1,"sessionId":"scratch","result":{}}');
	expect(await restore).toEqual({});
	const retirement = owned.control.send("Target.closeTarget");
	owned.server.send('{"id":3,"result":{"success":true}}');
	expect(await retirement).toEqual({ success: true });
});
