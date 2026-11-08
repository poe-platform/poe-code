import assert from 'node:assert/strict';
import test from 'node:test';
import {sqliteRecord} from './sqlite-record.js';
import {readSqliteRecord} from './sqlite-record-read.js';
import type {SqliteRecordSource} from './sqlite-pages.js';

const signal=new AbortController().signal;
test('record decoding leaves large TEXT and BLOB fields as range streams',async()=>{
 const payload=new Error('payload');
 const absent={[Symbol.asyncIterator](){return {async next():Promise<IteratorResult<Uint8Array>>{throw payload;}};}};
 const values=[null,-9223372036854775808n,-32769n,0n,1n,1.5,{type:'text' as const,size:1000000,bytes:absent},{type:'blob' as const,size:0,bytes:absent}];
 const encoded=sqliteRecord(values);
 // Build just the small header/scalar prefix: the field payload cannot be read
 // during decoding, and need never exist as a materialized test allocation.
 const prefix:number[]=[];
 try{for await(const bytes of encoded.bytes(signal))prefix.push(...bytes);}catch(error){assert.equal(error,payload);}
 const head=Uint8Array.from(prefix);let maxRead=0;
 const source:SqliteRecordSource={size:encoded.size,async *bytes(offset=0,length=encoded.size-offset){
  maxRead=Math.max(maxRead,length);
  assert.ok(offset+length<=head.length,'decoder touched the large payload');
  yield head.slice(offset,offset+length);
 }};
 const decoded=await readSqliteRecord(source,{signal,maxColumns:8});
 assert.deepEqual(decoded.slice(0,6),values.slice(0,6));
 assert.equal((decoded[6] as {size:number}).size,1000000);
 assert.equal((decoded[7] as {type:string}).type,'blob');
 assert.ok(maxRead<=81);
});

test('record decoder rejects corrupt headers, reserved serial types and length mismatches',async()=>{
 for(const bytes of [new Uint8Array([2,10]),new Uint8Array([2,11]),new Uint8Array([2,15]),new Uint8Array([3,0]),new Uint8Array([2,0,99])]){
  const record={size:bytes.length,async *bytes(offset=0,length=bytes.length-offset){yield bytes.slice(offset,offset+length);}};
  await assert.rejects(readSqliteRecord(record,{signal,maxColumns:8}),{code:'EIO'});
 }
});
