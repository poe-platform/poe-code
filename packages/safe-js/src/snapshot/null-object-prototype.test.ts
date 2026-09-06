import { describe, expect, it } from "vitest";
import { Budget } from "../interp/budget.js";
import { cloneSandboxValue, deepCopyFromSandbox, type SandboxObject } from "../interp/values.js";
import { hasNullObjectPrototype, setSandboxPrototype } from "../interp/object-model.js";
import { encodeReplayData, decodeReplayData } from "./replay-data.js";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";

describe.each(["snapshot", "replay", "clone"] as const)("null object prototypes through %s", format => {
  it.each([false, true])("preserves the marker and properties with cycle=%s", cyclic => {
    const value: SandboxObject = Object.assign(Object.create(null), { item: 7 });
    setSandboxPrototype(value, null);
    if (cyclic) value.self = value;
    let copy: SandboxObject;
    if (format === "clone") copy = cloneSandboxValue(value) as SandboxObject;
    else if (format === "replay") copy = decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData(value)))) as SandboxObject;
    else {
      const source = "await task()";
      const snapshot = serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { value } }], callStack: [], pendingPromises: [], moduleBindings: {} });
      const binding = restore(JSON.parse(JSON.stringify(snapshot)), { source, budget: new Budget() }).currentScope.lookup("value");
      if (!binding.found) throw new Error("Missing object");
      copy = binding.value as SandboxObject;
    }
    expect(hasNullObjectPrototype(copy)).toBe(true);
    expect(copy.item).toBe(7);
    if (cyclic) expect(copy.self).toBe(copy);
  });
});

it("keeps structuredClone's ordinary-object prototype behavior", () => {
  const object = Object.create(null) as SandboxObject;
  setSandboxPrototype(object, null);
  expect(hasNullObjectPrototype(cloneSandboxValue(object, { structuredClone: true }) as object)).toBe(false);
});

it("exports an explicitly null prototype independently of host backing storage", () => {
  const object: SandboxObject = { item: 7 };
  setSandboxPrototype(object, null);
  const copy = deepCopyFromSandbox(object);
  expect(Object.getPrototypeOf(copy)).toBeNull();
  expect(copy).toEqual({ item: 7 });
});

it.each([false, null, "true", 1])("rejects invalid null-prototype metadata %j", flag => {
  const object = Object.create(null) as SandboxObject;
  setSandboxPrototype(object, null);
  const replay = JSON.parse(JSON.stringify(encodeReplayData(object)));
  replay.nodes[0].sandboxNullPrototype = flag;
  expect(() => decodeReplayData(replay)).toThrow("prototype");
  const source = "await task()";
  const snapshot = JSON.parse(JSON.stringify(serialize({ source, currentAstNodeId: 1, scopeChain: [{ id: "module", bindings: { object } }], callStack: [], pendingPromises: [], moduleBindings: {} })));
  const entry = Object.values(snapshot.heap)[0] as Record<string, unknown>;
  entry.sandboxNullPrototype = flag;
  expect(() => restore(snapshot, { source, budget: new Budget() })).toThrow("prototype");
});
