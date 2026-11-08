import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {PythonTextDecoder,PythonTextDecodeError} from './text-decoder.js';
import reference from './fixtures/hz-python39.json' with {type:'json'};
for(const fixture of reference.checks)test(`HZ native byte transitions and recovery ${JSON.stringify(fixture)}`,()=>{
 const hash=createHash('sha256');
 for(let a=0;a<256;a++)for(let b=0;b<256;b++){
  const decoder=new PythonTextDecoder('hz');
  if(fixture.shifted)decoder.decode(Uint8Array.of(126,123),{stream:true});
  const result=(bytes:Uint8Array,final=false):string[]=>{try{return ['ok',decoder.decode(bytes,{stream:!final})];}catch(error){assert.ok(error instanceof PythonTextDecodeError);return ['error'];}};
  const outputs:string[][]=[];
  if(fixture.split)outputs.push(result(Uint8Array.of(a)));
  outputs.push(result(fixture.split?Uint8Array.of(b):Uint8Array.of(a,b)));
  outputs.push(result(new Uint8Array(),true));
  outputs.push(result(new TextEncoder().encode('VP~}abc'),true));
  hash.update(JSON.stringify(outputs)+'\n');
 }
 assert.equal(hash.digest('hex'),fixture.digest);
});
