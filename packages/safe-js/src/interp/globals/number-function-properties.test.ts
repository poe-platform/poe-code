import { describe, expect, it } from "vitest";
import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { createBuiltinBindings } from "../globals.js";
import { hasGuestObjectState, materializeFunctionProperties } from "../object-model.js";
import { createSandboxClosure, measureSandboxData, type SandboxClosure } from "../values.js";

describe.each(["isFinite", "isNaN", "isInteger", "isSafeInteger"])("Number.%s function properties", name => {
  it.each([
    "fn.extra=3;return [fn.extra,fn===Number[name],fn(1)]",
    "Object.defineProperty(fn,'extra',{value:3,writable:true,configurable:true});fn.extra=4;return [fn.extra,delete fn.extra,'extra' in fn]",
    "let calls=0;Object.defineProperty(fn,'extra',{configurable:true,get(){calls++;return this===fn}});return [fn.extra,calls]",
    "const key=Symbol('key');fn[key]=3;return [fn[key],Object.getOwnPropertySymbols(fn).length]",
    "Object.preventExtensions(fn);return [Object.isExtensible(fn),fn(1)]"
  ])("matches native behavior: %s", async body => {
    const source = `const name=${JSON.stringify(name)};const fn=Number[name];${body}`;
    // Obtain fresh native functions so preventExtensions cannot affect later cases.
    const { runInNewContext } = await import("node:vm");
    const expected: unknown = runInNewContext(`(function(){'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});

it.each(["addition", "deletion", "extensibility"])("tracks static function %s in the intrinsic state", mutation => {
  const globals = createBuiltinBindings({ budget: new Budget() });
  const properties = materializeFunctionProperties(globals.Number);
  const method = properties.isNaN as SandboxClosure;
  const methodProperties = materializeFunctionProperties(method);
  expect(hasGuestObjectState(globals.Number)).toBe(false);
  if (mutation === "addition") methodProperties.extra = 3;
  else if (mutation === "deletion") delete methodProperties.name;
  else Object.preventExtensions(methodProperties);
  expect(hasGuestObjectState(globals.Number)).toBe(true);
});

it("still charges guest replacements of builtin metadata", () => {
  const budget = new Budget();
  const globals = createBuiltinBindings({ budget });
  const method = materializeFunctionProperties(globals.Number).isNaN as SandboxClosure;
  expect(measureSandboxData(budget.retainedValues())).toBe(0);
  Object.defineProperty(materializeFunctionProperties(method), "name", { value: "x".repeat(1000) });
  expect(measureSandboxData(budget.retainedValues())).toBeGreaterThanOrEqual(1000);
});

it("does not make other host closures guest-mutable", () => {
  const capability = createSandboxClosure({ sandbox: true, call: () => 3 });
  expect(() => materializeFunctionProperties(capability)).toThrow("Host function properties are read only.");
});
