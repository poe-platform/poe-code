import { expect, it } from "vitest";
import { run } from "../run.js";
import { cloneSandboxValue } from "./values.js";

it.each([
  "() => 1",
  "async () => 1",
  "class Example {}",
  "function* () { yield 1; }",
  "(function* () { yield 1; })()",
  "(async function* () { yield 1; })()"
])("rejects executable values in SDK structured cloning: %s", async expression => {
  const native = Function(`return (${expression})`)();
  expect(() => structuredClone(native)).toThrow(expect.objectContaining({ name: "DataCloneError" }));
  const result = await run(`return (${expression})`);
  if (!result.ok) throw new Error("Failed to create executable guest value");
  const value = result.returnValue;
  expect(cloneSandboxValue(value)).toBe(value);
  for (const input of [value, { value }, [value]]) {
    expect(() => cloneSandboxValue(input, { structuredClone: true }))
      .toThrow(expect.objectContaining({ name: "DataCloneError" }));
  }
});
