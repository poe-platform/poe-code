import { expect, it } from "vitest";
import { parseEvalScript, parseModule } from "./parser.js";
import { lint } from "../lint/index.js";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each([
  String.raw`class C { \u0061sync m() {} }`,
  String.raw`class C { as\u0079nc *m() {} }`,
  String.raw`class C { st\u0061tic m() {} }`,
  String.raw`class C { st\u0061tic {} }`,
  String.raw`class C { st\u0061tic x = 1; }`,
  String.raw`class C { static \u0061sync m() {} }`,
  String.raw`class C { \u0061sync ["m"]() {} }`,
  String.raw`class C { \u0061sync #m() {} }`
])("rejects escaped class grammar terminals: %s", source => {
  expect(() => parseEvalScript(source)).toThrow();
  expect(() => parseEvalScript('"use strict";' + source)).toThrow();
  expect(() => parseModule(source)).toThrow();
  expect(() => lint(source)).toThrow();
});

it.each([
  String.raw`class C { \u0061sync() {} st\u0061tic() {} }`,
  String.raw`class C { \u0061sync = 1; st\u0061tic = 2; }`,
  String.raw`class C { #async() {} #static() {} }`,
  String.raw`class C { static async m() {} static async *g() {} }`,
  String.raw`class C { st\u0061tic` + '\nm() {} }',
  String.raw`class C { \u0061sync` + '\n*m() {} }'
])("accepts escaped names and literal modifiers: %s", source => {
  expect(() => parseEvalScript(source)).not.toThrow();
  expect(() => parseModule(source)).not.toThrow();
});

it("keeps escaped static across a newline as an instance field", async () => {
  expect(await run(String.raw`class C { st\u0061tic` + `
    m() { return 42; }
  }
  const c = new C();
  return [Object.hasOwn(c, "static"), c.m(), typeof C.m];`))
    .toMatchObject({ok: true, returnValue: [true, 42, "undefined"]});
});

it("preserves eval errors, private closures and source across repeated replay", async () => {
  const invalid = String.raw`globalThis.marker = 1; class C { \u0061sync m() {} }`;
  const classSource = String.raw`class C { #x = 41; st\u0061tic` + '\nm() { return this.#x + 1; } }; C';
  const source = `const trace = [];
    for (const compile of [s => eval(s), s => (0,eval)(s), s => Function(s)]) {
      try { compile(${JSON.stringify(invalid)}); }
      catch (error) { trace.push(error.name, error instanceof SyntaxError); }
      finally { trace.push("finally"); }
    }
    const C = eval(${JSON.stringify(classSource)});
    const instance = new C();
    await 0;
    return [trace, instance.m(), Object.hasOwn(instance, "static"), C.toString(),
      typeof globalThis.marker,
      instance.m.constructor("return typeof process + ',' + typeof require")(),
      typeof globalThis.fetch];`;
  const expected = {ok: true, returnValue: [
    Array(3).fill(["SyntaxError", true, "finally"]).flat(),
    42, true, classSource.slice(0, -3), "undefined", "undefined,undefined", "undefined"
  ]};
  expect(lint(source).filter(diagnostic => diagnostic.severity === "error")).toEqual([]);
  let pending = run(source);
  for (let cycle = 0; cycle < 3; cycle++) {
    const settled = pending.catch(error => error);
    try {
      const saved = JSON.parse(await dump(pending));
      expect(await settled).toMatchObject(expected);
      pending = run(source, {snapshot: restore(saved, {source})});
    } finally { await settled; }
  }
  expect(await pending).toMatchObject(expected);
  const completed = JSON.parse(await dump(pending));
  expect(await run(source, {snapshot: restore(completed, {source})})).toMatchObject(expected);
});
