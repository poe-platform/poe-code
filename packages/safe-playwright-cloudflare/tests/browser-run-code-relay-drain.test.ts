import { expect, test, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ RpcTarget: class {} }));
vi.mock("../src/browser-private-transport", () => ({
	waitForBrowserSocketClose: async () => {},
}));
vi.mock("../src/browser-socket-closure", () => ({
	closeBrowserSocket: vi.fn(),
	registerBrowserSocketClose: vi.fn(),
}));
import { createRunCodeCreationBudget } from "../src/browser-run-code-budget";
import { BROWSER_RUN_CODE_URL } from "../src/browser-run-code-contract";
import { createRunCodeRelay } from "../src/browser-run-code-relay";

test.each([false, true])("relay drains an in-flight receiver RPC before disposal (rejects: %s)", async (rejects) => {
	const frame = Promise.withResolvers<void>();
	const started = Promise.withResolvers<void>();
	const operations: string[] = [];
	const frameError = new Error("Receiver frame connection lost");
	const receiver = {
		frame: async () => {
			operations.push("frame");
			started.resolve();
			try { await frame.promise; }
			finally { operations.push("frame settled"); }
		},
		close: async () => { operations.push("close receiver"); },
		dup: () => receiver,
		[Symbol.dispose]: () => { operations.push("dispose receiver"); },
	};
	const socket = Object.assign(new EventTarget(), { accept() {} });
	const fail = vi.fn();
	const relay = createRunCodeRelay({
		signal: new AbortController().signal,
		connectSocket: async () => socket as WebSocket,
		creations: createRunCodeCreationBudget({ maxPages: 8, pages: [], contexts: [] }),
		fail,
	});
	await relay.capability.open(BROWSER_RUN_CODE_URL, receiver);
	socket.dispatchEvent(new MessageEvent("message", { data: '{"id":1,"result":{}}' }));
	await started.promise;
	const closing = relay.close();
	const outcome = closing.catch((error: unknown) => error);
	expect(relay.close()).toBe(closing);
	// Shutdown revokes new frames while retaining the already admitted RPC.
	socket.dispatchEvent(new MessageEvent("message", { data: '{"id":2,"result":{}}' }));
	await Promise.resolve();
	const beforeSettled = [...operations];
	if (rejects) frame.reject(frameError);
	else frame.resolve();
	const error = await outcome;
	expect(beforeSettled).toEqual(["frame"]);
	expect(operations).toEqual(["frame", "frame settled", "close receiver", "dispose receiver"]);
	if (rejects) {
		expect(error).toBeInstanceOf(AggregateError);
		expect((error as AggregateError).errors[0].errors[0]).toMatchObject({
			message: "Run-code receiver frame drain failed", cause: frameError,
		});
	} else expect(error).toBeUndefined();
	expect(fail).not.toHaveBeenCalled();
});
