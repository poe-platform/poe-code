import { describe, expect, it } from "vitest";
import { prepareReplayInputs, type ReplayInputs } from "../snapshot/replay-inputs.js";
import { encodeReplayData } from "../snapshot/replay-data.js";
import { readPromiseCancellation, withCancellationSignal, wrapCancelableBindings } from "./cancel.js";
import { createSandboxCollectionIterator, isSandboxCollectionIterator, nextCollectionIterator } from "./collection-iterator.js";
import { createSandboxClosure, createSandboxMap, createSandboxPromise, createSandboxSet, type SandboxObject, type SandboxValue } from "./values.js";

function inputs(container: SandboxValue): ReplayInputs {
  return { bindings: { container }, imports: {}, importMeta: {}, entryPointArgs: undefined };
}

describe("collection iterator host and replay bridges", () => {
  it.each(["map", "set"] as const)("rebinds capabilities in a %s iterator source", kind => {
    const original = createSandboxClosure({ call: () => 1 });
    const replacement = createSandboxClosure({ call: () => 2 });
    const first = createSandboxCollectionIterator(kind === "map" ? createSandboxMap([["callback", original]]) : createSandboxSet([original]), "values");
    const next = createSandboxCollectionIterator(kind === "map" ? createSandboxMap([["callback", replacement]]) : createSandboxSet([replacement]), "values");
    const saved = prepareReplayInputs(inputs(first)).snapshot;
    const restored = prepareReplayInputs(inputs(next), saved).values.bindings.container;
    expect(isSandboxCollectionIterator(restored)).toBe(true);
    if (!isSandboxCollectionIterator(restored)) throw new Error("Iterator lost");
    expect(nextCollectionIterator(restored).value).toBe(replacement);
  });

  it("keeps source capability paths distinct from arbitrary own property names", () => {
    const make = () => {
      const source = createSandboxClosure({ call: () => "source" });
      const property = createSandboxClosure({ call: () => "property" });
      const iterator = createSandboxCollectionIterator(createSandboxSet([source]), "values");
      Object.assign(iterator, { "<collection>": property });
      return { source, property, iterator };
    };
    const first = make();
    const next = make();
    const saved = prepareReplayInputs(inputs(first.iterator)).snapshot;
    const restored = prepareReplayInputs(inputs(next.iterator), saved).values.bindings.container;
    expect(isSandboxCollectionIterator(restored)).toBe(true);
    if (!isSandboxCollectionIterator(restored)) throw new Error("Iterator lost");
    expect(nextCollectionIterator(restored).value).toBe(next.source);
    expect((restored as unknown as SandboxObject)["<collection>"]).toBe(next.property);
  });

  it.each(["bindings", "imports"])("rejects an iterator masquerading as the %s record", section => {
    const current = inputs(undefined);
    const invalid = { ...current, [section]: createSandboxCollectionIterator(createSandboxSet(), "values") };
    expect(() => prepareReplayInputs(current, encodeReplayData(invalid))).toThrow(/input/);
  });

  it.each(["map", "set"] as const)("registers promises retained by a %s iterator for cancellation", async kind => {
    const controller = new AbortController();
    let release!: () => void;
    const promise = createSandboxPromise(new Promise(resolve => { release = () => resolve(7); }));
    const collection = kind === "map" ? createSandboxMap([["promise", promise]]) : createSandboxSet([promise]);
    const iterator = createSandboxCollectionIterator(collection, "values");
    wrapCancelableBindings({ iterator }, controller.signal);
    const outcome = withCancellationSignal(controller.signal, () => readPromiseCancellation(promise, promise.promise));
    void outcome.catch(() => undefined);
    controller.abort(false);
    try {
      expect(outcome).not.toBe(promise.promise);
      await expect(outcome).rejects.toBe(false);
    } finally { release(); }
  });
});
