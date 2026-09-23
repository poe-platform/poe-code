import { expect, test, vi } from "vitest";
import type { PlaywrightPage } from "@poe-platform/safe-bash/playwright";
import { captureBrowserSnapshotJSON } from "../src/browser-snapshot-json";
import { serializeNativeSnapshot, type NativeSnapshotScript } from "../src/browser-snapshot-json-injected";
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
	const result = serializeNativeSnapshot(injected, { maxBytes: Infinity, boxes: false });
	expect(result).not.toHaveProperty("limit");
	if ("limit" in result) throw new Error(`Unexpected ${result.limit} admission limit`);
	const buttons = nested ? result.nodes[0]!.children! : result.nodes;
	expect(buttons).toHaveLength(20001);
	expect(buttons[0]).toMatchObject({ name: "Probe0", ref: "e0" });
	expect(buttons[20000]).toMatchObject({ name: "Probe20000", ref: "e20000" });
	expect(serializeNativeSnapshot(injected, { maxBytes: 128, boxes: false })).toEqual({ limit: "byte" });
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
	expect(serializeNativeSnapshot(injected, { maxBytes: 65536, boxes: false }).nodes).toEqual(nativeSnapshot);
});

test("does not impose a frame count cap before native snapshot work", async () => {
	const snapshot = vi.fn().mockResolvedValue({ full: "" });
	const root = { _utilityContext: async () => ({ injectedScript: async () => ({ evaluate: async () => ({ nodes: [], iframeRefs: [] }) }) }) };
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
