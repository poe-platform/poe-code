import assert from "node:assert/strict";
import {test} from "node:test";
import {ansiToCells as original} from "../../toolcraft-design/dist/screen/ansi-text.js";

test("ANSI cells retain terminal controls, line boundaries and grapheme styles",async()=>{
  const {ansiToCells}=await import("toolcraft-design-rust/screen/ansi-text");
  assert.equal(ansiToCells.name,original.name);assert.equal(ansiToCells.length,original.length);
  const cases=["","plain","a\nb\n","\rabc\bX","界\bZ","\tA","abc\r\tZ","a\x1b[K","abc\r\x1b[1KZ","abc\x1b[2KZ","\x1b[8m界x\x1b[28mY","a\x1b]0;hidden\x07b","a\x1bPsecret\x1b\\b","\u009b31mR\u0085N","🙂é🇺🇸👩‍💻\ud800","a\x1b[31ḿb","🇺\x1b[0m🇸","🇺\x1b[31m🇸","\x1b[31mR\x1b[0m🙂","\x1b[1;2;4;7mA\x1b[22;27mB","\x1b[38:2::255:0:0mtruecolor","\x1b[48;5;0mblack","\x1b[99999999999999999999999999999mN","a\x1b[","\x1b[38;2mZ"];
  for(let code=0;code<110;code++)cases.push(`a\x1b[${code}mX\x1b[0mY`);
  for(const color of [-1,0,1,7,8,15,16,231,232,255,256])cases.push(`\x1b[38;5;${color};48;5;${255-color}mX`);
  for(const input of cases)assert.deepEqual(ansiToCells(input),original(input),JSON.stringify(input));
});

test("ANSI cell conversions return independent cells",async()=>{
  const {ansiToCells}=await import("toolcraft-design-rust/screen/ansi-text");
  const first=ansiToCells("aba\naba"),second=ansiToCells("aba\naba");
  first[0].ch="changed";first[1].style=3;
  assert.deepEqual(second,original("aba\naba"));assert.equal(first[2].ch,"a");
});

test("ANSI cells match mixed control sequences and preserve segmentation failures",async()=>{
  const {ansiToCells}=await import("toolcraft-design-rust/screen/ansi-text");
  const pieces=["ab","🙂","́","🇺","🇸","\r","\n","\t","\b","\x1b[1m","\x1b[2m","\x1b[7m","\x1b[0m","\x1b[31m","\x1b[30m","\x1b[91m","\x1b[92m","\x1b[8m","\x1b[28m","\x1b[K","\x1b[1K","\x1b[2K","\x1b]hidden\x07"];
  let seed=781;
  for(let sample=0;sample<100;sample++){
    let input="";for(let index=0;index<20;index++){seed=(seed*1664525+1013904223)>>>0;input+=pieces[seed%pieces.length];}
    assert.deepEqual(ansiToCells(input),original(input),JSON.stringify(input));
  }
  const saved=Intl.Segmenter.prototype.segment;
  try{for(const failure of [undefined,null,{},"stop"]){Intl.Segmenter.prototype.segment=function(){throw failure;};for(const convert of [original,ansiToCells]){let caught=false;try{convert("é");}catch(error){caught=true;assert.equal(error,failure);}assert.equal(caught,true);}}}
  finally{Intl.Segmenter.prototype.segment=saved;}
});
