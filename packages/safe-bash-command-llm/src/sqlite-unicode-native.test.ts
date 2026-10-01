import assert from 'node:assert/strict';
import test from 'node:test';
import {withNativeUnicode61} from './sqlite-unicode-native.js';
import type {SqliteNormalizedToken} from './sqlite-tokenizer.js';
const callbackModule=new WebAssembly.Module(Uint8Array.from([0,97,115,109,1,0,0,0,1,11,1,96,6,127,127,127,127,127,127,1,127,2,7,1,1,101,1,102,0,0,7,5,1,1,102,0,0]));
function native(){
 const heap=new Uint8Array(400000);let offset=256;
 const allocations:number[]=[],freed:number[]=[],calls:string[]=[];
 const set=(p:number,v:number)=>new DataView(heap.buffer).setInt32(p,v,true);
 const functions=new Map<number,((...args:number[])=>number)|null>();
 const table={get:(index:number)=>functions.get(index)??null,set(index:number,value:((...args:number[])=>number)|null){functions.set(index,value);}};
 functions.set(1,(_api:number,_name:number,context:number,tokenizer:number)=>{set(context,42);set(tokenizer,2);set(tokenizer+4,3);set(tokenizer+8,4);return 0;});
 functions.set(2,(_context:number,_args:number,_count:number,out:number)=>{set(out,77);calls.push('create');return 0;});
 functions.set(3,()=>{calls.push('delete');return 0;});
 functions.set(4,(_instance:number,_context:number,_flags:number,p:number,size:number,callback:number)=>{calls.push('tokenize');return table.get(callback)!(0,0,p,size,0,size);});
 set(108,1);
 const module={HEAPU8:heap,_malloc(size:number){const p=offset;offset+=size;allocations.push(p);return p;},_free(p:number){freed.push(p);},cwrap(name:string){
  if(name==='sqlite3_prepare_v2')return async(_db:number,_sql:string,_size:number,out:number)=>{set(out,123);calls.push('prepare');return 0;};
  if(name==='sqlite3_bind_pointer')return (_stmt:number,_index:number,out:number)=>{set(out,100);return 0;};
  if(name==='sqlite3_step')return async()=>100;
  if(name==='sqlite3_finalize')return async()=>{calls.push('finalize');return 0;};
  throw new Error(name);
 }};
 return {module,table,allocations,freed,calls,functions};
}
const options=(n:ReturnType<typeof native>)=>({database:1,table:n.table,callbackModule,slot:6,signal:new AbortController().signal,check(){}});
test('owns native tokenizer and reuses the same empty callback slot',async()=>{
 const n=native();let escaped:((bytes:Uint8Array)=>Iterable<SqliteNormalizedToken>)|undefined;
 for(let run=0;run<3;run++)await withNativeUnicode61(n.module,options(n),async tokenize=>{
  escaped=tokenize;const input=Uint8Array.of(97,98),tokens=[...tokenize(input)];
  input.fill(0);assert.deepEqual(tokens.map(t=>Array.from(t.bytes)),[[97,98]]);
 });
 assert.equal(n.table.get(6),null);assert.equal(n.calls.filter(c=>c==='delete').length,3);assert.equal(n.allocations.length,n.freed.length);
 assert.throws(()=>escaped!(Uint8Array.of(97)),{code:'EBADF'});
});
test('rejects occupied callback slots without disturbing their owner',async()=>{
 const n=native(),owner=()=>0;n.table.set(6,owner);
 await assert.rejects(withNativeUnicode61(n.module,options(n),async()=>{}),{code:'EBUSY'});
 assert.equal(n.table.get(6),owner);assert.equal(n.allocations.length,0);
});
test('bounds inputs before native tokenization',async()=>{
 const n=native();await withNativeUnicode61(n.module,options(n),async tokenize=>{assert.throws(()=>tokenize(new Uint8Array(65537)),RangeError);});
 assert.equal(n.calls.includes('tokenize'),false);assert.equal(n.allocations.length,n.freed.length);
});
test('retains operation and native destruction errors',async()=>{
 const n=native(),operation=new Error('operation'),cleanup=new Error('destroy');n.functions.set(3,()=>{throw cleanup;});
 await assert.rejects(withNativeUnicode61(n.module,options(n),async()=>{throw operation;}),error=>error instanceof AggregateError&&error.errors[0]===operation&&error.errors[1]===cleanup);
 assert.equal(n.table.get(6),null);assert.equal(n.allocations.length,n.freed.length);
});

test('preserves native tokenization and buffer-release errors together',async()=>{
 const n=native(),query=new Error('native token failure'),cleanup=new Error('buffer free failure');
 n.functions.set(4,()=>{throw query;});
 const free=n.module._free.bind(n.module);
 n.module._free=(pointer:number)=>{free(pointer);if(pointer===n.allocations.at(-1))throw cleanup;};
 await assert.rejects(withNativeUnicode61(n.module,options(n),async tokenize=>{tokenize(Uint8Array.of(97));}),error=>error instanceof AggregateError&&error.errors[0]===query&&error.errors[1]===cleanup);
 assert.equal(n.table.get(6),null);
});
test('recovers native instance ownership if creation throws after acquisition',async()=>{
 const n=native(),failure=new Error('create bridge');
 n.functions.set(2,(_context:number,_args:number,_count:number,out:number)=>{new DataView(n.module.HEAPU8.buffer).setInt32(out,77,true);throw failure;});
 await assert.rejects(withNativeUnicode61(n.module,options(n),async()=>{assert.fail('callback');}),error=>error===failure);
 assert.equal(n.calls.includes('delete'),true);assert.equal(n.table.get(6),null);assert.equal(n.allocations.length,n.freed.length);
});
