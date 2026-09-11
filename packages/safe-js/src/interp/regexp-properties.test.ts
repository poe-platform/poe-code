import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { run } from "../core.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { deepCopyFromSandbox } from "./values.js";

describe("RegExp guest properties", () => {
  it("preserves guest data properties when exporting a regex to the host", async () => {
    const result = await run("const value=/t/g;value.extra={count:7};value.lastIndex=2;return value;");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const exported = deepCopyFromSandbox(result.returnValue);
      expect(exported).toBeInstanceOf(RegExp);
      expect(exported).toMatchObject({ extra: { count: 7 }, lastIndex: 2 });
    }
  });

  it("restores custom data properties and regex identity through checkpoint replay", async () => {
    const source = "const value=/t/g;value.extra={count:7};value.alias=value;Object.seal(value);await 0;return [value.extra.count,value.alias===value,Object.isSealed(value),Object.isFrozen(value)];";
    const pending = run(source);
    const completed = pending.catch(error => error);
    try {
      const snapshot = restore(JSON.parse(await dump(pending)), { source });
      expect(await completed).toMatchObject({ ok: true, returnValue: [7, true, true, false] });
      expect(await run(source, { snapshot })).toMatchObject({ ok: true, returnValue: [7, true, true, false] });
    } finally {
      await completed;
    }
  });
  it.each([
    "const pattern=/t/;pattern[Symbol.match]=function(value){return value+'!'};return 'text'.match(pattern);",
    "const pattern=/t/;pattern.extra=7;return [pattern.extra,Object.keys(pattern)];",
    "const pattern=/t/;return Object.getOwnPropertyNames(pattern);",
    "const pattern=/t/;return Object.getOwnPropertyDescriptor(pattern,'lastIndex');",
    "const pattern=/t/;const key=Symbol('x');pattern[key]=7;return [pattern[key],Object.getOwnPropertySymbols(pattern)[0]===key];",
    "const pattern=/t/;Object.defineProperty(pattern,'extra',{value:7,enumerable:true});return [pattern.extra,Object.keys(pattern)];",
    "const pattern=/t/;Object.defineProperty(pattern,Symbol.search,{get(){return function(value){return this===pattern?value:'wrong'}}});return 'text'.search(pattern);",
    "const pattern=/t/;pattern.test=function(){return 7};return pattern.test('no');",
    "const pattern=/t/;pattern.extra=7;return [delete pattern.extra,'extra' in pattern];",
    "const pattern=/t/;const key=Symbol('x');pattern[key]=7;return [delete pattern[key],key in pattern];",
    "const pattern=/t/;pattern.extra=7;const copy={...pattern};return [copy.extra,Object.keys(copy)];",
    "const pattern=/t/;return [Object.isExtensible(pattern),Object.isSealed(pattern),Object.isFrozen(pattern)];",
    "const pattern=/t/;pattern.extra=7;Object.seal(pattern);pattern.extra=8;return [pattern.extra,Object.isSealed(pattern),Object.isFrozen(pattern)];",
    "const pattern=/t/;Object.freeze(pattern);try{pattern.lastIndex=7}catch(error){return [error.name,Object.isFrozen(pattern)]}",
    "const pattern=/t/;Object.defineProperty(pattern,'source',{value:'guest'});return [pattern.source,pattern.test('t'),pattern.test('guest')];"
  ])("matches native: %s", async (source) => {
    const expected = runInNewContext("(function(){'use strict';" + source + "})()");
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});
