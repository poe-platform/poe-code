import assert from "node:assert/strict";
import {test} from "node:test";
import * as original from "../../toolcraft-design/dist/dashboard/ansi.js";

test("dashboard ANSI parser preserves styled lines, base resets and controls",async()=>{
 const native=await import("toolcraft-design-rust/dashboard/ansi");assert.deepEqual(Object.keys(native),Object.keys(original));
 const inputs=["","plain","a\nb","ab\rZ","abc\bX","界界\rZ","x\tY","\x1b[31mred\x1b[39mbase","\x1b[1;2;7mflags\x1b[22;27moff","\x1b[38;2;300;2;3mRGB\x1b[0mreset","\x1b[48;5;234mBG\x1b[49mreset","\x1b[38:2::20:30:40mcolon","\x1b[8m界a\x1b[28mz","abcdef\rxx\x1b[K","a\x1b]0;hidden\x07b","é👩‍💻\ud800"];
 const styles=[undefined,{}, {fg:"red",bg:"blue",bold:false,dim:true,inverse:false,underline:true}, {fg:"",bg:"#123456",bold:true}];
 for(const input of inputs)for(const style of styles){
  assert.deepEqual(native.parseAnsi(input,style),original.parseAnsi(input,style));
  assert.equal(native.hasAnsi(input),original.hasAnsi(input));assert.equal(native.plainTerminalText(input),original.plainTerminalText(input));
 }
});

test("dashboard ANSI base properties preserve presence, ordering and arbitrary values",async()=>{
 const native=await import("toolcraft-design-rust/dashboard/ansi");const marker={};
 const styles=[{fg:undefined,bg:null,bold:false,dim:NaN,inverse:marker},{fg:marker,bg:Symbol.for("bg"),bold:1n,dim:0,inverse:"yes"},{fg:"red",bold:true}];
 for(const style of styles)for(const input of ["ab","a\x1b[31mb\x1b[39mc","a\x1b[1mb\x1b[0mc","a\rB","a\x1b[0K"]){
  const a=native.parseAnsi(input,style),b=original.parseAnsi(input,style);assert.deepEqual(a,b);
  assert.deepEqual(a.map(line=>line.segments.map(segment=>Object.keys(segment.style))),b.map(line=>line.segments.map(segment=>Object.keys(segment.style))));
 }
});

test("dashboard ANSI normalization preserves repeated getter order and thrown identity",async()=>{
 const native=await import("toolcraft-design-rust/dashboard/ansi");
 function observe(api){
  const trace=[];let reads=0;const style=new Proxy({fg:"red",bg:"blue",bold:false,dim:undefined,inverse:true},{get(target,key){trace.push(key);if(key==="fg"&&++reads===2)return undefined;return target[key];}});
  const value=api.parseAnsi("a\x1b[39mb\x1b[0mc",style);const failure={};assert.throws(()=>api.parseAnsi("x",{get fg(){throw failure;}}),error=>error===failure);
  return [value,trace];
 }
 assert.deepEqual(observe(native),observe(original));
});
