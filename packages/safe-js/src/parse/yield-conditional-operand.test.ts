import { Script } from "node:vm";
import { expect, it } from "vitest";
import { parseModule } from "./parser.js";
import { run } from "../run.js";

it.each([
  "true ? yield : 1",
  "false ? yield : 1",
  "(yield) ? yield : yield",
  "true ? (false ? yield : yield) : yield"
])("supports an omitted yield operand in conditional arms: %s", async (expression) => {
  for (const prefix of ["", "async "]) {
    const source = `${prefix}function* g(){return ${expression};}
      const iterator=g();return [await iterator.next(),await iterator.next(true),await iterator.next(7)]`;
    const NativeAsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const expected = await new NativeAsyncFunction(source)();
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  }
});

it.each(["yield * : 1", "yield : 1", "yield ? 1 : 2"])(
  "does not accept invalid yield punctuation: %s",
  (expression) => {
    const source = `function* g(){${expression};}`;
    expect(() => new Script(source)).toThrow(SyntaxError);
    expect(() => parseModule(source)).toThrow();
  }
);
