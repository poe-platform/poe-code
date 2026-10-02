import assert from "node:assert/strict";
import {test} from "node:test";
import * as terminal from "../dist/terminal.js";
import * as referenceTerminal from "../../toolcraft-design/dist/dashboard/terminal-width.js";
import * as reference from "../../toolcraft-design/dist/explorer/render/text.js";
const outcome=fn=>{try{return {value:fn()};}catch(error){return {error:[error?.constructor?.name,error?.message]};}};

test("terminal widths retain host start-column coercions and grapheme methods",()=>{
  for(const start of [0,1.5,-3,NaN,Infinity,"2",null,false])for(const text of ["abc","\tX","界\t👩‍💻","e\u0301","\ud800"]) {
    for(const name of ["displayWidth","expandTabs"])assert.deepEqual(outcome(()=>terminal[name](text,start)),outcome(()=>referenceTerminal[name](text,start)),`${name}/${text}/${String(start)}`);
  }
  function run(fn) {
    const trace=[],start={valueOf(){trace.push("number");return 3;}};
    return [outcome(()=>fn("a\tb",start)),trace];
  }
  assert.deepEqual(run(terminal.displayWidth),run(referenceTerminal.displayWidth));
  assert.deepEqual(run(terminal.expandTabs),run(referenceTerminal.expandTabs));
  for(const point of [undefined,0,768,0x1f1e6,"9000",NaN]) {
    function run(fn) {
      const trace=[],segment={codePointAt(index){trace.push(["point",index,this===segment]);return point;},*[Symbol.iterator](){trace.push("iterator");yield "🇦";yield "🇧";},includes(value){trace.push(["includes",value]);return true;}};
      return [fn(segment),trace];
    }
    assert.deepEqual(run(terminal.graphemeWidth),run(referenceTerminal.graphemeWidth));
  }
});

test("text cells preserve graphemes, tab columns, fractional widths and SGR-only stripping",async()=>{
  const native=await import("toolcraft-design-rust/explorer/render/text");
  assert.deepEqual(Object.keys(native),Object.keys(reference));
  for(const text of ["","plain text","界\t界","a\t👩‍💻🇵🇱","e\u0301\ud800","\x1b[31mred\x1b[0m","line\nnext"])for(const width of [-1,0,0.5,1,2.5,8,20,NaN])for(const start of [0,1,7.5,-1]) {
    for(const name of ["fitToWidth","centerCells"])assert.deepEqual(outcome(()=>native[name](text,width,start)),outcome(()=>reference[name](text,width,start)),`${name}/${text}/${width}/${start}`);
    for(const fill of [" ","─","界","","\t"])assert.deepEqual(outcome(()=>native.padEndCells(text,width,fill,start)),outcome(()=>reference.padEndCells(text,width,fill,start)));
    assert.deepEqual(native.splitGraphemeCells(text,start),reference.splitGraphemeCells(text,start));
    assert.equal(native.cellWidth(text,start),reference.cellWidth(text,start));
    assert.equal(native.stripAnsi(text),reference.stripAnsi(text));
  }
});

test("cell helpers retain callback order, repeated width coercion and arbitrary throws",async()=>{
  const native=await import("toolcraft-design-rust/explorer/render/text");
  for(const name of ["fitToWidth","centerCells","padEndCells"]) {
    function run(fn) {
      const trace=[],width={valueOf(){trace.push("width");return 4;}},start={valueOf(){trace.push("start");return 1;}};
      return [outcome(()=>name==="padEndCells"?fn("abcde",width,".",start):fn("abcde",width,start)),trace];
    }
    assert.deepEqual(run(native[name]),run(reference[name]),name);
  }
  const thrown={};
  const value={get length(){throw thrown;}};
  for(const fn of [native.cellWidth,native.fitToWidth,native.splitGraphemeCells])assert.throws(()=>fn(value,4),error=>error===thrown);
});

test("text policies preserve point coercions, iterator closure and padding method calls",async()=>{
  const native=await import("toolcraft-design-rust/explorer/render/text");
  function pointRun(fn) {
    const trace=[],point={valueOf(){trace.push("coerce");return 97;}},segment={codePointAt(){trace.push("point");return point;},*[Symbol.iterator](){trace.push("iterate");yield "a";},includes(value){trace.push(value);return 1;}};
    return [fn(segment),trace];
  }
  assert.deepEqual(pointRun(terminal.graphemeWidth),pointRun(referenceTerminal.graphemeWidth));
  function run(fn) {
    const trace=[],input={length:0,split(){trace.push("split");return {[Symbol.iterator](){let index=0;return {next(){trace.push(`next:${index}`);return index<3?{value:"abc"[index++],done:false}:{done:true};},return(){trace.push("closed");return {};}};}};}};
    return [fn(input,2),trace];
  }
  assert.deepEqual(run(native.fitToWidth),run(reference.fitToWidth));
  const thrown={};
  function failure(fn) {
    const trace=[],input={length:0,split(){return {[Symbol.iterator](){return {next(){return {value:{codePointAt(){throw thrown;}},done:false};},return(){trace.push("closed");return {};}};}};}};
    assert.throws(()=>fn(input,4),error=>error===thrown);return trace;
  }
  assert.deepEqual(failure(terminal.displayWidth),failure(referenceTerminal.displayWidth));
  function padding(fn) {
    const trace=[],repeat=String.prototype.repeat;
    String.prototype.repeat=function(count){trace.push([String(this),count]);return repeat.call(this,count);};
    try{return [fn("界",7,"",1),trace];}finally{String.prototype.repeat=repeat;}
  }
  assert.deepEqual(padding(native.padEndCells),padding(reference.padEndCells));
});
