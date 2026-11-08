import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { Budget, createRealm, run } from "../../core.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { measureSandboxData } from "../values.js";

it.each([
  "return Function('a','b','return a+b')(2,3)",
  "const f=Function('a','return a');return [f.name,f.length,f.toString(),f.constructor===Function,Object.getPrototypeOf(f)===Function.prototype]",
  "return new Function('a=2','{b}={b:3}','...rest','return [a,b,rest]')(undefined,undefined,4,5)",
  "const secret=7;globalThis.visible=9;return Function('return [typeof secret,visible,this===globalThis]')()",
  "const f=Function('return this');return [f()===globalThis,f.call(null)===globalThis,f.call(3).valueOf()]",
  "return Function('\"use strict\";return this')()===undefined",
  "const seen=[];const f=Function({toString(){seen.push('parameter');return 'a'}},{toString(){seen.push('body');return 'return a'}});return [seen,f(4)]",
  "const F=Function('x','this.x=x;this.target=new.target');const x=new F(7);return [x.x,x.target===F,x instanceof F]",
  "const f=Function('a','a','return a');return [f(1,2),f.length]",
  "try{Function('a=1','\"use strict\";return a')}catch(e){return e.name}",
  "try{Function('/*','*/) {return 7} //')}catch(e){return e.name}",
  "try{Function('a) {return 7} //','return 2')}catch(e){return e.name}",
  "return Function('return /a+/i.test(\"AAA\")')()",
  "return Function('return [typeof process,typeof require,typeof Buffer]')()",
  "return (function(){}).constructor('return 3')()",
  "const value=Function('created=7;return created')();return [value,globalThis.created]",
  "try{Function('\"use strict\";created=7')()}catch(e){return [e.name,Object.hasOwn(globalThis,'created')]}"
])("implements guest dynamic function semantics: %s", async source => {
  const expected = runInNewContext(`(function(){${source}})()`);
  expect(await run(source)).toMatchObject({ok: true, returnValue: expected});
});

it.each([
  "return Function('a','a=3;return arguments[0]')(1)",
  "return Function('a','a=3;Object.freeze(arguments);a=4;return [arguments[0],a]')(1)",
  "return Function('a','Object.defineProperty(arguments,\"0\",{get(){return 8}});a=4;return [arguments[0],a]')(1)",
  "return Function('a','Object.defineProperty(arguments,\"0\",{configurable:false});const ok=Reflect.deleteProperty(arguments,\"0\");a=4;return [ok,arguments[0]]')(1)",
  "return Function('a','const receiver={};Reflect.set(arguments,\"0\",8,receiver);return [a,arguments[0],receiver[0]]')(1)",
  "return Function('a','arguments[0]=3;return a')(1)",
  "return Function('arguments','return arguments')(7)",
  "return Function('return arguments.callee.name')()",
  "return Function('a','a=3;return Object.getOwnPropertyDescriptor(arguments,\"0\").value')(1)",
  "return Function('a','delete arguments[0];a=3;return [arguments[0],a]')(1)",
  "return Function('a','Object.defineProperty(arguments,\"0\",{value:4,writable:false});a=5;return [arguments[0],a]')(1)",
  "return Function('a','Object.freeze(arguments);a=3;return [arguments[0],a]')(1)",
  "return Function('a','a','a=3;return [arguments[0],arguments[1],a]')(1,2)",
  "return Function('a','a','return [arguments[0],a]')(1)",
  "return Function('a=1','a=3;return arguments[0]')(2)",
  "const saved=globalThis;globalThis.globalThis=7;return Function('return this')()===saved"
])("preserves non-strict function call state: %s", async source => {
  expect(await run(source)).toMatchObject({ok: true, returnValue: runInNewContext(`(function(){${source}})()`)});
});

it.each(["Function", "(function*(){}).constructor", "(async function(){}).constructor", "(async function*(){}).constructor"])(
  "preserves constructor and subclass prototypes through %s", async constructor => {
    const source = `const C=${constructor};const d=Object.getOwnPropertyDescriptor(C,'prototype');class D extends C{}const f=new D('return 1');return [C.name,C.length,typeof C.prototype,d.writable,d.enumerable,d.configurable,Object.getPrototypeOf(C)===Function,Object.getPrototypeOf(f)===D.prototype,f instanceof D,f instanceof C]`;
    expect(await run(source)).toMatchObject({ok: true, returnValue: runInNewContext(`(function(){${source}})()`)});
  }
);

it.each([
  "const C=(function*(){}).constructor;return C('yield 3')().next().value",
  "const C=(async function(){}).constructor;return await C('return 3')()",
  "const C=(async function(){}).constructor;const f=C('return 3');const p=f();return [C.name,f.constructor===C,Object.getPrototypeOf(f)===C.prototype,p instanceof Promise,await p,f.toString(),Object.hasOwn(f,'prototype')]",
  "const C=(async function*(){}).constructor;return (await C('yield 3')().next()).value"
])("uses guest compilation for each function constructor: %s", async source => {
  const expected = await runInNewContext(`(async function(){${source}})()`);
  expect(await run(source)).toMatchObject({ok: true, returnValue: expected});
});

it("exposes granted global bindings without capturing caller locals", async () => {
  expect(await run("const secret=7;return Function('return [allowed,typeof secret]')()", {bindings: {allowed: 2}}))
    .toMatchObject({ok: true, returnValue: [2,"undefined"]});
});

it("returns mapped arguments with updated parameter values", async () => {
  const result = await run("return Function('a','a=4;return arguments')(1)");
  expect(result).toMatchObject({ok: true, returnValue: {0: 4, length: 1}});
});

it("keeps dynamic function execution within fatal work limits", async () => {
  await expect(run("try{Function('while(true){}')()}catch(e){return 'caught'}", {
    budget: new Budget({maxSteps: 200})
  })).rejects.toMatchObject({code: "budgetExceeded", budget: "steps"});
});

it("accounts for dynamic source retained by a returned closure", async () => {
  const small = await run("return Function('return 1')");
  const body = `/*${"x".repeat(16384)}*/return 1`;
  const large = await run(`return Function(${JSON.stringify(body)})`);
  if (!small.ok || !large.ok) throw new Error("Dynamic function compilation failed.");
  expect(measureSandboxData([large.returnValue]) - measureSandboxData([small.returnValue])).toBeGreaterThanOrEqual(16384);
});

it.each([
  "Function.prototype",
  "Object.getPrototypeOf(async function(){})",
  "Object.getPrototypeOf(function*(){})",
  "Object.getPrototypeOf(async function*(){})"
])("charges guest mutations of the intrinsic prototype: %s", async prototype => {
  const budget = new Budget();
  const realm = createRealm({budget});
  try {
    expect(measureSandboxData(budget.retainedValues())).toBe(0);
    expect(await realm.evaluate(`${prototype}.payload='x'.repeat(1000);return 7`))
      .toMatchObject({ok: true, returnValue: 7});
    expect(measureSandboxData(budget.retainedValues())).toBeGreaterThanOrEqual(1000);
    expect(await realm.evaluate(`delete ${prototype}.payload;return 7`))
      .toMatchObject({ok: true, returnValue: 7});
    expect(measureSandboxData(budget.retainedValues())).toBe(0);
  } finally {await realm.close();}
});

it.each([
  ["const f=async function(){return 7};const p=Object.getPrototypeOf(f);await 0;return [Object.getPrototypeOf(f)===p,f.constructor===p.constructor,await f()]", [true,true,7]],
  ["const f=async()=>7;const p={tag:9};Object.setPrototypeOf(f,p);await 0;return [Object.getPrototypeOf(f)===p,f.tag,await f()]", [true,9,7]],
  ["const f=async()=>7;Object.setPrototypeOf(f,null);await 0;return [Object.getPrototypeOf(f)===null,await f()]", [true,7]],
  ["const f=Function('x','return function(y){return x+y}')(4);await 0;return f(5)", 9],
  ["const f=Function('x','return x+2');await 0;return f(5)", 7],
  ["const f=Function('return 1'),g=Function('return 2');await 0;return [f(),g()]", [1,2]],
  ["const f=(async function(){}).constructor('x','return x+2');await 0;return await f(5)", 7],
  ["const f=(function*(){}).constructor('yield 1;return 2');const g=f();await 0;return [g.next().value,g.next().value]", [1,2]],
  ["const f=(function*(){}).constructor('yield 1;return 2');const g=f();g.next();await 0;return g.next().value", 2],
  ["const C=Function('return class {read(){return 7}}')();await 0;return new C().read()", 7],
  ["const f=Function('return /a+/i.test(\"AAA\")');await 0;return f()", true],
  ["const f=Function('return (x=>x)`text`');const t=f();await 0;return [t[0],t.raw[0],t===f()]", ["text","text",true]],
  ["const f=(async function*(){}).constructor('yield 1;return 2');const g=f();await 0;return [(await g.next()).value,(await g.next()).value]", [1,2]],
  ["const f=(async function(){}).constructor('await 0;return 7');return await f()", 7],
  ["const f=(async function*(){}).constructor('await 0;yield 7');return (await f().next()).value", 7],
  ["const f=(async function(){}).constructor('a','await 0;a=7;return arguments[0]');return await f(1)", 7]
] as const)("restores dynamically compiled source state: %s", async (source, expected) => {
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    const saved = JSON.parse(await dump(pending));
    expect(await completed).toMatchObject({ok: true, returnValue: expected});
    expect(await run(source, {snapshot: restore(saved, {source})})).toMatchObject({ok: true, returnValue: expected});
  } finally { await completed; }
});
