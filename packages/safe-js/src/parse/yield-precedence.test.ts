import { Script } from "node:vm";
import { expect, it } from "vitest";
import { parseModule } from "./parser.js";
import { run } from "../run.js";

it.each([
  "var yield=3;return yield+2",
  "var yield=3;return !yield",
  "function f(yield){return yield*2}return f(3)",
  "var yield=x=>x+1;return yield(4)",
  "var yield=3;return typeof yield",
  "var yield=3;return ++yield"
])("preserves non-strict yield identifiers: %s", async body => {
  expect(await run(`return Function(${JSON.stringify(body)})()`)).toMatchObject({
    ok: true, returnValue: Function(body)()
  });
});

it.each([
  "1 + yield 2", "!yield 2", "typeof yield 2", "yield 1 + yield 2",
  "true && yield 2", "false || yield 2", "1 === yield 2", "yield* [] + yield 2"
])("rejects yield as an unparenthesized higher-precedence operand: %s", expression => {
  for (const prefix of ["", "async "]) {
    const source = `${prefix}function* g(){return ${expression};}`;
    expect(() => new Script(source)).toThrow(SyntaxError);
    expect(() => parseModule(source)).toThrow();
  }
});

it.each([
  "yield 2 ** 3", "(yield 2) ** 3", "yield yield 2", "1 + (yield 2)",
  "true ? yield 2 : yield 3", "yield 1 + 2", "yield* []", "new (yield 1)()"
])("preserves valid yield assignment expressions: %s", expression => {
  for (const prefix of ["", "async "]) {
    const source = `${prefix}function* g(){return ${expression};}`;
    expect(() => new Script(source)).not.toThrow();
    expect(() => parseModule(source)).not.toThrow();
  }
});
