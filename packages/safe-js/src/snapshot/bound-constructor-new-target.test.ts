import { expect, it } from "vitest";
import { createSandboxClosure, isSandboxClosure } from "../interp/values.js";
import { getSandboxPrototype, materializeFunctionProperties } from "../interp/object-model.js";
import { boundFunctionStates } from "../interp/bound-function-state.js";
import { run } from "../run.js";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";

it.each(["Array.bind(null, 1)", "Array.bind(null, 1).bind(null, 2)"])(
  "preserves an alternate newTarget when restoring %s", async expression => {
    const first = await run(`return ${expression}`);
    expect(first.ok).toBe(true);
    const bound = first.returnValue;
    if (!isSandboxClosure(bound) || bound.construct === undefined) throw new Error("Missing bound constructor");
    const alternate = createSandboxClosure({ guest: true, sandbox: true, call: () => undefined, construct: () => undefined });
    const prototype = { marker: "alternate" };
    Object.defineProperty(materializeFunctionProperties(alternate), "prototype", { value: prototype });
    const context = { stack: [], thisValue: undefined, newTarget: alternate };
    const live = await bound.construct([3], context);
    expect(getSandboxPrototype(live as object)).toBe(prototype);
    const source = "return 0";
    const saved = serialize({ source, currentAstNodeId: 1,
      scopeChain: [{ id: "module", bindings: { bound } }],
      callStack: [], pendingPromises: [], moduleBindings: {} });
    const restored = restore(JSON.parse(JSON.stringify(saved)), { source }).currentScope.lookup("bound").value;
    if (!isSandboxClosure(restored) || restored.construct === undefined) throw new Error("Missing restored constructor");
    const result = await restored.construct([3], context);
    expect(result).toEqual(live);
    expect(getSandboxPrototype(result as object)).toBe(prototype);
    let target = restored;
    while (boundFunctionStates.has(target)) target = boundFunctionStates.get(target)!.target;
    const ordinary = await restored.construct([3], { ...context, newTarget: restored });
    expect(ordinary).toEqual(live);
    expect(getSandboxPrototype(ordinary as object)).toBe(materializeFunctionProperties(target).prototype);
  }
);
