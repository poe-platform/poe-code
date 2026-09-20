import { expect, test, vi } from "vitest";
import { waitForBrowserSocketClose } from "../src/browser-socket-closure";
import { acquireCloudflareBrowser } from "../src/shell-browser-resource";
import { ownedProvider } from "./shell-browser-resource-private.fixture";

test.each([
	200, 503,
])("owner release deadline rejects without confirming a held control socket after DELETE %i", async (deleteStatus) => {
	const provider = ownedProvider(deleteStatus, { deferCloseAt: 0 });
	const deadline = new AbortController();
	const nativeTimeout = AbortSignal.timeout.bind(AbortSignal);
	const timeout = vi
		.spyOn(AbortSignal, "timeout")
		.mockImplementation((milliseconds) =>
			milliseconds === 5_000 ? deadline.signal : nativeTimeout(milliseconds),
		);
	const resource = await acquireCloudflareBrowser({
		binding: provider.binding,
		signal: provider.controller.signal,
	});
	const upstream = provider.upstreams[0]!;
	const physicallyClosed = waitForBrowserSocketClose(upstream);
	let confirmed = false;
	void physicallyClosed.then(() => {
		confirmed = true;
	});
	const closing = resource.release();
	let failure: unknown;
	const outcome = closing.then(
		() => undefined,
		(error: unknown) => {
			failure = error;
			return error;
		},
	);
	try {
		await provider.closes[0];
		deadline.abort(new DOMException("Owner deadline expired", "TimeoutError"));
		await vi.waitFor(() => expect(failure).toBeInstanceOf(AggregateError), {
			timeout: 100,
			interval: 1,
		});
		if (!(failure instanceof AggregateError))
			throw new Error("Missing aggregate owner release failure");
		const failures = failure.errors.map((error) => String(error));
		expect(failures).toContain(
			"Error: Owned browser release deadline exceeded",
		);
		if (deleteStatus === 503)
			expect(failures).toContain(
				"Error: Owned browser release failed: HTTP 503",
			);
		expect(upstream.readyState).toBe(WebSocket.CLOSING);
		expect(confirmed).toBe(false);
		expect(resource.release()).toBe(closing);
		expect(
			provider.requests.filter((method) => method === "DELETE"),
		).toHaveLength(1);
	} finally {
		provider.peers[0]!.close(1000);
		await physicallyClosed;
		await outcome;
		timeout.mockRestore();
	}
	expect(confirmed).toBe(true);
});
