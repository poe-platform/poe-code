import { expect, it } from "vitest";
import { run } from "../run.js";
import { cloneSandboxValue } from "./values.js";

it.each([
  "[1].values()",
  "new Uint8Array([1]).values()",
  "'a'[Symbol.iterator]()",
  "new Map([[1,2]]).entries()",
  "new Set([1]).values()",
  "'a'.matchAll(/a/g)"
])("rejects iterator private state in SDK structured cloning: %s", async expression => {
  expect(() => structuredClone(Function(`return ${expression}`)()))
    .toThrow(expect.objectContaining({ name: "DataCloneError" }));
  for (const exhausted of [false, true]) {
    const result = await run(`const value=${expression};
      ${exhausted ? "value.next();value.next();" : ""}return value;`);
    if (!result.ok) throw new Error("Failed to create guest iterator");
    for (const input of [result.returnValue, { value: result.returnValue }]) {
      expect(() => cloneSandboxValue(input, { structuredClone: true }))
        .toThrow(expect.objectContaining({ name: "DataCloneError" }));
    }
  }
});
