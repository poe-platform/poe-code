import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {highlightCodeBlock as reference} from "../../toolcraft-design/dist/terminal-markdown/parser/code-highlight.js";

// Read the reference's actual vocabulary so every alias and keyword stays covered.
const source=readFileSync(new URL("../../toolcraft-design/dist/terminal-markdown/parser/code-highlight.js",import.meta.url),"utf8");
const {codeLanguages,lexicalSpecs}=await import(`data:text/javascript;base64,${Buffer.from(`${source}\nexport {codeLanguages,lexicalSpecs};`).toString("base64")}`);
const load=()=>import("../dist/code-highlight.js");

test("code highlighting matches every reference language, alias and lexical vocabulary",async()=>{
  const {highlightCodeBlock:native}=await load();
  const common='\n// hi\n# hi\n/* block */\n<# block #>\n{- block -}\n-- hi\n@decorator #[derive(Debug)] $true $value --flag -x\n"quoted\\"text" \'single\' `template` """triple"""\n-1.2e+3 1e- .25 0xff true false null Null NULL ~\n';
  for(const language of codeLanguages){
    const spec=lexicalSpecs[language.spec]??{};
    const words=Object.values(spec).filter(value=>value instanceof Set).flatMap(value=>[...value]);
    const value=[...words,...words.map(word=>word.toUpperCase()),...words.map(word=>word.toLowerCase())].join(" ")+common;
    for(const lang of new Set([language.id,...language.aliases,...language.aliases.map(alias=>alias.toUpperCase())])){
      assert.deepEqual(native({lang,value}),reference({lang,value}),lang);
    }
  }
});

test("code highlighting preserves UTF-16 and malformed input across tokenizer families",async()=>{
  const {highlightCodeBlock:native}=await load();
  const values=["", "ordinary words",'"end\\', "'''unterminated\\",'"""a\\"""b"""',"/*", "<!--", "<tag attr='end", "</tag/>tail", "<!doctype html>", "<svg:path data-id=\"x\">", "[table]\nx = true\ny: null\n; comment", "  key  : value\n- key: 2\n  # note", "@media .card { --color: #123456789 !important; x: -.5e+2; }", "+add\n-remove\n unchanged", "FROM node\n RUN echo 1\n# hi", "# heading\n x # comment", "😀\ud800a\udfff\0\r\n\u2028\u00a0\t-9.4e-2"];
  let seed=0x13579;
  const alphabet="azAZ_09-+eE.$#@/\\*[]{}()<>!?=:\"'` \t\n\r\ud800\udc00";
  for(let sample=0;sample<120;sample++){
    let value="";
    for(let i=0;i<80;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;value+=alphabet[seed%alphabet.length];}
    values.push(value);
  }
  for(const lang of ["js","python","bash","sql","rust","powershell","haskell","json","jsonc","yaml","toml","css","diff","md","dockerfile","html"]){
    for(const value of values){
      const actual=native({lang,value});
      assert.deepEqual(actual,reference({lang,value}),`${lang}: ${JSON.stringify(value)}`);
      if(actual)assert.equal(actual.map(token=>token.value).join(""),value);
    }
  }
});

test("code highlighting preserves supplied token identity and lazy ingress reads",async()=>{
  const {highlightCodeBlock:native}=await load();
  function run(highlight,lang,tokens){
    const trace=[];
    const node={get tokens(){trace.push("tokens");return tokens;},get lang(){trace.push("lang");return lang;},get value(){trace.push("value");return "const x = true";}};
    return [highlight(node),trace];
  }
  for(const lang of [undefined,"","text","unknown","TS"]){
    for(const tokens of [undefined,null,[],[{kind:"plain",value:"given"}]]){
      assert.deepEqual(run(native,lang,tokens),run(reference,lang,tokens));
      if(tokens!==undefined)assert.equal(native({tokens}),tokens);
    }
  }
  const thrown={};
  assert.throws(()=>native({get tokens(){throw thrown;}}),error=>error===thrown);
  assert.equal(native.name,reference.name);assert.equal(native.length,reference.length);
  // Tokens are read a second time when present, and value is read separately for length and tokenization.
  for(const highlight of [reference,native]){
    let reads=0;
    assert.equal(highlight({get tokens(){return ++reads===1?[]:null;}}),null);
    reads=0;
    assert.deepEqual(highlight({lang:"js",get value(){return ++reads===1?"x":"true";}}),[{kind:"boolean",value:"true"}]);
  }
});
