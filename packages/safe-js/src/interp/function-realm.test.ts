import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { getSandboxDataProperty, releaseObjectPrototype } from "./object-model.js";
import { createGuestProxy, revokeGuestProxy } from "./guest-proxy.js";
import { createSandboxClosure } from "./values.js";
import { getFunctionRealmPrototype, registerFunctionRealm } from "./function-realm.js";

it("preserves an intrinsic function's realm after cleanup", () => {
  const budget = new Budget();
  const globals = createBuiltinBindings({budget});
  const prototype = getSandboxDataProperty(globals.Error,"prototype",budget);
  releaseObjectPrototype(budget);
  expect([...budget.retainedValues()]).toEqual([]);
  expect(getFunctionRealmPrototype(globals.Number,"Error",{})).toBe(prototype);
});

it("does not overwrite a function's originating realm", () => {
  const first = new Budget();
  const second = new Budget();
  const globals = createBuiltinBindings({budget:first});
  createBuiltinBindings({budget:second});
  const target = createSandboxClosure({call:()=>undefined});
  registerFunctionRealm(target,first);
  registerFunctionRealm(target,second);
  expect(getFunctionRealmPrototype(target,"Error",{}))
    .toBe(getSandboxDataProperty(globals.Error,"prototype",first));
});

it("rejects revoked proxy targets during realm lookup", () => {
  const budget = new Budget();
  const globals = createBuiltinBindings({budget});
  const proxy = createGuestProxy(globals.Number,{});
  expect(getFunctionRealmPrototype(proxy,"Error",{}))
    .toBe(getSandboxDataProperty(globals.Error,"prototype",budget));
  revokeGuestProxy(proxy);
  expect(()=>getFunctionRealmPrototype(proxy,"Error",{})).toThrow("revoked proxy");
});

it("uses the caller fallback for an unregistered host closure", () => {
  const fallback = {};
  const target = createSandboxClosure({name:"Number",call:()=>undefined});
  expect(getFunctionRealmPrototype(target,"Number",fallback)).toBe(fallback);
});

it("retains namespace-qualified defaults without flattening Intl names", () => {
  const budget = new Budget();
  const globals = createBuiltinBindings({budget});
  const constructor = getSandboxDataProperty(globals.Intl,"NumberFormat",budget);
  const prototype = getSandboxDataProperty(constructor,"prototype",budget);
  releaseObjectPrototype(budget);
  const fallback = {};
  expect(getFunctionRealmPrototype(globals.Number,"Intl.NumberFormat",fallback)).toBe(prototype);
  expect(getFunctionRealmPrototype(globals.Number,"NumberFormat",fallback)).toBe(fallback);
});
