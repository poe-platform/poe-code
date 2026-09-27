import { expect, it } from "vitest";
import { validateDumpEnvelope } from "./validation.js";
import { validateGuestHeapGraphs, validateGuestHeapNode } from "./guest-heap-validation.js";

function chain(kind: "guest-proxy" | "bound-function", length: number) {
  const state = { properties: { properties: [], extensible: true } };
  const heap: Record<string, Record<string, unknown>> = {
    [length + 1]: { kind: "guest-proxy-revoker", proxy: null, state },
  };
  for (let id = 1; id <= length; id++) {
    const target = { kind: "ref", id: id === 1 ? length + 1 : id - 1 };
    heap[String(id)] = kind === "guest-proxy"
      ? { kind, target, handler: { kind: "ref", id: length + 1 }, callable: true, constructible: false }
      : { kind, target, thisValue: { kind: "undefined" }, args: [], length: 0, state };
  }
  return heap;
}

it.each(["guest-proxy", "bound-function"] as const)("validates long %s chains with linear heap lookups", kind => {
  const length = 4096;
  const heap = chain(kind, length);
  let lookups = 0;
  const counted = new Proxy(heap, { get(target, key, receiver) {
    lookups++;
    return Reflect.get(target, key, receiver);
  } });
  for (const node of Object.values(heap)) validateGuestHeapNode(node, counted);
  validateGuestHeapGraphs(counted);
  expect(lookups).toBeLessThan(length * 12);
});

it.each(["guest-proxy", "bound-function"] as const)("rejects %s cycles after a shared tail", kind => {
  const heap = chain(kind, 8);
  heap["1"].target = { kind: "ref", id: 3 };
  expect(() => validateGuestHeapGraphs(heap)).toThrow(kind === "guest-proxy"
    ? "Cyclic Proxy target chain." : "Cyclic bound function target.");
});

it.each(["guest-proxy", "bound-function"] as const)("rejects %s self cycles", kind => {
  const heap = chain(kind, 1);
  heap["1"].target = { kind: "ref", id: 1 };
  expect(() => validateGuestHeapGraphs(heap)).toThrow("Cyclic");
});

it.each(["callable", "constructible"])("rejects inconsistent immediate Proxy %s flags", flag => {
  const heap = chain("guest-proxy", 3);
  heap["1"][flag] = flag === "constructible";
  expect(() => validateGuestHeapNode(heap["2"], heap)).toThrow("Inconsistent Proxy callable flags.");
});

it("accepts revoked Proxy targets and shared finished tails", () => {
  const heap = chain("guest-proxy", 8);
  heap["1"].target = null;
  heap["1"].handler = null;
  heap["8"].target = { kind: "ref", id: 2 };
  for (const node of Object.values(heap)) validateGuestHeapNode(node, heap);
  expect(() => validateGuestHeapGraphs(heap)).not.toThrow();
});

it("rejects non-callable and missing bound targets", () => {
  const heap = chain("bound-function", 1);
  heap["2"] = { kind: "object", entries: {} };
  expect(() => validateGuestHeapNode(heap["1"], heap)).toThrow("Wrong guest heap reference kind");
  delete heap["2"];
  expect(() => validateGuestHeapNode(heap["1"], heap)).toThrow();
});

it.each(["guest-proxy", "bound-function"] as const)("validates long %s chains through the public envelope validator", kind => {
  const heap = chain(kind, 2048);
  const snapshot = { version: 2, sourceHash: "target-chain", heap };
  expect(() => validateDumpEnvelope(snapshot)).not.toThrow();
  heap["1"].target = { kind: "ref", id: 2048 };
  expect(() => validateDumpEnvelope(snapshot)).toThrow("Cyclic");
});
