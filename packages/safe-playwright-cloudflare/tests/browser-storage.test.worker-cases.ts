import assert from "node:assert/strict";
import type {
	BrowserContext,
	BrowserWorker,
	Page,
} from "@cloudflare/playwright";
import { createMemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import {
	createPlaywrightCli,
	type PlaywrightLease,
	parsePlaywrightStorageState,
} from "@poe-platform/safe-bash/playwright";
import { createBrowserCodeExecutor } from "../src/browser-code-executor";
import { browserPageCDP } from "../src/browser-page-cdp";
import { parseBrowserProfile } from "@poe-platform/safe-bash/playwright";
import { PROFILE_LIMITS } from "./persistent-playwright.fixture";
import { checkpointBrowserProfile } from "./persistent-playwright.fixture";
import { acquireCloudflareBrowser } from "../src/shell-browser-resource";
import { createCloudflarePlaywrightAdapter } from "../src/shell-playwright";
import { assertProfileOriginRestore } from "./browser-storage-profile.test.worker-cases";

interface Env {
	BROWSER: BrowserWorker;
	BROWSER_RUN_CODE_LOADER: WorkerLoader;
}

async function currentDatabase(page: Page) {
	return page.evaluate(async () => {
		const names = (await indexedDB.databases()).map((db) => db.name);
		const opening = indexedDB.open("auth-db");
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			opening.onsuccess = () => resolve(opening.result);
			opening.onerror = () => reject(opening.error);
		});
		try {
			const request = db
				.transaction("values")
				.objectStore("values")
				.get("token");
			const value: unknown = await new Promise((resolve, reject) => {
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			return { names, value };
		} finally {
			db.close();
		}
	});
}

export async function assertBrowserStorageReplacement(env: Env) {
	const adapter = createCloudflarePlaywrightAdapter(env.BROWSER);
	let lease: PlaywrightLease | undefined;
	const cli = createPlaywrightCli({
		adapter: {
			...adapter,
			async acquire(options) {
				lease = await adapter.acquire(options);
				return lease;
			},
		},
	});
	const fs = createMemoryFileSystem();
	const shell = new Shell({ fs }).use(cli.plugin);
	const run = async (script: string) => {
		const result = await shell.exec(`playwright-cli ${script}`);
		assert.equal(result.exitCode, 0, result.stderr);
		return result.stdout;
	};
	const readState = async () => {
		await run("state-save /readback.json");
		const value: unknown = JSON.parse(
			new TextDecoder().decode(
				await fs.readFile("/readback.json", { maxBytes: 65536 }),
			),
		);
		return parsePlaywrightStorageState(value, { maxBytes: 65536 });
	};
	try {
		await run("open about:blank");
		assert.ok(lease);
		const context = lease.context as BrowserContext;
		await context.route("https://*.storage.example/**", (route) =>
			route.fulfill({
				status: 200,
				body: "<title>Live page</title><main>Keep DOM</main>",
			}),
		);
		await run("goto https://a.storage.example/first");
		await run("tab-new https://b.storage.example/second");
		await run("tab-select 0");
		const [first, second] = context.pages();
		assert.ok(first && second);
		await first.evaluate(async () => {
			sessionStorage.setItem("session", "first");
			localStorage.setItem("stale", "remove");
			document.body.dataset["preserved"] = "first";
			await new Promise<void>((resolve, reject) => {
				const opening = indexedDB.open("stale-db", 1);
				opening.onupgradeneeded = () =>
					opening.result.createObjectStore("values");
				opening.onerror = () => reject(opening.error);
				opening.onsuccess = () => {
					opening.result.close();
					resolve();
				};
			});
		});
		await second.evaluate(() => {
			sessionStorage.setItem("session", "second");
			document.body.dataset["preserved"] = "second";
		});
		// Standard guest/native storageState may retain a provider IDB connection.
		// Restoration must still replace its data through owned native controls.
		await context.storageState({ indexedDB: true });
		let publicPages = 0;
		context.on("page", () => publicPages++);
		const origins = ["https://a.storage.example", "https://c.storage.example"];
		await fs.writeFile(
			"/load.json",
			new TextEncoder().encode(
				JSON.stringify({
					cookies: [
						{
							name: "auth",
							value: "fresh",
							domain: "a.storage.example",
							path: "/",
							expires: -1,
							httpOnly: false,
							secure: true,
							sameSite: "Lax",
						},
					],
					origins: origins.map((origin) => ({
						origin,
						localStorage: [{ name: "auth", value: "fresh" }],
						indexedDB: [
							{
								name: "auth-db",
								version: 1,
								stores: [
									{
										name: "values",
										autoIncrement: false,
										indexes: [],
										records: [{ key: "token", value: { secret: "fresh" } }],
									},
								],
							},
						],
					})),
				}),
			),
		);
		await run("state-load /load.json");
		assert.equal(context.pages().length, 2);
		assert.equal(
			context.pages()[0] === first && context.pages()[1] === second,
			true,
		);
		assert.equal(first.url(), "https://a.storage.example/first");
		assert.equal(second.url(), "https://b.storage.example/second");
		assert.equal(publicPages, 0);
		assert.equal(
			(await run("eval 'location.pathname'")).includes("/first"),
			true,
		);
		assert.deepEqual(
			await first.evaluate(() => ({
				session: sessionStorage.getItem("session"),
				dom: document.body.dataset["preserved"],
				local: Object.fromEntries(Object.entries(localStorage)),
			})),
			{ session: "first", dom: "first", local: { auth: "fresh" } },
		);
		assert.deepEqual(
			await second.evaluate(() => ({
				session: sessionStorage.getItem("session"),
				dom: document.body.dataset["preserved"],
			})),
			{ session: "second", dom: "second" },
		);
		const loaded = await readState();
		assert.equal(
			loaded.cookies.find((cookie: { name: string }) => cookie.name === "auth")
				?.value,
			"fresh",
		);
		for (const origin of origins) {
			const current = loaded.origins.find(
				(item: { origin: string }) => item.origin === origin,
			);
			assert.ok(current, `Current readback missing ${origin}`);
			assert.deepEqual(current.localStorage, [
				{ name: "auth", value: "fresh" },
			]);
		}
		// Standard state-save omits IndexedDB. Check its current native data directly,
		// including the restored origin that did not previously have a visible tab.
		assert.deepEqual(await currentDatabase(first), {
			names: ["auth-db"],
			value: { secret: "fresh" },
		});
		const readbackPage = await context.newPage();
		try {
			await readbackPage.goto("https://c.storage.example/readback");
			assert.deepEqual(await currentDatabase(readbackPage), {
				names: ["auth-db"],
				value: { secret: "fresh" },
			});
			await readbackPage.evaluate(() => localStorage.clear());
		} finally {
			await readbackPage.close();
		}
		let checkpoint: ReturnType<typeof parseBrowserProfile> | undefined;
		await checkpointBrowserProfile(
			{ name: "checkpoint", context: lease.context, selectedPage: first },
			{
				async save(name, bytes, signal) {
					assert.equal(name, "checkpoint");
					signal?.throwIfAborted();
					checkpoint = parseBrowserProfile(bytes, PROFILE_LIMITS);
				},
			},
			AbortSignal.timeout(10_000),
		);
		assert.ok(checkpoint);
		assert.deepEqual(checkpoint.tabs, [first.url(), second.url()]);
		assert.equal(checkpoint.selected, 0);
		const idbOnly = checkpoint.state.origins.find(
			(item) => item.origin === "https://c.storage.example",
		);
		assert.ok(idbOnly, "Checkpoint omitted IDB-only closed-tab history");
		assert.deepEqual(idbOnly.localStorage, []);
		assert.equal(idbOnly.indexedDB?.[0]?.name, "auth-db");
		await assertProfileOriginRestore(env, checkpoint);
		publicPages = 0;
		await fs.writeFile(
			"/empty.json",
			new TextEncoder().encode('{"cookies":[],"origins":[]}'),
		);
		await run("state-load /empty.json");
		assert.deepEqual(await readState(), { cookies: [], origins: [] });
		assert.deepEqual(
			await first.evaluate(async () => ({
				local: localStorage.length,
				databases: (await indexedDB.databases()).map((db) => db.name),
				session: sessionStorage.getItem("session"),
				dom: document.body.dataset["preserved"],
			})),
			{ local: 0, databases: [], session: "first", dom: "first" },
		);
		assert.equal(context.pages().length, 2);
		assert.equal(publicPages, 0);
		assert.equal(
			(await run("eval 'location.pathname'")).includes("/first"),
			true,
		);
	} finally {
		await cli.dispose();
	}
}

export async function assertBrowserPrivateStorageCancellation(env: Env) {
	const resource = await acquireCloudflareBrowser({
		binding: env.BROWSER,
		signal: AbortSignal.timeout(30_000),
	});
	try {
		const context = await resource.browser.newContext();
		const page = await context.newPage();
		await page.setContent("<title>Still owned</title>");
		const identity = await browserPageCDP(page);
		const { targetInfo } = await identity.send("Target.getTargetInfo");
		const controller = new AbortController();
		const lease = await resource.prepareStorageOrigin({
			context: context as BrowserContext & PlaywrightLease["context"],
			browserContextId: targetInfo.browserContextId!,
			origin: "https://example.com",
			signal: controller.signal,
		});
		try {
			assert.equal(context.pages().length, 1);
			const execute = createBrowserCodeExecutor(resource, {
				ownerId: "storage-private-test",
				loader: env.BROWSER_RUN_CODE_LOADER,
			});
			assert.deepEqual(
				await execute({
					page,
					source: `async page => {
        const cdp = await page.context().browser().newBrowserCDPSession();
        try { return (await cdp.send('Target.getTargets')).targetInfos.filter(t=>t.type==='page').map(t=>t.targetId); }
        finally { await cdp.detach(); }
      }`,
					signal: AbortSignal.timeout(10_000),
					timeoutMs: 10_000,
					maxOutputBytes: 65536,
					maxPages: 4,
				}),
				[targetInfo.targetId],
			);
			controller.abort(new Error("Storage cancelled"));
			await assert.rejects(
				lease.cdp.send("Runtime.evaluate", { expression: "1+1" }),
			);
		} finally {
			await lease.release();
		}
		assert.equal(context.pages().length, 1);
		assert.equal(await page.title(), "Still owned");
		await assert.rejects(
			resource.prepareStorageOrigin({
				context: context as BrowserContext & PlaywrightLease["context"],
				browserContextId: targetInfo.browserContextId!,
				origin: "https://example.com",
				signal: AbortSignal.abort(new Error("Pre-cancelled")),
			}),
			/Pre-cancelled/,
		);
		const observer = await resource.browser.newBrowserCDPSession();
		try {
			const { targetInfos } = await observer.send("Target.getTargets");
			assert.equal(
				targetInfos.some((target) => target.targetId === lease.targetId),
				false,
			);
		} finally {
			await observer.detach();
		}
	} finally {
		await resource.release();
	}
}
