import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  "with({x:7}){return x}",
  "return 077",
  "return '\\141'",
  "if(true){function f(){return 7}}return typeof f",
  "if(true)function f(){return 7}return f()",
  "if(false)function f(){return 7}return typeof f",
  "if(false)function f(){return 1}else function f(){return 7}return f()",
  "let f=1;if(true)function f(){return 7}return f",
  "const before=typeof f;if(false)function f(){return 7}return [before,typeof f]"
])("matches native non-strict dynamic grammar: %s", async body => {
  const source = `return Function(${JSON.stringify(body)})()`;
  const expected = runInNewContext(`(function(){${source}})()`);
  expect(await run(source)).toMatchObject({ok: true, returnValue: expected});
});

it.each([
  '"use strict";with({x:7}){return x}',
  '"use strict";return 077',
  '"use strict";return "\\141"',
  '"use strict";if(true){function f(){return 7}}return typeof f',
  '"use strict";if(true)function f(){return 7}return typeof f'
])("preserves strict dynamic grammar: %s", async body => {
  const source = `try{return Function(${JSON.stringify(body)})()}catch(error){return error.name}`;
  const expected = runInNewContext(`(function(){${source}})()`);
  expect(await run(source)).toMatchObject({ok: true, returnValue: expected});
});
