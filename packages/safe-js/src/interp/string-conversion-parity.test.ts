import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, createRealm, run } from "../core.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

describe("string conversion across guest prototypes and built-ins", () => {
  it.each([
    'return String(Object.create({toString(){return "inherited"}}));',
    'return String([Object.create({toString(){return "inherited"}})]);',
    'const value=Object.create({toString(){return this.label}}); value.label="receiver"; return String(value);',
    "const value=Object.create({toString:undefined,valueOf(){return 7}}); return String(value);",
    "const value=Object.create({toString(){this.valueOf=()=>9;return {}},valueOf(){return 1}}); return String(value);",
    "try { return String(Object.create(null)); } catch(error) { return error.name; }",
    "const value=Object.create(null); value.valueOf=()=>7; return String(value);",
    'Object.prototype.toString=function(){return "changed"}; return String({});',
    "delete Object.prototype.toString; try { return String({}); } catch(error) { return error.name; }",
    "Object.prototype.toString=undefined; Object.prototype.valueOf=()=>7; return String({});",
    'const value=Object.create({toString(){return "wrong"}}); value.toString=undefined; try { return String(value); } catch(error) { return error.name; }',
    "const marker={}; const value=Object.create({toString(){throw marker}}); try { String(value); } catch(error) { return error===marker; }",
    'function fn(){} fn.toString=()=>"custom function"; return String(fn);',
    'const error=new Error("message"); Object.setPrototypeOf(error,{toString(){return "custom error"}}); return String(error);',
    'const error=new Error("message"); Object.setPrototypeOf(error,null); try { return String(error); } catch(error) { return error.name; }',
    "return [String(new Map()),String(new Set()),String(Promise.resolve(1))];",
    "function* values(){yield 1} return String(values());",
    'return String(new TypeError("message"));'
  ])("matches native conversion: %s", async (source) => {
    const expected = runInNewContext(`(() => { ${source} })()`, {}, { timeout: 1000 });
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each([
    "new Map()",
    "new Set()",
    "new TypeError('message')",
    '[Object.create({toString(){return "x"}})]'
  ])("uses the same conversion for property keys: %s", async (expression) => {
    const source = `const value=${expression}; const object={[value]:7}; return [String(value),Object.keys(object)[0],object[value]];`;
    const expected = runInNewContext(`(() => { ${source} })()`, {}, { timeout: 1000 });
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["", "a/b", "a\\/b", "a\\\\/b", "\n", "\r", "\u2028", "\u2029", "\\\n", "[a/b]"])(
    "formats RegExp source %j without changing its matching state",
    async (pattern) => {
      const source = `const value=new RegExp(${JSON.stringify(pattern)},"mi"); value.lastIndex=3; const object={[value]:7}; return [value.source,value.flags,String(value),Object.keys(object)[0],value.lastIndex];`;
      const expected = runInNewContext(`(() => { ${source} })()`, {}, { timeout: 1000 });
      expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
    }
  );

  it("preserves inherited hooks in completed replay and a persistent realm", async () => {
    const source =
      'return (()=>{const value=Object.create({toString(){return "x"}}); return [String([value]),{[value]:7}[value]];})();';
    const first = await run(source);
    expect(first).toMatchObject({ ok: true, returnValue: ["x", 7] });
    expect(await run(source, { snapshot: JSON.parse(await dump(first)) })).toMatchObject({
      ok: true,
      returnValue: ["x", 7]
    });
    const realm = createRealm();
    try {
      expect(
        await realm.evaluate('const value=Object.create({toString(){return "x"}});')
      ).toMatchObject({ ok: true });
      expect(await realm.evaluate("return String(value);")).toMatchObject({
        ok: true,
        returnValue: "x"
      });
    } finally {
      await realm.close();
    }
  });

  it("preserves retained custom prototypes through checkpoint replay", async () => {
    const source = 'const value=Object.create({toString(){return "x"}}); return String(value);';
    const result = await run(source);
    expect(result).toMatchObject({ ok: true, returnValue: "x" });
    const snapshot = JSON.parse(await dump(result));
    const resumed = await run(source, { snapshot: restore(snapshot, { source }) });
    expect(resumed).toMatchObject({ ok: true, returnValue: "x" });
    const recaptured = JSON.parse(await dump(resumed));
    expect(recaptured.heap).toEqual(snapshot.heap);
    expect(recaptured.bindings).toEqual(snapshot.bindings);
  });

  it("charges inherited lookup and generated strings to the budget", async () => {
    const source =
      'let value={toString(){return "x"}}; for(let i=0;i<12;i++)value=Object.create(value); return String(value);';
    const budget = new Budget();
    expect(await run(source, { budget })).toMatchObject({ ok: true, returnValue: "x" });
    await expect(
      run(source, { budget: new Budget({ maxSteps: budget.stepsUsed - 1 }) })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
    await expect(
      run("return String(new Map());", { budget: new Budget({ stringLength: 8 }) })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "stringLength" });
    await expect(
      run('return new RegExp("////").source;', { budget: new Budget({ stringLength: 6 }) })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "stringLength" });
  });
});
