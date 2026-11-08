import { expect, test } from "vitest";
import {
	beginBrowserOwnerShutdown,
	closeBrowserSocket,
	finalizeBrowserOwnerTermination,
	registerBrowserSocketClose,
} from "../src/browser-socket-closure";

test("successful owner DELETE cannot confirm a held upstream close", async () => {
	const pair = new WebSocketPair();
	pair[0].accept();
	pair[1].accept();
	const requested = Promise.withResolvers<void>();
	pair[1].addEventListener("close", () => requested.resolve(), { once: true });
	const closed = registerBrowserSocketClose(pair[0]);
	let confirmed = false;
	void closed.then(() => {
		confirmed = true;
	});
	beginBrowserOwnerShutdown([pair[0]]);
	closeBrowserSocket(pair[0]);
	await requested.promise;
	finalizeBrowserOwnerTermination([pair[0]], true);
	expect(pair[0].readyState).toBe(WebSocket.CLOSING);
	expect(confirmed).toBe(false);
	pair[1].close(1000);
	await closed;
	expect(confirmed).toBe(true);
});

test("owner termination never converts an untrusted injected EOF into confirmation", async () => {
	const pair = new WebSocketPair();
	pair[0].accept();
	pair[1].accept();
	const closed = registerBrowserSocketClose(pair[0]);
	beginBrowserOwnerShutdown([pair[0]]);
	pair[0].dispatchEvent(
		new ErrorEvent("error", { error: new Error("Network connection lost.") }),
	);
	finalizeBrowserOwnerTermination([pair[0]], true);
	await expect(closed).rejects.toThrow("failed before close confirmation");
	pair[0].close();
	pair[1].close();
});

test("active errors remain failed even when an owner is subsequently deleted", async () => {
	const pair = new WebSocketPair();
	pair[0].accept();
	pair[1].accept();
	const closed = registerBrowserSocketClose(pair[0]);
	pair[0].dispatchEvent(new Event("error"));
	beginBrowserOwnerShutdown([pair[0]]);
	finalizeBrowserOwnerTermination([pair[0]], true);
	await expect(closed).rejects.toThrow("failed before close confirmation");
	pair[0].close();
	pair[1].close();
});

test("successful owner deletion does not hide an abnormal native close acknowledgement", async () => {
	const pair = new WebSocketPair();
	pair[0].accept();
	pair[1].accept();
	const requested = Promise.withResolvers<void>();
	pair[1].addEventListener("close", () => requested.resolve(), { once: true });
	const closed = registerBrowserSocketClose(pair[0]);
	beginBrowserOwnerShutdown([pair[0]]);
	closeBrowserSocket(pair[0]);
	await requested.promise;
	finalizeBrowserOwnerTermination([pair[0]], true);
	pair[1].close(1008, "refused");
	await expect(closed).rejects.toThrow("1008 refused");
});
