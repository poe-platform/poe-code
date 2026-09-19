import assert from "node:assert/strict";
import { SHELL_PLAYWRIGHT_LIMITS } from "./persistent-playwright.fixture";
import type { BrowserWorker } from "@cloudflare/playwright";
import { readPlaywrightStorageState } from "@poe-platform/safe-bash/playwright";
import { createBrowserCodeExecutor } from "../src/browser-code-executor";
import { browserPageCDP } from "../src/browser-page-cdp";
import { acquireCloudflareBrowser } from "../src/shell-browser-resource";
import type {
	Fixture,
	Origins,
} from "./browser-storage-admission.test.worker-cases";
import { seed } from "./browser-storage-admission.test.worker-records";
import {
	controlFaultBinding,
	assertFaultDisposal,
} from "./browser-storage-admission.test.worker-relay";

export function failureText(error: unknown) {
	const pending = [error];
	const messages: string[] = [];
	for (let inspected = 0; pending.length && inspected < 16; inspected++) {
		const current = pending.shift();
		messages.push(String(current));
		if (current instanceof AggregateError)
			pending.push(...current.errors.slice(0, 16));
	}
	return messages.join("; ");
}

export function assertCommandFailure(
	outcome: PromiseSettledResult<{
		exitCode: number;
		stdout: string;
		stderr: string;
	}>,
	expected: RegExp,
) {
	if (outcome.status === "rejected")
		assert.match(failureText(outcome.reason), expected);
	else {
		assert.equal(outcome.value.exitCode, 1, JSON.stringify(outcome.value));
		assert.match(outcome.value.stdout + outcome.value.stderr, expected);
	}
}

export async function checkpointFailures(
	create: (owner: string, binding: BrowserWorker) => Fixture,
	nativeBinding: BrowserWorker,
	input: Origins,
) {
	await ["reader", "profile-limit", "reader-limit", "cancel"].reduce(
		async (previous, fault) => {
			await previous;
			await checkpointFailure(create, nativeBinding, input, fault);
		},
		Promise.resolve(),
	);
}

async function checkpointFailure(
	create: (owner: string, binding: BrowserWorker) => Fixture,
	nativeBinding: BrowserWorker,
	input: Origins,
	fault: string,
) {
	const control = controlFaultBinding(nativeBinding);
	const f = create(`failure-${fault}`, control.binding);
	assert.equal((await f.run(["open", input.origin, "--json"])).exitCode, 0);
	const session = f.client.inspectSessions()[0]!;
	assert.ok(session.selectedPage?.evaluate);
	await seed(session.selectedPage, "committed");
	assert.equal(
		(await f.run(["eval", "() => undefined", "--json"])).exitCode,
		0,
	);
	const previous = await f.profiles.load(session.name);
	assert.ok(previous);
	assert.ok(session.context.storageState);
	const native = session.context.storageState.bind(session.context);
	const abort = new AbortController();
	let contextClosed = false;
	session.context.on("close", () => {
		contextClosed = true;
	});
	try {
		await configureCheckpointFailure(
			fault,
			session.context,
			session.selectedPage,
			native,
			abort,
		);
		if (fault === "profile-limit") {
			const state = await readOwnedState(
				session.context,
				abort.signal,
				2 * 1024 * 1024,
			);
			const stateBytes = new TextEncoder().encode(
				JSON.stringify(state),
			).byteLength;
			assert.ok(
				stateBytes < 2 * 1024 * 1024,
				"Store overflow must pass the early reader bound",
			);
			assert.ok(
				stateBytes + session.selectedPage.url().length > 2 * 1024 * 1024,
				"Actual tab URL must push the serialized profile above the owner bound",
			);
		}
		const [outcome] = await Promise.allSettled([
			f.run(["eval", "() => undefined", "--json"], abort.signal),
		]);
		const expected = expectedFailure[fault];
		assert.ok(expected, "Checkpoint failure must have an expected error");
		assertCommandFailure(outcome, expected);
		assert.deepEqual(
			await f.profiles.load(session.name),
			previous,
			`Failed ${fault} must not publish a partial profile`,
		);
	} finally {
		session.context.storageState = native;
		if (fault.endsWith("limit")) {
			assert.equal(
				contextClosed,
				true,
				`${fault} must retire during the failed CLI command`,
			);
			assert.equal(f.client.inspectSessions().length, 0);
		}
		const [disposed] = await Promise.allSettled([f.client.dispose()]);
		assertFaultDisposal(disposed, fault);
		assert.equal(
			contextClosed,
			true,
			`${fault} must retire the actual native context`,
		);
		await control.assertNativeRetirement();
		assert.deepEqual(await f.profiles.load(session.name), previous);
	}
}

const expectedFailure: Record<string, RegExp> = {
	reader: /reader-failed/,
	"profile-limit": /Browser profile byte limit/,
	"reader-limit": /Browser storage state byte limit/,
	cancel: /checkpoint-cancelled/,
};

async function configureCheckpointFailure(
	fault: string,
	context: ReturnType<Fixture["client"]["inspectSessions"]>[number]["context"],
	page: NonNullable<
		ReturnType<Fixture["client"]["inspectSessions"]>[number]["selectedPage"]
	>,
	native: NonNullable<
		ReturnType<
			Fixture["client"]["inspectSessions"]
		>[number]["context"]["storageState"]
	>,
	abort: AbortController,
) {
	assert.ok(page.evaluate);
	if (fault === "reader")
		context.storageState = async () => {
			throw new Error("storage-admission-reader-failed");
		};
	if (fault === "cancel")
		context.storageState = async (options) => {
			const state = await native(options);
			abort.abort(new Error("storage-admission-checkpoint-cancelled"));
			return state;
		};
	if (fault.endsWith("limit")) {
		const bytes = failurePayloadBytes[fault];
		assert.ok(bytes, "Checkpoint limit must have a positive payload size");
		await page.evaluate(async (bytes) => {
			const opening = indexedDB.open("admission-db");
			const database = await new Promise<IDBDatabase>((resolve, reject) => {
				opening.onsuccess = () => resolve(opening.result);
				opening.onerror = () => reject(opening.error);
			});
			try {
				const transaction = database.transaction("records", "readwrite");
				transaction
					.objectStore("records")
					.put({ id: 8, tag: "large", payload: "x".repeat(bytes) });
				await new Promise<void>((resolve, reject) => {
					transaction.oncomplete = () => resolve();
					transaction.onerror = () => reject(transaction.error);
				});
			} finally {
				database.close();
			}
		}, bytes);
	}
	if (fault === "profile-limit")
		await page.goto(
			`about:blank#profile-envelope-${"x".repeat(1024 * 1024 + 64 * 1024)}`,
		);
}

const failurePayloadBytes: Record<string, number> = {
	"profile-limit": 1024 * 1024 - 32 * 1024,
	"reader-limit": 2 * 1024 * 1024 + 1,
	"public-reader-limit": SHELL_PLAYWRIGHT_LIMITS.maxArtifactBytes + 1,
};

async function readOwnedState(
	context: ReturnType<Fixture["client"]["inspectSessions"]>[number]["context"],
	signal: AbortSignal,
	maxBytes: number,
) {
	const cleanups: (() => Promise<void>)[] = [];
	try {
		return await readPlaywrightStorageState(context, {
			signal,
			indexedDB: true,
			maxBytes,
			registerCleanup: (cleanup) => cleanups.push(cleanup),
		});
	} finally {
		const retired = await Promise.allSettled(
			cleanups.map((cleanup) => Promise.resolve().then(cleanup)),
		);
		for (const outcome of retired) assert.equal(outcome.status, "fulfilled");
	}
}

export async function publicReaderLimit(
	create: (owner: string, binding: BrowserWorker) => Fixture,
	nativeBinding: BrowserWorker,
	input: Origins,
) {
	const control = controlFaultBinding(nativeBinding);
	const f = create("public-reader-limit", control.binding);
	let contextClosed = false;
	let previous: Uint8Array | undefined;
	let sessionName = "default";
	try {
		assert.equal((await f.run(["open", input.origin, "--json"])).exitCode, 0);
		const session = f.client.inspectSessions()[0]!;
		assert.ok(session.selectedPage?.evaluate);
		await seed(session.selectedPage, "committed");
		assert.equal(
			(await f.run(["eval", "() => undefined", "--json"])).exitCode,
			0,
		);
		session.context.on("close", () => {
			contextClosed = true;
		});
		sessionName = session.name;
		previous = await f.profiles.load(session.name);
		assert.ok(previous);
		assert.ok(session.context.storageState);
		const abort = new AbortController();
		await configureCheckpointFailure(
			"public-reader-limit",
			session.context,
			session.selectedPage,
			session.context.storageState.bind(session.context),
			abort,
		);
		await assert.rejects(
			readOwnedState(
				session.context,
				abort.signal,
				SHELL_PLAYWRIGHT_LIMITS.maxArtifactBytes,
			),
			/Browser storage state byte limit/,
		);
		assert.deepEqual(await f.profiles.load(session.name), previous);
	} finally {
		const [disposed] = await Promise.allSettled([f.client.dispose()]);
		assertFaultDisposal(disposed, "public-reader-limit");
		assert.equal(contextClosed, true);
		await control.assertNativeRetirement();
		assert.ok(previous);
		assert.deepEqual(await f.profiles.load(sessionName), previous);
	}
}

export async function heldGuest(
	native: BrowserWorker,
	loader: WorkerLoader,
	input: Origins,
) {
	const resource = await acquireCloudflareBrowser({
		binding: native,
		signal: new AbortController().signal,
	});
	try {
		const context = await resource.browser.newContext({
			viewport: { width: 640, height: 480 },
			locale: "en-GB",
		});
		const page = await context.newPage();
		await page.goto(input.origin);
		await seed(page, "public-tab");
		const identity = await browserPageCDP(page);
		const { targetInfo } = await identity.send("Target.getTargetInfo");
		assert.ok(targetInfo.browserContextId);
		const observed: string[] = [];
		context.on("page", (publicPage) => observed.push(publicPage.url()));
		const cdp = await resource.browser.newBrowserCDPSession();
		const events: string[] = [];
		cdp.on("Target.targetCreated", (event) =>
			events.push(event.targetInfo.targetId),
		);
		await cdp.send("Target.setDiscoverTargets", { discover: true });
		const abort = new AbortController();
		const lease = await resource.prepareStorageOrigin({
			context: {
				newPage: context.newPage.bind(context),
				pages: context.pages.bind(context),
				close: context.close.bind(context),
				on: context.on.bind(context),
				off: context.off.bind(context),
			},
			browserContextId: targetInfo.browserContextId,
			origin: input.initial,
			signal: abort.signal,
		});
		try {
			assert.deepEqual(context.pages(), [page]);
			assert.deepEqual(observed, []);
			const execute = createBrowserCodeExecutor(resource, {
				ownerId: "held-storage-native-guest",
				loader,
			});
			const result = await execute({
				page,
				signal: new AbortController().signal,
				timeoutMs: 10000,
				maxOutputBytes: 65536,
				maxPages: 4,
				source: `async page => {
					const before = page.context().pages().map(value => value.url());
					const cdp = await page.context().browser().newBrowserCDPSession();
					const denied = [];
					try {
						for (const method of ['Target.getTargetInfo', 'Target.attachToTarget', 'Target.closeTarget']) {
							try { await cdp.send(method, {targetId: ${JSON.stringify(lease.targetId)}, flatten: true}); }
							catch (error) { if (!String(error).includes('unavailable')) throw error; denied.push(method); }
						}
					} finally { await cdp.detach(); }
					const next = await page.context().newPage();
					await next.goto(${JSON.stringify(`${input.origin}/guest-network`)});
					return {before, denied, after: page.context().pages().map(value => value.url()), title: await next.title(),
						session: await page.evaluate(() => sessionStorage.getItem("admission-tab")),
						locale: await page.evaluate(() => navigator.language), viewport: page.viewportSize()};
				}`,
			});
			assert.deepEqual(result, {
				before: [`${input.origin}/`],
				denied: [
					"Target.getTargetInfo",
					"Target.attachToTarget",
					"Target.closeTarget",
				],
				after: [`${input.origin}/`, `${input.origin}/guest-network`],
				title: "Storage admission",
				session: "public-tab",
				locale: "en-GB",
				viewport: { width: 640, height: 480 },
			});
			assert.equal(context.pages().length, 2);
			assert.equal(observed.length, 1);
			assert.equal(events.includes(lease.targetId), false);
			const { targetInfos } = await cdp.send("Target.getTargets");
			assert.equal(
				targetInfos.some((info) => info.targetId === lease.targetId),
				false,
			);
			await assert.rejects(
				cdp.send("Target.getTargetInfo", { targetId: lease.targetId }),
				/unavailable/,
			);
			await assert.rejects(
				cdp.send("Target.attachToTarget", {
					targetId: lease.targetId,
					flatten: true,
				}),
				/unavailable/,
			);
			await assert.rejects(
				cdp.send("Target.closeTarget", { targetId: lease.targetId }),
				/unavailable/,
			);
			const { result: origin } = await lease.cdp.send("Runtime.evaluate", {
				expression: "location.origin",
				returnByValue: true,
			});
			assert.deepEqual(origin, { type: "string", value: input.initial });
			abort.abort(new Error("storage-admission-held-lease-cancelled"));
			await lease.release();
			await assert.rejects(lease.cdp.send("Target.getTargetInfo"), /closed/);
			assert.equal(context.pages().length, 2);
			assert.equal(observed.length, 1);
		} finally {
			await lease.release();
			await cdp.detach();
		}
	} finally {
		await resource.release();
	}
}
