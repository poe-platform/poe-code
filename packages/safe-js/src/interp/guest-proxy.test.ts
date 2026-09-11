import { expect, it } from "vitest";
import { createGuestProxy, guestProxyStates, requireActiveGuestProxy, revokeGuestProxy } from "./guest-proxy.js";
import { measureSandboxData, type SandboxObject } from "./values.js";

it("keeps target and handler out of guest-visible properties", () => {
  const target = { value: 7 }, handler = {};
  const proxy = createGuestProxy(target, handler);
  expect(Reflect.ownKeys(proxy)).toEqual([]);
  expect(requireActiveGuestProxy(proxy)).toEqual({ target, handler });
  expect(requireActiveGuestProxy(proxy).target).toBe(target);
  expect(requireActiveGuestProxy(proxy).handler).toBe(handler);
});

it.each([undefined, null, true, 7, "target", Symbol("target")])("rejects primitive target %s", target => {
  expect(() => createGuestProxy(target, {})).toThrow(TypeError);
});

it.each([undefined, null, false, 7, "handler", Symbol("handler")])("rejects primitive handler %s", handler => {
  expect(() => createGuestProxy({}, handler)).toThrow(TypeError);
});

it("revokes once and drops both strong edges", () => {
  const proxy = createGuestProxy({}, {});
  revokeGuestProxy(proxy);
  revokeGuestProxy(proxy);
  expect(guestProxyStates.get(proxy)).toEqual({ target: null, handler: null });
  expect(() => requireActiveGuestProxy(proxy)).toThrow(TypeError);
});

it("does not inspect target or handler getters during creation or revocation", () => {
  const effects: string[] = [];
  const target = { get value() { effects.push("target"); return 1; } };
  const handler = { get get() { effects.push("handler"); return undefined; } };
  const proxy = createGuestProxy(target, handler);
  revokeGuestProxy(proxy);
  expect(effects).toEqual([]);
});

it("cannot forge proxy state with ordinary properties", () => {
  const fake = { target: {}, handler: {} };
  expect(guestProxyStates.has(fake)).toBe(false);
  expect(() => requireActiveGuestProxy(fake)).toThrow(TypeError);
  expect(() => revokeGuestProxy(fake)).toThrow(TypeError);
});

it("retains target and handler in data accounting until revoked", () => {
  const target = { text: "x".repeat(200) }, handler = { text: "y".repeat(100) };
  const proxy = createGuestProxy(target, handler);
  expect(measureSandboxData([proxy])).toBe(1 + measureSandboxData([target, handler]));
  revokeGuestProxy(proxy);
  expect(measureSandboxData([proxy])).toBe(1);
});

it("counts shared edges and cycles only once", () => {
  const target: SandboxObject = {};
  const proxy = createGuestProxy(target, target);
  target.self = proxy;
  expect(measureSandboxData([proxy])).toBe(measureSandboxData([proxy, target]));
  expect(measureSandboxData([proxy])).toBeGreaterThan(1);
});
