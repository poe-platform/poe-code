import { expect, it, vi } from "vitest";
import { createSandboxClosure, createSandboxMap } from "../interp/values.js";
import { encodeReplayData } from "./replay-data.js";
import { prepareReplayInputs } from "./replay-inputs.js";

it.each(
  ["key", "value"].flatMap((kind) =>
    [":", ":forged", ":0:properties"].map((suffix) => [kind, suffix])
  )
)("rejects trailing map capability path segments for %s%s", (kind, suffix) => {
  const call = vi.fn(() => 7);
  const capability = createSandboxClosure({ call });
  const current = {
    bindings: { map: createSandboxMap([[capability, capability]]) },
    imports: {},
    entryPointArgs: undefined,
    importMeta: undefined
  };
  const saved = encodeReplayData(
    { ...current, bindings: { operation: capability } },
    {
      identifyCapability: () => JSON.stringify(["bindings", "map", `${kind}:0${suffix}`])
    }
  );
  const restored = vi.fn();
  expect(() => prepareReplayInputs(current, saved, undefined, restored)).toThrow(
    "Invalid replay input map capability path"
  );
  expect(restored).not.toHaveBeenCalled();
  expect(call).not.toHaveBeenCalled();
});

it.each(["key", "value"])("preserves the canonical %s map capability identity", (kind) => {
  const call = vi.fn(() => 7);
  const capability = createSandboxClosure({ call });
  const current = {
    bindings: { map: createSandboxMap([[capability, capability]]) },
    imports: {},
    entryPointArgs: undefined,
    importMeta: undefined
  };
  const saved = encodeReplayData(
    { ...current, bindings: { operation: capability } },
    {
      identifyCapability: () => JSON.stringify(["bindings", "map", `${kind}:0`])
    }
  );
  expect(prepareReplayInputs(current, saved).values.bindings.operation).toBe(capability);
  expect(call).not.toHaveBeenCalled();
});
