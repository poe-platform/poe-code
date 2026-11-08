import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {PythonTextDecoder,PythonTextDecodeError} from './text-decoder.js';
import reference from './fixtures/utf7-file-python39.json' with {type:'json'};
function decode(bytes:Uint8Array,split:number):string[]{
 const decoder=new PythonTextDecoder('utf7');
 try{return ['ok',decoder.decode(bytes.subarray(0,split),{stream:true})+decoder.decode(bytes.subarray(split))];}
 catch(error){if(error instanceof PythonTextDecodeError)return ['decode-error'];assert.ok(error instanceof TypeError);assert.equal(error.message,'surrogates not allowed');return ['encode-error'];}
}
for(const fixture of reference.cases)test(`UTF-7 file decoding ${fixture.hex}`,()=>{
 const bytes=Buffer.from(fixture.hex,'hex');
 for(let split=0;split<=bytes.length;split++)assert.deepEqual(decode(bytes,split),fixture.result,`split ${split}`);
});
for(const fixture of reference.checks)test(`UTF-7 every code unit matches native decode/UTF8, terminated=${fixture.terminated}`,()=>{
 for(let split=0;split<=5;split++){
  const hash=createHash('sha256');
  for(let point=0;point<65536;point++){
   const raw='+'+Buffer.from([point>>>8,point&255]).toString('base64').replaceAll('=','')+(fixture.terminated?'-':'');
   hash.update(JSON.stringify(decode(new TextEncoder().encode(raw),split))+'\n');
  }
  assert.equal(hash.digest('hex'),fixture.digest);
 }
});

test('UTF-7 stages long shifts in bounded chunks instead of retaining their input',()=>{
 const decoder=new PythonTextDecoder('utf7');
 assert.equal(decoder.decode(Uint8Array.of(43),{stream:true}),'');
 const chunk=new TextEncoder().encode('A'.repeat(1024));
 for(let i=0;i<1024;i++)assert.equal(decoder.decode(chunk,{stream:true}),'\0'.repeat(384));
 assert.equal(decoder.decode(Uint8Array.of(45)),'');
});
