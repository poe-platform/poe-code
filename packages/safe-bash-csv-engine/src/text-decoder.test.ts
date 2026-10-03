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
