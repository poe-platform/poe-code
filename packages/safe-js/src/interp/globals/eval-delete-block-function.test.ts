import { expect, it } from "vitest";
import { run } from "../../run.js";

// EvalDeclarationInstantiation 13.b.ii.7.b writes to VariableEnvironment
// with SetMutableBinding(..., false), not a newly resolved outer reference.
// Node 22 incorrectly creates/replaces a global after this local deletion.
it.each([
  "delete f;{function f(){return 7}}",
  "var f;delete f;{function f(){return 7}}",
  "delete f;if(true){function f(){return 7}}"
])("recreates the eval variable for a later block function: %s", async script => {
  const body = `eval(${JSON.stringify(script)});return [f(),typeof globalThis.f,delete f,typeof f]`;
  expect(await run(`return Function(${JSON.stringify(body)})()`)).toMatchObject({
    ok: true, returnValue: [7, "undefined", true, "undefined"]
  });
});

it("does not overwrite a same-named global after deleting the eval variable", async () => {
  const body = 'globalThis.f=9;eval("delete f;{function f(){return 7}}");return [f(),globalThis.f,delete f,f]';
  expect(await run(`return Function(${JSON.stringify(body)})()`)).toMatchObject({
    ok: true, returnValue: [7, 9, true, 9]
  });
});

it("does not recreate the variable when its block never executes", async () => {
  const body = 'eval("delete f;if(false){function f(){return 7}}");return [typeof f,typeof globalThis.f]';
  expect(await run(`return Function(${JSON.stringify(body)})()`)).toMatchObject({
    ok: true, returnValue: ["undefined", "undefined"]
  });
});
