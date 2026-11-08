import assert from "node:assert/strict";
import {test} from "node:test";
import {referenceMarkdown as reference} from "./reference-markdown.mjs";
const load=()=>import("../dist/markdown-inline.js");
const text=value=>({type:"text",value});
const context=(width=20)=>({width,theme:{accent:value=>`<accent>${value}</accent>`,muted:value=>`<muted>${value}</muted>`}});

test("Markdown inline rendering preserves nested styles, code, images and raw HTML",async()=>{
  const native=await load();
  const nodes=[text("ready \x1b[31mred\x1b[0m "),{type:"strong",children:[text("bold "),{type:"emphasis",children:[text("nested 界面")]}]},text(" "),{type:"strikethrough",children:[text("old")]},{type:"break"},{type:"inlineCode",value:"const ready = true"},{type:"image",alt:"figure"},{type:"image",alt:""},{type:"html",value:"<b>plain</b> <incomplete"},{type:"unknown",children:[text("fallback")]},{type:"unknown"}];
  for(const width of [1,2,7,20,80])assert.deepEqual(native.renderInline(nodes,context(width)),reference.renderInline(nodes,context(width)));
  const flatten=tokens=>tokens.map(token=>token.type==="word"?{type:token.type,value:token.value,styles:token.formatters.map(formatter=>formatter("sample"))}:token);
  assert.deepEqual(flatten(native.tokenizeInline(nodes,context())),flatten(reference.tokenizeInline(nodes,context())));
});

test("Markdown links retain autolink rules, trailing spaces and URL suffixes",async()=>{
  const native=await load();
  for(const [url,label] of [["https://example.com","https://example.com"],["http://example.com","example.com"],["mailto:a@example.com","a@example.com"],["https://example.com","example.com"],["http://example.com","http://other"],["/local","Label"],["/local",""]]){
    for(const children of [[text(label)],[text(label+"  ")],[{type:"strong",children:[text(label)]}],[]]){
      const nodes=[{type:"link",url,children},text(" after")];
      for(const width of [3,12,80])assert.deepEqual(native.renderInline(nodes,context(width)),reference.renderInline(nodes,context(width)));
    }
  }
});

test("Markdown inline tokenization preserves getters, formatters and nested iteration order",async()=>{
  const native=await load();
  function run(render){
    const trace=[],wrap=(label,value)=>new Proxy(value,{get(target,key){trace.push([label,String(key)]);return Reflect.get(target,key);},has(target,key){trace.push([label,"has",key]);return key in target;}});
    const nodes=[wrap("link",{type:"link",url:"http://example.com",children:[text("example.com")]}),wrap("image",{type:"image",alt:"alt"}),wrap("code",{type:"inlineCode",value:"a b"})];
    const ctx=wrap("ctx",{width:50,theme:wrap("theme",{accent(value){trace.push(["accent",this,value]);return value;},muted(value){trace.push(["muted",this,value]);return value;}})});
    return [render(nodes,ctx),trace];
  }
  assert.deepEqual(run(native.renderInline),run(reference.renderInline));
  const thrown={};
  function fail(tokenize){const trace=[];const inner={*[Symbol.iterator](){try{yield {get type(){throw thrown;}};}finally{trace.push("inner");}}};const nodes={*[Symbol.iterator](){try{yield {type:"strong",children:inner};}finally{trace.push("outer");}}};assert.throws(()=>tokenize(nodes,context()),error=>error===thrown);return trace;}
  assert.deepEqual(fail(native.tokenizeInline),fail(reference.tokenizeInline));
});

test("Markdown inline footnotes retain Map state, admission and numbering order",async()=>{
  const native=await load();
  function run(render){const ctx={...context(),footnotes:{definitions:new Map([["b",{}],["a",{}]]),labelsInOrder:[],numbers:new Map()}};const result=render(["missing","b","a","b"].map(label=>({type:"footnoteReference",label})),ctx);return [result,ctx.footnotes.labelsInOrder,[...ctx.footnotes.numbers]];}
  assert.deepEqual(run(native.renderInline),run(reference.renderInline));
  for(const label of ["a",undefined,null])for(const result of [undefined,null,0,"custom"]){
    function run(resolve){const trace=[];const footnotes={definitions:{has(value){trace.push(["has",value]);return {}; }},numbers:{size:4,get(value){trace.push(["get",value]);return result;},set(label,value){trace.push(["set",label,value]);}},labelsInOrder:{push(value){trace.push(["push",value]);}}};return [resolve(label,{footnotes}),trace];}
    assert.deepEqual(run(native.resolveFootnoteNumber),run(reference.resolveFootnoteNumber));
  }
});
