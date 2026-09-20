import assert from "node:assert/strict";
import { readPlaywrightStorageState } from "@poe-platform/safe-bash/playwright";
import { SHELL_PLAYWRIGHT_LIMITS } from "./persistent-playwright.fixture";
import { parseBrowserProfile } from "@poe-platform/safe-bash/playwright";
import { PROFILE_LIMITS } from "./persistent-playwright.fixture";
import type {
	Fixture,
	Origins,
} from "./browser-storage-admission.test.worker-cases";
import type {
	PlaywrightContext,
	PlaywrightPage,
	PlaywrightStorageState,
} from "@poe-platform/safe-bash/playwright";

async function mobileProbe(page: PlaywrightPage) {
	assert.ok(page.evaluate);
	return page.evaluate(
		() => ({
			touch: navigator.maxTouchPoints,
			scale: devicePixelRatio,
			width: screen.width,
			locale: navigator.language,
			session: sessionStorage.getItem("admission-tab"),
		}),
		undefined,
	);
}

export async function mobileStorage(f: Fixture, input: Origins) {
	await f.profiles.save(
		"default",
		new TextEncoder().encode(
			JSON.stringify({
				state: { cookies: [], origins: [] },
				tabs: [input.origin],
				selected: 0,
				contextOptions: {
					viewport: { width: 390, height: 844 },
					locale: "en-GB",
					isMobile: true,
					hasTouch: true,
					deviceScaleFactor: 2,
				},
			}),
		),
	);
	const restored = await f.run(["eval", "() => undefined", "--json"]);
	assert.equal(restored.exitCode, 0, JSON.stringify(restored));
	const session = f.client.inspectSessions()[0]!;
	assert.ok(session.selectedPage);
	const page = session.selectedPage;
	assert.equal(page.url(), 'about:blank');
	await page.goto(input.origin);
	await seed(page, "mobile-tab");
	const before = await mobileProbe(page);
	assert.deepEqual(before, {
		touch: 1,
		scale: 2,
		width: 390,
		locale: "en-GB",
		session: "mobile-tab",
	});
	const checkpoint = await f.run(["eval", "() => undefined", "--json"]);
	assert.equal(checkpoint.exitCode, 0, JSON.stringify(checkpoint));
	await f.fs.writeFile(
		"/mobile.json",
		new TextEncoder().encode(
			JSON.stringify(suppliedState(input.imported, "mobile-imported")),
		),
	);
	const loaded = await f.run(["state-load", "mobile.json", "--json"]);
	assert.equal(loaded.exitCode, 0, JSON.stringify(loaded));
	assert.deepEqual(await mobileProbe(page), before);
	const guest = await f.run([
		"run-code",
		`async page => {
		if (await page.evaluate(() => navigator.maxTouchPoints) !== 1) throw new Error('Guest mobile touch changed');
		const next = await page.context().newPage();
		await next.goto(${JSON.stringify(`${input.origin}/guest-network`)});
		if (await next.evaluate(() => navigator.maxTouchPoints) !== 1) throw new Error('New guest mobile touch changed');
		await next.close();
	}`,
		"--json",
	]);
	assert.equal(guest.exitCode, 0, JSON.stringify(guest));
	assert.deepEqual(await mobileProbe(page), before);
	assert.equal(f.client.inspectSessions()[0]!.context, session.context);
	assert.equal(f.client.inspectSessions()[0]!.selectedPage, page);
	assert.deepEqual(session.context.pages(), [page]);
}

export function suppliedState(
	origin: string,
	tag: string,
	database = "admission-db",
): PlaywrightStorageState {
	return {
		cookies: [
			{
				name: "admission",
				value: tag,
				domain: "127.0.0.1",
				path: "/",
				expires: -1,
				httpOnly: false,
				secure: false,
				sameSite: "Lax",
			},
		],
		origins: [
			{
				origin,
				localStorage: [{ name: "admission", value: tag }],
				indexedDB: [
					{
						name: database,
						version: 1,
						stores: [
							{
								name: "records",
								keyPath: "id",
								autoIncrement: false,
								indexes: [
									{
										name: "byTag",
										keyPath: "tag",
										unique: true,
										multiEntry: false,
									},
								],
								records: [{ value: { id: 7, tag } }],
							},
						],
					},
				],
			},
		],
	};
}

export async function checkpointBaseline(
	active: Fixture,
	input: Origins,
	pathname: string,
) {
	const { profiles, client, fs, run } = active;
	assert.equal((await run(["open", input.origin, "--json"])).exitCode, 0);
	const session = client.inspectSessions()[0];
	assert.ok(session?.context);
	assert.ok(session.selectedPage);
	const context = session.context;
	const page = session.selectedPage;
	assert.ok(context.storageState);
	const native = context.storageState.bind(context);
	let indexedDBCensusCalls = 0;
	context.storageState = async (options) => {
		if (options?.indexedDB) indexedDBCensusCalls++;
		return native(options);
	};
	await seed(page, "retained");
	if (pathname === "/checkpoint-census") {
		const result = await run(["eval", "() => undefined", "--json"]);
		assert.equal(result.exitCode, 0, JSON.stringify(result));
		assert.equal(
			indexedDBCensusCalls,
			0,
			"Owner checkpoint must not invoke the native indexedDB:true collector",
		);
		const bytes = await profiles.load(session.name);
		assert.ok(bytes);
		const profile = parseBrowserProfile(bytes, PROFILE_LIMITS);
		assert.ok(
			profile.state.origins.some((origin) =>
				origin.indexedDB?.some((database) => database.name === "admission-db"),
			),
		);
		const cleanups: (() => Promise<void>)[] = [];
		try {
			const state = await readPlaywrightStorageState(context, {
				signal: new AbortController().signal,
				indexedDB: true,
				maxBytes: SHELL_PLAYWRIGHT_LIMITS.maxArtifactBytes,
				registerCleanup: (cleanup) => cleanups.push(cleanup),
			});
			assert.ok(
				state.origins.some((origin) =>
					origin.indexedDB?.some(
						(database) => database.name === "admission-db",
					),
				),
			);
		} finally {
			await Promise.allSettled(
				cleanups.map((cleanup) => Promise.resolve().then(cleanup)),
			);
		}
		assert.equal(
			(await run(["state-save", "standard.json", "--json"])).exitCode,
			0,
		);
		const standard = JSON.parse(
			new TextDecoder().decode(await fs.readFile("/standard.json")),
		);
		assert.equal(JSON.stringify(standard).includes('"indexedDB"'), false);
		const previous = await profiles.load(session.name);
		context.storageState = async () => {
			throw new Error("storage-admission-native-reader-failure");
		};
		try {
			const failed = await run(["eval", "() => undefined", "--json"]);
			assert.equal(failed.exitCode, 1, JSON.stringify(failed));
			assert.ok(
				failed.stdout.includes("storage-admission-native-reader-failure"),
			);
			assert.deepEqual(await profiles.load(session.name), previous);
		} finally {
			context.storageState = native;
		}
	} else {
		await fs.writeFile(
			"/empty.json",
			new TextEncoder().encode('{"cookies":[],"origins":[]}'),
		);
		const result = await run(["state-load", "empty.json", "--json"]);
		assert.equal(result.exitCode, 0, JSON.stringify(result));
		const after = client.inspectSessions()[0];
		assert.equal(after?.context, context);
		assert.equal(after.selectedPage, page);
		assert.equal(
			await page.evaluate?.(
				() => sessionStorage.getItem("admission-tab"),
				undefined,
			),
			"retained",
		);
	}
}

export async function seed(
	page: PlaywrightPage,
	tag: string,
	database = "admission-db",
	local = true,
) {
	assert.ok(page.evaluate);
	await page.evaluate(
		async ({ tag, database, local }) => {
			sessionStorage.setItem("admission-tab", tag);
			if (local) {
				localStorage.setItem("admission", tag);
				await cookieStore.set({
					name: "admission",
					value: tag,
					path: "/",
					sameSite: "lax",
				});
			}
			const opening = indexedDB.open(database, 1);
			const connection = await new Promise<IDBDatabase>((resolve, reject) => {
				opening.onupgradeneeded = () =>
					opening.result
						.createObjectStore("records", { keyPath: "id" })
						.createIndex("byTag", "tag", { unique: true });
				opening.onsuccess = () => resolve(opening.result);
				opening.onerror = () => reject(opening.error);
			});
			try {
				const transaction = connection.transaction("records", "readwrite");
				transaction.objectStore("records").put({ id: 7, tag });
				await new Promise<void>((resolve, reject) => {
					transaction.oncomplete = () => resolve();
					transaction.onerror = () => reject(transaction.error);
				});
			} finally {
				connection.close();
			}
		},
		{ tag, database, local },
	);
}

export async function contents(page: PlaywrightPage) {
	assert.ok(page.evaluate);
	return page.evaluate(
		async () => ({
			local: Object.fromEntries(Object.entries(localStorage)),
			session: sessionStorage.getItem("admission-tab"),
			databases: await Promise.all(
				(await indexedDB.databases())
					.sort((left, right) =>
						(left.name ?? "").localeCompare(right.name ?? ""),
					)
					.map(async (database) => {
						if (database.name === undefined)
							throw new Error("IndexedDB census omitted database name");
						const opening = indexedDB.open(database.name);
						const connection = await new Promise<IDBDatabase>(
							(resolve, reject) => {
								opening.onsuccess = () => resolve(opening.result);
								opening.onerror = () => reject(opening.error);
							},
						);
						try {
							const store = connection
								.transaction("records")
								.objectStore("records");
							const reading = store.getAll();
							const records = await new Promise<unknown[]>(
								(resolve, reject) => {
									reading.onsuccess = () => resolve(reading.result);
									reading.onerror = () => reject(reading.error);
								},
							);
							const index = store.index("byTag");
							return {
								name: connection.name,
								version: connection.version,
								keyPath: store.keyPath,
								indexes: [
									{
										name: index.name,
										keyPath: index.keyPath,
										unique: index.unique,
										multiEntry: index.multiEntry,
									},
								],
								records,
							};
						} finally {
							connection.close();
						}
					}),
			),
		}),
		undefined,
	);
}

export async function assertContents(
	page: PlaywrightPage,
	tag: string,
	database = "admission-db",
	session: string | null = null,
	local = true,
) {
	assert.deepEqual(await contents(page), {
		local: local ? { admission: tag } : {},
		session,
		databases: [
			{
				name: database,
				version: 1,
				keyPath: "id",
				indexes: [
					{ name: "byTag", keyPath: "tag", unique: true, multiEntry: false },
				],
				records: [{ id: 7, tag }],
			},
		],
	});
}

export async function targetIds(context: PlaywrightContext) {
	assert.ok(context.newCDPSession);
	const acquire = context.newCDPSession.bind(context);
	return Promise.all(
		context.pages().map(async (page) => {
			const cdp = await acquire(page);
			try {
				return (await cdp.send("Target.getTargetInfo")).targetInfo;
			} finally {
				await cdp.detach();
			}
		}),
	);
}
