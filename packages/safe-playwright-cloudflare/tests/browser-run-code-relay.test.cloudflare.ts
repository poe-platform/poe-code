import { expect, test } from "vitest";
import { createBrowserPrivateTransport } from "../src/browser-private-transport";
import { createRunCodeCreationBudget } from "../src/browser-run-code-budget";
import {
	BROWSER_RUN_CODE_URL,
	type BrowserRunCodeReceiver,
} from "../src/browser-run-code-contract";
import { createRunCodeRelay } from "../src/browser-run-code-relay";

async function connectedRelay() {
	const pair = new WebSocketPair();
	pair[0].accept();
	const privacy = createBrowserPrivateTransport();
	const socket = privacy.wrap(pair[1], new AbortController().signal);
	const failures: string[] = [];
	const receiver: BrowserRunCodeReceiver = {
		async frame() {},
		async close() {},
		dup() {
			return receiver;
		},
		[Symbol.dispose]() {},
	};
	const relay = createRunCodeRelay({
		signal: new AbortController().signal,
		connectSocket: async () => socket,
		creations: createRunCodeCreationBudget({
			maxPages: 8,
			pages: [],
			contexts: [],
		}),
		fail: (error) => {
			failures.push(String(error));
		},
	});
	await relay.capability.open(BROWSER_RUN_CODE_URL, receiver);
	return { relay, pair: { 0: pair[0], 1: socket }, failures, privacy };
}

test("intentional relay shutdown ignores trailing provider messages and errors", async () => {
	const { relay, pair, failures, privacy } = await connectedRelay();
	const closing = relay.close();
	// A provider frame can already be queued when normal completion closes CDP.
	pair[1].dispatchEvent(new MessageEvent("message", { data: "{}" }));
	pair[1].dispatchEvent(new Event("error"));
	pair[0].close(1000);
	await closing;
	await privacy.close();
	expect(failures).toEqual([]);
});

test("an active relay reports the first invalid provider frame and revokes access", async () => {
	const { relay, pair, failures, privacy } = await connectedRelay();
	pair[1].dispatchEvent(new MessageEvent("message", { data: "not-json" }));
	pair[1].dispatchEvent(new MessageEvent("message", { data: "{}" }));
	pair[0].close(1000);
	await relay.close();
	await privacy.close();
	expect(failures).toHaveLength(1);
	expect(failures[0]).toContain("JSON");
});
