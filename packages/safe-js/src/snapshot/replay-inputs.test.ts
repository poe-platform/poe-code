import { describe, expect, it, vi } from "vitest";
import {
  createSandboxClosure,
  createSandboxMap,
  createSandboxSet,
  isSandboxMap,
  isSandboxSet
} from "../interp/values.js";
import { encodeReplayData } from "./replay-data.js";
import { prepareReplayInputs, type ReplayInputs } from "./replay-inputs.js";

function inputs(bindings: ReplayInputs["bindings"] = {}): ReplayInputs {
  return { bindings, imports: {}, entryPointArgs: undefined, importMeta: {} };
}

describe("initial replay inputs", () => {
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
