import { expect, it } from "vitest";
import { createMappedSandboxArguments } from "./arguments.js";
import { Scope } from "./scope.js";
import { deepCopyFromSandbox, deepCopyToSandbox, measureSandboxData } from "./values.js";

it("accounts for the environment retained by a mapped argument", () => {
  const scope = new Scope({a: 1, retained: "x".repeat(4096)});
  const args = createMappedSandboxArguments([1], ["a"], scope, undefined);
  expect(measureSandboxData([args])).toBeGreaterThanOrEqual(4096);
});

it("counts data retained by symbol properties on mapped arguments", () => {
  const args = createMappedSandboxArguments([], [], new Scope(), undefined);
  Object.defineProperty(args, Symbol("data"), {value: "x".repeat(4096)});
  expect(measureSandboxData([args])).toBeGreaterThanOrEqual(4096);
});

it("copies mapped arguments without imposing the strict callee descriptor", () => {
  const scope = new Scope();
  scope.declare("a", "var", 1);
  const args = createMappedSandboxArguments([1], ["a"], scope, undefined);
  scope.assign("a", 4);
  const copy = deepCopyFromSandbox(args) as Record<string, unknown>;
  expect(copy["0"]).toBe(4);
  expect(Object.getOwnPropertyDescriptor(copy, "callee")).toEqual({value: undefined, writable: true, enumerable: false, configurable: true});
});

it("copies a deleted callee and cycles without retaining parameter aliases", () => {
  const scope = new Scope();
  scope.declare("a", "var", 1);
  const args = createMappedSandboxArguments([1], ["a"], scope, undefined);
  delete args.callee;
  args.self = args;
  const host = deepCopyFromSandbox(args) as Record<string, unknown>;
  const copy = deepCopyToSandbox(host) as Record<string, unknown>;
  scope.assign("a", 4);
  expect(host["0"]).toBe(1);
  expect(copy["0"]).toBe(1);
  expect(Object.hasOwn(host, "callee")).toBe(false);
  expect(Object.hasOwn(copy, "callee")).toBe(false);
  expect(host.self).toBe(host);
  expect(copy.self).toBe(copy);
});

it("continues rejecting unregistered proxies at the host boundary", () => {
  const args = createMappedSandboxArguments([], [], new Scope(), undefined);
  expect(() => deepCopyFromSandbox(new Proxy(args, {}))).toThrow("Unsupported proxy sandbox value");
});

it("preserves symbol data properties in host copies", () => {
  const args = createMappedSandboxArguments([], [], new Scope(), undefined);
  const symbol = Symbol("data");
  Object.defineProperty(args, symbol, {value: {value: 9}, configurable: true});
  const copy = deepCopyFromSandbox(args) as object;
  expect(Object.getOwnPropertyDescriptor(copy, symbol)).toEqual({value: {value: 9}, enumerable: false, writable: false, configurable: true});
  expect(Object.getOwnPropertyDescriptor(copy, symbol)?.value).not.toBe(Object.getOwnPropertyDescriptor(args, symbol)?.value);
});

it("rejects a replaced callee accessor instead of silently dropping it", () => {
  const args = createMappedSandboxArguments([], [], new Scope(), undefined);
  Object.defineProperty(args, "callee", {get() {throw new Error("must not execute");}});
  expect(() => deepCopyFromSandbox(args)).toThrow("Cannot copy arguments accessor 'callee'");
});

it("preserves the current parameter value when freezing a mapped index", () => {
  const scope = new Scope();
  scope.declare("a", "var", 1);
  const args = createMappedSandboxArguments([1], ["a"], scope, undefined);
  scope.assign("a", 4);
  Object.freeze(args);
  scope.assign("a", 5);
  expect(args["0"]).toBe(4);
  expect(Object.getOwnPropertyDescriptor(args, "0")).toEqual({value: 4, writable: false, enumerable: true, configurable: false});
});

it("does not change a parameter when defining an incompatible descriptor fails", () => {
  const scope = new Scope();
  scope.declare("a", "var", 1);
  const args = createMappedSandboxArguments([1], ["a"], scope, undefined);
  Object.defineProperty(args, "0", {configurable: false});
  expect(Reflect.defineProperty(args, "0", {value: 8, configurable: true})).toBe(false);
  expect(scope.lookup("a")).toMatchObject({value: 1});
  scope.assign("a", 4);
  expect(args["0"]).toBe(4);
});
