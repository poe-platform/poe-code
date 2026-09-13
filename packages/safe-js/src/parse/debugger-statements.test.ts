import { expect, it } from "vitest";
import { parseEvalScript, parseModule } from "./parser.js";
import { lint } from "../lint/index.js";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each([
  "debugger;",
  "while(false) debugger;",
  "if(true) debugger; else debugger;",
  "do debugger; while(false);",
  "label: debugger;",
  "debugger\n0;",
  "debugger/*\n*/0;",
  "debugger\u20280;",
  "function f(){debugger}",
  "debugger"
])("accepts debugger in statement positions: %s", source => {
  expect(() => new Function(source)).not.toThrow();
  expect(() => parseEvalScript(source)).not.toThrow();
  expect(() => parseEvalScript('"use strict";' + source)).not.toThrow();
  expect(() => parseModule(source)).not.toThrow();
  expect(lint(source).filter(d => d.severity === "error")).toEqual([]);
});

it.each([
  "(debugger);", "debugger 0;", "debugger/*comment*/0;",
  "debugger: 0;", "debu\\u0067ger;", "var debugger;",
  "if(true) debugger else 0;"
])("rejects invalid debugger syntax: %s", source => {
  expect(() => new Function(source)).toThrow(SyntaxError);
  expect(() => parseEvalScript(source)).toThrow();
  expect(() => parseModule(source)).toThrow();
  expect(() => lint(source)).toThrow();
});

it("preserves completion, saved source and host isolation across replay", async () => {
  const source = `const f = (0,eval)("(function* f(){debugger;yield 7;debugger;})");
    const gen=f(); const first=gen.next(); debugger; await 0;
    const trace=[]; try {debugger;throw 3;} catch(e){trace.push(e);} finally {debugger;trace.push(4);}
    return [eval("42;debugger;"),(0,eval)("43;debugger;"),
      Function("debugger;return 44;")(),first.value,gen.next().done,trace,f.toString(),
      f.constructor.constructor("debugger;return typeof process+','+typeof require")()];`;
  const expected = { ok:true, returnValue:[42,43,44,7,true,[3,4],
    "function* f(){debugger;yield 7;debugger;}","undefined,undefined"] };
  let pending=run(source);
  for(let cycle=0;cycle<3;cycle++) {
    const settled=pending.catch(error=>error);
    try {
      const saved=JSON.parse(await dump(pending));
      expect(await settled).toMatchObject(expected);
      pending=run(source,{snapshot:restore(saved,{source})});
    } finally {await settled;}
  }
  expect(await pending).toMatchObject(expected);
  const saved=JSON.parse(await dump(pending));
  expect(await run(source,{snapshot:restore(saved,{source})})).toMatchObject(expected);
});
