import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  'return (function(a=eval("var x=2"),b=()=>x){var x;return [x,b()]})()',
  'return (async function(a=eval("var x=2"),b=()=>x){var x;return [x,b()]})()',
  'return (function*(a=eval("var x=2"),b=()=>x){var x;return [x,b()]})().next().value',
  'return (async function*(a=eval("var x=2"),b=()=>x){var x;return [x,b()]})().next().then(r=>r.value)',
  'return ((a=eval("var x=2"),b=()=>x)=>{var x;return [x,b()]})()',
  'function C(a=eval("var x=2"),b=()=>x){var x;this.value=[x,b()]}return new C().value',
  'return (async function(a=eval("var a=2")){return a})().catch(e=>e.name)',
  'try{(function*(a=eval("var a=2")){yield a})();return "accepted"}catch(e){return e.name}',
  'try{(async function*(a=eval("var a=2")){yield a})();return "accepted"}catch(e){return e.name}'
])("preserves parameter environments across function kinds: %s", async body => {
  const source = `return await Function(${JSON.stringify(body)})()`;
  const expected: unknown = await runInNewContext(`(async function(){${source}})()`);
  expect(await run(source)).toMatchObject({ok: true, returnValue: expected});
});
