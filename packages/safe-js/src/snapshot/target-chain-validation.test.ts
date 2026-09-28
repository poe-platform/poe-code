import { expect, it } from "vitest";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";
import { restore as restoreDump } from "../restore.js";
import { run } from "../run.js";
import { dump } from "../dump.js";
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

it.each([1, 2])("rejects mixed target cycles starting at %s through all validators", first => {
  const heap = chain("bound-function", 2);
  heap[String(first)] = { kind: "guest-proxy", target: { kind: "ref", id: 3 - first },
    handler: { kind: "ref", id: 3 }, callable: true, constructible: false };
  heap[String(3 - first)].target = { kind: "ref", id: first };
  expect(() => validateGuestHeapGraphs(heap)).toThrow("Cyclic");
  expect(() => validateDumpEnvelope({ version: 2, sourceHash: "mixed", heap })).toThrow("Cyclic");
  const source = "return fn()";
  const snapshot = serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: { fn: { kind: "ref", id: first } } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const forged = JSON.parse(JSON.stringify(snapshot));
  forged.heap = heap;
  expect(() => restore(forged, { source })).toThrow("Cyclic");
  expect(() => restoreDump({ ...forged, version: 2 }, { source })).toThrow("Cyclic");
});

it.each([
  ["object", { kind: "object", entries: {} }, true, true],
  ["revoker", { kind: "guest-proxy-revoker", proxy: null, state: { properties: { properties: [], extensible: true } } }, true, true],
  ["function", { kind: "guest-function" }, false, false],
] as const)("rejects Proxy flags against a non-proxy %s target", (_name, target, callable, constructible) => {
  const heap = chain("guest-proxy", 1);
  heap["1"].callable = callable;
  heap["1"].constructible = constructible;
  heap["2"] = target;
  expect(() => validateGuestHeapNode(heap["1"], heap)).toThrow("Inconsistent Proxy callable flags");
});

it("rejects flags across a bound target and accepts long mixed shared tails in linear time", () => {
  const heap = chain("guest-proxy", 4096);
  const state = { properties: { properties: [], extensible: true } };
  for (let id = 2; id <= 4096; id += 2) heap[String(id)] = {
    kind: "bound-function", target: { kind: "ref", id: id - 1 },
    thisValue: { kind: "undefined" }, args: [], length: 0, state,
  };
  let lookups = 0;
  const counted = new Proxy(heap, { get(target, key, receiver) {
    lookups++;
    return Reflect.get(target, key, receiver);
  } });
  for (const node of Object.values(heap)) validateGuestHeapNode(node, counted);
  expect(() => validateGuestHeapGraphs(counted)).not.toThrow();
  expect(() => validateDumpEnvelope({ version: 2, sourceHash: "mixed", heap })).not.toThrow();
  expect(lookups).toBeLessThan(4096 * 15);
  heap["3"].constructible = true;
  expect(() => validateGuestHeapGraphs(heap)).toThrow("Inconsistent Proxy callable flags");
});


it.each([
  ["{}", true, true],
  ["Proxy.revocable({},{}).revoke", true, true],
  ["function(){}", false, false],
  ["Math.max", true, true],
  ["Object", true, false],
] as const)("rejects forged Proxy flags for %s in a complete dump", async (expression, callable, constructible) => {
  const pending = run(`Number.prototype.saved=new Proxy(${expression},{});await 0;return 1`);
  try {
    const snapshot = JSON.parse(await dump(pending));
    const proxy = (Object.values(snapshot.heap) as Array<Record<string, unknown>>).find(node => node.kind === "guest-proxy")!;
    proxy.callable = callable;
    proxy.constructible = constructible;
    expect(() => validateDumpEnvelope(snapshot)).toThrow("Inconsistent Proxy callable flags");
  } finally { await pending; }
});

it.each(["function(){}", "()=>1", "function*(){}", "async function(){}", "class {}", "Math.max", "Object"])(
  "accepts valid mixed bound and Proxy targets for %s", async expression => {
    const source = `Number.prototype.saved=new Proxy(new Proxy(${expression},{}).bind(null),{});await 0;return 1`;
    const pending = run(source);
    try {
      const snapshot = JSON.parse(await dump(pending));
      expect(() => validateDumpEnvelope(snapshot)).not.toThrow();
      expect(() => restoreDump(snapshot, { source })).not.toThrow();
    } finally { await pending; }
  });


it("validates Proxy flags across bound targets ending at a revoked Proxy", () => {
  const heap = chain("bound-function", 3);
  heap["1"] = { kind: "guest-proxy", target: null, handler: null, callable: true, constructible: true };
  heap["3"] = { kind: "guest-proxy", target: { kind: "ref", id: 2 },
    handler: { kind: "ref", id: 4 }, callable: true, constructible: true };
  expect(() => validateDumpEnvelope({ version: 2, sourceHash: "revoked", heap })).not.toThrow();
  heap["3"].constructible = false;
  expect(() => validateDumpEnvelope({ version: 2, sourceHash: "revoked", heap })).toThrow("Inconsistent Proxy callable flags");
});


it.each(["guest-proxy", "bound-function"] as const)("reports the cyclic %s node after a different root kind", kind => {
  const heap = chain(kind, 2);
  heap["2"].target = { kind: "ref", id: 2 };
  heap["1"] = chain(kind === "guest-proxy" ? "bound-function" : "guest-proxy", 2)["2"];
  heap["1"].target = { kind: "ref", id: 2 };
  expect(() => validateGuestHeapGraphs(heap)).toThrow(kind === "guest-proxy"
    ? "Cyclic Proxy target chain." : "Cyclic bound function target.");
});

it.each(["function(){}", "()=>1", "function*(){}", "async function(){}", "async function*(){}", "({m(){}}).m",
  "Function('return 1')", "eval('(function(){})')", "(new class { saved = function(){} }).saved"])(
  "resolves Proxy constructibility from %s for direct and bound targets", async expression => {
    for (const target of [`(${expression})`, `(${expression}).bind(null).bind(null)`, `new Proxy((${expression}),{}).bind(null)`]) {
      const source = `Number.prototype.saved=new Proxy(${target},{});await 0;return 1`;
      const pending = run(source);
      const snapshot = JSON.parse(await dump(pending));
      await pending;
      expect(() => restoreDump(snapshot, { source })).not.toThrow();
      const proxies = (Object.values(snapshot.heap) as Array<Record<string, unknown>>).filter(node => node.kind === "guest-proxy");
      for (const proxy of proxies) proxy.constructible = !proxy.constructible;
      expect(() => restoreDump(snapshot, { source })).toThrow("Inconsistent Proxy callable flags");
      await expect(run(source, { snapshot })).rejects.toThrow("Inconsistent Proxy callable flags");
    }
  });
