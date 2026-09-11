import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { createRealm, run } from "../core.js";
import { Budget } from "./budget.js";

const cases = [
  ["assignment value during key coercion", "({})[{toString:allocate}]='b'.repeat(2000)"],
  ["earlier call argument", "f('b'.repeat(2000),allocate())"],
  ["earlier array element", "['b'.repeat(2000),allocate()]"],
  ["earlier object field", "({first:'b'.repeat(2000),second:allocate()})"],
  ["binary left operand", "'b'.repeat(2000)+allocate()"],
  ["earlier template substitution", "`${'b'.repeat(2000)}${allocate()}`"],
  ["computed object key", "({['b'.repeat(2000)]:allocate()})"],
  ["spread call argument", "f(...['b'.repeat(2000)],allocate())"],
  ["spread array element", "[...['b'.repeat(2000)],allocate()]"],
  ["earlier constructor argument", "new Array('b'.repeat(2000),allocate())"],
  ["earlier tagged template substitution", "f`${'b'.repeat(2000)}${allocate()}`"],
  ["accumulated spread iterator value", "[...g()]"],
  ["accumulated spread argument value", "f(...g())"],
  ["in operator right operand during key coercion", "({toString:allocate}) in ({payload:'b'.repeat(2000)})"],
  ["compound left value after its property is removed", "(function(){const o={x:'b'.repeat(2000)};o.x+=(delete o.x,allocate())})()"],
  ["compound right value during left coercion", "({x:{valueOf:allocate}}).x+='b'.repeat(2000)"],
  ["converted compound member key", "({})[{toString(){return 'b'.repeat(2000)}}]+=allocate()"]
];

const suspended = [
  ["array", "['b'.repeat(2000),yield 'pause']"],
  ["object", "({first:'b'.repeat(2000),second:yield 'pause'})"],
  ["call", "f('b'.repeat(2000),yield 'pause')"],
  ["binary", "'b'.repeat(2000)+(yield 'pause')"]
];

describe("intermediate operand lifetime", () => {
  it.each(suspended.flatMap(([name, expression]) => [false, true].map(fail => ({ name, expression, fail }))))(
    "releases abandoned $name state after run failure=$fail", async ({ expression, fail }) => {
      const budget = new Budget({ dataSize: 14000 });
      const source = `function f(a,b){return a.length}function* g(){return ${expression}}g().next();${fail ? "throw 'failed'" : "return true"}`;
      const execution = run(source, { budget });
      if (fail) await expect(execution).rejects.toThrow("failed");
      else expect(await execution).toMatchObject({ ok: true, returnValue: true });
      expect([...budget.retainedValues()]).toEqual([]);
      expect(() => budget.reset()).not.toThrow();
    }
  );

  it.each(suspended.flatMap(([name, expression]) => [false, true].map(resume => ({ name, expression, resume }))))(
    "retains suspended realm $name state until resume=$resume or close", async ({ expression, resume }) => {
      const budget = new Budget({ dataSize: 14000 });
      const realm = createRealm({ budget });
      try {
        expect(await realm.evaluate(`function f(a,b){return a.length}function* g(){return ${expression}}const gen=g();return gen.next()`))
          .toMatchObject({ ok: true, returnValue: { value: "pause", done: false } });
        expect([...budget.retainedValues()].length).toBeGreaterThan(0);
        if (resume) {
          expect(await realm.evaluate("return gen.next('ok')")).toMatchObject({ ok: true, returnValue: { done: true } });
          expect([...budget.retainedValues()]).toEqual([]);
        }
      } finally {
        await realm.close();
      }
      expect([...budget.retainedValues()]).toEqual([]);
    }
  );

  it.each([
    ["array", "['b'.repeat(2000),await argument()]"],
    ["template", "`${'b'.repeat(2000)}${await argument()}`"],
    ["tagged template", "tag`${'b'.repeat(2000)}${await argument()}`"]
  ].flatMap(([name, expression]) => [false, true].map(catches => ({ name, expression, catches }))))(
    "keeps prior $name values live during cancellation, guest catch=$catches", async ({ expression, catches }) => {
    const budget = new Budget({ dataSize: 6000 });
    const controller = new AbortController();
    const gate = Promise.withResolvers<number>();
    const reached = Promise.withResolvers<void>();
    const argument = catches ? "async function argument(){try{await pause()}catch(error){const temporary='y'.repeat(5000);return 0}}" : "async function argument(){return await pause()}";
    const execution = run(`${argument};function tag(parts,a,b){return a.length}return ${expression}`, { budget, signal: controller.signal,
      bindings: { pause: () => { reached.resolve(); return gate.promise; } } });
    void execution.catch(() => undefined);
    try {
      await reached.promise;
      expect([...budget.retainedValues()].length).toBeGreaterThan(0);
      controller.abort(new Error("cancelled"));
      if (catches) await expect(execution).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
      else await expect(execution).rejects.toThrow("cancelled");
      expect([...budget.retainedValues()]).toEqual([]);
    } finally {
      gate.resolve(1);
    }
  });

  it.each([
    "const seen=[];function f(x){seen.push(x);return x}const a=[,f(1),...[f(2)]];return [a.length,0 in a,a[1],a[2],seen]",
    "const seen=[];function key(){seen.push('key');return 'x'}function value(){seen.push('value');return 2}const o={a:1,[key()]:value(),...{b:3}};return [o,seen]",
    "const seen=[];function value(x){seen.push(x);return x}function f(a,b){seen.push('call');return a+b}return [f(value(1),value(2)),seen]",
    "const seen=[];function value(x){seen.push(x);return x}return [`a${value(1)}b${value(2)}c`,seen]",
    "function tag(parts,a,b){return [parts,parts.raw,a,b]}return tag`a${1}b${2}c`",
    "function* g(){yield 1;yield 2}return [...g(),3]"
  ])("preserves native expression order and results: %s", async source => {
    const expected = runInNewContext(`(()=>{'use strict';${source}})()`);
    const budget = new Budget();
    expect(await run(source, { budget })).toMatchObject({ ok: true, returnValue: expected });
    expect([...budget.retainedValues()]).toEqual([]);
  });

  it.each(cases)("retains %s during later evaluation", async (_name, expression) => {
    const source = `function allocate(){const temporary='y'.repeat(5000);throw 'allocated'}
      function f(a,b){return a.length}function* g(){yield 'b'.repeat(2000);allocate()}
      try{${expression}}catch(error){return error}`;
    const rejected = new Budget({ dataSize: 6000 });
    await expect(run(source, { budget: rejected })).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect([...rejected.retainedValues()]).toEqual([]);
    const accepted = new Budget({ dataSize: 14000 });
    expect(await run(source, { budget: accepted })).toMatchObject({ ok: true, returnValue: "allocated" });
    expect([...accepted.retainedValues()]).toEqual([]);
  });

  it.each([
    "({})[{toString:allocate}]=value",
    "f(value,allocate())",
    "[value,allocate()]"
  ])("already retains a bound value: %s", async expression => {
    const source = `const value='b'.repeat(2000);function allocate(){const temporary='y'.repeat(5000);throw 'allocated'}
      function f(a,b){return a.length}try{${expression}}catch(error){return error}`;
    await expect(run(source, { budget: new Budget({ dataSize: 6000 }) }))
      .rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
  });

  it("admits the later allocation when there is no earlier live value", async () => {
    expect(await run("function allocate(){const temporary='y'.repeat(5000);throw 'allocated'}try{allocate()}catch(error){return error}",
      { budget: new Budget({ dataSize: 6000 }) })).toMatchObject({ ok: true, returnValue: "allocated" });
  });
});
