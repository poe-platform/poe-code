import { afterAll, beforeAll, expect, test } from "vitest";
import { Miniflare } from "miniflare";
import {
	buildNativeFixture,
	disposeNativeFixture,
} from "./browser-native-fixture";

let worker: Miniflare;
beforeAll(async () => {
	const script = await buildNativeFixture(
		new URL("./browser-snapshot-json.test.worker.ts", import.meta.url),
	);
	worker = new Miniflare({
		modules: true,
		script,
		compatibilityDate: "2026-07-08",
		compatibilityFlags: ["nodejs_compat"],
		browserRendering: { binding: "BROWSER" },
	});
	await worker.ready;
}, 30000);
afterAll(async () => {
	if (worker) await disposeNativeFixture(worker);
});

for (const scenario of ["fidelity", "bounds", "frames", "abort"]) {
	test(`native structured snapshot ${scenario}`, async () => {
		const response = await worker.dispatchFetch(`http://localhost/${scenario}`);
		expect(await response.json()).toEqual({ ok: true });
	}, 30000);
}
