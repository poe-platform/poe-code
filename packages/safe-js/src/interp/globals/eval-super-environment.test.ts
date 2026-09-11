import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  "class B{constructor(x){this.x=x}}class C extends B{constructor(){eval('super(7)')}}return new C().x",
  "class B{}class C extends B{x=7;constructor(){eval('super()')}}return new C().x",
  "class B{}class C extends B{#x=7;constructor(){eval('super()')}get(){return this.#x}}return new C().get()",
  "class B{}class C extends B{constructor(){eval('super()');try{eval('super()')}catch(e){this.error=e.name}}}return new C().error",
  "class B{constructor(x){this.x=x}}class C extends B{constructor(x=eval('super(7)')){}}return new C().x",
  "class B{get x(){return this.y}}class C extends B{y=7;get(){return eval('super.x')}}return new C().get()",
  "class B{get x(){return this.y}}class C extends B{y=7;get(){return eval('(()=>super.x)()')}}return new C().get()",
  "class B{set x(v){this.y=v}}class C extends B{get(){eval('super.x=7');return this.y}}return new C().get()",
  "class B{constructor(){this.x=3}}class C extends B{constructor(){eval('(()=>super())()')}}return new C().x",
  "class B{}class C extends B{constructor(){eval('var f=()=>super()');f()}}return new C() instanceof B"
])("preserves the constructor/method environment in eval: %s", async body => {
  const source = `try{${body}}catch(e){return ['error',e.name]}`;
  const expected: unknown = runInNewContext(`(function(){${source}})()`);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});
