import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, createRealm, run } from "../../core.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { callStringMethod } from "./string.js";

// ECMAScript 2026 section 22.1.3.5 converts the receiver, then each argument
// in order, propagating a failed conversion before visiting the next argument.
describe("String concat argument conversion", () => {
  it("accounts for the result even when no arguments are supplied", async () => {
    await expect(async () => await callStringMethod("text", "concat", [], new Budget({ stringLength: 2 })))
      .rejects.toMatchObject({ code: "budgetExceeded", budget: "stringLength" });
  });

  it.each([
    "return 'x'.concat({toString(){return 'guest'}})",
    "return 'x'.concat({toString(){return {}},valueOf(){return 7}})",
    "return ''.concat(Object.create({toString(){return 'inherited'}}))",
    "const seen=[];const result='x'.concat({toString(){seen.push('a');return 'A'}},{toString(){seen.push('b');return 'B'}});return [result,seen]",
    "const marker={id:1};try{'x'.concat({toString(){throw marker}})}catch(error){return error===marker}",
    "const seen=[];try{''.concat({toString(){seen.push('first');throw 'marker'}},{toString(){seen.push('wrong');return 'last'}})}catch(error){return [error,seen]}",
    "const seen=[];const value={toString(){seen.push('string');return {}},valueOf(){seen.push('value');return {}}};try{''.concat(value)}catch(error){return [error.name,seen]}",
    "return 'x'.concat({})",
    "return 'x'.concat(/a/g,new Map(),new Set(),new Error('message'))",
    "return 'x'.concat(null,undefined,3,true,['a','b'])",
    "return 'x'.concat()",
    "const array=[];array.push(array);return 'x'.concat(array)",
    "try{return ''.concat(Object.create(null))}catch(error){return error.name}",
    "const seen=[];const value={async toString(){seen.push('prefix');return 'ignored'},valueOf(){seen.push('fallback');return 7}};return [''.concat(value),seen]",
    "const seen=[];const value={toString:function*(){seen.push('wrong');yield 1},valueOf(){seen.push('fallback');return 7}};return [''.concat(value),seen]",
    "const seen=[];const receiver={toString(){seen.push('receiver');return 'R'}};const value={toString(){seen.push('argument');return 'A'}};return [''.concat.call(receiver,value),seen]",
    "const seen=[];const value={toString(){seen.push('wrong');return 'A'}};try{''.concat.call(null,value)}catch(error){return [error.name,seen]}",
    "const value={toString(){return 'A'}};return [''.concat.apply('R',[value]),''.concat.bind('R',value)('B')]",
    "function value(){}value.toString=()=> 'custom';return ''.concat(value)",
    "const seen=[];const value={toString(){seen.push('coerce');return 'A'}};function argument(){seen.push('evaluate');return value}return [''.concat(argument()),seen]",
    "const second={toString(){return this.name},name:'before'};const first={toString(){second.name='after';return 'first'}};return ''.concat(first,second)",
    "return ''.concat({toString:null,valueOf(){return 7}})"
  ])("matches specified conversion and ordering: %s", async source => {
    const expected = runInNewContext(`(()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it("does not await an async hook's returned promise", async () => {
    const source = "const seen=[];const value={async toString(){seen.push('prefix');await 0;seen.push('resumed');return 'wrong'},valueOf(){seen.push('fallback');return 7}};const text=''.concat(value);seen.push('after');await 0;return [text,seen]";
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each([
    "'b'.repeat(2000).concat({toString:allocate})",
    "''.concat({toString:first},{toString:allocate})",
    "''.concat.call({toString:first},{toString:allocate})",
    "''.concat([{toString:first},{toString:allocate}])",
    "''.concat((function(){const error=new Error();error.name={toString:first};error.message={toString:allocate};return error})())"
  ])("retains intermediate text across coercion: %s", async expression => {
    const source = `function first(){return 'b'.repeat(2000)}function allocate(){const temporary='y'.repeat(5000);throw 'allocated'}try{return ${expression}}catch(error){return error}`;
    const rejected = new Budget({ dataSize: 6000 });
    await expect(run(source, { budget: rejected })).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect([...rejected.retainedValues()]).toEqual([]);
    const accepted = new Budget({ dataSize: 14000 });
    expect(await run(source, { budget: accepted })).toMatchObject({ ok: true, returnValue: "allocated" });
    expect([...accepted.retainedValues()]).toEqual([]);
  });

  it("allows the later allocation with an empty converted prefix", async () => {
    const budget = new Budget({ dataSize: 6000 });
    const source = "function first(){return ''}function allocate(){const temporary='y'.repeat(5000);throw 'allocated'}try{return ''.concat({toString:first},{toString:allocate})}catch(error){return error}";
    expect(await run(source, { budget })).toMatchObject({ ok: true, returnValue: "allocated" });
    expect([...budget.retainedValues()]).toEqual([]);
  });

  it("releases intermediate text after caught conversion failure", async () => {
    const budget = new Budget({ dataSize: 6000 });
    const source = "function first(){return 'b'.repeat(2000)}function stop(){throw 'stop'}function next(){const temporary='y'.repeat(5000);throw 'allocated'}try{''.concat({toString:first},{toString:stop})}catch(error){}try{next()}catch(error){return error}";
    expect(await run(source, { budget })).toMatchObject({ ok: true, returnValue: "allocated" });
    expect([...budget.retainedValues()]).toEqual([]);
  });

  it("keeps step exhaustion inside argument conversion fatal", async () => {
    await expect(run("try{return ''.concat({toString(){while(true){}return ''}})}catch(error){return 'caught'}", { budget: new Budget({ maxSteps: 100 }) }))
      .rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  });

  it("restores a checkpoint captured inside a coercion hook", async () => {
    const source = "const seen=[];function* g(){yield 'A';return 'B'}const gen=g();const value={toString(){seen.push('hook');return gen.next().value}};return ['prefix'.concat(value,value),seen]";
    const expected = runInNewContext(`(()=>{'use strict';${source}})()`);
    const execution = run(source);
    const snapshot = JSON.parse(await dump(execution));
    expect(snapshot.bindings.gen).toMatchObject({ kind: "generator", state: "suspended" });
    expect(snapshot.pendingAwaits[0].span.start.offset).toBe(source.indexOf("yield 'A'"));
    expect(await execution).toMatchObject({ ok: true, returnValue: expected });
    expect(await run(source, { snapshot: restore(snapshot, { source }) })).toMatchObject({ ok: true, returnValue: expected });
  });

  it("coerces argument values across persistent realm evaluations", async () => {
    const budget = new Budget();
    const realm = createRealm({ budget });
    try {
      expect(await realm.evaluate("const value={text:'first',toString(){return this.text}};return ''.concat(value)"))
        .toMatchObject({ ok: true, returnValue: "first" });
      expect([...budget.retainedValues()]).toEqual([]);
      expect(await realm.evaluate("value.text='second';return ''.concat(value)"))
        .toMatchObject({ ok: true, returnValue: "second" });
      expect([...budget.retainedValues()]).toEqual([]);
    } finally {
      await realm.close();
    }
    expect([...budget.retainedValues()]).toEqual([]);
  });
});
