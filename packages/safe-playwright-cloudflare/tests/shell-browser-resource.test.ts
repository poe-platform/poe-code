import { expect, test } from "vitest";
import {
	acquireCloudflareBrowser,
	createCloudflareBrowserRelease,
} from "../src/shell-browser-resource";

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

test("a failed browser deletion preserves the provider error across repeated cleanup", async () => {
	let requests = 0;
	const release = createCloudflareBrowserRelease({
		sessionId: "owned-session",
		binding: {
			fetch: Object.assign(
				async () => {
					requests++;
					return new Response(null, { status: 503 });
				},
				{ preconnect: fetch.preconnect },
			),
		},
	});
	const first = release();
	await expect(first).rejects.toThrow("Owned browser release failed: HTTP 503");
	expect(release()).toBe(first);
	await expect(release()).rejects.toThrow(
		"Owned browser release failed: HTTP 503",
	);
	expect(requests).toBe(1);
});
