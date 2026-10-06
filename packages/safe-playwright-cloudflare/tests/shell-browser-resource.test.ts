import { expect, test, vi } from "vitest";
import {
	acquireCloudflareBrowser,
	createCloudflareBrowserRelease,
} from "../src/shell-browser-resource";

test.each([undefined, Infinity, 1234])("browser deletion deadlines are opt-in: %s", async releaseTimeoutMs => {
  const timeout = vi.spyOn(AbortSignal, "timeout");
  try {
    const release = createCloudflareBrowserRelease({
      sessionId: "owned",
      releaseTimeoutMs,
      binding: { fetch: async () => new Response(null) } as never,
    });
    await release();
    if (releaseTimeoutMs === 1234) expect(timeout).toHaveBeenCalledWith(1234);
    else expect(timeout).not.toHaveBeenCalled();
  } finally { timeout.mockRestore(); }
});

test("an already canceled acquisition retains its reason without loading the browser runtime", async () => {
	let requests = 0;
	const reason = new Error("Run canceled");
	await expect(
		acquireCloudflareBrowser({
			signal: AbortSignal.abort(reason),
			binding: {
				fetch: Object.assign(
					async () => {
						requests++;
						return new Response(null, { status: 500 });
					},
					{ preconnect: fetch.preconnect },
				),
			},
		}),
	).rejects.toBe(reason);
	expect(requests).toBe(0);
});

test("concurrent browser cleanup deletes only its owned ID once and cancels the response body", async () => {
	const response = Promise.withResolvers<Response>();
	const requests: Request[] = [];
	let signal: AbortSignal | null | undefined;
	let bodyCanceled = false;
	const release = createCloudflareBrowserRelease({
		sessionId: "owned/session?only",
		binding: {
			fetch: Object.assign(
				(input: RequestInfo | URL, init?: RequestInit) => {
					requests.push(new Request(input, init));
					signal = init?.signal;
					return response.promise;
				},
				{ preconnect: fetch.preconnect },
			),
		},
	});
	const first = release();
	const concurrent = release();
	expect(concurrent).toBe(first);
	expect(requests.map((request) => [request.method, request.url])).toEqual([
		["DELETE", "http://fake.host/v1/devtools/browser/owned%2Fsession%3Fonly"],
	]);
	expect(signal).toBeInstanceOf(AbortSignal);
	expect(signal?.aborted).toBe(false);
	response.resolve(
		new Response(
			new ReadableStream({
				cancel() {
					bodyCanceled = true;
				},
			}),
		),
	);
	await Promise.all([first, concurrent]);
	expect(bodyCanceled).toBe(true);
	expect(release()).toBe(first);
	expect(requests).toHaveLength(1);
});

test("a failed browser deletion retries and caches only success", async () => {
	let requests = 0;
	const release = createCloudflareBrowserRelease({
		sessionId: "owned-session",
		binding: {
			fetch: Object.assign(
				async () => {
					requests++;
					return new Response(null, { status: requests === 1 ? 503 : 204 });
				},
				{ preconnect: fetch.preconnect },
			),
		},
	});
	const first = release();
	await expect(first).rejects.toThrow("Owned browser release failed: HTTP 503");
	await release();
	await release();
	expect(requests).toBe(2);
});

test("an already absent owned session is successfully released", async () => {
	const binding = { fetch: vi.fn(async () => new Response(null, { status: 404 })) };
	const release = createCloudflareBrowserRelease({ binding: binding as never, sessionId: "owned" });
	await release();
	await release();
	expect(binding.fetch).toHaveBeenCalledTimes(1);
});
