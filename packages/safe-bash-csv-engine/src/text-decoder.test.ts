import assert from 'node:assert/strict';
import test from 'node:test';
import {PythonTextDecoder,PythonTextDecodeError} from './text-decoder.js';

test('shared Python decoder preserves Latin1 controls and UTF8 BOM policy',()=>{
 assert.equal(new PythonTextDecoder('latin-1').decode(Uint8Array.of(0x80,0xe9)),'\u0080é');
 for(const [name,expected]of [['utf-8','\ufeffé'],['utf-8-sig','é']] as const){
  const decoder=new PythonTextDecoder(name);let value='';
  for(const byte of Uint8Array.of(0xef,0xbb,0xbf,0xc3,0xa9))value+=decoder.decode(Uint8Array.of(byte),{stream:true});
  assert.equal(value+decoder.decode(),expected);
 }
});
test('shared Python decoder distinguishes undecodable input from unknown codecs',()=>{
 assert.throws(()=>new PythonTextDecoder('ascii').decode(Uint8Array.of(128)),PythonTextDecodeError);
 const decoder=new PythonTextDecoder('utf8');decoder.decode(Uint8Array.of(0xc3),{stream:true});
 assert.throws(()=>decoder.decode(),PythonTextDecodeError);
 assert.throws(()=>new PythonTextDecoder('unknown'),/unknown encoding: unknown/);
});

test('UTF8 signature decoder retains an incomplete initial BOM at final EOF like Python 3.9',()=>{
 for(const hex of ['','ef','efbb','efbbbf']){
  const bytes=Uint8Array.from(Buffer.from(hex,'hex'));
  for(let split=0;split<=bytes.length;split++){
   const decoder=new PythonTextDecoder('utf-8-sig');
   assert.equal(decoder.decode(bytes.subarray(0,split),{stream:true})+decoder.decode(bytes.subarray(split)), '');
  }
 }
 for(const hex of ['efbb78','61ef'])assert.throws(()=>new PythonTextDecoder('utf-8-sig').decode(Uint8Array.from(Buffer.from(hex,'hex'))),PythonTextDecodeError);
 for(const hex of ['ef','efbb'])assert.throws(()=>new PythonTextDecoder('utf-8').decode(Uint8Array.from(Buffer.from(hex,'hex'))),PythonTextDecodeError);
 assert.equal(new PythonTextDecoder('utf-8').decode(Uint8Array.of(0xef,0xbb,0xbf)),'\ufeff');
});
test('UTF8 signature is stripped only once across incremental final calls',()=>{
 const decoder=new PythonTextDecoder('utf-8-sig'),bom=Uint8Array.of(0xef,0xbb,0xbf);
 assert.equal(decoder.decode(bom),'');assert.equal(decoder.decode(bom),'\ufeff');
 const pending=new PythonTextDecoder('utf-8-sig');
 assert.equal(pending.decode(bom.subarray(0,1)),'');assert.equal(pending.decode(bom.subarray(1)),'');
 assert.equal(pending.decode(new TextEncoder().encode('done')),'done');
});
