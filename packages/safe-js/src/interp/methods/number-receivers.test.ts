import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, createRealm, run } from "../../core.js";
import { dump } from "../../dump.js";

describe("number method receivers", () => {
  for (const method of ["toString", "toFixed", "toPrecision", "toExponential"]) {
    it.each(["2.5", "-0", "NaN", "Infinity", "-Infinity"])(
      `${method} uses the number supplied through call, apply, and bind: %s`,
      async (receiver) => {
        const source = `const method=(1).${method}; return [method.call(${receiver},2),method.apply(${receiver},[2]),method.bind(${receiver},2)(),method.bind(${receiver}).call(9,2)];`;
        const expected = runInNewContext(`(()=>{${source}})()`, {}, { timeout: 1000 });
        expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
      }
    );

    it(`${method} rejects detached and incompatible receivers without coercing them`, async () => {
      const source = `
        const method=(1).${method};
        let coercions=0;
        const receivers=[undefined,null,false,"2",{},[],()=>2,new Map(),{valueOf(){coercions++;return 2}}];
        const errors=receivers.map(receiver=>{
          try { method.call(receiver,2); return "accepted"; }
          catch(error) { return error.name; }
        });
        try { method(2); errors.push("accepted"); }
        catch(error) { errors.push(error.name); }
        return [errors,coercions];
      `;
      const expected = runInNewContext(`(()=>{${source}})()`, {}, { timeout: 1000 });
      expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
    });

    it(`${method} validates the receiver after argument evaluation but before argument conversion`, async () => {
      const source = `
        const method=(1).${method}; const events=[];
        function argument(){events.push("evaluated");return {valueOf(){events.push("converted");return 200}}}
        try { method.call({},argument()); } catch(error){events.push(error.name)}
        return events;
      `;
      const expected = runInNewContext(`(()=>{${source}})()`, {}, { timeout: 1000 });
      expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
    });
  }

  it("preserves the supplied receiver in persistent evaluations", async () => {
    const realm = createRealm();
    try {
      expect(await realm.evaluate("const format=(1).toFixed;")).toMatchObject({ ok: true });
      expect(await realm.evaluate("return format.call(2.5,1);")).toMatchObject({
        ok: true,
        returnValue: "2.5"
      });
    } finally {
      await realm.close();
    }
  });

  it("preserves receiver behavior through completed replay", async () => {
    const source = "return (()=>{const format=(1).toFixed;return format.apply(2.5,[1])})();";
    const first = await run(source);
    expect(first).toMatchObject({ ok: true, returnValue: "2.5" });
    expect(await run(source, { snapshot: JSON.parse(await dump(first)) })).toMatchObject({
      ok: true,
      returnValue: "2.5"
    });
  });

  it("keeps the string budget fatal for borrowed methods", async () => {
    await expect(
      run("try { return (1).toFixed.call(2,100); } catch(error) { return 'caught'; }", {
        budget: new Budget({ stringLength: 50 })
      })
    ).rejects.toMatchObject({ code: "budgetExceeded", budget: "stringLength" });
  });
});
