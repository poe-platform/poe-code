import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { dump } from "../dump.js";
import { run } from "../run.js";

it.each(["next", "return", "throw", "iterate"])(
  "keeps executing-generator %s errors catchable without completing the generator",
  async method => {
    const operation = method === "iterate" ? "for(const value of g) t.push(value)" : `g.${method}('ignored')`;
    const source = `const t=[];function* f(){
      try{t.push('body');${operation}}catch(e){t.push(e instanceof TypeError)}
      finally{t.push('finally')}
      yield 'alive';return 'done'
    }const g=f();const first=g.next();t.push(first.value,first.done);
    const last=g.next();t.push(last.value,last.done);return t`;
    const expected = ["body", true, "finally", "alive", false, "done", true];
    expect(runInNewContext(`(()=>{${source}})()`)).toEqual(expected);
    const original = await run(source);
    expect(original).toMatchObject({ ok: true, returnValue: expected });
    expect(await run(source, { snapshot: JSON.parse(await dump(original)) }))
      .toMatchObject({ ok: true, returnValue: expected });
  }
);
