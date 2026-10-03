import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {jsonValues} from './input.js';
import {Budget,resolveJqLimits} from './limits.js';
const fixtures=JSON.parse(readFileSync(new URL('./input-python39.json',import.meta.url),'utf8')) as {input:string;valid:boolean;codepoints:number[]|null}[];
test('Python JSON profile matches pinned Python 3.9 scalar grammar and escaped surrogates',async()=>{
 for(const fixture of fixtures){
  const b=new Budget(resolveJqLimits(),new AbortController().signal);let text='';
  const run=async()=>{for await(const event of jsonValues({async *[Symbol.asyncIterator](){yield new TextEncoder().encode(fixture.input);}},b,{stream:true,stringChunks:{maxControlBytes:65536},profile:'python39'}))if(Array.isArray(event)&&event.length===3)text+=event[1];};
  if(!fixture.valid)await assert.rejects(run,fixture.input);
  else{await run();if(fixture.codepoints)assert.deepEqual(Array.from(text,c=>c.codePointAt(0)),fixture.codepoints,fixture.input);}
 }
});
test('optional container events distinguish root and nested types and boundaries',async()=>{
 const b=new Budget(resolveJqLimits(),new AbortController().signal),events:unknown[]=[];
 for await(const event of jsonValues({async *[Symbol.asyncIterator](){yield new TextEncoder().encode('[{"id":{},"body":[]}]');}},b,{stream:true,stringChunks:{maxControlBytes:65536,containers:true}}))if(Array.isArray(event)&&event.length===3)events.push(event);
 assert.deepEqual(events,[[[],'[','open'],[[0],'{','open'],[[0,'id'],'{','open'],[[0,'id'],'}','close'],[[0,'body'],'[','open'],[[0,'body'],']','close'],[[0],'}','close'],[[],']','close']]);
});
test('Python document profile rejects extra documents, empty input, NUL tails and invalid UTF8',async()=>{
 for(const bytes of [new Uint8Array(),new TextEncoder().encode('{}\n{}\n'),new TextEncoder().encode('1\0'),Uint8Array.of(34,0xff,34)])for(const stream of [false,true]){
  const b=new Budget(resolveJqLimits(),new AbortController().signal);
  await assert.rejects(async()=>{for await(const event of jsonValues({async *[Symbol.asyncIterator](){yield bytes;}},b,{stream,profile:'python39'}))void event;});
 }
});
test('Python string chunks preserve unmatched surrogates at chunk boundaries',async()=>{
 for(const escaped of ['\\ud800','\\udfff','\\ud800\\u0041','\\ud83d\\ude00'])for(const size of [1,4096]){
  const input='"'+'x'.repeat(4093)+escaped+'tail"',bytes=new TextEncoder().encode(input);
  const b=new Budget(resolveJqLimits(),new AbortController().signal);let actual='';
  for await(const event of jsonValues({async *[Symbol.asyncIterator](){for(let i=0;i<bytes.length;i+=size)yield bytes.subarray(i,i+size);}},b,{stream:true,stringChunks:{maxControlBytes:65536},profile:'python39'}))if(Array.isArray(event)&&event.length===3)actual+=event[1];
  assert.equal(actual,JSON.parse(input));
 }
});
test('Python profile retains numeric spelling needed to distinguish integer and float IDs',async()=>{
 const b=new Budget(resolveJqLimits(),new AbortController().signal),tokens:string[]=[];
 for await(const event of jsonValues({async *[Symbol.asyncIterator](){yield new TextEncoder().encode('[1,1.0,1e0,-0,-0.0,123456789012345678901234567890,NaN,Infinity]');}},b,{stream:true,profile:'python39'})){
  if(Array.isArray(event)&&event.length===2){const value=event[1];if(value&&typeof value==='object'&&'text' in value)tokens.push(String(value.text));}
 }
 assert.deepEqual(tokens,['1','1.0','1e0','-0','-0.0','123456789012345678901234567890','NaN','Infinity']);
});
