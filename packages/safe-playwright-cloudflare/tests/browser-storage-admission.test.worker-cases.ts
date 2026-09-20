import assert from "node:assert/strict";
import type { createMemoryFileSystem } from "@poe-platform/safe-bash";
import type { createPersistentPlaywright } from "./persistent-playwright.fixture";
import type { createBrowserProfileStore } from "./browser-profile-store.fixture";
import { captureRunCodeTimeouts } from '../src/browser-run-code-native';
import type { BrowserContext, Page } from '@cloudflare/playwright';
import { parseBrowserProfile } from "@poe-platform/safe-bash/playwright";
import { PROFILE_LIMITS } from "./persistent-playwright.fixture";

export interface Origins {
	origin: string;
	initial: string;
	history: string;
	imported: string;
}
export interface Fixture {
	client: ReturnType<typeof createPersistentPlaywright>;
	profiles: ReturnType<typeof createBrowserProfileStore>;
	fs: ReturnType<typeof createMemoryFileSystem>;
	run(
		args: string[],
		signal?: AbortSignal,
	): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

import {
	suppliedState,
	seed,
	contents,
	assertContents,
	targetIds,
} from "./browser-storage-admission.test.worker-records";

export async function coldRestore(
	create: (owner: string) => Fixture,
	input: Origins,
	phase: "save" | "restore",
) {
	if (phase === "save") {
		const first = create("cold-owner");
		const initial = suppliedState(input.initial, "initial", "initial-db");
		initial.cookies = [];
		initial.origins[0]!.localStorage = [];
		await first.profiles.save(
			"default",
			new TextEncoder().encode(
				JSON.stringify({
					state: initial,
					tabs: [input.origin],
					selected: 0,
          configuration: { initScripts: ['window.profileRuns = (window.profileRuns || 0) + 1'] },
					contextOptions: {
						viewport: { width: 640, height: 480 },
						locale: "en-GB",
            permissions: ['geolocation'],
					},
				}),
			),
		);
		try {
      const opened = await first.run(['eval', '() => undefined', '--json']);
      assert.equal(opened.exitCode, 0, JSON.stringify(opened));
			const session = first.client.inspectSessions()[0];
			assert.ok(session?.selectedPage);
			const persisted = parseBrowserProfile(
				(await first.profiles.load("default"))!,
        PROFILE_LIMITS);
			const imported = persisted.state.origins.find(
				(value) => value.origin === input.initial,
			)?.indexedDB?.[0];
			assert.ok(
				imported,
				"Cold acquisition must retain its supplied IDB-only origin before the first checkpoint",
			);
			const supplied = suppliedState(input.imported, "supplied", "supplied-db");
			supplied.cookies[0]!.name = "supplied-cookie";
			supplied.origins.push(...initial.origins);
			await first.fs.writeFile(
				"/supplied.json",
				new TextEncoder().encode(JSON.stringify(supplied)),
			);
			const loaded = await first.run(["state-load", "supplied.json", "--json"]);
			assert.equal(loaded.exitCode, 0, JSON.stringify(loaded));
			assert.equal(session.selectedPage.url(), 'about:blank');
			await session.selectedPage.goto(input.origin);
			await seed(session.selectedPage, "current");
			const history = await session.context.newPage();
			await history.goto(input.history);
			await seed(history, "historical", "historical-db", false);
			await history.close();
			const created = await first.run(["tab-new", input.origin, "--json"]);
			assert.equal(created.exitCode, 0, JSON.stringify(created));
      await seed(
        first.client.inspectSessions()[0]!.selectedPage!,
				"second",
				"admission-db",
			);
      const configured = await first.run(['run-code', `async page => {
        await page.setViewportSize({width: 500, height: 350});
        await page.emulateMedia({colorScheme: 'dark'});
        await page.context().setGeolocation({latitude: 12.5, longitude: 34.5});
        page.setDefaultTimeout(2345);
        page.context().setDefaultNavigationTimeout(6789);
        await page.context().addInitScript('window.contextRestored = true');
        await page.addInitScript('window.pageRestored = true');
      }`, '--json']);
      assert.equal(configured.exitCode, 0, JSON.stringify(configured));
      const checkpoint = parseBrowserProfile((await first.profiles.load('default'))!, PROFILE_LIMITS);
      const historical = checkpoint.state.origins.find(origin => origin.origin === input.history);
      assert.equal(historical?.indexedDB?.[0]?.stores[0]?.records.length, 1, 'Closed-origin checkpoint must retain records before controller recreation');
		} finally {
			await first.client.dispose();
		}
		return;
	}
	const second = create("cold-owner");
	const other = create("cold-other-owner");
  const failures: unknown[] = [];
	try {
		assert.equal(
			(await second.run(["eval", "() => undefined", "--json"])).exitCode,
			0,
		);
		const session = second.client.inspectSessions()[0];
		assert.ok(session?.selectedPage);
		assert.equal(session.context.pages().length, 2);
		assert.equal(session.selectedPage, session.context.pages()[1]);
		assert.deepEqual(session.context.pages().map(page => page.url()), ['about:blank', 'about:blank']);
		for (const page of session.context.pages()) await page.goto(input.origin);
		assert.ok(session.selectedPage.evaluate);
		assert.deepEqual(
			await session.selectedPage.evaluate(
				() => [navigator.language, innerWidth, innerHeight],
				undefined,
			),
			["en-GB", 500, 350],
		);
    assert.deepEqual(await session.selectedPage.evaluate(() => [
      matchMedia('(prefers-color-scheme: dark)').matches,
      Reflect.get(window, 'contextRestored'), Reflect.get(window, 'pageRestored'),
    ], undefined), [true, true, true]);
    assert.equal(await session.selectedPage.evaluate(() => Reflect.get(window, 'profileRuns'), undefined), 1);
    assert.deepEqual(await session.selectedPage.evaluate(() => new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        position => resolve([position.coords.latitude, position.coords.longitude]),
        error => reject(new Error(error.message)), {timeout: 500},
      );
    }), undefined), [12.5, 34.5]);
    assert.equal(captureRunCodeTimeouts(session.selectedPage as Page).action, 2345);
    assert.equal(captureRunCodeTimeouts(session.context as BrowserContext).navigation, 6789);
		await assertContents(session.selectedPage, "second");
		assert.ok(session.context.cookies);
		assert.equal(
			(await session.context.cookies()).find(
				(cookie) => cookie.name === "admission",
			)?.value,
			"second",
		);
		assert.equal(
			(await session.context.cookies()).find(
				(cookie) => cookie.name === "supplied-cookie",
			)?.value,
			"supplied",
		);
		const inspection = await session.context.newPage();
		await inspection.goto(input.initial);
		await assertContents(inspection, "initial", "initial-db", null, false);
		await inspection.goto(input.history);
		await assertContents(
			inspection,
			"historical",
			"historical-db",
			null,
			false,
		);
		await inspection.goto(input.imported);
		await assertContents(inspection, "supplied", "supplied-db");
		await inspection.close();
		assert.equal(await other.profiles.load("default"), undefined);
		assert.equal(
			(await other.run(["open", input.origin, "--json"])).exitCode,
			0,
		);
		assert.deepEqual(
			await contents(other.client.inspectSessions()[0]!.selectedPage!),
			{ local: {}, session: null, databases: [] },
		);
		assert.deepEqual(
			await other.client.inspectSessions()[0]!.context.cookies?.(),
			[],
		);
  } catch (error) {
    failures.push(error);
  } finally {
    const outcomes = await Promise.allSettled([second, other].map(owner => Promise.resolve().then(() => owner.client.dispose())));
    failures.push(...outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason] : []));
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, 'Cold-owner restore and disposal failed');
}

export async function twoReplacements(f: Fixture, input: Origins) {
	assert.equal((await f.run(["open", input.origin, "--json"])).exitCode, 0);
	const session = f.client.inspectSessions()[0]!;
	assert.ok(session.selectedPage);
	const page = session.selectedPage;
	await seed(page, "first-tab", "stale-db");
	assert.equal((await f.run(["tab-new", input.origin, "--json"])).exitCode, 0);
	const selected = f.client.inspectSessions()[0]!.selectedPage!;
	await seed(selected, "second-tab", "another-stale-db");
	const pages = session.context.pages();
	const targets = await targetIds(session.context);
	const closed = await session.context.newPage();
	await closed.goto(input.history);
	await seed(closed, "closed", "closed-db", false);
	await closed.close();
	const navigation: string[] = [];
	for (const publicPage of pages)
		publicPage.on?.("framenavigated", () => navigation.push(publicPage.url()));
	const first = suppliedState(input.initial, "loaded-first", "loaded-db");
	await f.fs.writeFile(
		"/first.json",
		new TextEncoder().encode(JSON.stringify(first)),
	);
	const firstLoad = await f.run(["state-load", "first.json", "--json"]);
	assert.equal(firstLoad.exitCode, 0, JSON.stringify(firstLoad));
	const inspection = await session.context.newPage();
	await inspection.goto(input.initial);
	await assertContents(inspection, "loaded-first", "loaded-db");
	await seed(inspection, "mutated", "loaded-db");
	await inspection.close();
	const second = suppliedState(input.origin, "loaded-second", "replacement-db");
	await f.fs.writeFile(
		"/second.json",
		new TextEncoder().encode(JSON.stringify(second)),
	);
	const secondLoad = await f.run(["state-load", "second.json", "--json"]);
	assert.equal(secondLoad.exitCode, 0, JSON.stringify(secondLoad));
	assert.equal(f.client.inspectSessions()[0]!.context, session.context);
	assert.equal(f.client.inspectSessions()[0]!.selectedPage, selected);
	assert.deepEqual(session.context.pages(), pages);
	assert.deepEqual(await targetIds(session.context), targets);
	assert.deepEqual(navigation, []);
	await assertContents(page, "loaded-second", "replacement-db", "first-tab");
	await assertContents(
		selected,
		"loaded-second",
		"replacement-db",
		"second-tab",
	);
	const historical = await session.context.newPage();
	await historical.goto(input.initial);
	assert.deepEqual(await contents(historical), {
		local: {},
		session: null,
		databases: [],
	});
	await historical.goto(input.history);
	assert.deepEqual(await contents(historical), {
		local: {},
		session: null,
		databases: [],
	});
	await historical.close();
	assert.ok(session.context.cookies);
	assert.deepEqual(
		(await session.context.cookies()).map((cookie) => [
			cookie.name,
			cookie.value,
		]),
		[["admission", "loaded-second"]],
	);
}

export async function nativeCDPOwnership(
	create: (owner: string) => Fixture,
	input: Origins,
) {
	const owned = create("native-cdp-owner");
	const other = create("native-cdp-other-owner");
	try {
		assert.equal(
			(await owned.run(["open", input.origin, "--json"])).exitCode,
			0,
		);
		assert.equal(
			(await other.run(["open", input.origin, "--json"])).exitCode,
			0,
		);
		const session = owned.client.inspectSessions()[0]!;
		assert.ok(session.context.newCDPSession);
		assert.ok(session.selectedPage);
		const cdp = await session.context.newCDPSession(session.selectedPage);
		try {
			assert.ok((await cdp.send("Target.getTargetInfo")).targetInfo);
		} finally {
			await cdp.detach();
		}
		await assert.rejects(
			session.context.newCDPSession(
				other.client.inspectSessions()[0]!.selectedPage!,
			),
			/owned by this context/,
		);
		await assert.rejects(
			session.context.newCDPSession(new Proxy(session.selectedPage, {})),
			/owned by this context/,
		);
		const closed = await session.context.newPage();
		await closed.close();
		await assert.rejects(session.context.newCDPSession(closed), /live page/);
	} finally {
		await Promise.all([owned.client.dispose(), other.client.dispose()]);
	}
}

export async function profileLifecycle(
	f: Fixture,
	input: Origins,
	phase: string,
) {
	if (phase === "close") {
		assert.equal((await f.run(["open", input.origin, "--json"])).exitCode, 0);
		await seed(f.client.inspectSessions()[0]!.selectedPage!, "lifecycle");
		assert.equal(
			(await f.run(["eval", "() => undefined", "--json"])).exitCode,
			0,
		);
		assert.equal((await f.run(["close", "--json"])).exitCode, 0);
		assert.ok(await f.profiles.load("default"));
		assert.equal(
			await f.profiles.load("default", undefined, { resumeOnly: true }),
			undefined,
		);
		return;
	}
	const resumed = await f.run(["eval", "() => undefined", "--json"]);
	assert.equal(resumed.exitCode, 1, JSON.stringify(resumed));
	assert.equal(JSON.parse(resumed.stdout).isError, true);
	assert.equal(f.client.inspectSessions().length, 0);
	if (phase === "deleted") {
		assert.equal(await f.profiles.load("default"), undefined);
		return;
	}
	assert.equal(phase, "delete");
	assert.ok(await f.profiles.load("default"));
	const reopened = await f.run(["open", input.origin, "--json"]);
	assert.equal(reopened.exitCode, 0, JSON.stringify(reopened));
	const session = f.client.inspectSessions()[0]!;
	assert.ok(session.selectedPage);
	await assertContents(session.selectedPage, "lifecycle");
	assert.equal(
		(await session.context.cookies?.())?.find(
			(cookie) => cookie.name === "admission",
		)?.value,
		"lifecycle",
	);
	assert.equal((await f.run(["delete-data", "--json"])).exitCode, 0);
	assert.equal(await f.profiles.load("default"), undefined);
}

export async function largeScriptRestore(f: Fixture, phase: 'save' | 'restore') {
  const script = `window.largeProfileScript = true; /*${'a'.repeat(70 * 1024)}*/`;
  try {
    if (phase === 'save') {
      await f.fs.writeFile('/profile-init.js', new TextEncoder().encode(script));
      await f.fs.writeFile('/cli.config.json', new TextEncoder().encode(JSON.stringify({ browser: { initScript: ['profile-init.js'] } })));
      const opened = await f.run(['open', 'about:blank', '--config=cli.config.json', '--json']);
      assert.equal(opened.exitCode, 0, JSON.stringify(opened));
    } else {
      const resumed = await f.run(['eval', '() => window.largeProfileScript', '--json']);
      assert.equal(resumed.exitCode, 0, JSON.stringify(resumed));
    }
    const session = f.client.inspectSessions()[0]!;
    assert.ok(session.selectedPage);
    if (phase === 'restore') {
      assert.equal(session.selectedPage.url(), 'about:blank');
      assert.equal(await session.selectedPage.evaluate(() => Reflect.get(window, 'largeProfileScript'), undefined), undefined);
      await session.selectedPage.goto('about:blank');
    }
    assert.equal(await session.selectedPage.evaluate(() => Reflect.get(window, 'largeProfileScript'), undefined), true);
    const checkpoint = parseBrowserProfile((await f.profiles.load('default'))!, PROFILE_LIMITS);
    assert.deepEqual(checkpoint.configuration?.initScripts, [script]);
  } finally {
    await f.client.dispose();
  }
}
