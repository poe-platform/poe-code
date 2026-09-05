import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { run } from "../../core.js";
import { Budget } from "../budget.js";
import { CompileScope } from "../regex/compile-guard.js";
import { createSandboxClosure } from "../values.js";
import { callStringMethod } from "./string.js";

const methods = ["search", "match", "matchAll"] as const;

describe.each(methods)("String.%s pattern construction", method => {
  it.each([
    "'t'", "'[a-z]+'", "'(t)(x)?'", "'missing'", "''", "undefined", "null",
    "123", "true", "false", "['t']", "[]",
    "{toString(){seen.push('string');return 't'}}",
    "{toString(){seen.push('string');return {}},valueOf(){seen.push('value');return 't'}}",
    "Object.create({toString(){seen.push('inherited');return 't'}})",
    "{toString:7,valueOf(){seen.push('value');return 't'}}",
    "{async toString(){seen.push('string');return 'ignored'},valueOf(){seen.push('value');return 't'}}",
    "{toString(){throw marker}}", "{toString(){return {}},valueOf(){return {}}}", "'['"
  ])("matches native pattern input %s", async pattern => {
    const source = `const seen=[];const marker={id:1};const pattern=${pattern};
      try{const result=' Otter 123 null true false '.${method}(pattern);
        return [${method === "search" ? "result" : method === "match" ? "result===null?null:[Array.from(result),result.index,result.input]" : "Array.from(result).map(match=>[Array.from(match),match.index,match.input])"},seen]}
      catch(error){return [error===marker,error.name,seen]}`;
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["direct", "call", "apply", "bind"])("constructs through %s invocation", async invocation => {
    const call = invocation === "direct" ? `'Otter'.${method}(pattern)`
      : invocation === "call" ? "saved.call('Otter',pattern)"
      : invocation === "apply" ? "saved.apply('Otter',[pattern])"
      : "saved.bind('Otter',pattern)()";
    const source = `const seen=[];const pattern={toString(){seen.push('pattern');return 't'}};
      const saved='lookup'.${method};const result=${call};return [${method === "search" ? "result" : "result===null?null:Array.from(result)"},seen]`;
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it("coerces the receiver before constructing a pattern", async () => {
    const source = `const seen=[];const receiver={toString(){seen.push('receiver');return 'Otter'}};
      const pattern={toString(){seen.push(this===pattern?'pattern':'wrong');return 't'}};
      const result='lookup'.${method}.call(receiver,pattern);
      return [${method === "search" ? "result" : "Array.from(result)"},seen]`;
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it("rejects null before invoking the pattern hook", async () => {
    const source = `const seen=[];const pattern={toString(){seen.push('pattern');return 't'}};
      try{'lookup'.${method}.call(null,pattern)}catch(error){return [error.name,seen]}`;
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it("uses intrinsic construction despite a shadowed RegExp binding", async () => {
    const source = `const RegExp=()=>{throw 'shadowed'};const result='Otter'.${method}('t');
      return ${method === "search" ? "result" : "Array.from(result)"}`;
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["/t/g", "/t/gi", "/t/"])("preserves existing regex input %s", async pattern => {
    const source = `const pattern=${pattern};pattern.lastIndex=2;
      try{const result='Otter'.${method}(pattern);return [${method === "search" ? "result" : "result===null?null:Array.from(result)"},pattern.lastIndex]}
      catch(error){return [error.name,pattern.lastIndex]}`;
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});

describe("String pattern admission and ownership", () => {
  it.each(methods)("%s rejects invalid ownership before coercing a pattern", async method => {
    for (const invalidOwner of ["foreign", "stale", "missing"] as const) {
      const budget = new Budget();
      const lease = (invalidOwner === "foreign" ? new Budget() : budget).acquireCompileOwner();
      const parent = invalidOwner === "missing" ? undefined : new CompileScope(lease.owner);
      if (invalidOwner === "stale") {
        lease.release();
        budget.reset();
      }
      let calls = 0;
      const pattern = { toString: createSandboxClosure({ call: () => { calls += 1; return "a"; } }) };
      try {
        await expect(callStringMethod("a", method, [pattern], budget, undefined, parent)).rejects.toMatchObject({ code: "reentry" });
        expect(calls).toBe(0);
        expect([...budget.retainedValues()]).toEqual([]);
        expect(budget.currentDataSize).toBe(0);
      } finally {
        parent?.dispose();
        lease.release();
      }
    }
  });

  it("retains a pattern needed by fallback coercion after its binding is cleared", async () => {
    const source = `let pattern={payload:'x'.repeat(4000),
      toString:()=>{pattern=null;const temporary='y'.repeat(4000);return {}},
      valueOf(){return 't'}};return 'Otter'.search(pattern)`;
    await expect(run(source, { budget: new Budget({ dataSize: 6000 }) })).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect(await run(source, { budget: new Budget({ dataSize: 14000 }) })).toMatchObject({ ok: true, returnValue: 1 });
  });

  it.each([false, true])("releases the pattern after coercion failure=%s", async fail => {
    const budget = new Budget();
    const observed: boolean[] = [];
    const pattern = { toString: createSandboxClosure({ call: () => "t" }) };
    const execution = callStringMethod("Otter", "search", [pattern], budget, undefined, undefined, {
      stack: [], thisValue: undefined,
      invokeClosure: async () => {
        observed.push([...budget.retainedValues()].includes(pattern));
        if (fail) throw new Error("coercion failed");
        return "t";
      }
    });
    if (fail) await expect(execution).rejects.toThrow("coercion failed");
    else expect(await execution).toBe(1);
    expect(observed).toEqual([true]);
    expect([...budget.retainedValues()]).toEqual([]);
    expect(budget.currentDataSize).toBe(0);
  });

  it.each(methods)("%s preserves compile limits and cleans up failed construction", async method => {
    const budget = new Budget({ stringLength: 8 });
    await expect(callStringMethod("a", method, ["a".repeat(9)], budget)).rejects.toMatchObject({ code: "budgetExceeded", budget: "stringLength" });
    expect(budget.currentDataSize).toBe(0);
    await expect(callStringMethod("a", method, ["["], budget)).rejects.toThrow(SyntaxError);
    expect(budget.currentDataSize).toBe(0);
    expect([...budget.retainedValues()]).toEqual([]);
  });

  it("enforces matchAll output length on the internal method path", async () => {
    await expect(callStringMethod("aaaa", "matchAll", ["a"], new Budget({ arrayLength: 2 }))).rejects.toMatchObject({ code: "budgetExceeded", budget: "arrayLength" });
  });

  it("keeps a coercion loop's step exhaustion fatal", async () => {
    const source = "try{return 'a'.search({toString(){while(true){}return 'a'}})}catch(error){return 'caught'}";
    await expect(run(source, { budget: new Budget({ maxSteps: 100 }) })).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  });

  describe.each([false, true])("live matching input with receiver coercion=%s", coerce => {
    it.each(methods)("retains input while %s coerces its pattern", async method => {
      const operation = coerce
        ? `''.${method}.call({toString(){return 'b'.repeat(4000)}},pattern)`
        : `('b'.repeat(4000)).${method}(pattern)`;
      const source = `const pattern={toString(){const temporary='y'.repeat(4000);return 'a'}};
        try{${operation}}catch(error){return 'caught'}return true`;
      await expect(run(source, { budget: new Budget({ dataSize: 6000 }) })).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
      expect(await run(source, { budget: new Budget({ dataSize: 14000 }) })).toMatchObject({ ok: true, returnValue: true });
    });
  });
});
