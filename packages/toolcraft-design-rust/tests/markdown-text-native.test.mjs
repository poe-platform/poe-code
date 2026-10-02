import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import ts from "typescript";

// Expose the original renderer's private helpers without copying their algorithms.
const url=new URL("../../toolcraft-design/dist/terminal-markdown/renderer.js",import.meta.url);
let source=readFileSync(url,"utf8");
const syntax=ts.createSourceFile(url.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
for(const declaration of syntax.statements.filter(ts.isImportDeclaration).reverse()){
  const specifier=declaration.moduleSpecifier;
  source=source.slice(0,specifier.getStart(syntax))+JSON.stringify(new URL(specifier.text,url).href)+source.slice(specifier.end);
}
const names=["stripHtmlTags","tokenizeText","trimTrailingSpaces","wrapTokens","splitWord","wrapText"];
const reference=await import(`data:text/javascript;base64,${Buffer.from(`${source}\nexport {${names.join(",")}};`).toString("base64")}`);
const load=()=>import("../dist/markdown-text.js");
const values=[""," ","\t leading\twords  trailing \t","a\nb\n\n","\r\n CRLF\r\n", "界面 😀 e\u0301 👩‍💻 🇯🇵", "\ud800a\udfff", "a\u00a0b\u2003c\u2028d", "\x1b[31mred\x1b[0m plain", "<b>bold</b> outside > <<unfinished"];

test("Markdown text tokenization and tag stripping retain UTF-16, whitespace and formatter identity",async()=>{
  const native=await load(),formatters=[value=>`<${value}>`];
  for(const value of values){
    const tokens=native.tokenizeText(value,formatters);
    assert.deepEqual(tokens,reference.tokenizeText(value,formatters));
    for(const token of tokens)if(token.type==="word")assert.equal(token.formatters,formatters);
    assert.equal(native.stripHtmlTags(value),reference.stripHtmlTags(value));
    assert.deepEqual(native.trimTrailingSpaces(tokens),reference.trimTrailingSpaces(tokens));
  }
});

test("Markdown wrapping matches grapheme boundaries, gaps, explicit breaks and fractional widths",async()=>{
  const native=await load();
  for(const value of values)for(const width of [0,0.5,1,1.5,2,3,7,12,40,Infinity]){
    assert.deepEqual(native.splitWord(value,width),reference.splitWord(value,width),`${JSON.stringify(value)} / ${width}`);
    assert.deepEqual(native.wrapText(value,width),reference.wrapText(value,width));
  }
  const formatters=[value=>`\x1b[31m${value}\x1b[0m`,value=>`\x1b[1m${value}\x1b[22m`];
  for(const width of [1,3,7,20]){
    const tokens=[...reference.tokenizeText("hello   界面\nwide 👩‍💻 words",formatters),{type:"break"},{type:"space",value:"  "}];
    assert.deepEqual(native.wrapTokens(tokens,width),reference.wrapTokens(tokens,width));
  }
});

test("Markdown wrapping preserves token getters, formatter receivers and width coercion order",async()=>{
  const native=await load();
  function run(wrap){
    const trace=[],width={valueOf(){trace.push("width");return 4;}};
    const formatters=[function(value){trace.push(["formatter",this,value]);return value.toUpperCase();}];
    const token=new Proxy({type:"word",value:"hello",formatters},{get(target,key){trace.push(["get",key]);return target[key];}});
    const input={*[Symbol.iterator](){try{yield {type:"space",value:"ignored"};yield token;yield {type:"space",value:"  "};yield token;}finally{trace.push("closed");}}};
    return [wrap(input,width),trace];
  }
  assert.deepEqual(run(native.wrapTokens),run(reference.wrapTokens));
});

test("Markdown token iteration closes on arbitrary formatter throws and supports reentry",async()=>{
  const native=await load(),thrown={};
  function run(wrap){const trace=[];const input={*[Symbol.iterator](){try{yield {type:"word",value:"value",formatters:[()=>{throw thrown;}]};}finally{trace.push("closed");}}};assert.throws(()=>wrap(input,8),error=>error===thrown);return trace;}
  assert.deepEqual(run(native.wrapTokens),run(reference.wrapTokens));
  for(const wrap of [native.wrapTokens,reference.wrapTokens])assert.deepEqual(wrap([{type:"word",value:"abcd",formatters:[value=>wrap([{type:"word",value,formatters:[]}],1).join("-")]}],2),["a-b","c-d"]);
});

test("Markdown trailing spaces retain optional accesses and slice receivers",async()=>{
  const native=await load();
  function run(trim){const trace=[];const input={length:4,0:{type:"word",value:"a"},1:undefined,2:{type:"space"},3:{type:"space"},slice(start,end){trace.push([start,end,this===input]);return "custom";}};return [trim(input),trace];}
  assert.deepEqual(run(native.trimTrailingSpaces),run(reference.trimTrailingSpaces));
  function tags(strip){const trace=[];const input={*[Symbol.iterator](){try{yield "<";yield "hidden";yield ">";yield {toString(){trace.push("coerce");return "<visible>";}};}finally{trace.push("closed");}}};return [strip(input),trace];}
  assert.deepEqual(tags(native.stripHtmlTags),tags(reference.stripHtmlTags));
});
