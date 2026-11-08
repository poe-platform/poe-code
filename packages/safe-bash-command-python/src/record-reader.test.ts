import assert from 'node:assert/strict';
import test from 'node:test';
import {createPythonRecordReader} from './record-reader.js';

test('one-unit Unicode boundary lookbehind does not replay the record source',async()=>{
 let starts=0;const value='x'.repeat(8191)+'😀'+'y'.repeat(20000);
 const reader=createPythonRecordReader(async function*(){starts++;const encoder=new TextEncoder();for(let offset=0;offset<value.length;offset+=1000)yield encoder.encode(value.slice(offset,offset+1000));});
 try{
  const first=await reader.read(0,0);assert.equal(first,value.slice(0,8192));
  assert.equal(await reader.read(0,8191),value.slice(8191,16383));
  assert.equal(await reader.read(0,16383),value.slice(16383,24575));
  assert.equal(await reader.read(0,1000000),'');
  assert.equal(await reader.read(0,value.length-1),'y');
  assert.equal(starts,1,'native surrogate preservation must not restart serialization');
 }finally{await reader.close();}
});
