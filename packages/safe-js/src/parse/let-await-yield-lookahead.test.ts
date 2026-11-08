import { expect, it } from "vitest";
import { parseDynamicFunction, parseEvalScript, parseModule } from "./parser.js";
import { lint } from "../lint/index.js";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each([
  "async function f(){ let\nawait 0; }",
  "function* f(){ let\nyield 0; }",
  "async function* f(){ let\nawait 0; }",
  "async function* f(){ let\nyield 0; }",
  "async function f(){ let/*\n*/await 0; }",
  "function* f(){ let\u2028yield 0; }"
])("does not insert a semicolon inside a lexical declaration: %s", source => {
  expect(() => new Function(source)).toThrow(SyntaxError);
  expect(() => parseEvalScript(source)).toThrow();
  expect(() => parseEvalScript('"use strict";' + source)).toThrow();
  expect(() => parseModule(source)).toThrow();
  expect(() => lint(source)).toThrow();
});

it.each([
  "function f(){ let\nawait = 3; return await; }",
  "function f(){ let\nyield = 3; return yield; }",
  "async function f(){ var let=1; let;\nawait 0; }",
  "function* f(){ var let=1; let;\nyield 0; }",
  'function f(){ var let=1; let\n"await"; }',
  'function f(){ var let=1; let\n"yield"; }'
])("preserves valid declarations and explicit semicolons: %s", source => {
  expect(() => new Function(source)).not.toThrow();
  expect(() => parseEvalScript(source)).not.toThrow();
});

it.each(["async", "generator", "async-generator"] as const)("checks dynamic %s bodies", kind => {
  const token = kind === "generator" ? "yield" : "await";
  expect(() => parseDynamicFunction(kind, "", `let\n${token} 0;`)).toThrow();
});

it("retains eval early errors, source and generator state across repeated replay", async () => {
  const source = `const trace=[];
    for(const text of ["async function f(){let\\nawait 0;}","function* f(){let\\nyield 0;}"]) {
      for(const compile of [Function("s","return eval(s)"),s=>(0,eval)(s),s=>Function(s)]) {
        try {compile("globalThis.marker=1;"+text);}
        catch(e){trace.push(e.name,e instanceof SyntaxError);}
        finally{trace.push("finally");}
      }
    }
    const make=(0,eval)("(function* make(){var let=3; let; yield let;})");
    const gen=make(); const first=gen.next(); await 0;
    return [trace,typeof globalThis.marker,first.value,gen.next().done,make.toString(),
      make.constructor.constructor("return typeof process+','+typeof require")()];`;
  const expected={ok:true,returnValue:[Array(6).fill(["SyntaxError",true,"finally"]).flat(),
    "undefined",3,true,"function* make(){var let=3; let; yield let;}","undefined,undefined"]};
  expect(lint(source).filter(d=>d.severity==="error")).toEqual([]);
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
