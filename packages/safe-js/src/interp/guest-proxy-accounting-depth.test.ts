import { expect, it } from "vitest";
import { MAX_DATA_DEPTH } from "../graph-depth.js";
import { Budget } from "./budget.js";
import { createGuestProxy, guestProxyStates } from "./guest-proxy.js";
import { createSandboxClosure, measureSandboxData, reconcileCompiledValues, type SandboxObject, type SandboxValue } from "./values.js";

function chain(length: number, edge: "target" | "handler"): SandboxValue {
  const shared: SandboxObject = {};
  let value: SandboxValue = {};
  for (let index = 0; index < length; index++)
    value = edge === "target" ? createGuestProxy(value, shared) : createGuestProxy(shared, value);
  return value;
}

it.each(["target", "handler"] as const)("measures Proxy %s chains through the permitted depth", edge => {
  expect(measureSandboxData([chain(MAX_DATA_DEPTH, edge)])).toBe(MAX_DATA_DEPTH + 2);
});

it.each(["target", "handler"] as const)("reports dataDepth for an excessive Proxy %s chain", edge => {
  expect(() => measureSandboxData([chain(MAX_DATA_DEPTH + 1, edge)])).toThrowError(
    expect.objectContaining({ code: "budgetExceeded", budget: "dataDepth" })
  );
});

it.each([false, true])("reads the Proxy handler after target callbacks, including under quotas (held=%s)", held => {
  const events: string[] = [];
  const payload = { text: "x".repeat(1000) };
  let handler: SandboxObject = {};
  let nested = -1;
  const target = createSandboxClosure({ call: () => undefined, retainedValues: () => {
    events.push("target callback");
    nested = measureSandboxData([payload]);
    handler = payload;
    return [];
  } });
  const proxy = createGuestProxy(target, handler);
  guestProxyStates.set(proxy, {
    get target() { events.push("target read"); return target; },
    get handler() { events.push("handler read"); return handler; }
  });
  const budget = new Budget({ dataSize: 500 });
  const release = held ? budget.deferReconciliation() : undefined;
  try {
    expect(() => reconcileCompiledValues(budget, [proxy])).toThrowError(
      expect.objectContaining({ code: "budgetExceeded", budget: "dataSize" })
    );
  } finally { release?.(); }
  expect(nested).toBe(1006);
  expect(events).toEqual(["target read", "target read", "target callback", "handler read", "handler read"]);
  expect(measureSandboxData([proxy])).toBe(1008);
});

it("does not read a pending Proxy handler after its target throws", () => {
  const failure = new Error("target collection failed");
  let fails = true;
  let handlerReads = 0;
  const target = createSandboxClosure({ call: () => undefined, retainedValues: () => {
    if (fails) throw failure;
    return [];
  } });
  const proxy = createGuestProxy(target, {});
  guestProxyStates.set(proxy, {
    target,
    get handler() { handlerReads++; return target; }
  });
  expect(() => measureSandboxData([proxy])).toThrow(failure);
  expect(handlerReads).toBe(0);
  fails = false;
  expect(measureSandboxData([proxy])).toBe(2);
  expect(handlerReads).toBe(2);
});

it("keeps array siblings and Proxy handlers ordered when continuation frames are reused", () => {
  const events: string[] = [];
  const observer = (label: string) => createSandboxClosure({
    call: () => undefined,
    retainedValues: () => { events.push(label); return []; }
  });
  const first = createGuestProxy(observer("first target"), observer("first handler"));
  const last = createGuestProxy(observer("last target"), observer("last handler"));
  const roots = [[first, observer("sibling")], last];
  expect(measureSandboxData([roots])).toBe(13);
  expect(events).toEqual(["first target", "first handler", "sibling", "last target", "last handler"]);
});
