import { expect, test, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ RpcTarget: class {} }));
vi.mock("../src/browser-private-transport", () => ({
	waitForBrowserSocketClose: vi.fn(),
}));
vi.mock("../src/browser-socket-closure", () => ({
	closeBrowserSocket: vi.fn(),
	registerBrowserSocketClose: vi.fn(),
}));
import { waitForBrowserSocketClose } from "../src/browser-private-transport";
import { createRunCodeCreationBudget } from "../src/browser-run-code-budget";
import { BROWSER_RUN_CODE_URL } from "../src/browser-run-code-contract";
import { createRunCodeRelay } from "../src/browser-run-code-relay";
import { closeBrowserSocket } from "../src/browser-socket-closure";

test("relay identifies every failed cleanup operation and retains its original cause", async () => {
	const causes = Array.from({ length: 5 }, () => new Error("Network connection lost"));
	vi.mocked(closeBrowserSocket).mockImplementationOnce(() => { throw causes[0]; });
	vi.mocked(waitForBrowserSocketClose).mockRejectedValueOnce(causes[1]);
	const started = Promise.withResolvers<void>();
	const frame = Promise.withResolvers<void>();
	const receiver = {
		frame: async () => { started.resolve(); await frame.promise; },
		close: vi.fn(async () => { throw causes[3]; }),
		dup: () => receiver,
		[Symbol.dispose]: vi.fn(() => { throw causes[4]; }),
	};
	const socket = Object.assign(new EventTarget(), { accept() {} });
	const relay = createRunCodeRelay({
		signal: new AbortController().signal,
		connectSocket: async () => socket as WebSocket,
		creations: createRunCodeCreationBudget({ maxPages: 8, pages: [], contexts: [] }),
		fail: vi.fn(),
	});
	await relay.capability.open(BROWSER_RUN_CODE_URL, receiver);
	socket.dispatchEvent(new MessageEvent("message", { data: '{"id":1,"result":{}}' }));
	await started.promise;
	const outcome = relay.close().catch((error: AggregateError) => error);
	frame.reject(causes[2]);
	const error = await outcome as AggregateError;
	expect(error.message).toBe("Run-code transport cleanup failed");
	const failures = error.errors.flatMap((group: AggregateError) => group.errors);
	expect(failures.map((failure: Error) => failure.message)).toEqual([
		"Run-code socket close failed",
		"Run-code socket close confirmation failed",
		"Run-code receiver frame drain failed",
		"Run-code receiver close failed",
		"Run-code receiver disposal failed",
	]);
	expect(failures.map((failure: Error) => failure.cause)).toEqual(causes);
	expect(receiver.close).toHaveBeenCalledOnce();
	expect(receiver[Symbol.dispose]).toHaveBeenCalledOnce();
});
