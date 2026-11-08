import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {PythonTextDecoder,PythonTextDecodeError} from './text-decoder.js';
import reference from './fixtures/iso2022-python39.json' with {type:'json'};
function result(decoder:PythonTextDecoder,bytes:Uint8Array,final:boolean):string[]{
 try{return ['ok',decoder.decode(bytes,{stream:!final})];}catch(error){if(error instanceof Error&&error.message==='pending buffer overflow')return ['unicode-error'];assert.ok(error instanceof PythonTextDecodeError);return ['error'];}
}
for(const encoding of [...new Set(reference.cases.map(row=>row.encoding))])test(`${encoding} native escape boundaries and recovery`,()=>{
 for(const fixture of reference.cases.filter(row=>row.encoding===encoding)){
  const decoder=new PythonTextDecoder(encoding);
  assert.deepEqual(fixture.chunks.map((hex,i)=>result(decoder,Buffer.from(hex,'hex'),i>=2)),fixture.outputs,JSON.stringify(fixture.chunks));
 }
});
for(const fixture of reference.maps)test(`${fixture.encoding} native character map ${fixture.escape}`,()=>{
 const hash=createHash('sha256');
 for(let a=32;a<128;a++)for(let b=0;b<256;b++){
  const decoder=new PythonTextDecoder(fixture.encoding);decoder.decode(Buffer.from(fixture.escape,'hex'),{stream:true});
  hash.update(JSON.stringify(result(decoder,Uint8Array.of(a,b),true))+'\n');
 }
 assert.equal(hash.digest('hex'),fixture.digest);
});
for(const fixture of reference.streams)test(`${fixture.encoding} native persistent stream transitions`,()=>{
 let seed=0x12345678;
 const next=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
 const decoder=new PythonTextDecoder(fixture.encoding),hash=createHash('sha256');
 for(let i=0;i<5000;i++){
  const choice=next(),bytes=choice%4===0?Buffer.from(reference.escapes[(choice>>>8)%reference.escapes.length]!,'hex'):Uint8Array.of(choice>>>24);
  const split=next()%(bytes.length+1),final=Boolean(next()%2);
  hash.update(JSON.stringify([result(decoder,bytes.subarray(0,split),false),result(decoder,bytes.subarray(split),final)])+'\n');
 }
 assert.equal(hash.digest('hex'),fixture.digest);
});
