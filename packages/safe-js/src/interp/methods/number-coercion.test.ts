import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { run } from "../../core.js";
import { Budget } from "../budget.js";
import { createSandboxClosure } from "../values.js";
import { callNumberMethod } from "./number.js";

const methods = ["toFixed", "toPrecision", "toExponential", "toString"] as const;

describe.each(methods)("Number.%s argument coercion", method => {
  it.each([
    "{valueOf(){seen.push('value');return 2}}",
    "{valueOf(){seen.push('value');return {}},toString(){seen.push('string');return '2'}}",
    "Object.create({valueOf(){seen.push('inherited');return 2}})",
    "{valueOf:7,toString(){seen.push('string');return '2'}}",
    "{digits:2,valueOf(){seen.push(this===argument);return this.digits}}",
    "{async valueOf(){seen.push('value');return 9},toString(){seen.push('string');return '2'}}",
    "{valueOf(){seen.push('throw');throw marker}}",
    "{valueOf(){seen.push('value');return {}},toString(){seen.push('string');return {}}}"
  ])("matches native hooks: %s", async argument => {
    const source = `const seen=[];const marker={id:1};const argument=${argument};
      try{return [(12.345).${method}(argument),seen]}
      catch(error){return [error===marker,error.name,seen]}`;
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["direct", "call", "apply", "bind"])("coerces through %s invocation", async invocation => {
    const expression = invocation === "direct" ? `(12.345).${method}(argument)`
      : invocation === "call" ? "format.call(12.345,argument)"
      : invocation === "apply" ? "format.apply(12.345,[argument])"
      : "format.bind(12.345,argument)()";
    const source = `const seen=[];const argument={valueOf(){seen.push('once');return 2}};
      const format=(1).${method};return [${expression},seen]`;
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["NaN", "Infinity", "-Infinity", "12.345"])("preserves validation order for %s", async value => {
    const source = `const seen=[];const argument={valueOf(){seen.push('coerce');return 101}};
      try{return [(${value}).${method}(argument),seen]}
      catch(error){return [error.name,seen]}`;
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["NaN", "Infinity", "-Infinity"])("matches primitive range handling for %s", async value => {
    const source = `try{return (${value}).${method}(101)}catch(error){return error.name}`;
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it("rejects an invalid receiver before argument coercion", async () => {
    const source = `const seen=[];const argument={valueOf(){seen.push('coerce');return 2}};
      try{(1).${method}.call('1',argument)}catch(error){return [error.name,seen]}`;
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it("preserves a RangeError thrown by the guest hook", async () => {
    const source = `const marker=new RangeError('guest hook');
      try{(1).${method}({valueOf(){throw marker}})}
      catch(error){return [error===marker,error.name,error.message]}`;
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it("ignores extra arguments and preserves omitted/undefined arguments", async () => {
    const source = `const unused={valueOf(){throw 'unused'}};
      return [(12.345).${method}(2,unused),(12.345).${method}(),(12.345).${method}(undefined)]`;
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});

describe("Number formatting budgets", () => {
  it("retains an argument needed by the fallback hook after its binding is cleared", async () => {
    const source = `let argument={payload:'x'.repeat(4000),
      valueOf:()=>{argument=null;const temporary='y'.repeat(4000);return {}},
      toString(){return '2'}};return (12.345).toFixed(argument)`;
    await expect(run(source, { budget: new Budget({ dataSize: 6000 }) })).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect(await run(source, { budget: new Budget({ dataSize: 14000 }) })).toMatchObject({ ok: true, returnValue: "12.35" });
  });

  it.each([false, true])("releases its retained argument after coercion failure=%s", async fail => {
    const budget = new Budget();
    const observed: boolean[] = [];
    const argument = { valueOf: createSandboxClosure({ call: () => 2 }) };
    const execution = callNumberMethod(12.345, "toFixed", [argument], budget, {
      stack: [], thisValue: undefined,
      invokeClosure: async () => {
        observed.push([...budget.retainedValues()].includes(argument));
        if (fail) throw new Error("coercion failed");
        return 2;
      }
    });
    if (fail) await expect(execution).rejects.toThrow("coercion failed");
    else expect(await execution).toBe("12.35");
    expect(observed).toEqual([true]);
    expect([...budget.retainedValues()]).toEqual([]);
  });

  it("keeps step exhaustion fatal inside a coercion hook", async () => {
    const source = "try{return (1).toFixed({valueOf(){while(true){}return 2}})}catch(error){return 'caught'}";
    await expect(run(source, { budget: new Budget({ maxSteps: 100 }) })).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  });
});
