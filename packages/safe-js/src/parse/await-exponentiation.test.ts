import { Script } from "node:vm";
import { expect, it } from "vitest";
import { parseModule } from "./parser.js";
import { run } from "../run.js";

it.each([
  "var await=2;return await ** 3",
  "function f(await){return await ** 3}return f(2)",
  "const f=await=>await ** 3;return f(2)"
])("preserves non-strict await identifiers: %s", async body => {
  expect(await run(`return Function(${JSON.stringify(body)})()`)).toMatchObject({
    ok: true, returnValue: Function(body)()
  });
});

it.each(["await 2 ** 3", "await await 2 ** 3", "await (2) ** 3", "2 ** await 3 ** 4"])(
  "rejects an unparenthesized await on the left of exponentiation: %s", expression => {
    for (const kind of ["async function", "async function*"]) {
      const source = `${kind} f(){return ${expression}}`;
      expect(() => new Script(source)).toThrow(SyntaxError);
      expect(() => parseModule(source)).toThrow();
    }
  }
);

it.each([
  ["(await 2) ** 3", 8], ["await (2 ** 3)", 8], ["2 ** await 3", 8],
  ["(await await 2) ** 3", 8], ["2 ** (await 3) ** 2", 512], ["(-2) ** 3", -8]
] as const)("preserves valid exponentiation: %s", async (expression, expected) => {
  const source = `async function f(){return ${expression}}return await f()`;
  const NativeAsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  expect(await new NativeAsyncFunction(source)()).toBe(expected);
  expect(await run(source)).toMatchObject({ok:true,returnValue:expected});
});
