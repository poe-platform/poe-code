import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, createRealm, run } from "../core.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

// ECMAScript 2026 sections 13.2.8.6 and 7.1.17 require string-hint ToPrimitive
// for ordinary substitutions; tagged substitutions retain value identity.
describe("ordinary template substitution coercion", () => {
  it.each([
    "return `${{}}`",
    "const seen=[];const result=`${{toString(){seen.push('string');return 'ok'}}}`;return [result,seen]",
    "const seen=[];const result=`${{toString(){seen.push('string');return {}},valueOf(){seen.push('value');return 7}}}`;return [result,seen]",
    "return `${Object.create({toString(){return 'inherited'}})}`",
    "return `${/a/g}`",
    "return `${new Map()}`",
    "return `${new Set()}`",
    "return `${new Error('x')}`",
    "return `${(function*(){yield 1})()}`",
    "const a=[1,2];a.toString=()=> 'custom';return `${a}`",
    "const marker={};try{return `${{toString(){throw marker}}}`}catch(error){return error===marker}",
    "const seen=[];const a={toString(){seen.push('a');return 'A'}};const b={toString(){seen.push('b');return 'B'}};return [`${a}${b}`,seen]",
    "const seen=[];const value={async toString(){seen.push('string');return 'ignored'},valueOf(){seen.push('value');return 7}};return [`${value}`,seen]",
    "const seen=[];const value={toString:function*(){seen.push('wrong');yield 1},valueOf(){seen.push('value');return 7}};return [`${value}`,seen]",
    "const seen=[];const value={toString(){seen.push('string');return {}},valueOf(){seen.push('value');return {}}};try{return `${value}${seen.push('wrong')}`}catch(error){return [error.name,seen]}",
    "const seen=[];const value={toString(){seen.push('string');throw 'marker'}};try{return `${value}${seen.push('wrong')}`}catch(error){return [error,seen]}",
    "const seen=[];const value={toString(){seen.push(this.name);return this.name},name:'original'};function next(){value.name='changed';seen.push('next');return 1}return [`${value}:${next()}`,seen]",
    "return `${{toString:null,valueOf(){return 7}}}`",
    "return `${null}|${undefined}|${false}|${-0}|${1.25}`",
    "return `${[1,2]}`",
    "return `${new Date(NaN)}`",
    "return `${Promise.resolve(1)}`",
    "try{return `${Object.create(null)}`}catch(error){return error.name}",
    "const value={toString(){throw 'wrong'}};function tag(parts,sub){return sub===value}return tag`${value}`"
  ])("preserves specified string conversion and order: %s", async source => {
    const expected = runInNewContext(`(()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each([
    "`${'b'.repeat(2000)}${{toString:allocate}}`",
    "`${{payload:'b'.repeat(2000),toString:allocate}}`",
    "`${['b'.repeat(2000),{toString:allocate}]}`",
    "`${[{toString:allocate},'b'.repeat(2000)]}`",
    "`${(function(){const error=new Error();error.name='b'.repeat(2000);error.message={toString:allocate};return error})()}`",
    "`${[{toString(){return 'b'.repeat(2000)}},{toString:allocate}]}`",
    "`${(function(){const error=new Error();error.name={toString(){return 'b'.repeat(2000)}};error.message={toString:allocate};return error})()}`"
  ])("retains the prefix and input while coercion runs: %s", async expression => {
    const source = `function allocate(){const temporary='y'.repeat(5000);throw 'allocated'}try{return ${expression}}catch(error){return error}`;
    const rejected = new Budget({ dataSize: 6000 });
    await expect(run(source, { budget: rejected })).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
    expect([...rejected.retainedValues()]).toEqual([]);
    const accepted = new Budget({ dataSize: 14000 });
    expect(await run(source, { budget: accepted })).toMatchObject({ ok: true, returnValue: "allocated" });
    expect([...accepted.retainedValues()]).toEqual([]);
  });

  it("releases the converted input before the next substitution", async () => {
    const budget = new Budget({ dataSize: 6000 });
    expect(await run("function next(){const temporary='y'.repeat(5000);throw 'allocated'}try{return `${{payload:'b'.repeat(5000),toString(){return ''}}}${next()}`}catch(error){return error}", { budget }))
      .toMatchObject({ ok: true, returnValue: "allocated" });
    expect([...budget.retainedValues()]).toEqual([]);
  });

  it("does not await an async coercion hook's returned promise", async () => {
    const source = "const seen=[];const value={async toString(){seen.push('prefix');await 0;seen.push('resumed');return 'wrong'},valueOf(){seen.push('fallback');return 7}};const text=`${value}`;seen.push('after');await 0;return [text,seen]";
    const expected = await runInNewContext(`(async()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["throw 'marker'", "return {}"])("releases an input after failed conversion: %s", async body => {
    const budget = new Budget({ dataSize: 6000 });
    const source = `try{\`\${{payload:'b'.repeat(5000),toString(){${body}},valueOf(){return {}}}}\`}catch(error){}
      function next(){const temporary='y'.repeat(5000);throw 'allocated'}try{next()}catch(result){return result}`;
    expect(await run(source, { budget })).toMatchObject({ ok: true, returnValue: "allocated" });
    expect([...budget.retainedValues()]).toEqual([]);
  });

  it("coerces a sent generator value after restoring a suspended template", async () => {
    const source = "const seen=[];function* g(){return `prefix:${yield 'pause'}`}const gen=g();const first=gen.next();const last=gen.next({toString(){seen.push('hook');return 'done'}});return [first,last,seen]";
    const expected = runInNewContext(`(()=>{'use strict';${source}})()`);
    const execution = run(source);
    const snapshot = JSON.parse(await dump(execution));
    expect(snapshot.bindings.gen).toMatchObject({ kind: "generator", state: "suspended" });
    expect(snapshot.pendingAwaits[0].span.start.offset).toBe(source.indexOf("yield 'pause'"));
    expect(await execution).toMatchObject({ ok: true, returnValue: expected });
    expect(await run(source, { snapshot: restore(snapshot, { source }) })).toMatchObject({ ok: true, returnValue: expected });
  });

  it("coerces values and releases temporary roots across realm evaluations", async () => {
    const budget = new Budget();
    const realm = createRealm({ budget });
    try {
      expect(await realm.evaluate("const value={name:'first',toString(){return this.name}};return `${value}`"))
        .toMatchObject({ ok: true, returnValue: "first" });
      expect([...budget.retainedValues()]).toEqual([]);
      expect(await realm.evaluate("value.name='second';return `${value}`"))
        .toMatchObject({ ok: true, returnValue: "second" });
      expect([...budget.retainedValues()]).toEqual([]);
    } finally {
      await realm.close();
    }
    expect([...budget.retainedValues()]).toEqual([]);
  });
});
