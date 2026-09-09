import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore as restoreRun } from "../restore.js";
import { isSandboxClosure, measureSandboxData } from "../interp/values.js";
import { serialize, type RuntimeSnapshotValue } from "./serialize.js";
import { restore } from "./restore.js";

it("accounts for source retained by an escaping eval closure", async () => {
  const small = await run('return eval("(function(){return 7})")');
  const text = `/*${"x".repeat(16384)}*/(function(){return 7})`;
  const large = await run(`return eval(${JSON.stringify(text)})`);
  if (!small.ok || !large.ok) throw new Error("Eval failed.");
  expect(measureSandboxData([large.returnValue]) - measureSandboxData([small.returnValue]))
    .toBeGreaterThanOrEqual(16384);
});

it("restores an eval closure from its own source namespace", async () => {
  const original = await run('return eval("(function(x){return x+2})")');
  if (!original.ok) throw original.error;
  const wire = serialize({source: "return 0", currentAstNodeId: 1,
    scopeChain: [{id: "external", bindings: {f: original.returnValue as RuntimeSnapshotValue}}],
    callStack: [], pendingPromises: [], moduleBindings: {}});
  const restored = restore(JSON.parse(JSON.stringify(wire)), {source: "return 0"});
  const fn = restored.currentScope.lookup("f").value;
  expect(isSandboxClosure(fn)).toBe(true);
  if (!isSandboxClosure(fn)) throw new Error("Missing restored closure.");
  expect(await fn.call([5], {stack: [], thisValue: undefined})).toBe(7);
});

it.each([
  'const f=eval("(function(){return 7})");await 0;return f()',
  'let x=3;const f=eval("()=>++x");await 0;return [f(),x]',
  'const f=eval("(async function(){return 7})");await 0;return await f()',
  'const iterator=eval("(function*(){yield 1;return 7})()");iterator.next();await 0;return iterator.next().value',
  'class C{#x=7;read(){return eval("()=>this.#x")}}const f=new C().read();await 0;return f()',
  'const f=eval("()=>((s)=>s)`x`");const first=f();await 0;return first===f()',
  'const C=eval("(class {#x=7;read(){return this.#x}})");const value=new C();await 0;return value.read()',
  'const iterator=eval("(async function*(){yield 1;return 7})()");await iterator.next();await 0;return (await iterator.next()).value',
  'const f=eval("async()=>{await Promise.resolve(1);return 7}");const pending=f();await 0;return await pending',
  `const f=eval(${JSON.stringify(`eval("()=>7")`)});await 0;return f()`,
  `const f=eval(${JSON.stringify(`Function("return 7")`)});await 0;return f()`,
  `const f=Function(${JSON.stringify('eval("let x=7;function f(){return ++x}");return f')})();await 0;return [f(),f()]`,
  `const f=Function(${JSON.stringify('eval("let x=7;{function f(){return ++x}}");return f')})();await 0;return [f(),f()]`,
  '(0,eval)("var globalCount=7");await 0;return ++globalCount',
  '(0,eval)("let count=7;function globalNext(){return ++count}");await 0;return [globalNext(),globalNext()]',
  'let stored;Object.defineProperty(globalThis,"globalBlock",{set(f){stored=f},configurable:true});(0,eval)("let x=7;{function globalBlock(){return ++x}}");await 0;return [stored(),stored()]'
])("recovers eval-owned executable state: %s", async source => {
  const expected: unknown = await runInNewContext(`(async function(){'use strict';${source}})()`);
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    const wire = JSON.parse(await dump(pending));
    expect(await completed).toMatchObject({ok: true, returnValue: expected});
    expect(await run(source, {snapshot: restoreRun(wire, {source})}))
      .toMatchObject({ok: true, returnValue: expected});
  } finally {await completed;}
});
