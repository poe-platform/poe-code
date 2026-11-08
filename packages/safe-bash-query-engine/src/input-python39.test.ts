import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {Decimal} from './numbers.js';
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
 for(const bytes of [new Uint8Array(),new TextEncoder().encode('{}\n{}\n'),new TextEncoder().encode('1\0\0'),Uint8Array.of(34,0xff,34)])for(const stream of [false,true]){
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

test('Python JSON byte encoding detection matches pinned reference across arbitrary chunk boundaries',async()=>{
 const encodings=JSON.parse(readFileSync(new URL('./input-python39-encoding.json',import.meta.url),'utf8')) as {label:string;base64:string;valid:boolean;value?:string|number}[];
 for(const fixture of encodings)for(const size of [1,3,4096]){
  const bytes=Uint8Array.from(atob(fixture.base64),c=>c.charCodeAt(0));
  const b=new Budget(resolveJqLimits(),new AbortController().signal),values:unknown[]=[];
  const run=async()=>{for await(const value of jsonValues({async *[Symbol.asyncIterator](){for(let i=0;i<bytes.length;i+=size)yield bytes.subarray(i,i+size);}},b,{profile:'python39'}))values.push(value);};
  if(!fixture.valid)await assert.rejects(run,fixture.label);
  else{await run();assert.equal(values.length,1);assert.equal(typeof fixture.value==='number'?Number(values[0] instanceof Decimal?values[0].text:values[0]):values[0],fixture.value,fixture.label);assert.equal(b.inputBytes,bytes.length);}
 }
});

test('Python byte transcoding charges original bytes and preserves early-return cleanup',async()=>{
 const bytes=Uint8Array.of(255,254,34,0,0x2d,0x4e,34,0); // UTF-16LE "中"
 for(const limit of [bytes.length-1,bytes.length]){
  const b=new Budget(resolveJqLimits({maxInputBytes:limit}),new AbortController().signal);let retired=false;
  const run=async()=>{for await(const value of jsonValues({async *[Symbol.asyncIterator](){try{yield bytes;}finally{retired=true;}}},b,{profile:'python39'}))assert.equal(value,'中');};
  if(limit<bytes.length)await assert.rejects(run,/maxInputBytes/);else await run();
  assert.equal(retired,true);assert.equal(b.inputBytes,bytes.length);
 }
 let retired=false;
 const b=new Budget(resolveJqLimits(),new AbortController().signal);
 for await(const value of jsonValues({async *[Symbol.asyncIterator](){try{yield new TextEncoder().encode('["first",');assert.fail('read after early return');}finally{retired=true;}}},b,{profile:'python39',stream:true,stringChunks:{maxControlBytes:65536}})){void value;break;}
 assert.equal(retired,true);
});

test('Python UTF-32 input streams a large string through bounded text events',async()=>{
 const b=new Budget(resolveJqLimits({maxInputBytes:Infinity,maxValueBytes:Infinity}),new AbortController().signal);let length=0;
 const block=new Uint8Array(4096);for(let i=0;i<block.length;i+=4){block[i]=0x42;block[i+1]=0xf6;block[i+2]=1;}
 const input={async *[Symbol.asyncIterator](){yield Uint8Array.of(255,254,0,0,34,0,0,0);for(let i=0;i<128;i++)yield block;yield Uint8Array.of(34,0,0,0);}};
 for await(const event of jsonValues(input,b,{profile:'python39',stream:true,stringChunks:{maxControlBytes:65536}}))if(Array.isArray(event)&&event.length===3){assert.equal(typeof event[1],'string');const text=String(event[1]);assert.ok(text.length<=4096);length+=text.length;}
 assert.equal(length,128*2048);assert.equal(b.inputBytes,128*4096+12);
});


test('Python lossless string events distinguish raw surrogate code points from supplementary characters',async()=>{
 const raw=Uint8Array.of(0xed,0xa0,0x80,0xed,0xb0,0x80), scalar=Uint8Array.of(0xf0,0x90,0x80,0x80);
 for(const size of [1,3,4096]){
  const bytes=Uint8Array.from([123,34,...raw,34,58,34,...raw,34,44,34,...scalar,34,58,34,...scalar,34,125]);
  const b=new Budget(resolveJqLimits(),new AbortController().signal),values:unknown[]=[];
  for await(const event of jsonValues({async *[Symbol.asyncIterator](){for(let i=0;i<bytes.length;i+=size)yield bytes.subarray(i,i+size);}},b,{profile:'python39',stream:true,stringChunks:{maxControlBytes:65536,codePoints:true}})){
   if(Array.isArray(event)&&typeof event[2]==='boolean')values.push(event[3]);
  }
  assert.deepEqual(values,[{key:[0xd800,0xdc00],points:[0xd800,0xdc00]},{key:[0x10000],points:[0x10000]}]);
 }
});

test('lossless JSON byte decoding matches pinned Python 3.9 surrogatepass across encodings',async()=>{
 const fixtures=JSON.parse(readFileSync(new URL('./input-python39-surrogates.json',import.meta.url),'utf8')) as {encoding:string;base64:string;points:number[]}[];
 for(const fixture of fixtures)for(const size of [1,3,4096]){
  const bytes=Uint8Array.from(atob(fixture.base64),c=>c.charCodeAt(0)),actual:number[]=[];
  const b=new Budget(resolveJqLimits(),new AbortController().signal);
  for await(const event of jsonValues({async *[Symbol.asyncIterator](){for(let i=0;i<bytes.length;i+=size)yield bytes.subarray(i,i+size);}},b,{profile:'python39',stream:true,stringChunks:{maxControlBytes:65536,codePoints:true}})){
   if(Array.isArray(event)&&typeof event[2]==='boolean')actual.push(...(event[3] as {points:number[]}).points);
  }
  assert.deepEqual(actual,fixture.points,fixture.encoding+' '+fixture.base64);
 }
});

test('lossless Python chunks keep raw surrogates separate and reject malformed UTF8',async()=>{
 const prefix=new TextEncoder().encode('"'+'a'.repeat(4095));
 const bytes=Uint8Array.from([...prefix,0xed,0xa0,0x80,0xed,0xb0,0x80,34]),points:number[]=[];
 const b=new Budget(resolveJqLimits(),new AbortController().signal);
 for await(const event of jsonValues({async *[Symbol.asyncIterator](){for(let i=0;i<bytes.length;i+=7)yield bytes.subarray(i,i+7);}},b,{profile:'python39',stream:true,stringChunks:{maxControlBytes:65536,codePoints:true}})){
  if(Array.isArray(event)&&typeof event[2]==='boolean'){const part=(event[3] as {points:number[]}).points;assert.ok(part.length<=8192);points.push(...part);}
 }
 assert.deepEqual(points.slice(-2),[0xd800,0xdc00]);assert.equal(points.length,4097);
 for(const bytes of [[0xff],[0xc0,0x80],[0xe0,0x80,0x80],[0xf4,0x90,0x80,0x80],[0xc2],[0xe2,0x28,0xa1]]){
  let retired=false;
  await assert.rejects(async()=>{for await(const event of jsonValues({async *[Symbol.asyncIterator](){try{yield Uint8Array.from([34,...bytes,34]);}finally{retired=true;}}},new Budget(resolveJqLimits(),new AbortController().signal),{profile:'python39',stream:true,stringChunks:{maxControlBytes:65536,codePoints:true}}))void event;});
  assert.equal(retired,true);
 }
});
