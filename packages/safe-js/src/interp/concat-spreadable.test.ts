import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { run } from "../core.js";

describe("concat Symbol.isConcatSpreadable", () => {
  it.each([
    [
      "array-like opt in",
      "const value={0:7,length:1,[Symbol.isConcatSpreadable]:true};return [].concat(value);"
    ],
    [
      "array opt out",
      "const value=[7];value[Symbol.isConcatSpreadable]=false;const result=[].concat(value);return [result.length,result[0]===value];"
    ],
    [
      "receiver opt out",
      "const value=[7];value[Symbol.isConcatSpreadable]=false;const result=value.concat(8);return [result.length,result[0]===value,result[1]];"
    ],
    [
      "truthy hook and length conversion",
      "const value={0:7,1:8,length:'2.9',[Symbol.isConcatSpreadable]:'yes'};return [].concat(value);"
    ],
    [
      "null hook is false",
      "const value=[7];value[Symbol.isConcatSpreadable]=null;return [].concat(value)[0]===value;"
    ],
    [
      "undefined hook keeps array fallback",
      "const value=[7];value[Symbol.isConcatSpreadable]=undefined;return [].concat(value);"
    ],
    [
      "getter ordering",
      "const log=[];const value={get [Symbol.isConcatSpreadable](){log.push('spread');return true},get length(){log.push('length');return 1},get 0(){log.push('item');return 7}};return [[].concat(value),log];"
    ],
    [
      "length not read when disabled",
      "const value={get length(){throw 'unused'},[Symbol.isConcatSpreadable]:false};return [].concat(value)[0]===value;"
    ],
    [
      "inherited entries and holes",
      "const value=Object.create({1:7,[Symbol.isConcatSpreadable]:true});value.length=3;const result=[].concat(value);return [result.length,0 in result,1 in result,2 in result,result[1]];"
    ],
    [
      "inherited array entries",
      "const value=[,];Object.setPrototypeOf(value,{0:7});return [].concat(value);"
    ],
    [
      "snapshot length before indexed getters",
      "const value={length:2,[Symbol.isConcatSpreadable]:true,get 0(){this.length=0;return 7},1:8};return [].concat(value);"
    ],
    [
      "negative length",
      "const value={length:-3,[Symbol.isConcatSpreadable]:true};return [].concat(value);"
    ],
    ["primitive strings stay scalar", "return [].concat('ab');"]
  ])("matches native %s", async (_name, source) => {
    const expected = runInNewContext("(function(){'use strict';" + source + "})()");
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});
