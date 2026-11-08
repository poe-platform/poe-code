import { expect, it } from "vitest";
import { createCommandRegistry } from "./command-registry.js";

it("shares enabled command dispatch and discovery", () => {
  let calls = 0;
  const registry = createCommandRegistry([{ id: "go", label: "Go", keys: ["g"], run: () => calls++ }, { id: "off", label: "Disabled", keys: ["x"], enabled: () => false, run: () => calls++ }]);
  expect(registry.dispatch("g")).toBe(true); expect(registry.dispatch("x")).toBe(false);
  expect(calls).toBe(1); expect(registry.list().map(x => x.id)).toEqual(["go"]);
});
it("rejects ambiguous bindings", () => {
  expect(() => createCommandRegistry([{ id: "a", label: "A", keys: ["a"], run() {} }, { id: "b", label: "B", keys: ["a"], run() {} }])).toThrow();
});
