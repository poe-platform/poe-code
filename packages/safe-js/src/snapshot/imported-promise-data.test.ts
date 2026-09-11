import { expect, it } from "vitest";
import { Budget } from "../interp/budget.js";
import { createSharedArrayBufferStorage } from "../interp/shared-array-buffer.js";
import { createSandboxPromise, deepCopyToSandbox, getPromiseProperties, isSandboxPromise, measureSandboxData } from "../interp/values.js";
import { SandboxPromiseRejectionTracker, withSandboxPromiseRejectionTracker } from "../interp/promise-tracker.js";
import { decodeReplayData, encodeReplayData } from "./replay-data.js";

it("does not encode a pending imported Promise as settled data", () => {
  const value = deepCopyToSandbox(new Promise(() => undefined));
  expect(() => encodeReplayData(value, { captureSettledImportedPromises: true })).toThrow("resume capability");
});

it("does not admit arbitrary unregistered sandbox Promises", async () => {
  const value = createSandboxPromise(Promise.resolve(7));
  await value.promise;
  expect(() => encodeReplayData(value, { captureSettledImportedPromises: true })).toThrow("resume capability");
});

it("does not discard custom Promise properties", async () => {
  const value = deepCopyToSandbox(Promise.resolve(7));
  if (!isSandboxPromise(value)) throw new Error("Expected imported Promise");
  await value.promise;
  getPromiseProperties(value).extra = 1;
  const restored = decodeReplayData(encodeReplayData(value, { captureSettledImportedPromises: true }));
  if (!isSandboxPromise(restored)) throw new Error("Expected restored Promise");
  expect(getPromiseProperties(restored).extra).toBe(1);
  await expect(restored.promise).resolves.toBe(7);
});

it.each(["pending", "unknown", null])("rejects invalid serialized settlement %s", status => {
  expect(() => decodeReplayData({ root: { tag: "ref", id: 0 }, nodes: [
    { kind: "settled-imported-promise", status, outcome: 7 }
  ] })).toThrow("Invalid imported Promise settlement");
});

it("keeps unobserved execution rejections visible to the rejection tracker", async () => {
  const tracker = new SandboxPromiseRejectionTracker();
  withSandboxPromiseRejectionTracker(tracker, () => decodeReplayData({
    root: { tag: "ref", id: 0 }, nodes: [
      { kind: "settled-imported-promise", status: "rejected", outcome: "reason" }
    ]
  }));
  expect(await tracker.findUnhandledRejection()).toMatchObject({ reason: "reason" });
});

it("rejects impossible direct self-fulfillment", () => {
  expect(() => decodeReplayData({ root: { tag: "ref", id: 0 }, nodes: [
    { kind: "settled-imported-promise", status: "fulfilled", outcome: { tag: "ref", id: 0 } }
  ] })).toThrow("A fulfilled Promise cannot directly contain a Promise");
});

it("can immediately re-encode a restored settled Promise", () => {
  const graph = { root: { tag: "ref", id: 0 }, nodes: [
    { kind: "settled-imported-promise", status: "fulfilled", outcome: 7 }
  ] };
  const value = decodeReplayData(graph);
  expect(encodeReplayData(value, { captureSettledImportedPromises: true })).toEqual(graph);
});

it("retains and measures original settlement data after guest mutation", async () => {
  const value = deepCopyToSandbox(Promise.resolve(["original"]));
  if (!isSandboxPromise(value)) throw new Error("Expected imported Promise");
  const result = await value.promise;
  if (!Array.isArray(result)) throw new Error("Expected array settlement");
  result[0] = "changed";
  const saved = encodeReplayData(value, { captureSettledImportedPromises: true });
  const restored = decodeReplayData(saved);
  if (!isSandboxPromise(restored)) throw new Error("Expected restored Promise");
  await expect(restored.promise).resolves.toEqual(["original"]);
  expect(measureSandboxData([value])).toBeGreaterThan(measureSandboxData([result]));
});

it("captures original shared storage bytes rather than a live buffer alias", async () => {
  const bytes = new Uint8Array(createSharedArrayBufferStorage(1, undefined, new Budget()));
  bytes[0] = 7;
  const value = deepCopyToSandbox(Promise.resolve(bytes));
  if (!isSandboxPromise(value)) throw new Error("Expected imported Promise");
  const result = await value.promise;
  if (!(result instanceof Uint8Array)) throw new Error("Expected bytes");
  result[0] = 9;
  const restored = decodeReplayData(encodeReplayData(value, { captureSettledImportedPromises: true }));
  if (!isSandboxPromise(restored)) throw new Error("Expected restored Promise");
  expect(Array.from(await restored.promise as Uint8Array)).toEqual([7]);
});

it("resolves a canonical Promise node shared by different outcome graphs", async () => {
  const canonical = { root: { tag: "ref", id: 0 }, nodes: [
    { kind: "settled-imported-promise", status: "fulfilled", outcome: 7 }
  ] };
  const options = { importedPromiseMemo: new Map(), resolvePromiseGraph: () => canonical };
  const first = decodeReplayData(canonical, { ...options, graphId: "first" });
  const second = decodeReplayData({ root: {
    tag: "imported-promise-reference", callId: "first", node: 0
  }, nodes: [] }, { ...options, graphId: "second" });
  expect(second).toBe(first);
});

it.each([-1, 1, 0.5, "0"])("rejects invalid imported Promise node %s", node => {
  const graph = { root: 7, nodes: [
    { kind: "settled-imported-promise", status: "fulfilled", outcome: 7 }
  ] };
  expect(() => decodeReplayData({ root: {
    tag: "imported-promise-reference", callId: "first", node
  }, nodes: [] }, { importedPromiseMemo: new Map(), resolvePromiseGraph: () => graph }))
    .toThrow();
});

it.each([undefined, { root: 7, nodes: [] }, { root: 7, nodes: [{ kind: "object" }] }])(
  "rejects a missing or non-Promise canonical declaration", graph => {
    expect(() => decodeReplayData({ root: {
      tag: "imported-promise-reference", callId: "missing", node: 0
    }, nodes: [] }, { importedPromiseMemo: new Map(), resolvePromiseGraph: () => graph }))
      .toThrow();
  }
);

it("rejects a malformed canonical outcome even when reached only by reference", () => {
  expect(() => decodeReplayData({ root: {
    tag: "imported-promise-reference", callId: "first", node: 0
  }, nodes: [] }, { importedPromiseMemo: new Map(), resolvePromiseGraph: () => ({
    root: 7, nodes: [{ kind: "settled-imported-promise", status: "fulfilled", outcome: { tag: "ref", id: 99 } }]
  }) })).toThrow("Invalid replay data reference");
});
