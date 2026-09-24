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

test("guest state rejects malformed completion data", () => {
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

for (const [name, changes] of [
  ['bytes', { contextInitScripts: ['💻'.repeat(32768)] }],
  ['pages', { pages: Array.from({ length: 65 }, (_, index) => ({ ...state, targetId: `page-${index}` })) }],
  ['context scripts', { contextInitScripts: Array(257).fill('window.boot = true') }],
  ['page scripts', { pages: [{ ...state, initScripts: Array(257).fill('window.boot = true') }] }],
  ['combined scripts', { contextInitScripts: ['window.boot = true'], pages: [{ ...state, initScripts: Array(256).fill('window.boot = true') }] }],
] as const) {
  test(`guest state has no implicit cap on ${name}`, () => {
    const envelope = { context, pages: [state], contextTimeouts: timeouts, contextInitScripts: [], ...changes };
    const json = JSON.stringify(envelope);
    expect(parseRunCodeState(json)).toEqual(envelope);
    expect(serializeRunCodeState(envelope)).toBe(json);
  });
}

// Native registrations must obey the same unlimited policy as the transferred state.
test('retained host and incoming scripts have no separate count or byte ceiling', async () => {
  const { validateRunCodePageOwnership } = await import('../src/browser-run-code-native.js');
  const native = { delegate: { _targetId: 'owned-page' }, initScripts: Array.from({ length: 257 }, () => ({ source: 'a'.repeat(300) })) };
  const page = { isClosed: () => false };
  const context = { pages: () => [page] };
  const browser = { _connection: { toImpl: () => native } };
  expect(() => validateRunCodePageOwnership(browser as never, context as never, {
    context: { headers: [], offline: false, geolocation: null },
    pages: [{ ...state, initScripts: Array(257).fill('window.booted = true') }], contextTimeouts: timeouts,
    contextInitScripts: ['b'.repeat(70 * 1024)],
  })).not.toThrow();
});

test('native restoration rejects missing live page state before transferring scripts', async () => {
  const { validateRunCodePageOwnership } = await import('../src/browser-run-code-native.js');
  const page = { isClosed: () => false };
  const context = { pages: () => [page] };
  const browser = { _connection: { toImpl: () => ({ delegate: { _targetId: 'live-page' } }) } };
  expect(() => validateRunCodePageOwnership(browser as never, context as never, {
    context: { headers: [], offline: false, geolocation: null },
    pages: [], contextTimeouts: timeouts, contextInitScripts: [],
  })).toThrow('Run-code page state is unavailable');
});
