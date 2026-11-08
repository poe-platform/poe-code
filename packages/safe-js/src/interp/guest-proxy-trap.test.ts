import { expect, it, vi } from "vitest";
import { Budget } from "./budget.js";
import { createGuestProxy, revokeGuestProxy, withGuestProxyTrap } from "./guest-proxy.js";
import { createSandboxClosure, type SandboxCallContext, type SandboxValue } from "./values.js";

it.each([undefined, null])("treats %s as a missing trap", async method => {
  const target = {}, handler = {};
  const getProperty = vi.fn(async () => method);
  const result = await withGuestProxyTrap(createGuestProxy(target, handler), "get", new Budget(),
    { stack: [], thisValue: undefined, getProperty }, state => {
      expect(state).toEqual({ target, handler, trap: undefined });
      return 7;
    });
  expect(result).toBe(7);
  expect(getProperty).toHaveBeenCalledExactlyOnceWith(handler, "get");
});

it.each([3, false, "get", {}, Symbol("get")])("rejects noncallable trap %s", async method => {
  const action = vi.fn();
  await expect(withGuestProxyTrap(createGuestProxy({}, {}), "get", new Budget(),
    { stack: [], thisValue: undefined, getProperty: async () => method }, action)).rejects.toThrow(TypeError);
  expect(action).not.toHaveBeenCalled();
});

it("does not invoke native functions returned as traps", async () => {
  const native = vi.fn();
  await expect(withGuestProxyTrap(createGuestProxy({}, {}), "get", new Budget(),
    { stack: [], thisValue: undefined, getProperty: async () => native as unknown as SandboxValue }, () => 1))
    .rejects.toThrow(TypeError);
  expect(native).not.toHaveBeenCalled();
});

it("checks revocation before reading the handler", async () => {
  const proxy = createGuestProxy({}, {});
  revokeGuestProxy(proxy);
  const getProperty = vi.fn();
  await expect(withGuestProxyTrap(proxy, "get", new Budget(),
    { stack: [], thisValue: undefined, getProperty }, () => 1)).rejects.toThrow(TypeError);
  expect(getProperty).not.toHaveBeenCalled();
});

it("preserves captured state and its accounting through getter-side revocation", async () => {
  const target = { payload: "x".repeat(100) }, handler = {};
  const proxy = createGuestProxy(target, handler), budget = new Budget();
  const trap = createSandboxClosure({ guest: true, call: () => 7 });
  const context: SandboxCallContext = { stack: [], thisValue: undefined, getProperty: async () => {
    revokeGuestProxy(proxy);
    await Promise.resolve();
    expect([...budget.retainedValues()]).toContain(target);
    expect([...budget.retainedValues()]).toContain(handler);
    return trap;
  } };
  expect(await withGuestProxyTrap(proxy, "get", budget, context, async state => {
    expect(state.target).toBe(target);
    expect(state.handler).toBe(handler);
    expect(state.trap).toBe(trap);
    await Promise.resolve();
    expect([...budget.retainedValues()]).toContain(target);
    return 7;
  })).toBe(7);
  expect([...budget.retainedValues()]).toEqual([]);
});

it.each(["lookup", "operation"])("releases retained state after %s failure", async phase => {
  const budget = new Budget(), failure = new Error(phase);
  await expect(withGuestProxyTrap(createGuestProxy({}, {}), "get", budget,
    { stack: [], thisValue: undefined, getProperty: async () => {
      if (phase === "lookup") throw failure;
      return undefined;
    } }, () => { throw failure; })).rejects.toBe(failure);
  expect([...budget.retainedValues()]).toEqual([]);
});
