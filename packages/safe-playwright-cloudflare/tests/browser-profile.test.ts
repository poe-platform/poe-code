const limits = {maxBytes: 2 * 1024 * 1024, maxTabs: 8};
import { expect, test } from "vitest";
import { parseBrowserProfile } from "../../safe-bash/src/playwright/profile.js";

const encode = (value: unknown) =>
	new TextEncoder().encode(JSON.stringify(value));
const profile = {
	state: { cookies: [], origins: [] },
	tabs: ["https://example.com/", "about:blank"],
	selected: 1,
};

test("browser profile preserves validated native state and selected tab", () => {
	expect(parseBrowserProfile(encode(profile), limits)).toEqual(profile);
});

test("browser profiles retain native context settings and session expiry", () => {
	const saved = {
		...profile,
		contextOptions: { viewport: { width: 360, height: 732 }, isMobile: true },
		expiresAt: 123456,
		idleTimeoutMs: 60000,
		configuration: {
			timeouts: { action: 5000, navigation: 10000, settle: 0 },
			initScripts: ["window.profileInitialized = true;"],
		},
	};
	expect(parseBrowserProfile(encode(saved), limits)).toEqual(saved);
});

test("stored context settings and expiry are validated before restoration", () => {
	for (const metadata of [
		{ expiresAt: "later" },
		{ idleTimeoutMs: -1 },
		{ contextOptions: { viewport: { width: -1, height: 500 } } },
		{ configuration: { timeouts: { action: -1 } } },
		{ configuration: { initScripts: [false] } },
	]) {
		expect(() =>
			parseBrowserProfile(encode({ ...profile, ...metadata }), limits),
		).toThrow();
	}
});

test("browser restoration preserves native browser URLs without a host blocklist", () => {
	for (const tab of [
		"file:///tmp/page.html",
		"http://example.com",
		"https://api.cloudflare.com/",
		"https://localhost/",
		"https://an-app.someone.workers.dev/",
		"data:text/html,hello",
		`data:text/plain,${"a".repeat(20_000)}`,
	]) {
		const saved = { ...profile, tabs: [tab], selected: 0 };
		expect(parseBrowserProfile(encode(saved), limits)).toEqual(saved);
	}
});

test("browser restoration rejects malformed profiles before allocation", () => {
	for (const override of [
		{ selected: -1 },
		{ selected: 2 },
		{ selected: 0.5 },
		{ tabs: [42] },
		{ tabs: ["not a URL"] },
		{ tabs: [""] },
		{ tabs: Array(9).fill("https://example.com/") },
		{ state: { cookies: "invalid", origins: [] } },
	]) {
		expect(() =>
			parseBrowserProfile(encode({ ...profile, ...override }), limits),
		).toThrow();
	}
});
