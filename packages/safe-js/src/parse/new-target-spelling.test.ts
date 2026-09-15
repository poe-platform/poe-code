import { expect, it } from "vitest";
import { parseEvalScript, parseModule } from "./parser.js";
import { lint } from "../lint/index.js";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each([
  String.raw`function f() { new.t\u0061rget; }`,
  String.raw`function f() { return new.\u{74}arget; }`,
  String.raw`function f() { return () => new.targ\u0065t; }`,
  String.raw`class C { constructor() { new.t\u0061rget; } }`,
  'function f() { new.#target; }',
  'function f() { new."target"; }'
])("rejects nonterminal spellings in new.target: %s", source => {
  expect(() => parseEvalScript(source)).toThrow();
  expect(() => parseEvalScript('"use strict";' + source)).toThrow();
  expect(() => parseModule(source)).toThrow();
  expect(() => lint(source)).toThrow();
});

it.each([
  'function f() { return () => new.target; }',
  'class C { constructor() { new.target; } }',
  String.raw`function t\u0061rget() {} new t\u0061rget();`,
  String.raw`const x = {t\u0061rget: 1}; x.t\u0061rget;`,
  'function f() { return new /* comment */ . /* comment */ target; }'
])("accepts literal new.target and ordinary escaped names: %s", source => {
  expect(() => parseEvalScript(source)).not.toThrow();
  expect(() => parseModule(source)).not.toThrow();
});

it("retains constructor new.target and eval errors through repeated replay", async () => {
  const invalid = String.raw`globalThis.marker=1; function f() { new.t\u0061rget; }`;
  const source = `const trace=[];
    function C() { this.read = () => eval("new.target"); }
    const Bound = C.bind(null);
    const instance = new Bound();
    for (const compile of [s=>eval(s), s=>(0,eval)(s), s=>Function(s)]) {
      try { compile(${JSON.stringify(invalid)}); }
      catch(e) { trace.push(e.name, e instanceof SyntaxError); }
      finally { trace.push("finally"); }
    }
    await 0;
    return [instance.read() === C, trace, typeof globalThis.marker, C.toString(),
      instance.read.constructor("return typeof process + ',' + typeof require")()];`;
  const expected = {ok:true, returnValue:[true,
    Array(3).fill(["SyntaxError",true,"finally"]).flat(), "undefined",
    'function C() { this.read = () => eval("new.target"); }', "undefined,undefined"]};
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
