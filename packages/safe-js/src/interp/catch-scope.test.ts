import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, createRealm, run } from "../core.js";
import { dump } from "../dump.js";

describe("catch parameter scope", () => {
  it.each([
    "let a=9;try{throw {}}catch({a=a}){return a}",
    "let b=9;try{throw {}}catch({a=b,b=2}){return a}",
    "let b=9;try{throw []}catch([a=b,b=2]){return a}",
    "let b=9;try{throw {}}catch({a=typeof b,b=2}){return a}",
    "let b='x';try{throw {x:7}}catch({[b]:a,b=2}){return a}",
    "let b=9;try{throw {nested:{}}}catch({nested:{a=b},b=2}){return a}",
    "let b=9;try{throw {}}catch({a=b,...b}){return a}",
    "let b=9;try{throw []}catch([a=b,...b]){return a}",
    "let b=9;try{throw {}}catch({read=()=>b,a=read(),b=2}){return a}",
    "let b=9;try{throw {b:3}}catch({a=b,b}){return a}",
    "try{throw {}}catch({a=a}){return a}",
    "let b=9;try{throw {}}catch({a=await Promise.resolve().then(()=>b),b=2}){return a}",
    "try{throw {}}catch({a=1,b=a}){return b}",
    "try{throw {}}catch({read=()=>b,b=2}){return read()}",
    "try{throw {}}catch({a=await Promise.resolve(1),b=a}){return b}",
    "try{throw {}}catch({a=1,b=a}){a=3;return [a,b]}",
    "let error=9;try{throw 7}catch(error){error=2}return error;",
    "try{throw 7}catch{return 'caught'}",
    "function f(){let result;try{throw 7}catch(error){var error;result=error}return [result,error]}return f();",
    "let b=9;let name;try{try{throw {}}catch({a=(b=1),b=2}){name='accepted'}}catch(error){name=error.name}return [name,b];",
    "let b=9;const events=[];try{try{throw {}}catch({a=b,b=2}){events.push('catch')}finally{events.push('finally')}}catch(error){events.push(error.name)}return events;"
  ])("matches native initialization and shadowing: %s", async (body) => {
    const source = `try{${body}}catch(error){return error.name}`;
    const expected = await runInNewContext(`(async()=>{${source}})()`, {}, { timeout: 1000 });
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it("does not assign to a shadowed persistent binding before initialization", async () => {
    const realm = createRealm();
    try {
      expect(await realm.evaluate("let b=9;")).toMatchObject({ ok: true });
      expect(await realm.evaluate("try{try{throw {}}catch({a=(b=1),b=2}){return 'accepted'}}catch(error){return error.name}"))
        .toMatchObject({ ok: true, returnValue: "ReferenceError" });
      expect(await realm.evaluate("return b;")).toMatchObject({ ok: true, returnValue: 9 });
    } finally {
      await realm.close();
    }
  });

  it("preserves catch TDZ behavior in completed replay", async () => {
    const source = "return (()=>{let b=9;try{try{throw {}}catch({a=b,b=2}){return a}}catch(error){return error.name}})();";
    const first = await run(source);
    expect(first).toMatchObject({ ok: true, returnValue: "ReferenceError" });
    expect(await run(source, { snapshot: JSON.parse(await dump(first)) }))
      .toMatchObject({ ok: true, returnValue: "ReferenceError" });
  });

  it("does not make budget failures in defaults catchable", async () => {
    await expect(run("try{throw {}}catch({a=(()=>{while(true){}})(),b=2}){return 'caught'}", {
      budget: new Budget({ maxSteps: 1000 })
    })).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  });
});
