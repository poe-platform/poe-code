import { expect, it } from "vitest";
import { parseEvalScript, parseModule } from "./parser.js";
import { lint } from "../lint/index.js";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each([
  "({}) = 1;",
  "([]) = [];",
  "(({})) = {};",
  "(() => ({}) = 1);",
  "(async () => ({}) = 1);",
  "let x; ([x]) = [1];"
])("rejects a parenthesized literal as a destructuring target: %s", source => {
  expect(() => new Function(source)).toThrow(SyntaxError);
  expect(() => parseEvalScript(source)).toThrow();
  expect(() => parseEvalScript('"use strict";' + source)).toThrow();
  expect(() => parseModule(source)).toThrow();
  expect(() => lint(source)).toThrow();
});

it.each([
  "let x; ({x} = {x:1});",
  "let x; ([x] = [1]);",
  "let x; (x) = 1;",
  "let x={}; (x.value) = 1;",
  "([]).value = 1;",
  "({}).value = 1;",
  "let x; ({value:(x)} = {value:1});",
  "let x; [(x)] = [1];"
])("preserves valid grouped assignments: %s", source => {
  expect(() => new Function(source)).not.toThrow();
  expect(() => parseEvalScript(source)).not.toThrow();
  expect(() => parseModule(source)).not.toThrow();
});

it("rejects before eval side effects and preserves grouped targets across replay", async () => {
  const source = `const trace=[];
    for (const compile of [s=>eval(s), s=>(0,eval)(s), s=>Function(s)]) {
      try { compile("globalThis.marker=1; ({})=1;"); }
      catch(e) { trace.push(e.name, e instanceof SyntaxError); }
      finally { trace.push("finally"); }
    }
    const make = eval("(function make(){ let x; ([x]=[7]); return ()=>x; })");
    const read=make();
    await 0;
    return [read(), make.toString(), trace, typeof globalThis.marker,
      read.constructor("return typeof process + ',' + typeof require")()];`;
  const expected = {ok:true, returnValue:[7,
    "function make(){ let x; ([x]=[7]); return ()=>x; }",
    Array(3).fill(["SyntaxError",true,"finally"]).flat(), "undefined", "undefined,undefined"]};
  expect(lint(source).filter(d => d.severity === "error")).toEqual([]);
  let pending = run(source);
  for (let cycle=0; cycle<3; cycle++) {
    const settled = pending.catch(error => error);
    try {
      const saved = JSON.parse(await dump(pending));
      expect(await settled).toMatchObject(expected);
      pending = run(source, {snapshot:restore(saved, {source})});
    } finally { await settled; }
  }
  expect(await pending).toMatchObject(expected);
  const saved = JSON.parse(await dump(pending));
  expect(await run(source, {snapshot:restore(saved, {source})})).toMatchObject(expected);
});
