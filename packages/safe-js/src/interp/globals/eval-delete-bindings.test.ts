import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  'eval("var x=1"); return [delete x, typeof x]',
  'eval("function f(){}"); return [delete f, typeof f]',
  'eval("var x=1"); eval("var x=2"); return [delete x,typeof x]',
  'var x=1; eval("var x=2"); return [delete x,x]',
  'let x=1; return [delete x,x]',
  'eval("let x=1"); return typeof x',
  'eval("var x=1"); const read=()=>typeof x; delete x; return read()',
  'eval("var x=1"); delete x; eval("var x=3"); return [x,delete x,typeof x]',
  'eval("{function x(){}}"); return [delete x,typeof x]',
  'return (function(x){eval("var x=2");return [delete x,x,arguments[0]]})(1)',
  'eval("var x=1"); return eval("delete x")',
  'eval("var x=1"); x += (delete x,2); return [x,delete x,typeof x]',
  'eval("var x=1");const remove=()=>delete x;return (function(){"use strict";try{x=(remove(),2)}catch(e){return e.name}})()',
  'eval("var x=1");({x=(delete x,2)}={});return [x,delete x,typeof x]',
  'eval("var x=1");[x=(delete x,2)]=[];return [x,delete x,typeof x]'
])("matches native eval binding deletion: %s", async body => {
  const expected: unknown = runInNewContext(`Function(${JSON.stringify(body)})()`);
  expect(await run(`return Function(${JSON.stringify(body)})()`)).toMatchObject({
    ok: true, returnValue: expected
  });
});

it("recreates a deleted assignment binding in its original environment", async () => {
  // SetMutableBinding recreates the captured declarative binding, not a global.
  // Node 22 instead updates the global in this edge case, so it is not the oracle.
  const body = 'globalThis.outer=9;eval("var outer=1");outer+=(delete outer,2);return [outer,globalThis.outer]';
  expect(await run(`return Function(${JSON.stringify(body)})()`)).toMatchObject({
    ok: true, returnValue: [3, 9]
  });
});
