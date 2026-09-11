import { expect, it } from "vitest";
import { createSandboxClosure, createSandboxPromise, getPromiseProperties, isSandboxClosure, isSandboxPromise } from "../interp/values.js";
import { decodeReplayData, encodeReplayData } from "./replay-data.js";
import { prepareReplayInputs } from "./replay-inputs.js";
import { Budget } from "../interp/budget.js";
import { CompileScope } from "../interp/regex/compile-guard.js";

it("round-trips Promise capability descriptors, aliases and self-cycles", async () => {
  const source = createSandboxPromise(Promise.resolve(7));
  const shared = { count: 1 };
  Object.defineProperties(getPromiseProperties(source), {
    hidden: { value: shared }, alias: { value: shared, enumerable: true }, self: { value: source }
  });
  Object.preventExtensions(getPromiseProperties(source));
  const graph = encodeReplayData({ source, alias: source, shared }, { identifyPromise: () => "input", captureCapabilityProperties: true });
  const target = createSandboxPromise(Promise.resolve(9));
  const restored = decodeReplayData(JSON.parse(JSON.stringify(graph)), { resolvePromise: () => target }) as Record<string, unknown>;
  expect(restored.source).toBe(target);
  expect(restored.alias).toBe(target);
  const properties = getPromiseProperties(target);
  expect(properties.hidden).toBe(restored.shared);
  expect(properties.alias).toBe(restored.shared);
  expect(properties.self).toBe(target);
  expect(Object.getOwnPropertyDescriptor(properties, "hidden")).toMatchObject({ enumerable: false, configurable: false, writable: false });
  expect(Object.isExtensible(properties)).toBe(false);
  await expect(target.promise).resolves.toBe(9);
});

it("keeps bare Promise capability atoms compatible", () => {
  const target = createSandboxPromise(Promise.resolve(7));
  expect(decodeReplayData({ root: { tag: "promise-capability", id: "input" }, nodes: [] }, { resolvePromise: () => target })).toBe(target);
  expect(isSandboxPromise(target)).toBe(true);
});

it("rejects a Promise substituted for its property table without mutating the target", () => {
  const target = createSandboxPromise(Promise.resolve(7));
  const previous = getPromiseProperties(target);
  expect(() => decodeReplayData({ root: { tag: "ref", id: 0 }, nodes: [
    { kind: "promise-capability", id: "input", properties: { tag: "ref", id: 0 } }
  ] }, { resolvePromise: () => target })).toThrow(/properties/);
  expect(getPromiseProperties(target)).toBe(previous);
});

it("rolls back property replacement when a later initialization fails", () => {
  const source = createSandboxPromise(Promise.resolve(7));
  getPromiseProperties(source).label = "saved";
  const graph = encodeReplayData([source, source], { identifyPromise: () => "input", captureCapabilityProperties: true });
  const promiseNode = graph.nodes.findIndex(node => node.kind === "promise-capability");
  const invalid = graph.nodes.length;
  const malformed = JSON.parse(JSON.stringify(graph));
  malformed.nodes.push({ kind: "promise-capability", id: "second", properties: { tag: "ref", id: invalid + 1 } });
  malformed.nodes.push({ kind: "object", properties: { broken: { value: { tag: "ref", id: invalid + 9 }, writable: true, enumerable: true, configurable: true } }, extensible: true, nullPrototype: false });
  const root = malformed.nodes[malformed.root.id];
  root.properties["1"].value = { tag: "ref", id: invalid };
  expect(promiseNode).toBeGreaterThanOrEqual(0);
  const target = createSandboxPromise(Promise.resolve(9));
  const previous = getPromiseProperties(target);
  previous.label = "current";
  expect(() => decodeReplayData(malformed, { resolvePromise: () => target })).toThrow();
  expect(getPromiseProperties(target)).toBe(previous);
  expect(previous.label).toBe("current");
});

it("rebinds callable properties of replay input Promises", async () => {
  const original = createSandboxPromise(Promise.resolve(1));
  getPromiseProperties(original).read = createSandboxClosure({ call: () => 7 });
  const inputs = { bindings: { input: original }, imports: {}, entryPointArgs: undefined, importMeta: {} };
  const first = prepareReplayInputs(inputs, undefined, () => createSandboxPromise(Promise.resolve(1)));
  const replacement = createSandboxPromise(Promise.resolve(2));
  getPromiseProperties(replacement).read = createSandboxClosure({ call: () => 9 });
  const next = prepareReplayInputs({ ...inputs, bindings: { input: replacement } },
    JSON.parse(JSON.stringify(first.snapshot)), () => createSandboxPromise(Promise.resolve(2)));
  const restored = next.values.bindings.input;
  const read = getPromiseProperties(restored).read;
  if (!isSandboxClosure(read)) throw new Error("Missing callable property");
  expect(await read.call([])).toBe(9);
});

it.each([
  { data: "x".repeat(129), limits: { stringLength: 128 } },
  { data: Array.from({ length: 65 }, () => 1), limits: { arrayLength: 64 } }
])("rolls back earlier Promise properties after an allocation rejection %j", ({ data, limits }) => {
  const first = createSandboxPromise(Promise.resolve(1));
  const second = createSandboxPromise(Promise.resolve(2));
  getPromiseProperties(first).label = "saved";
  getPromiseProperties(second).data = data;
  const graph = encodeReplayData([first, second], {
    identifyPromise: value => value === first ? "first" : "second", captureCapabilityProperties: true
  });
  const firstTarget = createSandboxPromise(Promise.resolve(3));
  const secondTarget = createSandboxPromise(Promise.resolve(4));
  const firstProperties = getPromiseProperties(firstTarget);
  const secondProperties = getPromiseProperties(secondTarget);
  firstProperties.label = "current";
  const budget = new Budget(limits);
  const operation = budget.acquireCompileOwner(false);
  const compilation = new CompileScope(operation.owner);
  try {
    expect(() => decodeReplayData(graph, { resolvePromise: id => id === "first" ? firstTarget : secondTarget }, compilation))
      .toThrow(expect.objectContaining({ code: "budgetExceeded", budget: Object.keys(limits)[0] }));
    expect(getPromiseProperties(firstTarget)).toBe(firstProperties);
    expect(firstProperties.label).toBe("current");
    expect(getPromiseProperties(secondTarget)).toBe(secondProperties);
  } finally { compilation.dispose(); operation.release(); }
});
