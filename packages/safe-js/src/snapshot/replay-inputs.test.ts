import { describe, expect, it, vi } from "vitest";
import {
  createSandboxClosure,
  createSandboxPromise,
  createSandboxMap,
  createSandboxSet,
  isSandboxMap,
  isSandboxSet
} from "../interp/values.js";
import { encodeReplayData } from "./replay-data.js";
import { prepareReplayInputs, type ReplayInputs } from "./replay-inputs.js";
import { createModuleNamespace } from "../interp/module-namespace.js";

function inputs(bindings: ReplayInputs["bindings"] = {}): ReplayInputs {
  return { bindings, imports: {}, entryPointArgs: undefined, importMeta: {} };
}

describe("initial replay inputs", () => {
  it("does not observe dormant namespace promises until activation", () => {
    const pending = createSandboxPromise(Promise.resolve(7));
    const preparePromise = vi.fn(() => pending);
    const first = prepareReplayInputs(inputs(), undefined, preparePromise);
    const namespace = createModuleNamespace({ pending });
    first.captureNamespace(namespace, "fixture");
    expect(preparePromise).not.toHaveBeenCalled();
    expect(first.prepareNamespace(namespace, "fixture").pending).toBe(pending);
    expect(first.prepareNamespace(namespace, "fixture").pending).toBe(pending);
    expect(preparePromise).toHaveBeenCalledTimes(1);
  });

  it("validates dormant namespace roots even when they are never activated", () => {
    const first = prepareReplayInputs(inputs());
    const saved = structuredClone(first.snapshot);
    saved.namespaceRoots = { fixture: saved.root };
    expect(() => prepareReplayInputs(inputs(), saved)).toThrow("module namespace");
  });
  it("rejects snapshot accessors without invoking them", () => {
    const read = vi.fn(() => ({}));
    const saved = encodeReplayData(inputs());
    Object.defineProperty(saved, "namespaceRoots", { get: read, enumerable: true });
    expect(() => prepareReplayInputs(inputs(), saved)).toThrow();
    expect(read).not.toHaveBeenCalled();
  });
  it("defers unused namespace capabilities until the namespace is requested", () => {
    const read = createSandboxClosure({ call: () => 7 });
    const unused = createSandboxClosure({ call: () => 99 });
    const first = prepareReplayInputs({ ...inputs(), imports: { read } });
    first.captureNamespace(createModuleNamespace({ read, unused }), "fixture");
    const replacement = createSandboxClosure({ call: () => 8 });
    const restored = prepareReplayInputs({ ...inputs(), imports: { read: replacement } },
      structuredClone(first.snapshot));
    expect(restored.values.imports.read).toBe(replacement);
    expect(() => restored.prepareNamespace(createModuleNamespace({ read: replacement }), "fixture"))
      .toThrow("Missing replay capability");
  });

  it("preserves mutated named-import aliases when activating a dormant namespace", () => {
    const data = { count: 0 };
    const first = prepareReplayInputs({ ...inputs(), imports: { data } });
    first.captureNamespace(createModuleNamespace({ data, alias: data }), "fixture");
    data.count++;
    const namespace = first.prepareNamespace(createModuleNamespace({}), "fixture");
    expect(namespace.data).toBe(first.values.imports.data);
    expect(namespace.alias).toBe(namespace.data);
    expect(namespace.data).toEqual({ count: 1 });
    const restored = prepareReplayInputs(inputs(), structuredClone(first.snapshot));
    expect(restored.values.imports.data).toEqual({ count: 0 });
    (restored.values.imports.data as { count: number }).count++;
    const replayed = restored.prepareNamespace(createModuleNamespace({}), "fixture");
    expect(replayed.data).toBe(restored.values.imports.data);
    expect(replayed.alias).toBe(replayed.data);
    expect(replayed.data).toEqual({ count: 1 });
  });
  it("rejects an ordinary object substituted for a module namespace", () => {
    const namespace=createModuleNamespace({value:7});
    expect(()=>prepareReplayInputs({namespace},encodeReplayData({namespace:{value:7}})))
      .toThrow("module namespace");
    expect(()=>prepareReplayInputs({...inputs(),moduleNamespaces:{fixture:namespace}},
      encodeReplayData({...inputs(),moduleNamespaces:{fixture:{value:7}}})))
      .toThrow("module namespace");
  });
  it.each(["map", "set"])("rebinds callable capabilities inside a %s", (kind) => {
    const original = createSandboxClosure({ call: () => 1 });
    const replacement = createSandboxClosure({ call: () => 2 });
    const container =
      kind === "map" ? createSandboxMap([["callback", original]]) : createSandboxSet([original]);
    const next =
      kind === "map"
        ? createSandboxMap([["callback", replacement]])
        : createSandboxSet([replacement]);
    const first = prepareReplayInputs(inputs({ container }));
    const restored = prepareReplayInputs(inputs({ container: next }), first.snapshot).values
      .bindings.container;
    const capability = isSandboxMap(restored)
      ? restored.entries.get("callback")
      : isSandboxSet(restored)
        ? [...restored.values][0]
        : undefined;
    expect(capability).toBe(replacement);
  });

  it("rejects absent capabilities without calling replacements or following inherited properties", () => {
    const call = vi.fn(() => 1);
    const original = createSandboxClosure({ call });
    const first = prepareReplayInputs(inputs({ operation: original }));
    expect(() =>
      prepareReplayInputs(inputs(Object.create({ operation: original })), first.snapshot)
    ).toThrow(/capability/i);
    expect(call).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [],
    { bindings: [], imports: {} },
    { bindings: {}, imports: {}, entryPointArgs: 42 }
  ])("rejects invalid input section shapes", (value) => {
    expect(() => prepareReplayInputs(inputs(), encodeReplayData(value))).toThrow(
      /input|arguments/i
    );
  });
});
