import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { run } from "../core.js";

describe("Symbol.hasInstance protocol", () => {
  it.each([
    [
      "object matcher",
      "const matcher={[Symbol.hasInstance](value){return value===7}};return [7 instanceof matcher,8 instanceof matcher];"
    ],
    [
      "getter once and receiver",
      "const log=[];const matcher={get [Symbol.hasInstance](){log.push('get');return function(value){log.push(this===matcher,value);return 'yes'}}};return [7 instanceof matcher,log];"
    ],
    [
      "inherited hook",
      "const prototype={[Symbol.hasInstance](value){return value===7}};return 7 instanceof Object.create(prototype);"
    ],
    [
      "class hook",
      "class Matcher{static [Symbol.hasInstance](value){return value===7}}return 7 instanceof Matcher;"
    ],
    [
      "constructor override",
      "function Box(){}Object.defineProperty(Box,Symbol.hasInstance,{value(){return false}});return new Box() instanceof Box;"
    ],
    [
      "bound hook",
      "function Box(){}const Bound=Box.bind(null);Object.defineProperty(Bound,Symbol.hasInstance,{value(value){return value===7}});return 7 instanceof Bound;"
    ],
    [
      "bound target hook",
      "function Box(){}Object.defineProperty(Box,Symbol.hasInstance,{value(value){return value===7}});const Bound=Box.bind(null);return 7 instanceof Bound;"
    ],
    [
      "non-callable hook",
      "function Box(){}Object.defineProperty(Box,Symbol.hasInstance,{value:7});try{return {} instanceof Box}catch(error){return error.name}"
    ],
    [
      "null hook falls back",
      "function Box(){}Object.defineProperty(Box,Symbol.hasInstance,{value:null});return new Box() instanceof Box;"
    ],
    [
      "non-callable object without hook",
      "try{return {} instanceof {}}catch(error){return error.name}"
    ],
    [
      "throwing hook",
      "const matcher={[Symbol.hasInstance](){throw 'hook'}};try{return 7 instanceof matcher}catch(error){return error}"
    ],
    [
      "promised hook result is truthy",
      "const matcher={async [Symbol.hasInstance](){return false}};return 7 instanceof matcher;"
    ],
    [
      "ordinary bound fallback",
      "function Box(){}const Bound=Box.bind(null);return [new Box() instanceof Bound,7 instanceof Bound];"
    ],
    ["primitive right rejects", "try{return 7 instanceof 3}catch(error){return error.name}"]
  ])("matches native %s", async (_name, source) => {
    const expected = runInNewContext("(function(){'use strict';" + source + "})()");
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});
