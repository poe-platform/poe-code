import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { run } from "../../core.js";
import { Budget } from "../budget.js";
import { createSandboxClosure, isSandboxClosure } from "../values.js";
import { getStringMember } from "./string.js";

const methods = [
  ["at", "1"], ["charAt", "1"], ["charCodeAt", "1"], ["codePointAt", "1"],
  ["concat", "'!'"], ["endsWith", "'r'"], ["includes", "'tt'"], ["indexOf", "'t'"],
  ["isWellFormed", ""], ["lastIndexOf", "'t'"], ["localeCompare", "'abc'"],
  ["match", "/[a-z]/g"], ["matchAll", "/[a-z]/g"], ["normalize", "'NFC'"],
  ["padEnd", "12,'-'"], ["padStart", "12,'-'"], ["repeat", "2"],
  ["replace", "'t','T'"], ["replaceAll", "'t','T'"], ["slice", "1,4"],
  ["search", "/t/"], ["split", "'t'"], ["startsWith", "'O'"], ["substr", "1,2"],
  ["substring", "1,3"], ["toLowerCase", ""], ["toUpperCase", ""],
  ["toWellFormed", ""], ["trim", ""], ["trimEnd", ""], ["trimStart", ""]
] as const;

describe.each([
  ["string", "' Otter '"],
  ["object", "{toString(){seen.push('receiver');return ' Otter '}}"],
  ["number", "12345"],
  ["boolean", "true"],
  ["array", "[' Otter ']"]
])("String methods borrowed onto %s receivers", (_kind, receiver) => {
  it.each(methods)("%s uses and coerces the call receiver", async (method, args) => {
    const call = `'lookup'.${method}.call(receiver${args ? `,${args}` : ""})`;
    const result = method === "matchAll" ? `Array.from(${call}).map(match=>match[0])` : call;
    const source = `const seen=[];const receiver=${receiver};return [${result},seen]`;
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});

describe.each(["null", "undefined"])("String methods reject %s receivers", receiver => {
  it.each(methods)("%s rejects before running the method", async (method, args) => {
    const source = `try{return 'lookup'.${method}.call(${receiver}${args ? `,${args}` : ""})}
      catch(error){return error.name}`;
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});

describe("String direct-call controls", () => {
  it.each(methods)("%s keeps direct behavior", async (method, args) => {
    const call = `' Otter '.${method}(${args})`;
    const source = `return ${method === "matchAll" ? `Array.from(${call}).map(match=>match[0])` : call}`;
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});

describe("String receiver invocation boundaries", () => {
  it.each([
    "return ['lookup'.slice.apply('other',[1,4]),'lookup'.trim.bind(' other ')()]",
    "const method='lookup'.slice;try{return method(1)}catch(error){return error.name}",
    "const seen=[];const receiver={toString(){seen.push(this===receiver);return 'other'}};return ['lookup'.slice.call(receiver,1),seen]",
    "const seen=[];const receiver={toString(){seen.push('string');return {}},valueOf(){seen.push('value');return 123}};return ['lookup'.slice.call(receiver,1),seen]",
    "const marker={id:1};try{'lookup'.slice.call({toString(){throw marker}},1)}catch(error){return error===marker}",
    "const seen=[];const receiver={async toString(){seen.push('string');return 'ignored'},valueOf(){seen.push('value');return 'other'}};return ['lookup'.slice.call(receiver,1),seen]",
    "const seen=[];const receiver={toString(){seen.push('coerce');return 'other'}};const argument=()=>{seen.push('argument');return 1};return ['lookup'.slice.call(receiver,argument()),seen]",
    "const seen=[];const receiver={toString(){seen.push('coerce');return 'otto'}};const result='lookup'.replaceAll.call(receiver,'t',function(match,index,input){seen.push([this===undefined,match,index,input]);return 'T'});return [result,seen]",
    "const seen=[];const receiver={toString(){seen.push('coerce');return 'otto'}};const result='lookup'.replace.call(receiver,/t/g,(match,index,input)=>{seen.push([match,index,input]);return 'T'});return [result,seen]",
    "const receiver=Object.create({toString(){return ' other '}});return 'lookup'.trim.call(receiver)",
    "function receiver(){}receiver.toString=()=> ' other ';return 'lookup'.trim.call(receiver)"
  ])("matches native behavior: %s", async source => {
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});

describe("String receiver budgets", () => {
  it("retains a receiver needed by fallback coercion after its binding is cleared", async () => {
    const source = `let receiver={payload:'x'.repeat(4000),
      toString:()=>{receiver=null;const temporary='y'.repeat(4000);return {}},
      valueOf(){return ' other '}};return 'lookup'.trim.call(receiver)`;
    await expect(run(source, { budget: new Budget({ dataSize: 6000 }) })).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect(await run(source, { budget: new Budget({ dataSize: 14000 }) })).toMatchObject({ ok: true, returnValue: "other" });
  });

  it.each([false, true])("releases the retained receiver after coercion failure=%s", async fail => {
    const budget = new Budget();
    const observed: boolean[] = [];
    const receiver = { toString: createSandboxClosure({ call: () => " other " }) };
    const method = getStringMember("lookup", "trim", budget);
    if (!isSandboxClosure(method)) throw new Error("Expected a String method.");
    const execution = method.call([], {
      stack: [], thisValue: receiver,
      invokeClosure: async () => {
        observed.push([...budget.retainedValues()].includes(receiver));
        if (fail) throw new Error("coercion failed");
        return " other ";
      }
    });
    if (fail) await expect(execution).rejects.toThrow("coercion failed");
    else expect(await execution).toBe("other");
    expect(observed).toEqual([true]);
    expect([...budget.retainedValues()]).toEqual([]);
  });

  it.each([
    "'lookup'.trim.call({toString(){while(true){}return 'other'}})",
    "'lookup'.replace.call('other','o',()=>{while(true){}return 'O'})"
  ])("keeps step exhaustion fatal: %s", async expression => {
    const source = `try{return ${expression}}catch(error){return 'caught'}`;
    await expect(run(source, { budget: new Budget({ maxSteps: 100 }) })).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  });
});
