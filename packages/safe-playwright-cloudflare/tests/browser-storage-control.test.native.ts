import { afterAll, beforeAll, expect, test } from "vitest";
import { Miniflare } from "miniflare";
import { buildNativeFixture, disposeNativeFixture } from "./browser-native-fixture";

let worker: Miniflare;
beforeAll(async () => {
	worker = new Miniflare({
		modules: true,
		script: await buildNativeFixture(new URL("./browser-storage-control.test.worker.ts", import.meta.url)),
		compatibilityDate: "2026-07-08",
		compatibilityFlags: ["nodejs_compat"],
		browserRendering: { binding: "BROWSER" },
	});
	await worker.ready;
});
afterAll(async () => {
	if (worker) await disposeNativeFixture(worker);
});

for (const scenario of ["owned-unlimited", "explicit-control"]) {
	test(`native storage control ${scenario}`, async () => {
		const response = await worker.dispatchFetch(`http://fixture/${scenario}`);
		const receipt = await response.json();
		expect(receipt).toEqual({ ok: true, transferredBytes: scenario === "owned-unlimited" ? 34 * 1024 * 1024 : 0 });
		expect(response.status).toBe(200);
	});
}
