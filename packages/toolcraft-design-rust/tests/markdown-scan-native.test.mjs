import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {test} from "node:test";

const source=readFileSync(new URL("../../toolcraft-design/dist/terminal-markdown/parser/inline.js",import.meta.url),"utf8");
const names=["parseInlineCode","parseBracketedLabel","parseLinkDestination","parseAutolink","parseLiteralAutolink","parseInlineHtmlTag","decodeEscapes","createOffsetMap","INLINE_HTML_TAGS"];
const reference=await import(`data:text/javascript;base64,${Buffer.from(`${source}\nexport {${names.join(",")}};`).toString("base64")}`);
const native=createRequire(import.meta.url)("../dist/toolcraft-design-rust.node");

function compare(kind,input,start=0){
  assert.deepEqual(native.designScanMarkdown(kind,input,start),reference[kind](input,start),`${kind} at ${start}: ${JSON.stringify(input)}`);
}

test("Markdown scanners preserve code fences, bracket depth, escaped destinations and titles",()=>{
  const cases={
    parseInlineCode:["`x`","`` `x` ``","` x `","`  `","`a\nb`","``x`y``","`unclosed","```a``b```","`😀\ud800\0`"],
    parseBracketedLabel:["[a]","[a[b]c]","[a\\]b]","[a`[x]`b]","[a``]``b]","[a`b]","[a\\q]","[", "[😀\ud800]"],
    parseLinkDestination:["()","( \t)","(url)","(url \"title\")","(url 'ti\\'tle')","(url \"\")","( \"title\")","(\"title\")","(url(title))","(url\\(x\\))","(<https://a>)","(a\\q)","(a\n\"title\")","(a \"unfinished)","(a\"b)","(a '\\\\' )","(😀\ud800 \"x\")"]
  };
  for(const [kind,inputs] of Object.entries(cases))for(const input of inputs){compare(kind,input);compare(kind,`prefix${input}tail`,6);}
});

test("Markdown scanners preserve scheme admission and literal URL/email boundaries",()=>{
  for(const input of ["<https://a>","<a:b>","<ab:>","<A+.-2:x>","<a_b:x>","<mailto:a@b.c>","<a@b.c>","<https://a b>","<https://a\nb>","<https://a\rb>","<https://a\u00a0b>","<>","<https://a", "<https://😀\ud800>"])compare("parseAutolink",input);
  const urls=["http://a","https://a/x(y)).","http://","HTTPS://a","www.example.com","www.a","www..","www.a.b/path!","a.b+tag@domain.test","a@b","a@.b.c","a@b..c","a@b.c@d.e","a%_+-@b-c.d","https://a/{x}]?!","https://a/a(b)c)","https://a\u00a0b","https://😀\ud800","https://a\rnext"];
  for(const url of urls)for(const prefix of [""," ","(","](","a","0","_",".","+","-","@","/",":","😀"]){compare("parseLiteralAutolink",prefix+url,prefix.length);}
});

test("Markdown HTML scanner covers every admitted tag and malformed attributes",()=>{
  for(const tag of reference.INLINE_HTML_TAGS){
    for(const input of [`<${tag}>hi</${tag}>tail`,`<${tag.toUpperCase()} a='x'>hi</${tag.toUpperCase()} >`,`<${tag}/>`,`</${tag}\t>`])compare("parseInlineHtmlTag",input);
  }
  compare("parseInlineHtmlTag","<mark>Unicode closing tag</marK>tail");
  for(const input of ["<custom>x</custom>","<div-name>","<span><span>x</span>tail</span>","<span a='>'>x</span>","<span a=>","<span a=foo/>","<span a=foo<>","<span a=`x`>","<span a=\"x>","<span\na=x>","<span a=x\ny>","<span :x._-0 = 'value' disabled>","<span / >", "<span /x>","</span x>","<span>abc</spanish>tail", "<span>abc</SPAN\t>tail","<!--x-->","<!doctype html>","<>" ])compare("parseInlineHtmlTag",input);
});

test("Markdown escapes and byte offsets retain surrogate halves and absolute offsets",()=>{
  let punctuation="";
  for(let unit=0;unit<128;unit++)punctuation+=`\\${String.fromCharCode(unit)}`;
  for(const input of [punctuation,"\\😀\\\ud800\\", "Aé界😀\ud800X\udfff", "\ud800\ud800\udc00\udc00", ""]){
    compare("decodeEscapes",input);
    for(const offset of [0,7,-2,0.5,Number.MAX_SAFE_INTEGER])compare("createOffsetMap",input,offset);
  }
});

test("Markdown scanners differentially handle seeded malformed UTF-16 input",()=>{
  let seed=0x72ef1;
  const alphabet="azAZ09:/\\ \t\n\r\"'`[]()<>!@._-+%{};,?=\ud800\udc00";
  for(let sample=0;sample<350;sample++){
    let input="";
    for(let i=0;i<40;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;input+=alphabet[seed%alphabet.length];}
    for(const [kind,prefix,suffix] of [["parseInlineCode","``","``"],["parseBracketedLabel","[","]"],["parseLinkDestination","(",")"],["parseAutolink","<ab:",">"],["parseLiteralAutolink","http://",""],["parseLiteralAutolink","www.a.",""],["parseLiteralAutolink","a@b.",""],["parseInlineHtmlTag","<span ",">tail</span>"]])compare(kind,prefix+input+suffix);
    compare("decodeEscapes",input);compare("createOffsetMap",input,13);
  }
});
