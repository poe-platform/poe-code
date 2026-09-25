import { expect, test } from "vitest";
import { serializeNativeSnapshot, type NativeSnapshotScript } from "../src/browser-snapshot-json-injected";
import type { PlaywrightPage } from "@poe-platform/safe-bash/playwright";
import { captureBrowserSnapshotJSON } from "../src/browser-snapshot-json";

function snapshot(children: unknown[]): NativeSnapshotScript {
  return { _lastAriaSnapshotForQuery: { root: { children }, iframeRefs: [] } } as unknown as NativeSnapshotScript;
}

test("unlimited JSON snapshots retain more than 20000 native nodes", () => {
  const nodes = Array.from({ length: 20001 }, () => ({ role: "button", name: "Save", children: [], props: {}, box: {} }));
  expect(serializeNativeSnapshot(snapshot(nodes), { maxBytes: Infinity, boxes: false }).nodes).toHaveLength(20001);
});

test("native text retains compact leaf and mixed-child representations", () => {
  const node = { role: "paragraph", name: "", props: {}, box: {}, children: ["Hello"] };
  const mixed = { ...node, role: "generic", children: ["Before", node, "After"] };
  expect(serializeNativeSnapshot(snapshot([mixed]), { maxBytes: Infinity, boxes: false }).nodes).toEqual([
    { role: "generic", children: ["Before", { role: "paragraph", text: "Hello" }, "After"] },
  ]);
  expect(() => serializeNativeSnapshot(snapshot([mixed]), { maxBytes: 10, boxes: false })).toThrow("limit exceeded");
});

test("an explicit JSON budget accepts its exact serialized size", () => {
  const tree = snapshot([{ role: "generic", name: "", props: {}, box: {}, children: ["Before", { role: "button", name: "Save", props: {}, box: {}, children: [] }, "After"] }]);
  const result = serializeNativeSnapshot(tree, { maxBytes: Infinity, boxes: false });
  const bytes = new TextEncoder().encode(JSON.stringify(result.nodes)).length;
  expect(serializeNativeSnapshot(tree, { maxBytes: bytes, boxes: false })).toEqual(result);
  expect(() => serializeNativeSnapshot(tree, { maxBytes: bytes - 1, boxes: false })).toThrow("limit exceeded");
});

test.each([Infinity, 1024 * 1024])("snapshot traversal admits 129 child frames with byte budget %s", async maxBytes => {
  const refs = Array.from({ length: 129 }, (_, index) => `frame-${index}`);
  const frame = (tree: NativeSnapshotScript) => ({
    _utilityContext: async () => ({ injectedScript: async () => ({
      evaluate: async (fn: typeof serializeNativeSnapshot, options: { maxBytes: number; boxes: boolean }) => fn(tree, options),
    }) }),
    selectors: { resolveFrameForSelector: async () => null },
  });
  const leaf = frame(snapshot([{ role: "button", name: "Save", children: [], props: {}, box: {} }]));
  const tree = snapshot(refs.map(ref => ({ role: "iframe", ref, children: [], props: {}, box: {} })));
  tree._lastAriaSnapshotForQuery!.iframeRefs = refs;
  const root = { ...frame(tree), selectors: { resolveFrameForSelector: async () => ({ frame: leaf }) } };
  const page = { frames: () => [root, ...refs.map(() => leaf)], _snapshotForAI: async () => ({ full: "" }),
    _connection: { toImpl: () => ({ mainFrame: () => root }) } };
  const result = await captureBrowserSnapshotJSON(page as unknown as PlaywrightPage, {
    maxBytes, signal: new AbortController().signal, timeoutMs: 15000,
  });
  expect(result).toHaveLength(129);
  expect(result.every(node => node.children?.length === 1)).toBe(true);
});

test("public capture accepts its exact output byte budget and recovers after a smaller budget", async () => {
  const tree = snapshot([{ role: "button", name: "Save", children: [], props: {}, box: {} }]);
  const root = { _utilityContext: async () => ({ injectedScript: async () => ({
    evaluate: async (fn: typeof serializeNativeSnapshot, options: { maxBytes: number; boxes: boolean }) => fn(tree, options),
  }) }), selectors: { resolveFrameForSelector: async () => null } };
  const page = { _snapshotForAI: async () => ({ full: "" }), _connection: { toImpl: () => ({ mainFrame: () => root }) } };
  const options = { maxBytes: Infinity, signal: new AbortController().signal, timeoutMs: 15000 };
  const result = await captureBrowserSnapshotJSON(page as unknown as PlaywrightPage, options);
  const bytes = new TextEncoder().encode(JSON.stringify(result)).length;
  expect(await captureBrowserSnapshotJSON(page as unknown as PlaywrightPage, { ...options, maxBytes: bytes })).toEqual(result);
  await expect(captureBrowserSnapshotJSON(page as unknown as PlaywrightPage, { ...options, maxBytes: bytes - 1 })).rejects.toThrow("limit exceeded");
  expect(await captureBrowserSnapshotJSON(page as unknown as PlaywrightPage, options)).toEqual(result);
});

test.each([false, true])("unlimited public snapshots retain 200001 nodes with nested root %s", async nested => {
  const children = Array.from({ length: 200001 }, () => ({ role: "button", name: "Save", children: [], props: {}, box: {} }));
  const tree = snapshot(nested ? [{ role: "generic", children, props: {}, box: {} }] : children);
  const root = { _utilityContext: async () => ({ injectedScript: async () => ({
    evaluate: async (fn: typeof serializeNativeSnapshot, options: { maxBytes: number; boxes: boolean }) => fn(tree, options),
  }) }), selectors: { resolveFrameForSelector: async () => null } };
  const page = { _snapshotForAI: async () => ({ full: "" }), _connection: { toImpl: () => ({ mainFrame: () => root }) } };
  const result = await captureBrowserSnapshotJSON(page as unknown as PlaywrightPage, {
    maxBytes: Infinity, signal: new AbortController().signal, timeoutMs: 15000,
  });
  expect(nested ? result[0]?.children : result).toHaveLength(200001);
});
