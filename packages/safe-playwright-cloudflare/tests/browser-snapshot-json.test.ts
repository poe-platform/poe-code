import { expect, test, vi } from "vitest";
import type { PlaywrightPage } from "@poe-platform/safe-bash/playwright";
import { captureBrowserSnapshotJSON } from "../src/browser-snapshot-json";
import { serializeNativeSnapshot, type NativeSnapshotScript, type NativeSnapshotResult } from "../src/browser-snapshot-json-injected";
import nativeSnapshot from "./fixtures/native-snapshot-876.json";

for (const nested of [false, true]) test(`JSON serialization admits more than 20000 nodes with nested=${nested}`, () => {
	const children = Array.from({ length: 20001 }, (_, index) => ({
		role: "button", name: `Probe${index}`, ref: `e${index}`,
		children: [], props: {}, box: { visible: true, inline: false },
	}));
	const group = { role: "group", name: "Many buttons", children, props: {}, box: { visible: true, inline: false } };
	const injected: NativeSnapshotScript = { _lastAriaSnapshotForQuery: {
		root: { ...group, children: nested ? [group] : children }, iframeRefs: [],
	} };
	const serialized = serializeNativeSnapshot(injected, { maxBytes: Infinity, boxes: false });
	expect(typeof serialized).toBe("string");
	const result = JSON.parse(serialized) as NativeSnapshotResult;
	expect(result).not.toHaveProperty("limit");
	if ("limit" in result) throw new Error(`Unexpected ${result.limit} admission limit`);
	const buttons = nested ? result.nodes[0]!.children! : result.nodes;
	expect(buttons).toHaveLength(20001);
	expect(buttons[0]).toMatchObject({ name: "Probe0", ref: "e0" });
	expect(buttons[20000]).toMatchObject({ name: "Probe20000", ref: "e20000" });
  expect(serializeNativeSnapshot(injected, { maxBytes: 128, boxes: false })).toEqual(serializeNativeSnapshot(injected, { maxBytes: Infinity, boxes: false }));
});

test("zero snapshot timeout allows asynchronous capture and preserves caller cancellation", async () => {
	const controller = new AbortController();
	const reason = new Error("caller cancelled");
	const snapshot = vi.fn(async () => {
		await new Promise(resolve => setTimeout(resolve, 10));
		return { full: "" };
	});
	const frame = { async _utilityContext() { return { async injectedScript() { return {
		async evaluate() { return JSON.stringify({ nodes: [], iframeRefs: [] }); },
	}; } }; } };
	const page = { frames: () => [frame], _snapshotForAI: snapshot, _connection: { toImpl: () => ({ mainFrame: () => frame }) } };
	const options = { signal: controller.signal, timeoutMs: 0, maxBytes: 1048576 };
	await expect(captureBrowserSnapshotJSON(page as unknown as PlaywrightPage, options)).resolves.toEqual([]);
	expect(snapshot).toHaveBeenCalledWith({ timeout: 0 });
	snapshot.mockImplementationOnce(async () => { controller.abort(reason); return { full: "" }; });
	await expect(captureBrowserSnapshotJSON(page as unknown as PlaywrightPage, options)).rejects.toBe(reason);
});

// Captured with real @playwright/cli 0.1.19: setContent, fill Name with Ada,
// snapshot --json. Refs are fixed here only to test transport, not DOM identity.
test("serializes the captured native text and textbox schema", () => {
	const nativeNode = (value: unknown): unknown => {
		if (typeof value === "string") return value;
		const { text, children, ...fields } = value as { text?: string; children?: unknown[] };
		return { name: "", ...fields, props: {}, box: {}, children: text === undefined ? (children ?? []).map(nativeNode) : [text] };
	};
	const injected = { _lastAriaSnapshotForQuery: { root: { children: nativeSnapshot.map(nativeNode) }, iframeRefs: [] } } as unknown as NativeSnapshotScript;
	expect(JSON.parse(serializeNativeSnapshot(injected, { maxBytes: 65536, boxes: false })).nodes).toEqual(nativeSnapshot);
});

test("does not impose a frame count cap before native snapshot work", async () => {
	const snapshot = vi.fn().mockResolvedValue({ full: "" });
	const root = { _utilityContext: async () => ({ injectedScript: async () => ({ evaluate: async () => JSON.stringify({ nodes: [], iframeRefs: [] }) }) }) };
	const page = { frames: () => Array(129).fill({}), _snapshotForAI: snapshot, _connection: { toImpl: () => ({ mainFrame: () => root }) } };
	await expect(
		captureBrowserSnapshotJSON(page as unknown as PlaywrightPage, {
			signal: new AbortController().signal,
			timeoutMs: 15000,
			maxBytes: 1048576,
		}),
	).resolves.toEqual([]);
	expect(snapshot).toHaveBeenCalledOnce();
});

for (const nested of [false, true]) test(`JSON capture retains later siblings beyond legacy byte limits with nested=${nested}`, () => {
  const children = ["oversized first child".repeat(100)];
  children.push("last child");
  const node = { role: "group", name: "", props: {}, box: {}, children };
  const injected = { _lastAriaSnapshotForQuery: { root: { children: nested ? [node] : children }, iframeRefs: [] } } as unknown as NativeSnapshotScript;
  const result = JSON.parse(serializeNativeSnapshot(injected, { maxBytes: 128, boxes: false }));
  expect(result.nodes).toEqual(nested ? [{ role: "group", children }] : children.map(text => ({ role: "text", text })));
});
