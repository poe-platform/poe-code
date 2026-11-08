import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
import { run } from "../../run.js";
import { accessorClosure } from "../accessors.js";
import { Budget } from "../budget.js";
import { createBuiltinBindings } from "../globals.js";
import { releaseObjectPrototype } from "../object-model.js";

it.each([
  'Object.getOwnPropertyDescriptor(arguments,"callee")',
  'Reflect.getOwnPropertyDescriptor(arguments,"callee")',
  'Object.getOwnPropertyDescriptors(arguments).callee',
  '({get:arguments.__lookupGetter__("callee"),set:arguments.__lookupSetter__("callee"),enumerable:false,configurable:false})'
])("exposes the realm thrower through %s", expression => {
  const source = `return (function(){"use strict";const d=${expression};
    const f=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(function(){}),"caller").get;
    let error;try{d.get()}catch(e){error=e.name}
    return [d.get===d.set,d.get===f,d.enumerable,d.configurable,error];})()`;
  return expect(run(source)).resolves.toMatchObject({
    ok: true, returnValue: runInNewContext(`(function(){${source}})()`)
  });
});

it("does not admit arbitrary native accessors", () => {
  const accessor = vi.fn(() => 7);
  expect(() => accessorClosure(accessor, new Budget())).toThrow("Native accessors cannot execute");
  expect(accessor).not.toHaveBeenCalled();
});

it("resolves the native restricted accessor independently in each realm", () => {
  const first = new Budget(), second = new Budget();
  createBuiltinBindings({ budget: first });
  createBuiltinBindings({ budget: second });
  const native = Object.getOwnPropertyDescriptor(Function.prototype, "caller")!.get;
  try {
    expect(accessorClosure(native, first)).not.toBe(accessorClosure(native, second));
    expect(accessorClosure(native, first)).toBe(accessorClosure(native, first));
    expect(() => accessorClosure(native)).toThrow("Native accessors cannot execute");
  } finally {
    releaseObjectPrototype(first);
    releaseObjectPrototype(second);
  }
});
