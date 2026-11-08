import assert from "node:assert/strict";
import { test } from "node:test";
import { wrapAnsi as reference } from "fast-wrap-ansi";

const outcome=fn=>{try{return {value:fn()};}catch(error){return {error:[error?.constructor?.name,error?.message]};}};

test("native ANSI wrapping preserves whitespace, Unicode, escapes and fractional widths",async()=>{
  const {wrapAnsi}=await import("../dist/wrap-ansi.js");
  const strings=["","   ","one two three","  one   two  ","abc\r\ndef\nghi\r","e\u0301 café 界かな","👩🏽‍💻🇵🇱 1️⃣", "a\ud800b\udc00", "a\tb\0c", "\x1b[31mone two three\x1b[39m", "\x1b[1mwideword\x1b[22m", "\x1b[38;2;1;2;3mwords here\x1b[0m", "\x9b31mone two\x9b39m", "\x1b]8;;https://example.test\x07one two\x1b]8;;\x07", "\x1b]8;;url\x1b\\one two\x1b]8;;\x1b\\", "\x1b[ unfinished"];
  const options=[undefined,{hard:true},{wordWrap:false},{trim:false},{hard:true,trim:false},{hard:true,trim:true,wordWrap:false}];
  for(const value of strings) for(const columns of [0,1,2,4,6.5,Infinity,NaN,-1]) for(const opts of options) assert.deepEqual(outcome(()=>wrapAnsi(value,columns,opts)),outcome(()=>reference(value,columns,opts)),JSON.stringify([value,columns,opts]));
  for(const code of [0,1,2,3,4,7,8,9,22,30,37,39,40,47,49,90,97,100,107,999]) {
    const value=`\x1b[${code}mhello world again`;
    assert.equal(wrapAnsi(value,6,{hard:true}),reference(value,6,{hard:true}));
  }
});

test("ANSI wrapping preserves changing option getters, column coercions and input conversion",async()=>{
  const {wrapAnsi}=await import("../dist/wrap-ansi.js");
  function run(fn) {
    const trace=[];let reads=0;
    const options=new Proxy({hard:true,wordWrap:false},{get(target,key){trace.push(key);return key === "trim" ? ++reads%3 !== 0 : target[key];}});
    const columns={valueOf(){trace.push("columns");return 4;}};
    const input={toString(){trace.push("input");return " aa bbbbb ccc  \r\nddd ";}};
    return [outcome(()=>fn(input,columns,options)),trace];
  }
  assert.deepEqual(run(wrapAnsi),run(reference));
  for(const input of [null,undefined,123,true,Symbol("text")]) assert.equal(wrapAnsi(input,3),reference(input,3));
  for(const columns of ["3",null,undefined,Symbol("width"),3n]) assert.deepEqual(outcome(()=>wrapAnsi("long words",columns,{hard:true})),outcome(()=>reference("long words",columns,{hard:true})));
  const thrown={};
  assert.throws(()=>wrapAnsi("text",4,{get trim(){throw thrown;}}),error=>error===thrown);
});

test("ANSI wrapping retains array species and nested invocations",async()=>{
  const {wrapAnsi}=await import("../dist/wrap-ansi.js");
  function run(fn) {
    const trace=[],split=String.prototype.split;
    class Parts extends Array {static get [Symbol.species](){trace.push("species");return Array;}}
    String.prototype.split=function(...args){return Parts.from(split.apply(this,args));};
    try {return [fn("one two\nthree four",5,{hard:true}),trace];}
    finally {String.prototype.split=split;}
  }
  assert.deepEqual(run(wrapAnsi),run(reference));
  for(const fn of [wrapAnsi,reference]) {
    const options={get hard(){assert.equal(fn("nested text",8),"nested\ntext");return true;}};
    assert.equal(fn("longwords here",4,options),reference("longwords here",4,{hard:true}));
  }
});

test("numeric wrapping retains observable Math operations and thrown identity",async()=>{
  const {wrapAnsi}=await import("../dist/wrap-ansi.js");
  function run(fn) {
    const trace=[],floor=Math.floor;
    Math.floor=value=>{trace.push(value);return floor(value);};
    try {return [fn("one abcdefghijklmnop next",5,{hard:true}),trace];}
    finally {Math.floor=floor;}
  }
  const expected=run(reference);
  assert.ok(expected[1].length>0);
  assert.deepEqual(run(wrapAnsi),expected);
  const floor=Math.floor,thrown={};
  Math.floor=()=>{throw thrown;};
  try {
    for(const fn of [wrapAnsi,reference]) assert.throws(()=>fn("one abcdefghijklmnop next",5,{hard:true}),error=>error===thrown);
  } finally {Math.floor=floor;}
});
