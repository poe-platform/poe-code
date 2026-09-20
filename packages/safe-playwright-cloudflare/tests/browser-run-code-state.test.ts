import { expect, test } from "vitest";
import {
	parseRunCodeState,
	serializeRunCodeState,
} from "../src/browser-run-code-state";

const context = { headers: [], offline: false, geolocation: null };
const timeouts = { action: 0, navigation: null };
const state = {
	timeouts,
	targetId: "owned-page",
	viewport: { width: 360, height: 732 },
	size: {
		viewport: { width: 360, height: 732 },
		screen: { width: 360, height: 808 },
	},
	media: { colorScheme: "dark" as const },
	initScripts: ["window.booted = 41"],
};

test("guest state preserves emulation and separate page and context scripts", () => {
	const envelope = {
		context,
		pages: [state],
		contextTimeouts: timeouts,
		contextInitScripts: ["window.contextInit = true"],
	};
	expect(parseRunCodeState(serializeRunCodeState(envelope))).toEqual(envelope);
});

test("guest state rejects oversized or malformed completion data", () => {
	for (const json of [
		" ".repeat(65537),
		JSON.stringify({
			context,
			pages: [{ ...state, timeouts: { action: -1, navigation: null } }],
			contextTimeouts: timeouts,
			contextInitScripts: [],
		}),
		JSON.stringify({
			context,
			pages: [state],
			contextTimeouts: { action: null, navigation: "1500" },
			contextInitScripts: [],
		}),
		JSON.stringify({
			context,
			pages: Array(65).fill(state),
			contextTimeouts: timeouts,
			contextInitScripts: [],
		}),
		JSON.stringify({
			context,
			pages: [{ ...state, viewport: { width: 0, height: 732 } }],
			contextTimeouts: timeouts,
			contextInitScripts: [],
		}),
		JSON.stringify({
			context,
			pages: [{ ...state, media: { colorScheme: "script" } }],
			contextTimeouts: timeouts,
			contextInitScripts: [],
		}),
		JSON.stringify({
			context,
			pages: [{ ...state, injected: true }],
			contextTimeouts: timeouts,
			contextInitScripts: [],
		}),
		JSON.stringify({
			context,
			pages: [{ ...state, initScripts: [42] }],
			contextTimeouts: timeouts,
			contextInitScripts: [],
		}),
		JSON.stringify({
			context,
			pages: [state],
			contextTimeouts: timeouts,
			contextInitScripts: Array(257).fill(""),
		}),
		JSON.stringify({
			context,
			pages: [{ ...state, initScripts: Array(256).fill("") }],
			contextTimeouts: timeouts,
			contextInitScripts: [""],
		}),
		JSON.stringify({
			context,
			pages: [state],
			contextTimeouts: timeouts,
			contextInitScripts: ["💻".repeat(16384)],
		}),
	]) {
		expect(() => parseRunCodeState(json)).toThrow();
	}
});

test("guest context state preserves clearing and rejects malformed native settings", () => {
	const envelope = {
		pages: [state],
		contextTimeouts: timeouts,
		contextInitScripts: [],
	};
	const configured = {
		headers: [{ name: "x-probe", value: "value" }],
		offline: true,
		geolocation: { latitude: -90, longitude: 180, accuracy: 0 },
	};
	expect(
		parseRunCodeState(
			serializeRunCodeState({ ...envelope, context: configured }),
		).context,
	).toEqual(configured);
	for (const invalid of [
		{ ...context, headers: [{ name: "invalid header", value: "value" }] },
		{ ...context, headers: [{ name: "x-probe", value: "first\r\nsecond" }] },
		{ ...context, headers: [{ name: "x-probe", value: 1 }] },
		{ ...context, offline: "true" },
		{ ...context, geolocation: { latitude: 91, longitude: 0 } },
		{ ...context, geolocation: { latitude: 0, longitude: 181 } },
		{ ...context, geolocation: { latitude: 0, longitude: 0, accuracy: -1 } },
	]) {
		expect(() =>
			parseRunCodeState(JSON.stringify({ ...envelope, context: invalid })),
		).toThrow();
	}
});
