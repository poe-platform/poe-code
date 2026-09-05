import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, createRealm, defineExtension, run } from "../core.js";
import { SandboxError } from "./budget.js";
import { dump } from "../dump.js";

describe("finally after catch-binding failures", () => {
  it.each([
    "const events=[];try{try{throw null}catch({x}){events.push('catch')}finally{events.push('finally')}}catch(error){events.push(error.name)}return events;",
    "const events=[];try{try{throw undefined}catch({}){}finally{events.push('finally')}}catch(error){events.push(error.name)}return events;",
    "const events=[];try{try{throw {}}catch([x]){}finally{events.push('finally')}}catch(error){events.push(error.name)}return events;",
    "const events=[];try{try{throw {nested:null}}catch({nested:{x}}){}finally{events.push('finally')}}catch(error){events.push(error.name)}return events;",
    "const events=[];try{try{throw {}}catch({[{toString(){return {}},valueOf(){return {}}}]:x}){}finally{events.push('finally')}}catch(error){events.push(error.name)}return events;",
    "function f(){try{throw null}catch({x}){return 'catch'}finally{return 'override'}}return f();",
    "function f(){try{throw {}}catch({[{toString(){throw 7}}]:x}){}finally{return 'override'}}return f();",
    "const replacement={};try{try{throw null}catch({x}){}finally{throw replacement}}catch(error){return error===replacement}",
    "let result='before';loop:while(true){try{throw null}catch({x}){}finally{result='after';break loop}}return result;",
    "const events=[];for(let index=0;index<2;index++){try{throw null}catch({x}){}finally{events.push(index);continue}}return events;",
    "const events=[];try{try{throw null}catch({x}){}finally{events.push(await Promise.resolve('finally'))}}catch(error){events.push(error.name)}return events;",
    "const events=[];try{try{try{throw null}catch({x}){}finally{events.push('inner')}}finally{events.push('outer')}}catch(error){events.push(error.name)}return events;",
    "const events=[];try{try{throw {}}catch({[{toString(){throw /x/}}]:x}){}finally{const other=/y/;events.push(other.test('y'))}}catch(error){events.push(error.test('x'))}return events;"
  ])("matches native completion ordering: %s", async (body) => {
    const source = `try{${body}}catch(error){return ['uncaught',error.name]}`;
    const expected = await runInNewContext(`(async()=>{${source}})()`, {}, { timeout: 1000 });
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["undefined", "null", "7", "'sentinel'", "{}", "new Error('message')", "{code:'budgetExceeded'}"])(
    "preserves the thrown value across finally: %s",
    async (expression) => {
      const source = `const reason=${expression};const events=[];try{try{throw {}}catch({[{toString(){throw reason}}]:x}){}finally{events.push('finally')}}catch(error){events.push(error===reason)}return events;`;
      expect(await run(source)).toMatchObject({ ok: true, returnValue: ["finally", true] });
    }
  );

  it.each(["named", "rest"])("runs finally after a failing live host %s read", async (kind) => {
    const extension = defineExtension({
      manifest: { version: 1, name: "catch-finally", globals: ["value"] },
      setup(context) {
        return { globals: { value: context.createHostObject({ properties: {
          x: { get() { throw new TypeError("host read"); } }
        } }) } };
      }
    });
    const realm = createRealm({ extensions: [extension] });
    try {
      const binding = kind === "named" ? "{x}" : "{...rest}";
      expect(await realm.evaluate(`const events=[];try{try{throw value}catch(${binding}){}finally{events.push('finally')}}catch(error){events.push(error.name,error.message)}return events;`))
        .toMatchObject({ ok: true, returnValue: ["finally", "TypeError", "host read"] });
    } finally {
      await realm.close();
    }
  });

  it.each([
    new SandboxError("reentry"),
    new SandboxError({ budget: "steps", current: 2, limit: 1 })
  ])("does not let finally override a fatal sandbox error: %s", async (failure) => {
    const extension = defineExtension({
      manifest: { version: 1, name: "fatal-catch", globals: ["value"] },
      setup(context) {
        return { globals: { value: context.createHostObject({ properties: {
          x: { get() { throw failure; } }
        } }) } };
      }
    });
    const realm = createRealm({ extensions: [extension] });
    try {
      await expect(realm.evaluate("try{throw value}catch({x}){}finally{return 'override'}"))
        .rejects.toBe(failure);
    } finally {
      await realm.close();
    }
  });

  it("preserves finalization through completed replay", async () => {
    const source = "return (()=>{const events=[];try{try{throw null}catch({x}){}finally{events.push('finally')}}catch(error){events.push(error.name)}return events})();";
    const first = await run(source);
    expect(first).toMatchObject({ ok: true, returnValue: ["finally", "TypeError"] });
    expect(await run(source, { snapshot: JSON.parse(await dump(first)) }))
      .toMatchObject({ ok: true, returnValue: ["finally", "TypeError"] });
  });

  it("counts a pending thrown value while the finalizer allocates more data", async () => {
    const source = "try{throw {}}catch({[{toString(){throw 'x'.repeat(2000)}}]:x}){}finally{const extra='y'.repeat(2000);return extra.length}";
    expect(await run("try{throw {}}catch({x}){}finally{const extra='y'.repeat(2000);return extra.length}", {
      budget: new Budget({ dataSize: 5000 })
    })).toMatchObject({ ok: true, returnValue: 2000 });
    await expect(run(source, { budget: new Budget({ dataSize: 5000 }) }))
      .rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect(await run(source, { budget: new Budget({ dataSize: 10000 }) }))
      .toMatchObject({ ok: true, returnValue: 2000 });
  });
});
