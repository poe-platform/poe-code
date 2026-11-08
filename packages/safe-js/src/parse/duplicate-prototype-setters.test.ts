import { expect, it } from "vitest";
import { parseEvalScript, parseModule } from "./parser.js";
import { run } from "../run.js";
import { lint } from "../lint/index.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each([
  '({__proto__: null, __proto__: null})',
  '({__proto__: null, "__proto__": {}})',
  '({"__pr\\u006fto__": null, __proto__: null})',
  '({__pr\\u006fto__: null, __proto__: null})',
  '({__proto__: null, ...{}, __proto__: null})',
  'function neverCalled() { return {__proto__: null, __proto__: null}; }',
  '({value: {__proto__: null, __proto__: null}})'
])("rejects duplicate prototype setters before execution: %s", source => {
  expect(() => parseEvalScript(source)).toThrow();
  expect(() => parseEvalScript('"use strict";' + source)).toThrow();
  expect(() => parseModule(source)).toThrow();
  expect(() => lint(source)).toThrow("Duplicate __proto__ prototype setter");
});

it.each([
  '({__proto__: null, ["__proto__"]: null})',
  '({__proto__: null, __proto__() {}})',
  '({__proto__: null, get __proto__() {}})',
  '({__proto__: null, set __proto__(x) {}})',
  'var __proto__; ({__proto__: null, __proto__})',
  'var {__proto__: a, __proto__: b} = {}',
  'var a, b; ({__proto__: a, __proto__: b} = {})',
  'var a, b; ([{__proto__: a, __proto__: b}] = [{}])',
  '({__proto__: a, __proto__: b}) => [a,b]',
  'async ({__proto__: a, __proto__: b}) => [a,b]',
  'var a,b; for ({__proto__: a, __proto__: b} of [{}]) {}',
  '({a: {__proto__: null}, b: {__proto__: null}})'
])("accepts ordinary properties and repeated destructuring keys: %s", source => {
  expect(() => parseEvalScript(source)).not.toThrow();
  expect(() => parseEvalScript('"use strict";' + source)).not.toThrow();
});

it("keeps duplicate JSON keys as ordinary own data properties", async () => {
  expect(await run(`const value=JSON.parse('{"__proto__":1,"__proto__":2}');
    return [value.__proto__, Object.getPrototypeOf(value)===Object.prototype,
      Object.getOwnPropertyDescriptor(value,"__proto__").value];`))
    .toMatchObject({ok: true, returnValue: [2, true, 2]});
});

it("rejects direct, indirect and dynamic source without executing its side effects", async () => {
  const source = `const trace=[];
    for (const compile of [eval, source => (0,eval)(source), source => Function(source)]) {
      try { compile('globalThis.marker=1; ({__proto__: null, __proto__: null})'); }
      catch (error) { trace.push(error.name); }
    }
    try { eval('globalThis.marker=1; ({__proto__: null, __proto__: null})'); }
    catch (error) { trace.push(error.name); }
    await 0;
    return [trace, typeof globalThis.marker, Function('return typeof process + "," + typeof require')()];`;
  expect(lint(source).filter(diagnostic => diagnostic.severity === "error")).toEqual([]);
  const expected = {ok: true, returnValue: [Array(4).fill("SyntaxError"), "undefined", "undefined,undefined"]};
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
