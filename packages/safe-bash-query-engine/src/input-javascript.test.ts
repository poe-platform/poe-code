import assert from 'node:assert/strict';
import test from 'node:test';
import {jsonValues} from './input.js';
import {Budget,resolveJqLimits} from './limits.js';

async function parse(bytes:Uint8Array,size:number){
 let value:unknown;
 for await(const item of jsonValues({async *[Symbol.asyncIterator](){for(let at=0;at<bytes.length;at+=size)yield bytes.subarray(at,at+size);}},new Budget(resolveJqLimits(),new AbortController().signal),{profile:'javascript'}))value=item;
 return value;
}
test('JavaScript JSON byte profile matches TextDecoder and JSON.parse across chunk boundaries',async()=>{
 const encoder=new TextEncoder();
 const cases=[...['null','true','-0','1e999','1.00000000000000001','[1,2,3]','{"version":1,"version":3,"__proto__":[]}','"\\ud800x\\udfff"','"😀"','\ufeff[]','\ufeff\ufeff[]','','[] []','01','NaN','Infinity','-Infinity','[1,]','1\0','{"x":1}trailing'].map(text=>encoder.encode(text)),Uint8Array.from([34,0xe0,0x80,0x80,34]),Uint8Array.from([34,0xf0,0x9f,34]),Uint8Array.from([91,0,93,0])];
 for(const bytes of cases)for(const size of [1,7,65536]){
  let expected:unknown;try{expected=JSON.parse(new TextDecoder().decode(bytes));}catch{await assert.rejects(parse(bytes,size));continue;}
  const actual=await parse(bytes,size);
  assert.equal(JSON.stringify(actual),JSON.stringify(expected));
  if(typeof expected==='number')assert.ok(Object.is(actual,expected));
 }
});
test('JavaScript JSON byte profile charges raw bytes and retires failed sources',async()=>{
 let closed=false;
 const input={async *[Symbol.asyncIterator](){try{yield new Uint8Array([239,187,191,91,93]);}finally{closed=true;}}};
 await assert.rejects(async()=>{for await(const value of jsonValues(input,new Budget(resolveJqLimits({maxInputBytes:4}),new AbortController().signal),{profile:'javascript'}))void value;},/maxInputBytes/);
 assert.equal(closed,true);
});
