import { expect, it } from "vitest";
import { parseDynamicFunction } from "./parser.js";
import { run } from "../run.js";

it.each([
  "while(false) BODY", "for(;false;) BODY", "do BODY while(false)",
  "for(var x in {}) BODY", "for(var x of []) BODY", "if(true) BODY", "with({}) BODY"
])("matches native declaration restrictions in %s", template => {
  for (const declaration of ["function f(){}", "async function f(){}", "function* f(){}", "class C{}", "let x=3;", "const x=3;"]) {
    const source = template.replace("BODY", declaration);
    let valid = true;
    try { Function(source); } catch { valid = false; }
    if (valid) expect(() => parseDynamicFunction("normal", "", source)).not.toThrow();
    else expect(() => parseDynamicFunction("normal", "", source)).toThrow();
  }
});

it.each([
  "if(true) function f(){return 3}return f()",
  "if(false){}else function f(){return 3}return f()",
  "for(var i=0;i<1;i++) var x=3;return x",
  "for(var i=0;i<1;i++){let x=3;function f(){return x}}return f()"
])("preserves valid statement bodies: %s", async source => {
  const expected: unknown = Function(source)();
  expect(() => parseDynamicFunction("normal", "", source)).not.toThrow();
  expect(await run(`return Function(${JSON.stringify(source)})()`)).toMatchObject({ok: true, returnValue: expected});
});
