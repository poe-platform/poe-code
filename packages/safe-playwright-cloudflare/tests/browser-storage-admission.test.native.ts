import { serveOrigin } from "./node-origin.fixture";
import { afterAll, beforeAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { Miniflare } from "miniflare";
import {
	buildNativeFixture,
	disposeNativeFixture,
} from "./browser-native-fixture";

let worker: Miniflare;
let server: Awaited<ReturnType<typeof serveOrigin>>;
let history: Awaited<ReturnType<typeof serveOrigin>>;
let initial: Awaited<ReturnType<typeof serveOrigin>>;
let imported: Awaited<ReturnType<typeof serveOrigin>>;
let script: string;
const persistence = new URL(
	`../../../out/issue-2/native/native-profile-${crypto.randomUUID()}/`,
	import.meta.url,
).pathname;
beforeAll(async () => {
	server = await serveOrigin();
	history = await serveOrigin();
	initial = await serveOrigin();
	imported = await serveOrigin();
	script = await buildNativeFixture(
		new URL("./browser-storage-admission.test.worker.ts", import.meta.url),
	);
	worker = createWorker();
	await worker.ready;
}, 30000);
function createWorker() {
	return new Miniflare({
		modules: true,
		script,
		compatibilityDate: "2026-07-08",
		compatibilityFlags: ["nodejs_compat"],
		browserRendering: { binding: "BROWSER" },
		workerLoaders: { BROWSER_RUN_CODE_LOADER: {} },
		kvNamespaces: ["PROFILE_KV"],
		kvPersist: persistence,
		durableObjectsPersist: persistence,
		durableObjects: { PROFILE_OWNERS: "StorageAdmissionProfiles" },
	});
}
afterAll(async () => {
	try {
		if (worker) await disposeNativeFixture(worker);
	} finally {
		await server?.stop();
		await history?.stop();
		await initial?.stop();
		await imported?.stop();
		await rm(persistence, { recursive: true, force: true });
	}
});

for (const scenario of [
	"profile-store",
	"checkpoint-census",
	"same-context-load",
	"cold-owner-restore",
	"two-replacements",
	"checkpoint-failures",
	"public-reader-limit",
	"checkpoint-close-failure",
	"checkpoint-held-cancel",
	"checkpoint-control-eof",
	"held-guest",
	"mobile-storage",
	"native-cdp-ownership",
	"profile-lifecycle",
]) {
	test(`native consumer storage admission ${scenario}`, async () => {
		if (scenario === "profile-lifecycle") {
			await ["close", "delete", "deleted"].reduce(async (previous, phase) => {
				await previous;
				const response = await worker.dispatchFetch(
					`http://fixture/profile-lifecycle-${phase}`,
					{
						method: "POST",
						body: JSON.stringify({
							origin: server.url.origin,
							initial: initial.url.origin,
							imported: imported.url.origin,
							history: history.url.origin,
						}),
					},
				);
				const receipt = await response.json();
				console.log(
					JSON.stringify({
						scenario: `profile-lifecycle-${phase}`,
						status: response.status,
						result: receipt,
					}),
				);
				expect(receipt).toEqual({ ok: true });
				if (phase !== "deleted") {
					await disposeNativeFixture(worker);
					worker = createWorker();
					await worker.ready;
				}
			}, Promise.resolve());
			return;
		}
		if (scenario === "cold-owner-restore") {
			const saved = await worker.dispatchFetch(
				"http://fixture/cold-owner-save",
				{
					method: "POST",
					body: JSON.stringify({
						origin: server.url.origin,
						history: history.url.origin,
						initial: initial.url.origin,
						imported: imported.url.origin,
					}),
				},
			);
			const receipt = await saved.json();
			console.log(
				JSON.stringify({
					scenario: "cold-owner-save",
					status: saved.status,
					result: receipt,
				}),
			);
			expect(receipt).toEqual({ ok: true });
			await disposeNativeFixture(worker);
			worker = createWorker();
			await worker.ready;
		}
		const response = await worker.dispatchFetch(`http://fixture/${scenario}`, {
			method: "POST",
			body: JSON.stringify({
				origin: server.url.origin,
				history: history.url.origin,
				initial: initial.url.origin,
				imported: imported.url.origin,
			}),
		});
		const result = await response.json();
		console.log(JSON.stringify({ scenario, status: response.status, result }));
		expect(response.status).toBe(200);
		expect(result).toEqual({ ok: true });
	}, 30000);
}
