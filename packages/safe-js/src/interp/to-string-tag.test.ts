import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { run } from "../core.js";

describe("Object.prototype.toString Symbol.toStringTag", () => {
  it.each([
    ["own tag", "return Object.prototype.toString.call({[Symbol.toStringTag]:'Custom'});"],
    [
      "inherited tag",
      "return Object.prototype.toString.call(Object.create({[Symbol.toStringTag]:'Inherited'}));"
    ],
    [
      "getter receiver and single read",
      "let reads=0;const object={get [Symbol.toStringTag](){reads++;return this===object?'Custom':'wrong'}};return [Object.prototype.toString.call(object),reads];"
    ],
    [
      "throwing getter",
      "try{return Object.prototype.toString.call({get [Symbol.toStringTag](){throw 'tag'}})}catch(error){return error}"
    ],
    [
      "non-string tag is not coerced",
      "const value=[];value[Symbol.toStringTag]={toString(){throw 'coerced'}};return Object.prototype.toString.call(value);"
    ],
    [
      "async function non-string fallback",
      "const value=async()=>{};Object.defineProperty(value,Symbol.toStringTag,{value:7});return Object.prototype.toString.call(value);"
    ],
    [
      "removed async prototype",
      "const value=async()=>{};Object.setPrototypeOf(value,{});return Object.prototype.toString.call(value);"
    ],
    [
      "boxed object receiver",
      "Object.defineProperty(Number.prototype,Symbol.toStringTag,{get(){return typeof this+':'+this.valueOf()}});return Object.prototype.toString.call(Object(7));"
    ],
    ["symbol primitive", "return Object.prototype.toString.call(Symbol('key'));"],
    [
      "removed symbol tag",
      "delete Symbol.prototype[Symbol.toStringTag];return Object.prototype.toString.call(Symbol('key'));"
    ],
    [
      "arguments builtin tag",
      "function read(){return Object.prototype.toString.call(arguments)}return read(7);"
    ],
    [
      "nullish receivers",
      "return [Object.prototype.toString.call(null),Object.prototype.toString.call(undefined)];"
    ]
  ])("matches native %s", async (_name, source) => {
    // Each native control has its own realm so prototype changes cannot leak.
    const expected = runInNewContext("(function(){'use strict';" + source + "})()");
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
  it("uses the ToObject receiver required by the specification for a primitive", async () => {
    // ECMA-262 2026 20.1.3.6 steps 3 and 15 use Get(ToObject(this), @@toStringTag).
    // Node 22's primitive fast path supplies the primitive itself to this getter.
    const source =
      "Object.defineProperty(Number.prototype,Symbol.toStringTag,{get(){return typeof this+':'+this.valueOf()}});return Object.prototype.toString.call(7);";
    expect(await run(source)).toMatchObject({ ok: true, returnValue: "[object object:7]" });
  });
});
