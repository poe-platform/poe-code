import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { run } from "../../core.js";
import { Budget } from "../budget.js";
import { CompileScope } from "../regex/compile-guard.js";
import { createSandboxClosure, createSandboxRegex } from "../values.js";
import { createRegexGlobals } from "./regex.js";

describe.each(["RegExp", "new RegExp"])("%s input construction", invocation => {
  it.each([
    "undefined", "null", "''", "'a'", "'(a)(b)?'", "'['", "123", "true", "false",
    "['a']", "[]", "{}", "Object.create(null)",
    "{toString(){seen.push('string');return 'a'}}",
    "{toString(){seen.push('string');return {}},valueOf(){seen.push('value');return 'a'}}",
    "Object.create({toString(){seen.push('inherited');return 'a'}})",
    "{toString:7,valueOf(){seen.push('value');return 'a'}}",
    "{async toString(){seen.push('string');return 'ignored'},valueOf(){seen.push('value');return 'a'}}",
    "{toString(){throw marker}}", "{toString(){return {}},valueOf(){return {}}}"
  ])("matches native pattern %s", async pattern => {
    const source = `const seen=[];const marker={id:1};const pattern=${pattern};
      try{const result=${invocation}(pattern);return [result.source,result.flags,result.lastIndex,seen]}
      catch(error){return [error===marker,error.name,seen]}`;
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each([
    "undefined", "null", "''", "'ig'", "'gg'", "'invalid'", "123", "true", "['i']", "[]",
    "{toString(){seen.push('flags');return 'i'}}",
    "{toString(){seen.push('flags');return {}},valueOf(){seen.push('value');return 'i'}}",
    "{toString(){throw marker}}"
  ])("matches native flags %s", async flags => {
    const source = `const seen=[];const marker={id:1};const flags=${flags};
      try{const result=${invocation}('a',flags);return [result.source,result.flags,result.lastIndex,seen]}
      catch(error){return [error===marker,error.name,seen]}`;
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["'a'", "'['", "'throw'"])("preserves pattern-before-flags order for %s", async result => {
    const source = `const seen=[];const marker={id:1};
      const pattern={toString(){seen.push('pattern');if(${result}==='throw')throw marker;return ${result}}};
      const flags={toString(){seen.push('flags');return 'i'}};
      try{const result=${invocation}(pattern,flags);return [result.source,result.flags,seen]}
      catch(error){return [error===marker,error.name,seen]}`;
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it("supports nested regex construction in coercion", async () => {
    const source = `return ${invocation}({toString(){return new RegExp('a').source}},
      {toString(){return RegExp('a','i').flags}}).test('A')`;
    expect(await run(source)).toMatchObject({ ok: true, returnValue: true });
  });
});

describe.each(["RegExp(pattern,flags)", "new RegExp(pattern,flags)", "RegExp.call(null,pattern,flags)", "RegExp.bind(null,pattern)(flags)"])("RegExp copy semantics: %s", invocation => {
  it.each(["undefined", "'i'", "''", "null", "{toString(){seen.push('flags');return 'i'}}"])("handles flags %s", async flags => {
    const source = `const seen=[];const pattern=/a/g;pattern.lastIndex=2;const flags=${flags};
      try{const result=${invocation};return [result===pattern,result.source,result.flags,result.lastIndex,pattern.lastIndex,seen]}
      catch(error){return [error.name,pattern.lastIndex,seen]}`;
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});

describe.each(["RegExp", "new RegExp"])("%s admission", invocation => {
  it.each(["pattern", "flags"])("retains the %s needed by fallback coercion", async argument => {
    const returned = argument === "pattern" ? "a" : "i";
    const source = `let value={payload:'x'.repeat(4000),
      toString:()=>{value=null;const temporary='y'.repeat(4000);return {}},valueOf(){return '${returned}'}};
      return ${invocation}(${argument === "pattern" ? "value" : "'a',value"}).${argument === "pattern" ? "source" : "flags"}`;
    await expect(run(source, { budget: new Budget({ dataSize: 6000 }) })).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect(await run(source, { budget: new Budget({ dataSize: 14000 }) })).toMatchObject({ ok: true, returnValue: returned });
  });

  it("retains the produced pattern while coercing flags", async () => {
    const source = `try{${invocation}({toString(){return 'x'.repeat(4000)}},
      {toString(){const temporary='y'.repeat(4000);throw 'flags failed'}})}catch(error){return error}`;
    await expect(run(source, { budget: new Budget({ dataSize: 6000 }) })).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect(await run(source, { budget: new Budget({ dataSize: 14000 }) })).toMatchObject({ ok: true, returnValue: "flags failed" });
  });

  it("keeps coercion step exhaustion fatal", async () => {
    await expect(run(`try{${invocation}({toString(){while(true){}return 'a'}})}catch(error){return 'caught'}`, {
      budget: new Budget({ maxSteps: 100 })
    })).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  });
});

describe.each(["call", "construct"] as const)("RegExp.%s ownership", invocation => {
  it("rejects invalid owners before hooks or regex identity shortcuts", async () => {
    for (const invalidOwner of ["foreign", "stale", "missing", "context"] as const) {
      const budget = new Budget();
      const lease = (invalidOwner === "foreign" ? new Budget() : budget).acquireCompileOwner();
      const foreignLease = new Budget().acquireCompileOwner();
      const globals = createRegexGlobals({ budget, compileOwner: invalidOwner === "missing" ? undefined : lease.owner });
      if (invalidOwner === "stale") { lease.release(); budget.reset(); }
      let calls = 0;
      const pattern = { toString: createSandboxClosure({ call: () => { calls += 1; return "a"; } }) };
      try {
        for (const value of [pattern, createSandboxRegex("a")]) {
          await expect(globals.RegExp[invocation]!([value], invalidOwner === "context" ? {
            stack: [], thisValue: undefined, compilation: new CompileScope(foreignLease.owner)
          } : undefined)).rejects.toMatchObject({ code: "reentry" });
        }
        expect(calls).toBe(0);
        expect([...budget.retainedValues()]).toEqual([]);
      } finally { lease.release(); foreignLease.release(); }
    }
  });

  it.each([false, true])("releases retained inputs after flags coercion failure=%s", async fail => {
    const budget = new Budget();
    const observed: boolean[] = [];
    const pattern = { toString: createSandboxClosure({ call: () => "a" }) };
    const flags = { toString: createSandboxClosure({ call: () => {
      const retained = [...budget.retainedValues()];
      observed.push(retained.includes(pattern) && retained.includes(flags) && retained.includes("a"));
      if (fail) throw new Error("flags failed");
      return "i";
    } }) };
    const execution = createRegexGlobals({ budget }).RegExp[invocation]!([pattern, flags]);
    if (fail) await expect(execution).rejects.toThrow("flags failed");
    else expect(await execution).toMatchObject({ source: "a", flags: "i" });
    expect(observed).toEqual([true]);
    expect([...budget.retainedValues()]).toEqual([]);
    expect(() => budget.reset()).not.toThrow();
    expect(budget.currentDataSize).toBe(0);
  });

  it("preserves compile admission and cleans up syntax and length failures", async () => {
    const budget = new Budget({ stringLength: 8 });
    const globals = createRegexGlobals({ budget });
    await expect(globals.RegExp[invocation]!(["a".repeat(9)])).rejects.toMatchObject({ code: "budgetExceeded", budget: "stringLength" });
    await expect(globals.RegExp[invocation]!(["["])).rejects.toThrow(SyntaxError);
    expect([...budget.retainedValues()]).toEqual([]);
    expect(budget.currentDataSize).toBe(0);
    expect(() => budget.reset()).not.toThrow();
  });
});
