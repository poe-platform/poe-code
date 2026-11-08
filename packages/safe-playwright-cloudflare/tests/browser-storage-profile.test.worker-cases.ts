import assert from "node:assert/strict";
import type { BrowserWorker } from "@cloudflare/playwright";
import type { PlaywrightLease } from "@poe-platform/safe-bash/playwright";
import { parseBrowserProfile } from "@poe-platform/safe-bash/playwright";
import { PROFILE_LIMITS } from "./persistent-playwright.fixture";
import { checkpointBrowserProfile } from "./persistent-playwright.fixture";
import { createCloudflarePlaywrightAdapter } from "../src/shell-playwright";

export async function assertProfileOriginRestore(
	env: { BROWSER: BrowserWorker },
	profile: ReturnType<typeof parseBrowserProfile>,
) {
	let loads = 0;
	const adapter = createCloudflarePlaywrightAdapter(env.BROWSER, {
		async loadState(name, signal) {
			assert.equal(name, "agent-profile");
			signal.throwIfAborted();
			loads++;
			return profile.state;
		},
	});
	async function checkpoint(lease: PlaywrightLease) {
		let saved: ReturnType<typeof parseBrowserProfile> | undefined;
		await checkpointBrowserProfile(
			{ name: "agent-profile", context: lease.context },
			{
				async save(_name, bytes) {
					saved = parseBrowserProfile(bytes, PROFILE_LIMITS);
				},
			},
			AbortSignal.timeout(10_000),
		);
		assert.ok(saved);
		return saved.state;
	}
	const restored = await adapter.acquire({
		acquisitionId: "profile-default-restoration",
		session: "agent-profile",
		browser: "chromium",
		headless: true,
		signal: AbortSignal.timeout(15_000),
		contextOptions: { viewport: { width: 600, height: 400 } },
	});
	try {
		// No restored origin ever has a live tab in this new context.
		const state = await checkpoint(restored);
		const historical = state.origins.find(
			(item) => item.origin === "https://c.storage.example",
		);
		assert.ok(
			historical,
			"Default profile seed lost closed-tab IDB-only origin",
		);
		assert.deepEqual(historical.localStorage, []);
		assert.equal(historical.indexedDB?.[0]?.name, "auth-db");
		assert.equal(loads, 1);
	} finally {
		await restored.release();
	}
	const explicit = await adapter.acquire({
		acquisitionId: "profile-explicit-precedence",
		session: "agent-profile",
		browser: "chromium",
		headless: true,
		signal: AbortSignal.timeout(15_000),
		contextOptions: { storageState: { cookies: [], origins: [] } },
	});
	try {
		assert.equal(
			loads,
			1,
			"Explicit standard storage state must bypass profile lookup",
		);
		assert.deepEqual(await checkpoint(explicit), { cookies: [], origins: [] });
	} finally {
		await explicit.release();
	}
}
