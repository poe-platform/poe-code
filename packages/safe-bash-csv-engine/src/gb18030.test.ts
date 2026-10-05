import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {PythonTextDecoder,PythonTextDecodeError} from './text-decoder.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/gb18030-python39.json',import.meta.url),'utf8')) as {twoDigest:string;four:[string,string|null][];probes:[string,[string,boolean,string][]][]};
test('GB18030 matches pinned Python at every four-byte mapping boundary and split',()=>{
 for(const [hex,value]of fixture.four)for(let split=0;split<=4;split++){
  const decoder=new PythonTextDecoder('gb18030'),raw=Buffer.from(hex,'hex');
  if(value===null)assert.throws(()=>decoder.decode(raw.subarray(0,split),{stream:true})+decoder.decode(raw.subarray(split)),PythonTextDecodeError);
  else assert.equal(decoder.decode(raw.subarray(0,split),{stream:true})+decoder.decode(raw.subarray(split)),value,hex);
 }
});
test('GB18030 preserves pinned incremental failure timing and post-error state',()=>{
 for(const [hex,steps]of fixture.probes){
  const decoder=new PythonTextDecoder('gb18030'),raw=Buffer.from(hex,'hex');
  for(let i=0;i<raw.length;i++){
   const [value,error]=steps[i]!;
   if(error)assert.throws(()=>decoder.decode(raw.subarray(i,i+1),{stream:true}),PythonTextDecodeError);
   else assert.equal(decoder.decode(raw.subarray(i,i+1),{stream:true}),value,hex);
  }
 }
});

test('all GB18030 two-byte inputs preserve the pinned Python table',()=>{
 const hash=createHash('sha256'),decoder=new PythonTextDecoder('gb18030');
 for(let a=128;a<256;a++)for(let b=0;b<256;b++){
  let value=0;try{value=decoder.decode(Uint8Array.of(a,b)).codePointAt(0)!+1;}catch(error){assert.ok(error instanceof PythonTextDecodeError);}
  hash.update(Uint8Array.of(value&255,(value>>>8)&255,(value>>>16)&255,value>>>24));
 }
 assert.equal(hash.digest('hex'),fixture.twoDigest);
});
test('GB18030 failed empty flush retains its prefix, and new malformed input consumes it',()=>{
 const decoder=new PythonTextDecoder('gb18030');
 assert.equal(decoder.decode(Uint8Array.of(0x81,0x30,0x81),{stream:true}),'');
 assert.throws(()=>decoder.decode(),PythonTextDecodeError);
 assert.equal(decoder.decode(Uint8Array.of(0x30)),'\u0080');
 decoder.decode(Uint8Array.of(0x81,0x30),{stream:true});
 assert.throws(()=>decoder.decode(Uint8Array.of(0,0)),PythonTextDecodeError);
 assert.equal(decoder.decode(Uint8Array.of(65)),'A');
});
