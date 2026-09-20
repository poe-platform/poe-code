import { afterEach, expect, test } from "vitest";
import {
	createBrowserPrivateTransport,
	waitForBrowserSocketClose,
} from "../src/browser-private-transport";
import { createBrowserStorageControl } from "../src/browser-storage-control";

const barrier = JSON.stringify({
	method: "Runtime.consoleAPICalled",
	params: { tag: "barrier" },
});
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((close) => close()));
});

function receive(socket: WebSocket, throughBarrier = false) {
	return new Promise<string[]>((resolve, reject) => {
		const received: string[] = [];
		const deadline = AbortSignal.timeout(1000);
		const timeout = () => {
			socket.removeEventListener("message", message);
			reject(new Error("Missing protocol delivery"));
		};
		deadline.addEventListener("abort", timeout, { once: true });
		const message = (event: MessageEvent<string>) => {
			received.push(event.data);
			if (!throughBarrier || event.data === barrier) {
				deadline.removeEventListener("abort", timeout);
				socket.removeEventListener("message", message);
				resolve(received);
			}
		};
		socket.addEventListener("message", message);
	});
}

function nativePair() {
	const pair = new WebSocketPair();
	pair[1].accept();
	pair[1].addEventListener("close", () => pair[1].close(), { once: true });
	cleanups.push(async () => {
		pair[1].close();
	});
	return { raw: pair[0], server: pair[1] };
}

function coordinator(
	options?: Parameters<typeof createBrowserPrivateTransport>[0],
	failure = false,
) {
	const privacy = createBrowserPrivateTransport(options);
	cleanups.unshift(async () => {
		if (failure)
			await expect(privacy.close()).rejects.toThrow("cleanup failed");
		else await privacy.close();
	});
	return privacy;
}

function client(privacy: ReturnType<typeof createBrowserPrivateTransport>) {
	const pair = nativePair();
	const controller = new AbortController();
	const socket = privacy.wrap(pair.raw, controller.signal);
	socket.accept();
	return { ...pair, socket, controller };
}

function target(targetId: string) {
	return JSON.stringify({
		method: "Target.targetCreated",
		params: { targetInfo: { targetId, type: "page" } },
	});
}

test("CDP command timeout retains its original reason through bridge shutdown", async () => {
	const privacy = coordinator({ commandTimeoutMs: 20 }, true);
	const peer = client(privacy);
	const wire = receive(peer.server);
	peer.socket.send(JSON.stringify({ id: 1, method: "Browser.getVersion" }));
	await wire;
	await waitForBrowserSocketClose(peer.socket);
	const failure = await privacy.close().catch((error: unknown) => error);
	expect(failure).toBeInstanceOf(AggregateError);
	const messages = (failure as AggregateError).errors.map((error: Error) => error.message);
	expect(messages).toHaveLength(1);
	expect(messages[0]).toContain("CDP Browser.getVersion timed out (command 1, pending 1, deadline 20ms, elapsed ");
	expect(messages[0]).toContain("ms)");
});

test("late secondary clients hide already-active private identities", async () => {
	const privacy = coordinator({ maxPrivateTargets: 2, maxPrivateSessions: 2 });
	const primary = client(privacy);
	privacy.beginCreation().commit("owned-private");
	const secondary = client(privacy);
	const receipts = [primary, secondary].map((peer) =>
		receive(peer.socket, true),
	);
	for (const peer of [primary, secondary]) {
		peer.server.send(target("owned-private"));
		peer.server.send(barrier);
	}
	expect(await Promise.all(receipts)).toEqual([[barrier], [barrier]]);
});

test("admission during pending creation arms every client before native events", async () => {
	const privacy = coordinator();
	const primary = client(privacy);
	const creation = privacy.beginCreation();
	const secondary = client(privacy);
	const receipts = [primary, secondary].map((peer) =>
		receive(peer.socket, true),
	);
	for (const peer of [primary, secondary])
		peer.server.send(target("pending-private"));
	creation.commit("pending-private");
	for (const peer of [primary, secondary]) peer.server.send(barrier);
	expect(await Promise.all(receipts)).toEqual([[barrier], [barrier]]);
});

test("one client abort during creation does not invalidate another client token", async () => {
	const privacy = coordinator();
	const primary = client(privacy);
	const creation = privacy.beginCreation();
	const secondary = client(privacy);
	primary.controller.abort(new Error("primary canceled"));
	creation.commit("still-private");
	const receipt = receive(secondary.socket, true);
	secondary.server.send(target("still-private"));
	secondary.server.send(barrier);
	expect(await receipt).toEqual([barrier]);
});

test("active capacity is not released by detach or a client close", async () => {
	const privacy = coordinator({ maxPrivateTargets: 2, maxPrivateSessions: 2 });
	const primary = client(privacy);
	privacy.beginCreation().commit("held");
	privacy.beginCreation().commit("scratch");
	privacy.observe({
		method: "Target.detachedFromTarget",
		params: { sessionId: "detached", targetId: "held" },
	});
	primary.controller.abort();
	expect(() => privacy.beginCreation()).toThrow("active capacity");
	privacy.observe({
		method: "Target.targetDestroyed",
		params: { targetId: "scratch" },
	});
	privacy.beginCreation().commit("replacement");
	expect(() => privacy.beginCreation()).toThrow("active capacity");
});

test("scratch churn and recent replay retain the held private identity", async () => {
	const privacy = coordinator({ maxPrivateTargets: 2, maxPrivateSessions: 2 });
	const primary = client(privacy);
	privacy.beginCreation().commit("held");
	async function churn(index: number): Promise<void> {
		if (index === 16) return;
		const targetId = `scratch-${index}`;
		privacy.beginCreation().commit(targetId);
		privacy.observe({ method: "Target.targetDestroyed", params: { targetId } });
		const receipt = receive(primary.socket, true);
		primary.server.send(target(targetId));
		primary.server.send(target("held"));
		primary.server.send(barrier);
		expect(await receipt).toEqual([barrier]);
		await churn(index + 1);
	}
	await churn(0);
	const late = client(privacy);
	const receipt = receive(late.socket, true);
	late.server.send(target("scratch-15"));
	late.server.send(target("held"));
	late.server.send(barrier);
	expect(await receipt).toEqual([barrier]);
});

test("unknown creation failure closes every client without fabricated rollback", async () => {
	const privacy = coordinator(undefined, true);
	client(privacy);
	client(privacy);
	privacy.beginCreation().fail(new Error("native creation refused"));
	expect(() => privacy.beginCreation()).toThrow("native creation refused");
});

test("a target destroyed before commit cannot become an active stale identity", () => {
	const privacy = coordinator(undefined, true);
	const creation = privacy.beginCreation();
	privacy.observe({
		method: "Target.targetDestroyed",
		params: { targetId: "already-dead" },
	});
	expect(() => creation.commit("already-dead")).toThrow("destroyed");
});

test("client admission is bounded and confirmed upstream closure frees only client capacity", async () => {
	const privacy = coordinator({ maxClients: 1 });
	const first = client(privacy);
	const rejected = nativePair();
	expect(() =>
		privacy.wrap(rejected.raw, new AbortController().signal),
	).toThrow("client capacity");
	first.controller.abort();
	await waitForBrowserSocketClose(first.socket);
	client(privacy);
});

test("rollback releases buffered public events without inventing a private ID", async () => {
	const privacy = coordinator();
	const peer = client(privacy);
	const creation = privacy.beginCreation();
	const receipt = receive(peer.socket, true);
	peer.server.send(target("public"));
	creation.rollback();
	peer.server.send(barrier);
	expect(await receipt).toEqual([target("public"), barrier]);
});

test("private command access is refused without delivery to the raw provider", async () => {
	const privacy = coordinator();
	const peer = client(privacy);
	privacy.beginCreation().commit("owned-private");
	const receipt = receive(peer.socket);
	peer.socket.send(
		JSON.stringify({
			id: 7,
			method: "Target.attachToTarget",
			params: { targetId: "owned-private", flatten: true },
		}),
	);
	expect((await receipt)[0]).toContain('"error"');
});

function control(
	limits?: Parameters<typeof createBrowserStorageControl>[0]["limits"],
	failure = false,
) {
	const pair = nativePair();
	const events: string[] = [];
	const owner = createBrowserStorageControl({
		socket: pair.raw,
		limits,
		onEvent: (event) => {
			events.push(event.method);
		},
	});
	cleanups.unshift(async () => {
		if (failure) await expect(owner.close()).rejects.toThrow("cleanup failed");
		else await owner.close();
	});
	return { ...pair, owner, events };
}

test("trusted control resolves matching session replies and delivers observed events", async () => {
	const peer = control();
	const observed: string[] = [];
	const unsubscribe = peer.owner.subscribe((event) => {
		observed.push(event.method);
	});
	const wire = receive(peer.server);
	const result = peer.owner.send(
		"Runtime.evaluate",
		{ expression: "1" },
		"private-session",
	);
	expect((await wire)[0]).toBe(
		JSON.stringify({
			id: 1,
			method: "Runtime.evaluate",
			params: { expression: "1" },
			sessionId: "private-session",
		}),
	);
	peer.server.send(
		JSON.stringify({
			method: "Target.targetDestroyed",
			params: { targetId: "owned" },
		}),
	);
	peer.server.send(
		JSON.stringify({
			id: 1,
			result: { value: 1 },
			sessionId: "private-session",
		}),
	);
	expect(await result).toEqual({ value: 1 });
	expect(peer.events).toEqual(["Target.targetDestroyed"]);
	expect(observed).toEqual(peer.events);
	unsubscribe();
	unsubscribe();
});

test("native control errors reject the command while keeping the connection usable", async () => {
	const peer = control();
	const first = peer.owner.send("Page.navigate");
	first.catch(() => {});
	peer.server.send(
		JSON.stringify({ id: 1, error: { message: "native navigation refused" } }),
	);
	await expect(first).rejects.toThrow("native navigation refused");
	const second = peer.owner.send("Browser.getVersion");
	peer.server.send(JSON.stringify({ id: 2, result: { product: "native" } }));
	expect(await second).toEqual({ product: "native" });
});

test("wrong-session control replies fail closed and reject pending owned work", async () => {
	const peer = control(undefined, true);
	const result = peer.owner.send("Runtime.evaluate", {}, "expected-session");
	result.catch(() => {});
	peer.server.send(
		JSON.stringify({ id: 1, result: {}, sessionId: "foreign-session" }),
	);
	await expect(result).rejects.toThrow("reply identity");
	await expect(peer.owner.send("Browser.getVersion")).rejects.toThrow(
		"reply identity",
	);
});

test("control count byte and subscription bounds do not publish excess commands", async () => {
	const peer = control({
		maxPendingCommands: 1,
		maxPendingBytes: 128,
		maxSubscriptions: 1,
	});
	const result = peer.owner.send("Browser.getVersion");
	result.catch(() => {});
	await expect(peer.owner.send("Browser.getVersion")).rejects.toThrow(
		"capacity",
	);
	const unsubscribe = peer.owner.subscribe(() => {});
	expect(() => peer.owner.subscribe(() => {})).toThrow("subscription capacity");
	unsubscribe();
	peer.owner.subscribe(() => {});
	await peer.owner.close();
	await expect(result).rejects.toThrow("closed");
});

test("oversized control commands are rejected before provider send", async () => {
	const peer = control({ maxMessageBytes: 64 });
	await expect(
		peer.owner.send("Runtime.evaluate", { expression: "x".repeat(64) }),
	).rejects.toThrow("capacity");
});

test("control close is idempotent and rejects pending commands before settlement", async () => {
	const peer = control();
	const result = peer.owner.send("Browser.getVersion");
	result.catch(() => {});
	const first = peer.owner.close();
	expect(peer.owner.close()).toBe(first);
	await first;
	await expect(result).rejects.toThrow("closed");
	expect(() => peer.owner.subscribe(() => {})).toThrow("closed");
});

test("unknown native creation deadline rejects outstanding work and remains visible at disposal", async () => {
	const peer = control({ commandTimeoutMs: 1 }, true);
	const result = peer.owner.send("Target.createTarget");
	result.catch(() => {});
	await expect(result).rejects.toThrow("timed out");
});

test("invalid control frames fail pending readers rather than being silently ignored", async () => {
	const peer = control(undefined, true);
	const result = peer.owner.send("Browser.getVersion");
	result.catch(() => {});
	peer.server.send("[]");
	await expect(result).rejects.toThrow("Invalid owned storage control frame");
});

test("invalid guard options fail before accepting any raw client", () => {
	expect(() =>
		createBrowserPrivateTransport({ maxPrivateSessions: 0 }),
	).toThrow("Invalid private");
});

test("failed creation remains idempotent when preparer reports the original error", () => {
	const privacy = coordinator(undefined, true);
	const creation = privacy.beginCreation();
	const original = new Error("native creation failed");
	creation.fail(original);
	expect(() => creation.fail(original)).not.toThrow();
});

test("trusted retirement before local delivery frees capacity and seeds recent replay for later clients", async () => {
	const privacy = coordinator({ maxPrivateTargets: 2, maxPrivateSessions: 2 });
	const primary = client(privacy);
	privacy.beginCreation().commit("A");
	privacy.beginCreation().commit("B");
	const trusted = control();
	trusted.owner.subscribe(privacy.observe);
	const confirmed = trusted.owner.send("Browser.getVersion");
	const retirement =
		'{"method":"Target.targetDestroyed","params":{"targetId":"A"}}';
	trusted.server.send(retirement);
	trusted.server.send('{"id":1,"result":{}}');
	await confirmed;
	privacy.beginCreation().commit("C");
	const late = client(privacy);
	const receipts = [primary, late].map((peer) => receive(peer.socket, true));
	for (const peer of [primary, late]) {
		peer.server.send(target("A"));
		peer.server.send(target("B"));
		peer.server.send(target("C"));
		peer.server.send(retirement);
		peer.server.send(barrier);
	}
	expect(await Promise.all(receipts)).toEqual([[barrier], [barrier]]);
	expect(() => privacy.beginCreation()).toThrow("active capacity");
});
