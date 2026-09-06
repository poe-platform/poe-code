import { describe, expect, it } from "vitest";
import { run } from "../core.js";
import { Budget } from "./budget.js";
import { createSymbolGlobal } from "./globals/symbol.js";
import {
  hasGuestObjectState,
  materializeFunctionProperties,
  releaseObjectPrototype
} from "./object-model.js";
import { createSandboxClosure, measureSandboxData } from "./values.js";

describe("Symbol intrinsic descriptors", () => {
  it("tracks changed intrinsic properties and releases their retained data", () => {
    const budget = new Budget();
    const constructor = createSymbolGlobal(budget);
    try {
      expect(hasGuestObjectState(constructor)).toBe(false);
      Object.defineProperty(materializeFunctionProperties(constructor), "for", {
        value: "x".repeat(700)
      });
      expect(hasGuestObjectState(constructor)).toBe(true);
      expect(measureSandboxData([...budget.retainedValues()])).toBeGreaterThanOrEqual(700);
    } finally {
      releaseObjectPrototype(budget);
    }
    expect([...budget.retainedValues()]).toEqual([]);
  });

  it("does not make host capability properties mutable", async () => {
    const capability = createSandboxClosure({ call: () => undefined, properties: { safe: 7 } });
    expect(
      await run("try{capability.safe=9}catch(error){return [error.name,capability.safe]}", {
        bindings: { capability }
      })
    ).toMatchObject({ ok: true, returnValue: ["TypeError", 7] });
  });
  it.each([
    "length",
    "name",
    "prototype",
    "for",
    "keyFor",
    "iterator",
    "asyncIterator",
    "hasInstance",
    "isConcatSpreadable",
    "match",
    "matchAll",
    "replace",
    "search",
    "species",
    "split",
    "toPrimitive",
    "toStringTag",
    "unscopables"
  ])("matches native descriptor for %s", async (key) => {
    const source = `const d=Object.getOwnPropertyDescriptor(Symbol,${JSON.stringify(key)});return [d.writable,d.enumerable,d.configurable,typeof d.value];`;
    expect(await run(source)).toMatchObject({ ok: true, returnValue: new Function(source)() });
  });

  it.each([
    ["enumeration", "return Object.keys(Symbol);"],
    [
      "registry method replacement",
      "const original=Symbol.for;Symbol.for=()=>7;const first=Symbol.for('key');Symbol.for=original;return [first,typeof Symbol.for('key')];"
    ],
    ["registry method deletion", "return [delete Symbol.keyFor,Object.hasOwn(Symbol,'keyFor')];"],
    [
      "name redefinition",
      "Object.defineProperty(Symbol,'name',{value:'Renamed'});return Symbol.name;"
    ],
    ["immutable well-known value", "try{Symbol.iterator=7}catch(error){return error.name}"],
    ["immutable prototype", "try{Symbol.prototype={}}catch(error){return error.name}"]
  ])("matches native %s", async (_name, source) => {
    expect(await run(source)).toMatchObject({
      ok: true,
      returnValue: new Function("'use strict';" + source)()
    });
  });
});
