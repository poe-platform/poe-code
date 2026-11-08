import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";

it.each(["null", "undefined"])("short-circuits the reported default-export reproduction with %s", async value => {
  expect(await run(`export default () => { const a = ${value}; return a?.b.c; };`, { entryPointArgs: [] }))
    .toMatchObject({ ok: true, returnValue: undefined });
});

it.each(["null", "undefined", "({b:{c:7,get(value){return this.c+value}}})"])(
  "matches native continuous property and method chains with %s", async value => {
    const expressions = [
      "a?.b.c",
      "a?.b[effects++ ? 'unused' : 'c']",
      "a?.b.get(++effects)",
      "a?.b.get?.(++effects).toString()",
      "a?.b?.get(++effects)?.toString()",
      "(a?.b).c",
      "(a?.b).get(++effects)"
    ];
    for (const expression of expressions) {
      const source = `const a=${value};let effects=0,value;
        try{value=${expression}}catch(error){value=error.name}
        return [value,effects];`;
      expect(await run(`export default () => {${source}}`, { entryPointArgs: [] }), expression)
        .toMatchObject({ ok: true, returnValue: runInNewContext(`(()=>{${source}})()`) });
    }
  }
);

it.each([
  "missing?.a.b(++effects).c",
  "missing?.[effects++].b",
  "missing?.a[effects++]",
  "missing?.a(effects++).b",
  "missing?.(effects++).a.b",
  "missing?.a?.(effects++).b",
  "missing?.a.b?.(effects++)",
  "delete missing?.a.b[effects++]",
  "(missing?.a).b",
  "(missing?.a)(effects++)",
  "(missing?.a)?.(effects++).b",
  "(missing?.a, undefined).b",
  "({a:undefined})?.a.b",
  "({a(){return undefined}})?.a().b",
  "({a:undefined})?.a(effects++)",
  "({a:undefined})?.a?.(effects++).b",
  "({a(){return this.value},value:{b:7}})?.a().b",
  "(({a(){return this.value},value:{b:7}})?.a)().b",
  "(missing?.a ?? {b:7}).b",
  "[missing?.a][0].b"
])("matches native chain boundaries and effects: %s", async expression => {
  const source = `let effects=0;const missing=undefined;let value;
    try { value=${expression}; } catch(error) { value=error.name; }
    return [value,effects];`;
  const expected = runInNewContext("(()=>{'use strict';" + source + "})()");
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

it.each(["null", "({a:{b:7}})"])("resumes computed chain members after generator suspension: %s", value => {
  const source = `function* gen(){const obj=${value};return obj?.[yield 'key'].b}
    const g=gen();return [g.next(),g.next('a')];`;
  return expect(run(source)).resolves.toMatchObject({ ok: true, returnValue: runInNewContext("(()=>{" + source + "})()") });
});

it("preserves chain outcomes and completed host effects through replay", async () => {
  const source = "const obj=input();let effects=0;const result=obj?.a.b(effects++).c;await 0;return [result,effects]";
  let calls=0;
  const bindings={input(){calls++;return null;}};
  const first=await run(source,{bindings});
  expect(first).toMatchObject({ok:true,returnValue:[undefined,0]});
  expect(await run(source,{bindings,snapshot:JSON.parse(await dump(first))})).toMatchObject({ok:true,returnValue:[undefined,0]});
  expect(calls).toBe(1);
});

it("keeps optional eval indirect without relying on top-level Script lexical bindings", async () => {
  const source="globalThis.chainEvalValue='global';const chainEvalValue='local';return eval?.('chainEvalValue')";
  expect(await run(source)).toMatchObject({ok:true,returnValue:runInNewContext("(()=>{"+source+"})()")});
});
