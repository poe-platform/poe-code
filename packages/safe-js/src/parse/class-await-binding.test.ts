import { Script } from "node:vm";
import { expect, it } from "vitest";
import { parseEvalScript } from "./parser.js";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each([
  "class await {}", String.raw`class aw\u0061it {}`,
  "(class await {})", "function f(){ class await {} }",
  "class C {static { (() => { class await {} }); }}"
])("accepts contextual class names in Script code: %s", source => {
  for (const prefix of ["", '"use strict";']) {
    expect(() => new Script(prefix + source)).not.toThrow();
    expect(() => parseEvalScript(prefix + source)).not.toThrow();
  }
});

it.each([
  "async function f(){class await {}}",
  "class C {static {class await {}}}", "class yield {}", "class eval {}"
])("preserves forbidden class bindings: %s", source => {
  expect(() => new Script(source)).toThrow(SyntaxError);
  expect(() => parseEvalScript(source)).toThrow();
});

it("retains contextual class source and identity across replay", async () => {
  const source = `const C=(0,eval)("(class await {})");const x=new C();await 0;
    return [x instanceof C,C.name,C.toString(),
      Function("return class await {}")().name,
      C.constructor("return typeof process+','+typeof require")()];`;
  const expected={ok:true,returnValue:[true,"await","class await {}","await","undefined,undefined"]};
  let pending=run(source);
  for(let i=0;i<3;i++){
    const settled=pending.catch(error=>error);
    try{const saved=JSON.parse(await dump(pending));expect(await settled).toMatchObject(expected);
      pending=run(source,{snapshot:restore(saved,{source})});}finally{await settled;}
  }
  expect(await pending).toMatchObject(expected);
  const saved=JSON.parse(await dump(pending));
  expect(await run(source,{snapshot:restore(saved,{source})})).toMatchObject(expected);
});
