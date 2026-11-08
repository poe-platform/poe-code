import { expect, it } from "vitest";
import { run } from "../run.js";
import { cloneSandboxValue } from "./values.js";

it.each([
  "Iterator.from({next(){return {done:true}}})",
  "[1].values().map(value=>value)",
  "new DisposableStack()",
  "new AsyncDisposableStack()",
  "(function(){return arguments})(1,2)"
])("rejects runtime private state in both clone paths: %s", async expression => {
  const guest = await run(`try { structuredClone(${expression});return 'accepted'; }
    catch(error){return error.name;}`);
  expect(guest).toMatchObject({ ok: true, returnValue: "DataCloneError" });
  const result = await run(`return ${expression}`);
  if (!result.ok) throw new Error("Failed to create guest runtime record");
  for (const input of [result.returnValue, { value: result.returnValue }]) {
    expect(() => cloneSandboxValue(input, { structuredClone: true }))
      .toThrow(expect.objectContaining({ name: "DataCloneError" }));
  }
});
