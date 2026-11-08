import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, createRealm, run } from "../core.js";
import { dump } from "../dump.js";

describe("function method receivers", () => {
  it.each([
    "function a(){return 'A'}function b(){return 'B'}return a.call.call(b,null)",
    "function a(){return 'A'}function b(){return 'B'}return a.apply.call(b,null,[])",
    "function a(){return 'A'}function b(){return 'B'}return a.bind.call(b,null)()",
    "function a(){return 'A'}function b(x){return [this.value,x]}b.method=a.call;return b.method({value:'B'},7)",
    "function a(){return 'A'}function b(x){return [this.value,x]}b.method=a.apply;return b.method({value:'B'},[7])",
    "function A(){}function B(value){this.value=value}B.method=A.bind;const Bound=B.method(null,7);const result=new Bound();return [result.value,result instanceof B,result instanceof Bound]",
    "function a(){return 'A'}function b(x,y){return [this.value,x,y]}const holder=b.bind({value:'B'},7);holder.method=a.bind;return holder.method({value:'ignored'},8)()",
    "function a(){return 'A'}async function b(){return 'B'}return await a.call.call(b,null)",
    "function a(){return 'A'}function* b(){yield 'B'}return a.call.call(b,null).next().value",
    "function a(){return 'A'}const b=(x)=>x;return a.call.call(b,null,7)",
    "function a(){return 'A'}function b(x,y){return [this.value,x,y]}return a.apply.apply(b,[{value:'B'},[7,8]])",
    "function a(){return 'A'}function b(x){return [this.value,x]}return a.call.bind(b,{value:'B'})(7)",
    "function a(){return 'A'}const reason={};function b(){throw reason}try{a.call.call(b,null)}catch(error){return error===reason}",
    "function a(){return 'A'}function b(){return /x/.test('x')}return a.call.call(b,null)",
    "function a(){return 'A'}function b(x,y){return [x,y]}const bound=a.bind.call(b,null,7);return [bound.name,bound.length,bound(8)]"
  ])("uses the actual callable receiver: %s", async (source) => {
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`, {}, { timeout: 1000 });
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["call", "apply", "bind"])("rejects detached %s without invoking its former target", async (method) => {
    const source = `let calls=0;function f(){calls++;return 7}const method=f.${method};try{method(null,[]);return ['accepted',calls]}catch(error){return [error.name,calls]}`;
    expect(await run(source)).toMatchObject({ ok: true, returnValue: ["TypeError", 0] });
  });

  it.each(["call", "apply", "bind"])("rejects noncallable receivers for %s", async (method) => {
    const source = `let calls=0;function f(){calls++}const results=[];for(const value of [undefined,null,1,'text',{},[]]){try{f.${method}.call(value,null,[]);results.push('accepted')}catch(error){results.push(error.name)}}return [results,calls]`;
    expect(await run(source)).toMatchObject({ ok: true, returnValue: [Array(6).fill("TypeError"), 0] });
  });

  it("retains borrowed binding state across realm evaluations", async () => {
    const realm = createRealm();
    try {
      expect(await realm.evaluate("function a(){return 'A'}function b(x){return [this.value,x]}const bound=a.bind.call(b,{value:'B'});return 0"))
        .toMatchObject({ ok: true, returnValue: 0 });
      expect(await realm.evaluate("return bound(7)"))
        .toMatchObject({ ok: true, returnValue: ["B", 7] });
    } finally {
      await realm.close();
    }
  });

  it("preserves borrowed invocation through completed replay", async () => {
    const source = "function a(){return 'A'}function b(x){return x+1}return a.call.call(b,null,7)";
    const first = await run(source);
    expect(first).toMatchObject({ ok: true, returnValue: 8 });
    expect(await run(source, { snapshot: JSON.parse(await dump(first)) }))
      .toMatchObject({ ok: true, returnValue: 8 });
  });

  it("applies the step budget to the actual target", async () => {
    await expect(run("function a(){return 'A'}function b(){while(true){}}try{return a.call.call(b,null)}catch(error){return 'caught'}", {
      budget: new Budget({ maxSteps: 1000 })
    })).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  });
});
