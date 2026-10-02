import assert from "node:assert/strict";
import { test } from "node:test";
import reference from "fast-string-width";

const outcome = fn => { try { return {value:fn()}; } catch(error) { return {error:[error?.constructor?.name,error?.message]}; } };

test("native dependency width matches Unicode, ANSI and exact block arithmetic", async () => {
  const {default:width} = await import("../dist/string-width.js");
  const values = ["", "hello", "\t\r\n\0", "界かな한글", "𠀀", "Ａ｡ｶ", "e\u0301", "\u0301", "a\uFE0F", "👩🏽‍💻", "🇵🇱", "1️⃣", "🏴\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}", "\ud800", "\udc00", "a\ud800b", "\x1b[31mred\x1b[0m", "\x9b31mred", "\x1b]8;;https://x.test\x07link\x1b]8;;\x1b\\", "\x1b]8;;x\nlink\x07", "\x1b[12345m", "\x1b[", "\x1bx", "αaβb", "\u3000\u2329\ufe10", "x".repeat(2001), "界".repeat(1001), "\t".repeat(1001)];
  const options = [{}, {regularWidth:0.1,wideWidth:0.3,emojiWidth:0.7,controlWidth:0.2,tabWidth:0.9}, {regularWidth:0,wideWidth:-1,emojiWidth:NaN,tabWidth:Infinity}, {regularWidth:Infinity}, {regularWidth:"2",wideWidth:"3"}, {controlWidth:null,tabWidth:null,emojiWidth:null,regularWidth:null,wideWidth:null}];
  for(const value of values) for(const opts of options) assert.deepEqual(outcome(()=>width(value,opts)),outcome(()=>reference(value,opts)),JSON.stringify([value,opts]));
  for(let code=0;code<=0x10ffff;code+=127) {
    const value=String.fromCodePoint(code);
    assert.equal(width(value),reference(value),`U+${code.toString(16)}`);
  }
});

test("width preserves option reads, input coercions and unmatched width coercion", async () => {
  const {default:width} = await import("../dist/string-width.js");
  function run(fn) {
    const trace=[];
    const options=new Proxy({regularWidth:{valueOf(){trace.push("valueOf");return 1;}}},{get(target,key){trace.push(String(key));return target[key];}});
    const input={get length(){trace.push("length");return 3;},toString(){trace.push("string");return "αaβ";},slice(start,end){trace.push(["slice",start,end]);return "αaβ".slice(start,end);}};
    return [outcome(()=>fn(input,options)),trace];
  }
  assert.deepEqual(run(width),run(reference));
  for(const value of [null,undefined,Symbol("input")]) assert.deepEqual(outcome(()=>width(value)),outcome(()=>reference(value)));
  const thrown={token:true};
  assert.throws(()=>width("abc",{get tabWidth(){throw thrown;}}),error=>error===thrown);
});

test("width closes unmatched iterators on arbitrary throws and preserves nested scans", async () => {
  const {default:width} = await import("../dist/string-width.js");
  const thrown={token:true};
  function run(fn) {
    const trace=[];
    const input={length:1,toString(){return "α";},slice(){return {replaceAll(){return {[Symbol.iterator](){return {
      next(){return {value:{codePointAt(){throw thrown;}},done:false};},
      return(){trace.push("closed");return {};}
    };}};}};}};
    assert.throws(()=>fn(input),error=>error===thrown);
    return trace;
  }
  assert.deepEqual(run(width),run(reference));
  function nested(fn) {
    let calls=0;
    return fn({length:2,toString(){return "界界";},slice(start,end){if(!calls++) fn("a");return "界界".slice(start,end);}});
  }
  assert.equal(nested(width),nested(reference));
});

test("width retains observable truncation bookkeeping even for its unlimited API", async () => {
  const {default:width} = await import("../dist/string-width.js");
  function run(fn) {
    const trace=[],max=Math.max,min=Math.min,floor=Math.floor;
    Math.max=(...args)=>{trace.push(["max",...args]);return args[1] === Infinity ? 1 : max(...args);};
    Math.min=(...args)=>{trace.push(["min",...args]);return min(...args);};
    Math.floor=(...args)=>{trace.push(["floor",...args]);return floor(...args);};
    try {return [fn("abαβ"),trace];}
    finally {Math.max=max;Math.min=min;Math.floor=floor;}
  }
  assert.deepEqual(run(width),run(reference));
});
