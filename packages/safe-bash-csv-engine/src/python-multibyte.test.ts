import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {PythonTextDecoder,PythonTextDecodeError} from './text-decoder.js';
const reference=JSON.parse(readFileSync(new URL('./fixtures/multibyte-python39.json',import.meta.url),'utf8')) as {cases:{name:string;prefixes:string[];digest:string}[]};
for(const fixture of reference.cases)test(`incremental ${fixture.name} transitions match pinned Python 3.9`,()=>{
 const hash=createHash('sha256');
 for(const hex of fixture.prefixes){
  // Python defers this eight-byte compositional form; its complete domain is
  // checked separately instead of enumerating arbitrary seven-byte prefixes.
  if(fixture.name==='euc_kr'&&hex==='a4d4')continue;
  const prefix=Uint8Array.from(Buffer.from(hex,'hex'));
  for(let byte=0;byte<256;byte++){
   const decoder=new PythonTextDecoder(fixture.name);
   assert.equal(decoder.decode(prefix,{stream:true}),'');
   let value='',failed=false;
   try{value=decoder.decode(Uint8Array.of(byte),{stream:true});}
   catch(error){assert.ok(error instanceof PythonTextDecodeError);failed=true;}
   const output=new TextEncoder().encode(value);
   const pending=failed||value?new Uint8Array():Uint8Array.from([...prefix,byte]);
   hash.update(Uint8Array.of(Number(failed),output.length&255,(output.length>>>8)&255,(output.length>>>16)&255,(output.length>>>24)&255));
   hash.update(output);hash.update(Uint8Array.of(pending.length));hash.update(pending);
   if(pending.length)assert.throws(()=>decoder.decode(),PythonTextDecodeError);else assert.equal(decoder.decode(),'');
  }
 }
 assert.equal(hash.digest('hex'),fixture.digest);
});

test('multibyte failures consume prior bytes only when new input arrives',()=>{
 const decoder=new PythonTextDecoder('big5');
 assert.equal(decoder.decode(Uint8Array.of(0xa4),{stream:true}),'');
 assert.throws(()=>decoder.decode(),PythonTextDecodeError);
 assert.equal(decoder.decode(Uint8Array.of(0xa4)),'中');
 decoder.decode(Uint8Array.of(0xa4),{stream:true});
 assert.throws(()=>decoder.decode(Uint8Array.of(0)),PythonTextDecodeError);
 assert.equal(decoder.decode(Uint8Array.of(65)),'A');
});

test('all EUC-KR compositional syllables match Python at every split',()=>{
 const {hangul}=JSON.parse(readFileSync(new URL('./fixtures/multibyte-python39.json',import.meta.url),'utf8')) as {hangul:{initial:number[];final:number[];digest:string}};
 for(let split=0;split<=8;split++){
  const hash=createHash('sha256');
  for(const initial of hangul.initial)for(let medial=0xbf;medial<0xd4;medial++)for(const final of hangul.final){
   const bytes=Uint8Array.of(0xa4,0xd4,0xa4,initial,0xa4,medial,0xa4,final);
   const decoder=new PythonTextDecoder('euc_kr');
   hash.update(decoder.decode(bytes.subarray(0,split),{stream:true})+decoder.decode(bytes.subarray(split)));
  }
  assert.equal(hash.digest('hex'),hangul.digest);
 }
});

test('EUC-KR defers malformed composition until byte eight and retains incomplete flush state',()=>{
 for(let length=2;length<8;length++){
  const bytes=new Uint8Array(length);bytes.set([0xa4,0xd4]);
  const decoder=new PythonTextDecoder('euc_kr');
  assert.equal(decoder.decode(bytes,{stream:true}),'');
  assert.throws(()=>decoder.decode(),PythonTextDecodeError);
  assert.throws(()=>decoder.decode(new Uint8Array(8-length)),PythonTextDecodeError);
  assert.equal(decoder.decode(Uint8Array.of(65)),'A');
 }
});
