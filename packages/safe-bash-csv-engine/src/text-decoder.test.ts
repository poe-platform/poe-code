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

// Captured with codecs.getincrementaldecoder in the pinned Python 3.9 oracle.
test('Python codec aliases and punctuation retain canonical decoding behavior',()=>{
 for(const name of ['cp65001','u8','UTF/8','__utf--8__'])assert.equal(new PythonTextDecoder(name).decode(Uint8Array.of(0xc3,0xa9)),'é');
 for(const name of ['UTF 8 SIG','UTF_8_SIG'])assert.equal(new PythonTextDecoder(name).decode(Uint8Array.of(0xef,0xbb,0xbf,65)),'A');
 for(const name of ['ISO 8859-1','cp819','L1'])assert.equal(new PythonTextDecoder(name).decode(Uint8Array.of(0x80,0xe9)),'\u0080é');
 for(const name of ['ansi_x3.4-1968','646','US']){
  assert.equal(new PythonTextDecoder(name).decode(Uint8Array.of(65)),'A');
  assert.throws(()=>new PythonTextDecoder(name).decode(Uint8Array.of(128)),PythonTextDecodeError);
 }
});
test('Python rejects near aliases and inherited object names',()=>{
 for(const name of ['utf8-sig','utf.8','latin.1','constructor','__proto__'])assert.throws(()=>new PythonTextDecoder(name),RangeError);
});


test('single-byte codecs match every byte from the pinned Python 3.9 oracle',async()=>{
 const {readFile}=await import('node:fs/promises');
 const reference=JSON.parse(await readFile(new URL('./fixtures/single-byte-python39.json',import.meta.url),'utf8')) as {cases:{name:string;canonical:string;values:(string|null)[]}[]};
 for(const {name,canonical,values}of reference.cases){
  for(const alias of new Set([name,canonical])){
   const decoder=new PythonTextDecoder(alias);let accepted='';
   for(let byte=0;byte<256;byte++){
    const value=values[byte];
    if(value===null)assert.throws(()=>decoder.decode(Uint8Array.of(byte),{stream:true}),PythonTextDecodeError,`${alias}:${byte}`);
    else {assert.equal(decoder.decode(Uint8Array.of(byte),{stream:true}),value,`${alias}:${byte}`);accepted+=value;}
   }
   assert.equal(decoder.decode(),'');
   const bytes=Uint8Array.from(values.flatMap((value,byte)=>value===null?[]:[byte]));
   assert.equal(new PythonTextDecoder(alias).decode(bytes),accepted,alias);
  }
 }
});


test('UTF16 decoding and error categories match pinned Python at every byte split',async()=>{
 const {readFile}=await import('node:fs/promises');
 const reference=JSON.parse(await readFile(new URL('./fixtures/utf16-python39.json',import.meta.url),'utf8')) as {cases:{encoding:string;hex:string;split:number;text?:string;error?:string}[]};
 for(const row of reference.cases){
  const bytes=Uint8Array.from(Buffer.from(row.hex,'hex'));
  const decode=()=>{const decoder=new PythonTextDecoder(row.encoding);return decoder.decode(bytes.subarray(0,row.split),{stream:true})+decoder.decode(bytes.subarray(row.split));};
  if(row.error)assert.throws(decode,error=>error instanceof Error&&(row.error==='UnicodeDecodeError'?error instanceof PythonTextDecodeError:error.message==='UTF-16 stream does not start with BOM'&&!(error instanceof PythonTextDecodeError)),JSON.stringify(row));
  else assert.equal(decode(),row.text,JSON.stringify(row));
 }
});
