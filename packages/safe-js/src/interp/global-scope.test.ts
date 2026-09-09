import { expect, it } from "vitest";
import { Scope } from "./scope.js";

it("finds the explicit guest global environment without capturing local frames", () => {
  const builtins = new Scope({builtin: 1});
  const global = builtins.child({granted: 2}, {globalEnvironment: true});
  const local = global.child({secret: 3}, {functionBoundary: true}).child({nested: 4});
  expect(local.globalScope()).toBe(global);
  expect(global.globalScope()).toBe(global);
  expect(local.globalScope().lookup("granted")).toMatchObject({found: true, value: 2});
  expect(local.globalScope().lookup("secret")).toEqual({found: false});
});

it("uses the root environment for a standalone interpreter scope", () => {
  const root = new Scope({granted: 1});
  expect(root.child({secret: 2}).globalScope()).toBe(root);
});

it("preserves the global-environment marker through frame capture and hydration", () => {
  const root = new Scope();
  const global = root.child({granted: 2}, {globalEnvironment: true});
  const frame = global.captureFrame();
  expect(frame.globalEnvironment).toBe(true);
  const restored = root.child({}, {globalEnvironment: true});
  restored.hydrateFrame(frame);
  expect(restored.child({secret: 3}).globalScope()).toBe(restored);
  expect(() => root.child().hydrateFrame(frame)).toThrow(/allocation/);
});
