import { expect, it, vi } from "vitest";
import { Budget } from "./budget.js";
import { hasGuestObjectState, registerIntrinsicObject, setSandboxPrototype } from "./object-model.js";

it.each(["value","writable","enumerable","configurable"] as const)("still detects a changed %s descriptor field", field => {
  const root={value:42};
  registerIntrinsicObject(new Budget(),root);
  expect(hasGuestObjectState(root)).toBe(false);
  Object.defineProperty(root,"value",{[field]:field==="value"?43:false});
  expect(hasGuestObjectState(root)).toBe(true);
});

it("compares symbol identities and detects deletion or replacement at unchanged key counts", () => {
  const first=Symbol("key"),second=Symbol("key");
  const root:Record<symbol,number>={[first]:42};
  registerIntrinsicObject(new Budget(),root);
  expect(hasGuestObjectState(root)).toBe(false);
  delete root[first];
  root[second]=42;
  expect(hasGuestObjectState(root)).toBe(true);
  delete root[second];
  expect(hasGuestObjectState(root)).toBe(true);
  root[first]=42;
  expect(hasGuestObjectState(root)).toBe(false);
});

it("compares accessor identities without invoking them", () => {
  const getter=vi.fn(()=>42);
  const root={};
  Object.defineProperty(root,"value",{get:getter,configurable:true});
  registerIntrinsicObject(new Budget(),root);
  expect(hasGuestObjectState(root)).toBe(false);
  Object.defineProperty(root,"value",{get:()=>42});
  expect(hasGuestObjectState(root)).toBe(true);
  expect(getter).not.toHaveBeenCalled();
});

it("retains prototype and extensibility checks", () => {
  const budget=new Budget();
  const root={},other={};
  registerIntrinsicObject(budget,root);
  registerIntrinsicObject(budget,other);
  expect(hasGuestObjectState(root)).toBe(false);
  expect(hasGuestObjectState(other)).toBe(false);
  setSandboxPrototype(root,{},budget);
  Object.preventExtensions(other);
  expect(hasGuestObjectState(root)).toBe(true);
  expect(hasGuestObjectState(other)).toBe(true);
});

it("preserves SameValue treatment of NaN and signed zero", () => {
  const root={nan:NaN,zero:0};
  registerIntrinsicObject(new Budget(),root);
  root.nan=NaN;
  expect(hasGuestObjectState(root)).toBe(false);
  root.zero=-0;
  expect(hasGuestObjectState(root)).toBe(true);
  root.zero=0;
  expect(hasGuestObjectState(root)).toBe(false);
});
