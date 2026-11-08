import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { run } from "../core.js";

describe("string symbol protocols", () => {
  it.each([
    "const pattern={[Symbol.match](value){return value+'!'}};return 'text'.match(pattern);",
    "const pattern={[Symbol.search](value){return [this===pattern,value]}};return 'text'.search(pattern);",
    "const limit={};const pattern={[Symbol.split](value,count){return [this===pattern,value,count===limit]}};return 'text'.split(pattern,limit);",
    "let reads=0;const pattern={get [Symbol.match](){reads++;return function(value){return [this===pattern,value,reads]}}};return 'text'.match(pattern);",
    "const pattern=Object.create({[Symbol.search](value){return value}});return 'text'.search(pattern);",
    "try{return 'text'.match({[Symbol.match]:7})}catch(error){return error.name}",
    "try{return 'text'.split({[Symbol.split]:{}})}catch(error){return error.name}",
    "const receiver={toString(){throw 'coerced'}};const pattern={[Symbol.match](value){return value===receiver}};return ''.match.call(receiver,pattern);",
    "const receiver={toString(){throw 'coerced'}};const pattern={[Symbol.split](value){return value===receiver}};return ''.split.call(receiver,pattern);",
    "const log=[];const receiver={toString(){log.push('receiver');return 'text'}};const pattern={get [Symbol.search](){log.push('hook');return undefined},toString(){log.push('pattern');return 't'}};const result=''.search.call(receiver,pattern);return [result,log];",
    "const pattern={[Symbol.match]:null,toString(){return 't'}};return 'text'.match(pattern)[0];",
    "const result=Promise.resolve(7);return 'text'.match({[Symbol.match](){return result}})===result;",
    "try{return ''.search.call(null,{get [Symbol.search](){throw 'read'}})}catch(error){return error.name}"
  ])("matches native: %s", async (source) => {
    const expected = runInNewContext("(function(){'use strict';" + source + "})()");
    expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
  });
});
