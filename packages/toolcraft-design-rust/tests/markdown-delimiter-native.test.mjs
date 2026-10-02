import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {test} from "node:test";
import {referenceInline as reference} from "./reference-markdown-inline.mjs";

const native=createRequire(import.meta.url)("../dist/toolcraft-design-rust.node");

function matchReference(input){
  const delimiters=input.map(delimiter=>({...delimiter}));
  const pairs=reference.matchDelimiterPairs(delimiters).map(pair=>({opener:delimiters.indexOf(pair.opener),closer:delimiters.indexOf(pair.closer),kind:pair.kind,sequence:pair.sequence}));
  return {delimiters,pairs};
}

test("Markdown delimiter admission follows flanking and underscore/strike rules",()=>{
  for(const marker of ["*","_","~"])for(let length=1;length<=8;length++){
    for(const before of ["","a"," ",".","\u00a0","界","。","\ud800"])for(const after of ["","b","\t","!","\u2028","界","￥","\udc00"]){
      const input=before+marker.repeat(length)+after;
      const classify=value=>Number(reference.isDelimiterWhitespace(value||null))|Number(reference.isDelimiterPunctuation(value||null))*2;
      assert.deepEqual(native.designMarkdownDelimiter(marker,length,classify(before),classify(after)),reference.parseDelimiter(input,before.length,marker),JSON.stringify(input));
    }
  }
});

test("Markdown delimiter pairing retains run lengths, trapped delimiters and sequence identity",()=>{
  const patterns=["*a*","***a***","****a****","a***b**c*","**a*b*c**","~~a~~~","~~~a~~~","*a _b* c_","a_b_c","a__b__c","*a**b***c*","**a ~~b *c*~~ d**","***a___b***c___","* _ x * _", "~~~~a~~~~"];
  for(const input of patterns){
    const delimiters=[];
    let position=0,index=0;
    while(index<input.length){
      if("*_~".includes(input[index])){
        const delimiter=reference.parseDelimiter(input,index,input[index]);
        if(delimiter){delimiters.push({...delimiter,position:position++});index+=delimiter.length;continue;}
      }
      while(index<input.length&&!"*_~".includes(input[index]))index++;
      position++;
      if(input[index]==="~"&&input[index+1]!=="~")index++;
    }
    assert.deepEqual(native.designMatchMarkdownDelimiters(delimiters),matchReference(delimiters),input);
  }
});

test("Markdown pair matching differentially covers dense and seeded delimiter graphs",()=>{
  const variants=[];
  for(const marker of ["*","_","~"])for(const length of [1,2,3,4,5,6])for(const canOpen of [false,true])for(const canClose of [false,true])variants.push({marker,length,canOpen,canClose});
  for(const opener of variants)for(const closer of variants){
    for(const position of [1,2]){
      const input=[{...opener,position:0},{...closer,position}];
      assert.deepEqual(native.designMatchMarkdownDelimiters(input),matchReference(input));
    }
  }
  let seed=0x34eec;
  for(let sample=0;sample<700;sample++){
    const input=[];
    let position=0;
    for(let index=0;index<18;index++){
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      input.push({...variants[seed%variants.length],position});
      position+=1+(seed%3);
    }
    assert.deepEqual(native.designMatchMarkdownDelimiters(input),matchReference(input),JSON.stringify(input));
  }
});
