import { Script, runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { parseEvalScript } from "./parser.js";

it.each([
  "", "1 + 2", "var answer=3; answer", "let answer=3; answer",
  "function f(){return 3} f()", "async function f(){await 1} f",
  "var await=3; await", "var yield=3; yield", "with({x:3}) x",
  "<!-- comment\n1", "var x=010; x", "'use strict'; var x=1; x",
  "('use strict'); with({}){}", "'use strict';;var x=1",
  "'other';; 'use strict'; with({}){}", "import('granted')",
  "class C { #x=1; get(){return this.#x} }",
  "return 1", "{return 1}", "import x from 'x'", "export const x=1",
  "import.meta", "await 1", "for await (const x of []) {}",
  "new.target", "super.x", "super()", "this.#missing",
  "'use strict'; with({}){}", "'use strict'; var x=010",
  "'\\1'; 'use strict';", "'use strict'; var yield=1",
  "let x; var x", "function f(){}; let f"
])("matches native Script grammar: %s", source => {
  let nativeError: unknown;
  try { new Script(source); } catch (error) { nativeError = error; }
  if (nativeError === undefined) expect(() => parseEvalScript(source)).not.toThrow();
  else {
    expect(nativeError).toBeInstanceOf(SyntaxError);
    expect(() => parseEvalScript(source)).toThrow(SyntaxError);
  }
});

it.each([
  ["'use strict'; 1", true], ["'other'; 'use strict'; 1", true],
  ["'use\\x20strict'; 1", false], ["('use strict'); 1", false],
  ["'other';; 'use strict'; 1", false], ["; 'use strict'; 1", false],
  ["{ 'use strict'; }", false], ["1", false]
] as const)("records script strictness without function wrapping: %s", (source, strict) => {
  const result = parseEvalScript(source);
  expect(result.strict).toBe(strict);
  expect(result.node.body[0]?.span.start.offset).toBe(0);
});

it("inherits strictness from a direct caller", () => {
  expect(() => runInNewContext('(function(){"use strict";eval("with({}){}");})()'))
    .toThrow();
  expect(() => parseEvalScript("with({}){}", {strict: true})).toThrow(SyntaxError);
  expect(parseEvalScript("1", {strict: true}).strict).toBe(true);
});

it("admits new.target only with the caller function context", () => {
  expect(runInNewContext('(function(){return eval("new.target")})()')).toBeUndefined();
  expect(() => parseEvalScript("new.target", {newTarget: true})).not.toThrow();
  expect(() => parseEvalScript("return 1", {newTarget: true})).toThrow(SyntaxError);
});

it("inherits method, constructor and private-name syntax context", () => {
  expect(runInNewContext('class B {x(){return 1}}; class C extends B {#x=2; constructor(){eval("super()")}; get(){return eval("super.x()+this.#x")}}; new C().get()')).toBe(3);
  expect(() => parseEvalScript("super()", {superCall: true})).not.toThrow();
  expect(() => parseEvalScript("super.x()+this.#x", {
    superProperty: true, privateNames: new Set(["x"])
  })).not.toThrow();
  expect(() => parseEvalScript("this.#other", {privateNames: new Set(["x"])}))
    .toThrow(SyntaxError);
});

it("rejects arguments in a class initializer while allowing nested ordinary functions", () => {
  expect(() => runInNewContext('class C {x=eval("arguments")};new C()')).toThrow();
  expect(() => parseEvalScript("arguments", {arguments: false})).toThrow(SyntaxError);
  expect(() => parseEvalScript("()=>arguments", {arguments: false})).toThrow(SyntaxError);
  expect(() => parseEvalScript("function f(){return arguments}", {arguments: false})).not.toThrow();
});
