import { createServer } from "node:http";
import { once } from "node:events";
import { afterAll, beforeAll, expect, test } from "vitest";
import { Miniflare } from "miniflare";
import {
	buildNativeFixture,
	disposeNativeFixture,
} from "./browser-native-fixture";

let worker: Miniflare;
let networkServer: ReturnType<typeof createServer>;
let networkURL: string;
beforeAll(async () => {
	networkServer = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({path: request.url, method: request.method, cookie: request.headers.cookie ?? null, body: Buffer.concat(chunks).toString()}));
  });
  networkServer.listen(0, '127.0.0.1');
  await once(networkServer, 'listening');
  const address = networkServer.address();
  if (!address || typeof address === 'string') throw new Error('Network fixture address missing');
  networkURL = `http://127.0.0.1:${address.port}/`;
	const script = await buildNativeFixture(
		new URL("./browser-run-code.test.worker.ts", import.meta.url),
	);
	worker = new Miniflare({
		modules: true,
		script,
		compatibilityDate: "2026-07-08",
		compatibilityFlags: ["nodejs_compat"],
		browserRendering: { binding: "BROWSER" },
		workerLoaders: { BROWSER_RUN_CODE_LOADER: {} },
	});
	await worker.ready;
}, 30000);
afterAll(async () => {
	if (worker) await disposeNativeFixture(worker);
	networkServer?.closeAllConnections();
	if (networkServer?.listening) await new Promise<void>((resolve, reject) => networkServer.close(error => error ? reject(error) : resolve()));
});

for (const scenario of [
	"context",
	"context-mutations",
	"context-reuse",
	"serialization",
	"serialization-after-context-close",
	"foreign-context",
	"default-target",
	"storage-replacement",
	"storage-private-cancel",
	"timeouts",
	"network",
	"network-close",
	"quota",
	"deadline",
	"user-error",
	"mobile",
	"mobile-repeat",
	"emulation-change",
	"init-scripts",
	"init-script-limit",
	"init-script-context-retention",
	"init-script-page-retention",
	"init-script-byte-retention",
	"init-script-page-close-capacity",
	"init-script-context-close-capacity",
	"syntax",
	"loader-error",
	"cancel",
	"output",
]) {
	test(`native run-code ${scenario}`, async () => {
		const url = new URL(`http://localhost/${scenario}`);
		if (scenario === "network")
			url.searchParams.set("target", networkURL);
		const response = await worker.dispatchFetch(url);
		const body = await response.text();
		expect(response.status, `${scenario}: ${body}`).toBe(200);
		expect(JSON.parse(body), `${scenario}: ${body}`).toEqual({ ok: true });
	}, 30000);
}

test.each([1, 2, 3])("native deadline reports JSON under contention (round %i)", async () => {
	await Promise.all(["deadline", "context", "user-error"].map(async (scenario) => {
		const response = await worker.dispatchFetch(`http://localhost/${scenario}`);
		const body = await response.text();
		expect(response.status, `${scenario}: ${body}`).toBe(200);
		expect(JSON.parse(body), `${scenario}: ${body}`).toEqual({ ok: true });
	}));
}, 30000);
