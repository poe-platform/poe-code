import assert from "node:assert/strict";
import { test } from "node:test";
import { stripAnsi } from "../dist/index.js";
import { stripAnsi as reference } from "../../toolcraft-design/dist/internal/strip-ansi.js";

test("native ANSI cleanup accepts changing non-string values like the reference", () => {
  const outcome=(fn,value)=>{try{return {value:fn(value)};}catch(error){return {error:[error.constructor.name,error.message]};}};
  for(const value of [0,3,false,true,1n,Symbol("value"),{},null,undefined,new String("a\x1b[31mb\x1b]x\x07c")]) assert.deepEqual(outcome(stripAnsi,value),outcome(reference,value));
});

test("observable ANSI input preserves indexed reads, lengths, receivers and throws", () => {
  function run(fn) {
    const trace=[],value="a\x1b[31mb\u009b0mc\x1b]title\x1b\\d\x1bx";
    const input=new Proxy({length:value.length,charCodeAt(index){trace.push(`code:${this===input}:${index}`);return value.charCodeAt(index);}},{get(target,key,receiver){trace.push(String(key));return key in target ? Reflect.get(target,key,receiver) : value[key];}});
    return [fn(input),trace];
  }
  assert.deepEqual(run(stripAnsi),run(reference));
  const thrown={identity:true};
  assert.throws(()=>stripAnsi({get length(){throw thrown;}}),error=>error===thrown);
});
