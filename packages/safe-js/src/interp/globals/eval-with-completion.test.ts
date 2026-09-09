import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  "1;with({}){}",
  "1;with({}){2}",
  "1;with({}){var x}",
  "1;with({}){2;var x}",
  "1;outer:{with({}){break outer}}",
  "1;outer:{with({}){2;break outer}}",
  "let i=0;while(i++<2){7;with({}){continue}}",
  "let i=0;while(i++<2){7;with({}){3;continue}}",
  "1;with({}){with({}){}}",
  "1;with({x:7}){x}",
  "try{with(null){2}}catch(e){e.name}",
  "try{with({}){throw 9}}catch(e){e}"
])("preserves sloppy eval with completion: %s", async source => {
  const body = `return eval(${JSON.stringify(source)})`;
  const program = `Function(${JSON.stringify(body)})()`;
  const expected: unknown = runInNewContext(program);
  expect(await run(`return ${program}`)).toMatchObject({ ok: true, returnValue: expected });
});
