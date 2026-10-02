import assert from "node:assert/strict";
import {test} from "node:test";
import {referenceInline as reference} from "./reference-markdown-inline.mjs";

const load=()=>import("../dist/markdown-parse-inline.js");
function snapshot(nodes){
  return nodes.map(node=>({keys:Reflect.ownKeys(node),descriptor:Object.getOwnPropertyDescriptor(node,"range"),node:{...node,...(node.children?{children:snapshot(node.children)}:{})}}));
}
function compare(parse,input,options={}){
  assert.deepEqual(snapshot(parse(input,options)),snapshot(reference.parseInline(input,options)),JSON.stringify(input));
}

test("inline Markdown parser preserves nodes, hidden byte ranges and normalization",async()=>{
  const {parseInline}=await load();
  const cases=["","plain 😀 café 界","\\*escaped\\* \\q", "a\\\nb", "a\\\\\nb", "a \t\nb", "a \nb", "  \nx", "` x ` and `` `y` ``", "***strong emphasis***", "**a *b* c**", "a_b_c", "~~strike~~ ~plain~", "***a___b***c___", "*a _b* c_", "[**label**](url \"title\")", "[outer [inner](u)](v)", "![a\\]b](image 'title')", "<https://example.com/a>", "https://example.com/a(b)). next", "www.example.com and a+b@example.com", "[https://a www.a.b a@b.c](x)", "<span a='>'>**raw**</span> after", "<mark>text</marK>", "[^one] [^missing] [^bad label]", "😀***é\ud800***\udfff", "a*\u00a0b* \u2028_x_", "***`x`***", "[]() ![]() * *", "\0\r\n\ud800\udc00"];
  for(const input of cases)for(const options of [{},{offset:17},{allowLiteralAutolinks:false},{footnoteLabels:new Set(["one"])}])compare(parseInline,input,options);
  assert.equal(parseInline.name,reference.parseInline.name);assert.equal(parseInline.length,reference.parseInline.length);
});

test("inline Markdown parser preserves sparse/custom offset maps and source-range descriptors",async()=>{
  const {parseInline}=await load();
  const input="😀 [*a*](u) **x**\\!";
  const sparse=Object.assign(new Array(3),{0:10,2:30});
  for(const offsets of [[],[99],sparse,Array.from({length:input.length+1},(_,i)=>100-i),Array.from({length:input.length+1},(_,i)=>i%3===0?NaN:i/3)])compare(parseInline,input,{offsets});
  for(const result of [null,undefined]){
    const offsets=Array.from({length:input.length+1},(_,i)=>i+50);
    offsets.slice=()=>result;
    compare(parseInline,input,{offsets});
  }
  for(const parse of [parseInline,reference.parseInline]){
    const [node]=parse("hello");
    assert.equal(JSON.stringify(node),'{"type":"text","value":"hello"}');
    node.range={start:1,end:2};assert.equal(node.range.start,1);
    assert.equal(delete node.range,true);
  }
});

test("inline Markdown parser rejects excessive native and callback recursion and recovers",async()=>{
  const {parseInline}=await load();
  assert.throws(()=>parseInline("[".repeat(140)+"x"+"](u)".repeat(140)),RangeError);
  assert.throws(()=>parseInline("*".repeat(300)+"x"+"*".repeat(300)),RangeError);
  const options={footnoteLabels:{has(){return parseInline("[^one]",options);}}};
  assert.throws(()=>parseInline("[^one]",options),RangeError);
  compare(parseInline,"**recovers**");
});

test("inline Markdown parser keeps option/offset access order and lazy footnote membership",async()=>{
  const {parseInline}=await load();
  function run(parse){
    const trace=[];
    const offsets=new Proxy(Array.from({length:100},(_,i)=>i*2),{get(target,key,receiver){trace.push(`offset:${String(key)}`);return Reflect.get(target,key,receiver);}});
    const labels={has(label){trace.push(`has:${label}:${this===labels}`);return label==="one"?{}:false;}};
    const options={get footnoteLabels(){trace.push("labels");return labels;},get allowLiteralAutolinks(){trace.push("literal");return null;},get offsets(){trace.push("offsets");return offsets;},get offset(){trace.push("offset");return 3;}};
    return [snapshot(parse("a[^one] [^two] [*link*](url) **bold**",options)),trace];
  }
  assert.deepEqual(run(parseInline),run(reference.parseInline));
  for(const thrown of [undefined,null,7,"failure",{},new Error("callback")]){
    assert.throws(()=>parseInline("[^one]",{footnoteLabels:{has(){throw thrown;}}}),error=>error===thrown);
  }
  for(const parse of [parseInline,reference.parseInline]){
    assert.deepEqual(parse("plain",{footnoteLabels:null}).map(node=>({...node})),[{type:"text",value:"plain"}]);
    assert.throws(()=>parse("[^one]",{footnoteLabels:null}),TypeError);
  }
});

test("inline Markdown parser differentially covers seeded punctuation and nested syntax",async()=>{
  const {parseInline}=await load();
  const pieces=["a"," ","\n","*","**","***","_","__","~~","\\*","`x`","[x](u)","![x](i)","<span>x</span>","<ab:x>","https://a","[^one]","😀","\ud800","。","\u00a0"];
  let seed=0x813ff;
  for(let sample=0;sample<650;sample++){
    let input="";
    for(let i=0;i<16;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;input+=pieces[seed%pieces.length];}
    compare(parseInline,input,{footnoteLabels:new Set(["one"]),offset:9});
  }
  for(let depth=1;depth<=30;depth++){
    compare(parseInline,"*".repeat(depth)+"x"+"*".repeat(depth));
    compare(parseInline,"[".repeat(depth)+"x"+"](url)".repeat(depth));
  }
});
