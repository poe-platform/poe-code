import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  "function f(){};f=9;f",
  "const before=f;function f(){};before===f",
  "function f(){return 1}const before=f;function f(){return 2};[before===f,f()]",
  "f=9;function f(){};f",
  "function f(){};var f=9;f",
  "function* f(){yield 1};f=9;f",
  "async function f(){};f=9;f",
  "{function f(){};f=9;f}"
].flatMap(source => ["direct", "indirect", "strict"].map(mode => ({ source, mode }))))(
  "preserves eval function execution identity: $source ($mode)",
  async ({ source, mode }) => {
    const body = `${mode === "strict" ? '"use strict";' : ""}return ${mode === "indirect" ? "(0,eval)" : "eval"}(${JSON.stringify(source)})`;
    const program = `Function(${JSON.stringify(body)})()`;
    const expected: unknown = runInNewContext(program);
    expect(await run(`return ${program}`)).toMatchObject({ ok: true, returnValue: expected });
  }
);
