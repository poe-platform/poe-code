import assert from "node:assert/strict";
import {test} from "node:test";
import {escapeTerminalText as reference} from "../../toolcraft-design/dist/escape-terminal-text.js";
const outcome=fn=>{try{return {value:fn()};}catch(error){return {error:[error?.constructor?.name,error?.message]};}};

test("terminal escaping exposes every control and directional mark while preserving Unicode",async()=>{
  const {escapeTerminalText:native}=await import("toolcraft-design-rust/escape-terminal-text");
  const points=[...Array.from({length:256},(_,index)=>index),0x61c,0x200e,0x200f,0x202a,0x202b,0x202c,0x202d,0x202e,0x2066,0x2067,0x2068,0x2069,0x206a,0x1f600,0xd800,0xdc00];
  for(const point of points){const value=`a${String.fromCodePoint(point)}b`;assert.equal(native(value),reference(value));}
  for(const value of ["","Résumé 日本語 😀 e\u0301 /draft [ready] \\u001b","\x1b[2J\x1b]8;;https://example.invalid\x07label\x1b]8;;\x1b\\"])assert.equal(native(value),reference(value));
});

test("terminal escaping preserves iterator cleanup, code-point comparisons and method receivers",async()=>{
  const {escapeTerminalText:native}=await import("toolcraft-design-rust/escape-terminal-text");
  function run(escape,point) {
    const trace=[],code={valueOf(){trace.push("code coercion");return point;},toString(base){trace.push(["hex",base,this===code]);return point.toString(base);}};
    const character={codePointAt(index){trace.push(["point",index,this===character]);return code;},[Symbol.toPrimitive](hint){trace.push(["character",hint]);return "x";}};
    const input={*[Symbol.iterator](){try{yield character;}finally{trace.push("closed");}}};
    return [outcome(()=>escape(input)),trace];
  }
  for(const point of [0,31,32,127,160,0x61c,0x200e,0x202a,0x2067,10000])assert.deepEqual(run(native,point),run(reference,point));
  const thrown={},trace=[],input={*[Symbol.iterator](){try{yield {codePointAt(){throw thrown;}};}finally{trace.push("closed");}}};
  assert.throws(()=>native(input),error=>error===thrown);assert.deepEqual(trace,["closed"]);
});

test("terminal escaping retains invalid argument behavior and public function shape",async()=>{
  const module=await import("toolcraft-design-rust/escape-terminal-text"),native=module.escapeTerminalText;
  assert.deepEqual(Object.keys(module),["escapeTerminalText"]);assert.equal(native.name,reference.name);assert.equal(native.length,reference.length);
  for(const value of [null,undefined,1,{},["a","\n"]])assert.deepEqual(outcome(()=>native(value)),outcome(()=>reference(value)));
});
