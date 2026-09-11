import { expect, it } from "vitest";
import { cloneSandboxValue, deepCopyToSandbox } from "./values.js";

it.each([
  ["direct", (key: symbol) => key],
  ["record", (key: symbol) => ({ value: key })],
  ["array", (key: symbol) => [key]],
  ["map key", (key: symbol) => new Map([[key, 1]])],
  ["map value", (key: symbol) => new Map([[1, key]])],
  ["set", (key: symbol) => new Set([key])]
] as const)("rejects SDK structured-clone symbol values in %s", (_name, create) => {
  for (const key of [Symbol("local"), Symbol.for("registered"), Symbol.iterator]) {
    const input = create(key);
    expect(() => structuredClone(input)).toThrow(expect.objectContaining({ name: "DataCloneError" }));
    const sandbox = deepCopyToSandbox(input);
    expect(() => cloneSandboxValue(sandbox, { structuredClone: true }))
      .toThrow(expect.objectContaining({ name: "DataCloneError" }));
  }
});

it("preserves symbol identity in ordinary SDK copies", () => {
  const value = Symbol("ordinary");
  expect(cloneSandboxValue(value)).toBe(value);
});
