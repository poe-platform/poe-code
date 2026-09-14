import { expect, it, vi } from "vitest";
import {
  createSandboxClosure,
  createSandboxPromise,
  getPromiseProperties,
  promiseProperties
} from "../interp/values.js";
import { decodeReplayData, encodeReplayData } from "./replay-data.js";
import { prepareReplayInputs } from "./replay-inputs.js";

it("does not create a Promise property table while rejecting a forged capability path", () => {
  const promise = createSandboxPromise(new Promise(() => undefined));
  const preparePromise = vi.fn();
  const restored = vi.fn();
  expect(promiseProperties.has(promise)).toBe(false);
  expect(() =>
    prepareReplayInputs(
      {
        bindings: { owned: promise },
        imports: {},
        entryPointArgs: undefined,
        importMeta: undefined
      },
      {
        root: {
          tag: "capability",
          id: JSON.stringify(["bindings", "owned", "properties", "missing"])
        },
        nodes: []
      },
      preparePromise,
      restored
    )
  ).toThrow("Missing replay capability");
  expect(promiseProperties.has(promise)).toBe(false);
  expect(preparePromise).not.toHaveBeenCalled();
  expect(restored).not.toHaveBeenCalled();
});

it("resolves an explicitly supplied capability through an existing Promise property table", () => {
  const call = vi.fn(() => 7);
  const capability = createSandboxClosure({ call });
  const promise = createSandboxPromise(new Promise(() => undefined));
  const table = getPromiseProperties(promise);
  table.operation = capability;
  const current = {
    bindings: { owned: promise },
    imports: {},
    entryPointArgs: undefined,
    importMeta: undefined
  };
  const saved = encodeReplayData(
    { ...current, bindings: { operation: capability } },
    {
      identifyCapability: () => JSON.stringify(["bindings", "owned", "properties", "operation"])
    }
  );
  const restored = prepareReplayInputs(current, saved);
  expect(restored.values.bindings).toEqual({ operation: capability });
  expect(promiseProperties.get(promise)).toBe(table);
  expect(table.operation).toBe(capability);
  expect(call).not.toHaveBeenCalled();
});

it.each([false, true])(
  "rolls back an installed Promise property table after a later scheduler throws (existing=%s)",
  (existing) => {
    const promise = createSandboxPromise(new Promise(() => undefined));
    const before = existing ? getPromiseProperties(promise) : undefined;
    if (before !== undefined) before.original = 7;
    const failure = new Error("late scheduling failure");
    const schedule = vi.fn(() => {
      expect(promiseProperties.get(promise)).not.toBe(before);
      expect(promiseProperties.get(promise)).toEqual({ replacement: 9 });
      throw failure;
    });
    const property = (value: unknown) => ({
      value,
      writable: true,
      enumerable: true,
      configurable: true
    });
    const ref = (id: number) => ({ tag: "ref", id });
    expect(() =>
      decodeReplayData(
        {
          root: ref(0),
          nodes: [
            {
              kind: "object",
              properties: { first: property(ref(1)), later: property(ref(3)) },
              extensible: true,
              nullPrototype: false
            },
            { kind: "promise-capability", id: "owned", properties: ref(2) },
            {
              kind: "object",
              properties: { replacement: property(9) },
              extensible: true,
              nullPrototype: false
            },
            { kind: "settled-imported-promise", status: "fulfilled", outcome: 8, scheduleId: 1 }
          ]
        },
        { resolvePromise: () => promise, restoreScheduledPromise: schedule }
      )
    ).toThrow(failure);
    expect(schedule).toHaveBeenCalledOnce();
    expect(promiseProperties.get(promise)).toBe(before);
    if (before !== undefined) expect(before).toEqual({ original: 7 });
  }
);
