import { expect, it } from "vitest";
import { run } from "../run.js";
import { cloneSandboxValue } from "./values.js";

it.each([
  "new WeakMap()",
  "new WeakSet()",
  "new WeakRef({})",
  "new FinalizationRegistry(()=>{})"
])("rejects weak private state in low-level structured cloning: %s", async expression => {
  expect(() => structuredClone(Function(`return ${expression}`)()))
    .toThrow(expect.objectContaining({ name: "DataCloneError" }));
  for (const nullPrototype of [false, true]) {
    const result = await run(`const value=${expression};
      ${nullPrototype ? "Object.setPrototypeOf(value,null);" : ""}return value`);
    if (!result.ok) throw new Error("Failed to construct weak-state value");
    for (const input of [result.returnValue, { value: result.returnValue }]) {
      expect(() => cloneSandboxValue(input, { structuredClone: true }))
        .toThrow(expect.objectContaining({ name: "DataCloneError" }));
    }
  }
});
