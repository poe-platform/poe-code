import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { Budget, createRealm, run } from "../core.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

describe("generator template substitutions", () => {
  it.each([
    "function* g(){return `before ${yield 'pause'} after`}const gen=g();return [gen.next(),gen.next('ok')]",
    "function tag(parts,value){return [parts,parts.raw,value]}function* g(){return tag`before ${yield 'pause'} after`}const gen=g();return [gen.next(),gen.next(7)]",
    "function* g(){return `${`${yield 'pause'}`}`}const gen=g();return [gen.next(),gen.next('ok')]",
    "function* g(){return `${yield}`}const gen=g();return [gen.next(),gen.next(7)]",
    "function* g(){return `${yield* [1,2]}`}const gen=g();return [gen.next(),gen.next(),gen.next()]",
    "const seen=[];function tag(parts,a,b){seen.push('tag');return [parts,a,b]}function* g(){return tag`a${yield 'first'}b${yield 'second'}c`}const gen=g();const a=gen.next();const b=gen.next(1);const before=seen.slice();return [a,b,before,gen.next(2),seen]",
    "const seen=[];function* g(){try{return `${yield 'pause'}`}catch(error){return 'caught:'+error}finally{seen.push('finally')}}const gen=g();return [gen.next(),gen.throw('sent'),seen]",
    "const seen=[];function tag(parts,value){seen.push('tag');return value}function* g(){try{return tag`${yield 'pause'}`}finally{seen.push('finally')}}const gen=g();return [gen.next(),gen.return(9),seen]"
  ])("preserves suspension, completion and order: %s", async (source) => {
    const expected = runInNewContext(`(()=>{'use strict';${source}})()`);
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });

  it.each(["`${'b'.repeat(2000)}${yield 'pause'}`", "tag`${'b'.repeat(2000)}${yield 'pause'}`"])(
    "releases abandoned template state: %s", async (expression) => {
      const budget = new Budget({ dataSize: 14000 });
      expect(await run(`function tag(parts,a,b){return a.length}function* g(){return ${expression}}g().next();return true`, { budget }))
        .toMatchObject({ ok: true, returnValue: true });
      expect([...budget.retainedValues()]).toEqual([]);
      expect(() => budget.reset()).not.toThrow();
    }
  );

  it.each([false, true])("keeps template state across realm calls until resume=%s or disposal", async (resume) => {
    const budget = new Budget({ dataSize: 14000 });
    const realm = createRealm({ budget });
    try {
      expect(await realm.evaluate("function* g(){return `${'b'.repeat(2000)}${yield 'pause'}`}const gen=g();return gen.next()"))
        .toMatchObject({ ok: true, returnValue: { value: "pause", done: false } });
      expect([...budget.retainedValues()].length).toBeGreaterThan(0);
      if (resume) {
        expect(await realm.evaluate("return gen.next('ok').value.length"))
          .toMatchObject({ ok: true, returnValue: 2002 });
        expect([...budget.retainedValues()]).toEqual([]);
      }
    } finally {
      await realm.close();
    }
    expect([...budget.retainedValues()]).toEqual([]);
  });

  it.each(["`${'b'.repeat(2000)}${yield 'pause'}`", "tag`${'b'.repeat(2000)}${yield 'pause'}`"])(
    "accounts for the suspended template during a later allocation: %s", async (expression) => {
      for (const dataSize of [6000, 14000]) {
        const budget = new Budget({ dataSize });
        const realm = createRealm({ budget });
        try {
          expect(await realm.evaluate(`function tag(parts,a,b){return a.length}function* g(){return ${expression}}const gen=g();return gen.next()`))
            .toMatchObject({ ok: true, returnValue: { value: "pause", done: false } });
          const allocation = realm.evaluate("try{(function(){const temporary='y'.repeat(5000);throw temporary.length})()}catch(result){return result}");
          if (dataSize === 6000) await expect(allocation).rejects.toMatchObject({ code: "budgetExceeded", budget: "dataSize" });
          else expect(await allocation).toMatchObject({ ok: true, returnValue: 5000 });
        } finally {
          await realm.close();
        }
        expect([...budget.retainedValues()]).toEqual([]);
      }
    }
  );

  it.each(["`${yield 'first'}:${yield 'second'}`", "tag`${yield 'first'}:${yield 'second'}`"])(
    "restores a suspended template checkpoint: %s", async (expression) => {
      const source = `function tag(parts,a,b){return [a,b]}function* g(){return ${expression}}const gen=g();return [gen.next(),gen.next('a'),gen.next('b')]`;
      const expected = runInNewContext(`(()=>{'use strict';${source}})()`);
      const execution = run(source);
      const snapshot = JSON.parse(await dump(execution));
      expect(snapshot.bindings.gen).toMatchObject({ kind: "generator", state: "suspended" });
      expect(snapshot.pendingAwaits).toHaveLength(1);
      expect(snapshot.pendingAwaits[0].span.start.offset).toBe(source.indexOf("yield 'first'"));
      expect(await execution).toMatchObject({ ok: true, returnValue: expected });
      expect(await run(source, { snapshot: restore(snapshot, { source }) }))
        .toMatchObject({ ok: true, returnValue: expected });
    }
  );
});
