import { expect, test } from "vitest";
import { createBrowserPrivateTransport } from "../src/browser-private-transport";
import { createBrowserStorageControl } from "../src/browser-storage-control";
import { acquireCloudflareBrowser } from "../src/shell-browser-resource";
import {
	ownedProvider,
	storageContext,
} from "./shell-browser-resource-private.fixture";

test("owned resource provides origin preparation and guards a late secondary client", async () => {
	const provider = ownedProvider();
	const resource = await acquireCloudflareBrowser({
		binding: provider.binding,
		signal: provider.controller.signal,
	});
	try {
		expect(resource.prepareStorageOrigin).toBeTypeOf("function");
		expect(provider.clientHeaders[1]).toBe("@cloudflare/playwright@1.3.6");
		const lease = await resource.prepareStorageOrigin({
			context: storageContext(await resource.browser.newContext()),
			browserContextId: "context",
			origin: "https://owned.example",
			signal: provider.controller.signal,
		});
		const socket = await resource.connectSocket(provider.controller.signal);
		socket.accept();
		const receipt = new Promise<string>((resolve) =>
			socket.addEventListener(
				"message",
				(event: MessageEvent<string>) => resolve(event.data),
				{ once: true },
			),
		);
		socket.send(JSON.stringify({ id: 1, method: "Target.getTargets" }));
		expect(JSON.parse(await receipt).result.targetInfos).toEqual([
			{ targetId: "public-target", type: "page" },
		]);
		await lease.release();
	} finally {
		await resource.release();
	}
	expect(
		provider.requests.filter((method) => method === "DELETE"),
	).toHaveLength(1);
	await Promise.all(provider.closes);
});

test("interrupt closes public clients but keeps trusted control for lease retirement", async () => {
	const provider = ownedProvider();
	const resource = await acquireCloudflareBrowser({
		binding: provider.binding,
		signal: provider.controller.signal,
	});
	try {
		const lease = await resource.prepareStorageOrigin({
			context: storageContext(await resource.browser.newContext()),
			browserContextId: "context",
			origin: "https://owned.example",
			signal: provider.controller.signal,
		});
		await resource.interrupt();
		await lease.release();
		expect(provider.commands[0]).toContain("Target.closeTarget");
		await expect(
			resource.connectSocket(new AbortController().signal),
		).rejects.toThrow();
	} finally {
		await resource.release();
	}
	expect(
		provider.requests.filter((method) => method === "DELETE"),
	).toHaveLength(1);
	await Promise.all(provider.closes);
});

test("owner release preserves DELETE failure and closes every acquired socket exactly once", async () => {
	const provider = ownedProvider(503);
	const resource = await acquireCloudflareBrowser({
		binding: provider.binding,
		signal: provider.controller.signal,
	});
	const secondary = await resource.connectSocket(provider.controller.signal);
	secondary.accept();
	const first = resource.release();
	expect(resource.release()).toBe(first);
	await expect(first).rejects.toThrow("release");
	await Promise.all(provider.closes);
	expect(
		provider.requests.filter((method) => method === "DELETE"),
	).toHaveLength(1);
});

test("owner release waits for physical control close while independently attempting failed DELETE once", async () => {
	const provider = ownedProvider(503, { deferCloseAt: 0 });
	const resource = await acquireCloudflareBrowser({
		binding: provider.binding,
		signal: provider.controller.signal,
	});
	let settled = false;
	const closing = resource.release();
	void closing.then(
		() => {
			settled = true;
		},
		() => {
			settled = true;
		},
	);
	try {
		await provider.closes[0];
		expect(settled).toBe(false);
		expect(
			provider.requests.filter((method) => method === "DELETE"),
		).toHaveLength(1);
	} finally {
		provider.peers[0]!.close();
		await expect(closing).rejects.toThrow("Owned browser release failed");
	}
	expect(settled).toBe(true);
	expect(resource.release()).toBe(closing);
	await Promise.all(provider.closes);
});

test("setup abort deletes once before a late upgrade returns and then closes that socket", async () => {
	const controller = new AbortController();
	const started = Promise.withResolvers<void>();
	const upgrade = Promise.withResolvers<Response>();
	const deleted = Promise.withResolvers<void>();
	const closed = Promise.withResolvers<void>();
	const pair = new WebSocketPair();
	pair[1].accept();
	pair[1].addEventListener("close", () => {
		pair[1].close();
		closed.resolve();
	});
	let deletions = 0;
	const binding = {
		fetch: Object.assign(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				const method = new Request(input, init).method;
				if (method === "POST")
					return Response.json({ sessionId: "owned-session" });
				if (method === "DELETE") {
					deletions++;
					deleted.resolve();
					return new Response(null);
				}
				started.resolve();
				return upgrade.promise;
			},
			{ preconnect: fetch.preconnect },
		),
	};
	const reason = new Error("setup canceled");
	const outcome = acquireCloudflareBrowser({
		binding,
		signal: controller.signal,
	});
	outcome.catch(() => {});
	await started.promise;
	controller.abort(reason);
	await deleted.promise;
	await expect(outcome).rejects.toBe(reason);
	upgrade.resolve(new Response(null, { status: 101, webSocket: pair[0] }));
	await closed.promise;
	expect(deletions).toBe(1);
});

test.each([
	0, 1,
])("setup abort during socket %i handshake closes all acquired sockets and deletes once", async (stallAt) => {
	const provider = ownedProvider(200, { stallAt });
	const reason = new Error("handshake canceled");
	const outcome = acquireCloudflareBrowser({
		binding: provider.binding,
		signal: provider.controller.signal,
	});
	outcome.catch(() => {});
	await provider.handshake.promise;
	provider.controller.abort(reason);
	await expect(outcome).rejects.toBe(reason);
	await Promise.all(provider.closes);
	expect(
		provider.requests.filter((method) => method === "DELETE"),
	).toHaveLength(1);
});

test("failed primary upgrade closes trusted control and retains failed provider deletion", async () => {
	const provider = ownedProvider(503, { failAt: 1 });
	const outcome = acquireCloudflareBrowser({
		binding: provider.binding,
		signal: provider.controller.signal,
	});
	await expect(outcome).rejects.toThrow("acquisition and cleanup failed");
	await Promise.all(provider.closes);
	expect(
		provider.requests.filter((method) => method === "DELETE"),
	).toHaveLength(1);
});

test("release attempts every owned cleanup and retains both control and DELETE errors", async () => {
	const provider = ownedProvider(503);
	const resource = await acquireCloudflareBrowser({
		binding: provider.binding,
		signal: provider.controller.signal,
	});
	provider.peers[0]!.send("[]");
	await provider.closes[0];
	const failure = await resource.release().then(
		() => undefined,
		(error: unknown) => error,
	);
	expect(failure).toBeInstanceOf(AggregateError);
	if (!(failure instanceof AggregateError))
		throw new Error("Missing aggregate release failure");
	expect(failure.errors.map((error) => String(error))).toEqual([
		"AggregateError: Owned storage control cleanup failed",
		"Error: Owned browser release failed: HTTP 503",
	]);
	await Promise.all(provider.closes);
	expect(
		provider.requests.filter((method) => method === "DELETE"),
	).toHaveLength(1);
});

test("a completed acquisition signal cannot cancel the persistent owner or a later invocation", async () => {
	const provider = ownedProvider();
	const resource = await acquireCloudflareBrowser({
		binding: provider.binding,
		signal: provider.controller.signal,
	});
	const invocation = new AbortController();
	try {
		provider.controller.abort(new Error("first invocation finished"));
		expect(provider.requestSignals.map((signal) => signal.aborted)).toEqual([
			false,
			false,
		]);
		expect(resource.browser.isConnected()).toBe(true);
		const secondary = await resource.connectSocket(invocation.signal);
		secondary.accept();
		const lease = await resource.prepareStorageOrigin({
			context: storageContext(await resource.browser.newContext()),
			browserContextId: "context",
			origin: "https://owned.example",
			signal: invocation.signal,
		});
		await lease.release();
		expect(resource.browser.isConnected()).toBe(true);
	} finally {
		await resource.release();
	}
	await Promise.all(provider.closes);
});

test("native creation deadline closes pending clients and preserves failure at disposal", async () => {
	const privacy = createBrowserPrivateTransport({ creationTimeoutMs: 1 });
	const pair = new WebSocketPair();
	pair[1].accept();
	pair[1].addEventListener("close", () => pair[1].close(), { once: true });
	const socket = privacy.wrap(pair[0], new AbortController().signal);
	socket.accept();
	const closed = new Promise<void>((resolve) =>
		socket.addEventListener(
			"close",
			() => {
				socket.close();
				resolve();
			},
			{ once: true },
		),
	);
	privacy.beginCreation();
	await closed;
	expect(() => privacy.beginCreation()).toThrow("timed out");
	await expect(privacy.close()).rejects.toThrow("cleanup failed");
});

test("settled native command deadline cannot fail a later pending command", async () => {
	const pair = new WebSocketPair();
	pair[1].accept();
	pair[1].addEventListener("close", () => pair[1].close(), { once: true });
	const control = createBrowserStorageControl({
		socket: pair[0],
		limits: { commandTimeoutMs: 1 },
	});
	const first = control.send("Browser.getVersion");
	pair[1].send('{"id":1,"result":{}}');
	await first;
	await expect(control.send("Runtime.evaluate")).rejects.toThrow(
		"timed out: Runtime.evaluate",
	);
	await control.close();
});
