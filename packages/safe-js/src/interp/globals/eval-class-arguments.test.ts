import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  'class C{x=eval("arguments")};new C()',
  'class C{static x=eval("arguments")}',
  'class C{static{eval("arguments")}}',
  'class C{x=()=>eval("arguments")};new C().x()',
  'class C{static x=()=>eval("arguments")};C.x()',
  'class C{x=eval("()=>arguments")};new C().x()',
  'class C{x=eval("(function(){return arguments.length})(1,2)")};new C().x',
  'class C{x=(function(){return eval("arguments.length")})(1,2)};new C().x',
  'class C{x=eval("new.target")};new C().x'
])("inherits class-initializer eval syntax context: %s", async source => {
  const body = `try{return eval(${JSON.stringify(source)})}catch(error){return error.name}`;
  const expected: unknown = runInNewContext(`(function(){${body}})()`);
  expect(await run(body)).toMatchObject({ ok: true, returnValue: expected });
});
