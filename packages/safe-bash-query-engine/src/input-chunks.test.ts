import assert from 'node:assert/strict';
import test from 'node:test';
import {jsonValues} from './input.js';
import {Budget,resolveJqLimits,type Json} from './limits.js';

const budget=()=>new Budget(resolveJqLimits({maxValueBytes:Infinity,maxInputBytes:Infinity,maxSteps:Infinity}),new AbortController().signal);
test('chunked JSON strings deliver bounded payloads before the producer finishes',async()=>{
 const b=budget();let delivered=0,ended=false,retired=false;const paths:Json[]=[];
 const source={async *[Symbol.asyncIterator](){try{yield new TextEncoder().encode('[{"id":"one","body":"');for(let i=0;i<1024;i++){if(i>4)assert.ok(delivered>0);yield new Uint8Array(4096).fill(120);}ended=true;yield new TextEncoder().encode('"}]');}finally{retired=true;}}};
 {for await(const event of jsonValues(source,b,{stream:true,stringChunks:{maxControlBytes:65536}})){
  assert.ok(Array.isArray(event));if(event.length===3){const [path,text,last]=event;assert.ok(typeof text==='string');assert.ok(text.length<=16384);if(JSON.stringify(path)==='[0,"body"]'){delivered+=text.length;if(last)assert.equal(ended,true);}else paths.push(event);}
 }}
 assert.equal(delivered,4194304);assert.equal(retired,true);assert.deepEqual(paths,[[[0,'id'],'one',true]]);
});
test('chunked JSON strings preserve escape and UTF8 boundaries',async()=>{
 const text='x'.repeat(4093)+'😀é\n"\\'+'y'.repeat(4090)+'😀';
 const encoded=new TextEncoder().encode('[{"value":'+JSON.stringify(text).replaceAll('😀','\\ud83d\\ude00')+'}]');
 for(const size of [1,7,4096,encoded.length]){const b=budget();let actual='';
  {for await(const event of jsonValues({async *[Symbol.asyncIterator](){for(let i=0;i<encoded.length;i+=size)yield encoded.subarray(i,i+size);}},b,{stream:true,stringChunks:{maxControlBytes:65536}}))if(Array.isArray(event)&&event.length===3)actual+=event[1];}
  assert.equal(actual,text);
 }
});
test('chunked JSON rejects malformed tails and bounds control tokens',async()=>{
 for(const input of ['["'+'x'.repeat(4096)+'\\uD800"]','["'+'x'.repeat(4096)+'\\q"]','{"'+'k'.repeat(100)+'":1}','['+'1'.repeat(100)+']']){
  const b=budget();{await assert.rejects(async()=>{for await(const event of jsonValues({async *[Symbol.asyncIterator](){yield new TextEncoder().encode(input);}},b,{stream:true,stringChunks:{maxControlBytes:64}})){void event;}});}
 }
});
test('large producer chunks remain bounded and early consumer return retires the producer',async()=>{
 const b=budget();let retired=false;const bytes=new TextEncoder().encode('["'+'x'.repeat(1024*1024)+'"]');let seen=0;
 for await(const event of jsonValues({async *[Symbol.asyncIterator](){try{yield bytes;assert.fail('advanced after consumer return');}finally{retired=true;}}},b,{stream:true,stringChunks:{maxControlBytes:64}})){
  assert.ok(Array.isArray(event));assert.equal(event.length,3);assert.ok(typeof event[1]==='string'&&event[1].length<=4108);seen++;if(seen===2)break;
 }
 assert.equal(seen,2);assert.equal(retired,true);
});
test('chunked strings preserve scalar and container stream events',async()=>{
 const b=budget();const result:Json[]=[];
 for await(const event of jsonValues({async *[Symbol.asyncIterator](){yield new TextEncoder().encode('[{"a":"","b":false,"c":null,"d":[],"e":{}}]');}},b,{stream:true,stringChunks:{maxControlBytes:64}}))result.push(event);
 assert.deepEqual(result,[[[0,'a'],'',true],[[0,'b'],false],[[0,'c'],null],[[0,'d'],[]],[[0,'e'],{}],[[0,'e']],[[0]]]);
});
test('chunked parsing preserves cancellation reason and closes its source',async()=>{
 const controller=new AbortController(),reason=new Error('stop import');let retired=false;
 const b=new Budget(resolveJqLimits({maxValueBytes:Infinity}),controller.signal);
 await assert.rejects(async()=>{for await(const event of jsonValues({async *[Symbol.asyncIterator](){try{yield new TextEncoder().encode('["'+'x'.repeat(8192)+'"]');}finally{retired=true;}}},b,{stream:true,stringChunks:{maxControlBytes:64}})){
  void event;controller.abort(reason);
 }},error=>error===reason);
 assert.equal(retired,true);
});
