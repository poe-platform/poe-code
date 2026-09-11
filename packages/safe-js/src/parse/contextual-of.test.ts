import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";

it.each([
  "const of=7;return of",
  "const of=8;return of/2",
  "const of=8;return `${of/2}`",
  "let result='';for(const of of /xy/.source)result+=of;return result",
  "const of=8;let result=0;for(const value of [of/2])result+=value;return result",
  "let of=8;of/=2;return of",
  "const f=of=>of+1;return f(2)",
  "const values=[];for(const of in {a:1,b:2})values.push(of);return values",
  "let of=0;for(of=0;of<2;of++){}return of",
  "const of={value:0};for(of.value of [2,4]){}return of.value",
  "const values=[];for(const of of [/x/,/y/])values.push(of.source);return values",
  "let of=2;of+=3;return of",
  "function of(of){return of+1}return of(2)",
  "const of=7;return {of}.of",
  "const {of}={of:7};return of",
  "const [of]=[7];return of",
  "let total=0;for(const of of [2,4])total+=of;return total",
  "let of;for(of of [2,4]){}return of",
  "let total=0;for(let of=0;of<3;of++)total+=of;return total",
  "const of=[2,4];let total=0;for(const value of of)total+=value;return total"
])("accepts contextual of identifiers: %s", async source => {
  const expected = runInNewContext(`(function(){${source}})()`);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});

it.each([
  "const for=7;return for",
  "for(const of of){}",
  "for(const of=1 of [2]){}"
])("keeps invalid bindings and for-of headers rejected: %s", async source => {
  expect(() => runInNewContext(`(function(){${source}})()`)).toThrow();
  await expect(run(source)).rejects.toThrow();
});
