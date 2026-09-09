import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each([
  "class B{constructor(){this.x=7}}class C extends B{constructor(){return {later:eval('()=>super()')}}}const value=new C();await 0;return value.later().x",
  "class B{constructor(){this.x=7}}class C extends B{#y=9;constructor(){return {later:eval('()=>super()')}}get(){return this.#y}}const value=new C();await 0;return [value.later().get()]",
  "class B{constructor(){this.x=7}}class C extends B{constructor(){return eval('()=>super()')}}const later=new C();await 0;const first=later();try{later()}catch(e){return [first.x,e.name]}",
  "class B{get x(){return this.y}}class C extends B{y=7;get(){return eval('()=>super.x')}}const later=new C().get();await 0;return later()",
  "class B{set x(value){this.y=value}}class C extends B{get(){return eval('(value)=>super.x=value')}}const item=new C();const later=item.get();await 0;later(7);return item.y"
])("recovers the super environment captured by eval: %s", async source => {
  const expected: unknown = await runInNewContext(`(async function(){${source}})()`);
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    const snapshot = JSON.parse(await dump(pending));
    expect(await completed).toMatchObject({ ok: true, returnValue: expected });
    expect(await run(source, { snapshot: restore(snapshot, { source }) })).toMatchObject({
      ok: true, returnValue: expected
    });
  } finally {
    await completed;
  }
});
