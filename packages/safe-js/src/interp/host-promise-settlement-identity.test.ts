import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { wrapCallerInjectedBindings } from "./host-bridge.js";
import { getPromiseProperties, type SandboxPromise } from "./values.js";

it("preserves imported sibling Promise identity through host settlement copying", async () => {
  const sibling = Promise.resolve(3);
  const original = Promise.resolve({ sibling });
  const copied = wrapCallerInjectedBindings({ original, sibling }, { budget: new Budget() });
  const settled = await (copied.original as SandboxPromise).promise;
  expect((settled as { sibling: SandboxPromise }).sibling).toBe(copied.sibling);
});

it("preserves a host Promise fulfillment back-reference", async () => {
  const value: { original?: Promise<unknown> } = {};
  const original = Promise.resolve(value);
  value.original = original;
  const copied = wrapCallerInjectedBindings({ original }, { budget: new Budget() });
  const settled = await (copied.original as SandboxPromise).promise;
  delete value.original;
  expect((settled as { original: SandboxPromise }).original).toBe(copied.original);
});

it("keeps import calls independent and ordinary settlement data separately copied", async () => {
  const data = { count: 1 };
  const original = Promise.resolve({ data });
  const first = wrapCallerInjectedBindings({ original, data }, { budget: new Budget() });
  const second = wrapCallerInjectedBindings({ original }, { budget: new Budget() });
  data.count = 2;
  const left = await (first.original as SandboxPromise).promise;
  const right = await (second.original as SandboxPromise).promise;
  expect(first.original).not.toBe(second.original);
  expect(left).not.toBe(right);
  expect(first.data).toEqual({ count: 1 });
  expect(left).toEqual({ data: { count: 2 } });
  expect((left as { data: unknown }).data).not.toBe(first.data);
});

it("does not import Promise metadata or execute its unrelated getters", async () => {
  const original = Promise.resolve(7);
  let reads = 0;
  Object.defineProperty(original, "label", { get() { reads++; return "private"; } });
  Object.defineProperty(original, Symbol("private context"), { value: { secret: true } });
  const copied = wrapCallerInjectedBindings({ original }, { budget: new Budget() });
  await expect((copied.original as SandboxPromise).promise).resolves.toBe(7);
  expect(Reflect.ownKeys(getPromiseProperties(copied.original as SandboxPromise))).toEqual([]);
  expect(reads).toBe(0);
});
