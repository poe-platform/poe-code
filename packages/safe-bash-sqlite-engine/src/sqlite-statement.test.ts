import assert from 'node:assert/strict';
import test from 'node:test';
import {withSqliteStatement} from './sqlite-statement.js';
function native() {
 const heap=new Uint8Array(200000); let next=32,step=0;
 const calls:string[]=[],freed:number[]=[],bound:{pointer:number;size:number}[]=[];
 const module={HEAPU8:heap,_malloc(size:number){const p=next;next+=size;return p;},_free(p:number){freed.push(p);},cwrap(name:string){
  switch(name){
   case 'sqlite3_prepare_v2':return async (_db:number,_sql:string,_length:number,out:number)=>{new DataView(heap.buffer).setInt32(out,7,true);calls.push('prepare');return 0;};
   case 'sqlite3_step':return async ()=>{calls.push('step');return step++===0?100:101;};
   case 'sqlite3_reset':return async ()=>{step=0;calls.push('reset');return 0;};
   case 'sqlite3_clear_bindings':return ()=>0;
   case 'sqlite3_finalize':return async ()=>{calls.push('finalize');return 0;};
   case 'sqlite3_bind_parameter_count':return ()=>1;
   case 'sqlite3_bind_blob':return (_stmt:number,_index:number,pointer:number,size:number)=>{bound.push({pointer,size});return 0;};
   case 'sqlite3_column_count':return ()=>1;
   case 'sqlite3_column_type':return ()=>4;
   case 'sqlite3_column_bytes':return ()=>3;
   case 'sqlite3_column_blob':return ()=>{heap.set([1,2,3],150000);return 150000;};
   default: return ()=>{throw new Error(name);};
  }
 }};
 return {module,calls,freed,bound};
}
const options=()=>({database:1,sql:'SELECT term FROM tokens WHERE term=?',signal:new AbortController().signal,check(){}});
test('owns one reusable statement and binds an empty blob as non-NULL',async()=>{
 const n=native();
 await withSqliteStatement(n.module,options(),async statement=>{
  for(let i=0;i<2;i++){
   const rows=[];for await(const row of statement.rows([new Uint8Array()],['blob']))rows.push(row);
   assert.deepEqual(rows,[[Uint8Array.of(1,2,3)]]);
  }
 });
 assert.equal(n.calls.filter(c=>c==='prepare').length,1);assert.equal(n.calls.at(-1),'finalize');
 assert.equal(n.bound.length,2);assert.ok(n.bound.every(b=>b.pointer>0&&b.size===0));
});
test('rejects oversized scalar before copying and still finalizes',async()=>{
 const n=native(),wrap=n.module.cwrap.bind(n.module);let copied=false;
 n.module.cwrap=(name)=>name==='sqlite3_column_bytes'?()=>65537:name==='sqlite3_column_blob'?()=>{copied=true;return 100;}:wrap(name);
 await assert.rejects(withSqliteStatement(n.module,options(),async s=>{for await(const ignoredRow of s.rows([new Uint8Array()],['blob'])){ /* Consume the cursor to exercise native validation. */ }}),/scalar/);
 assert.equal(copied,false);assert.equal(n.calls.at(-1),'finalize');
});
test('does not coerce a wrong native scalar type',async()=>{
 const n=native(),wrap=n.module.cwrap.bind(n.module);
 n.module.cwrap=name=>name==='sqlite3_column_type'?()=>3:wrap(name);
 await assert.rejects(withSqliteStatement(n.module,options(),async s=>{for await(const ignoredRow of s.rows([new Uint8Array()],['blob'])){ /* Consume the cursor to exercise native validation. */ }}),/type/);
 assert.equal(n.calls.at(-1),'finalize');
});
test('closes an unfinished cursor before finalizing and rejects escaped use',async()=>{
 const n=native();let escaped:AsyncIterator<unknown>|undefined;
 await withSqliteStatement(n.module,options(),async s=>{escaped=s.rows([new Uint8Array()],['blob'])[Symbol.asyncIterator]();await escaped.next();});
 assert.deepEqual(n.calls.slice(-2),['reset','finalize']);assert.equal((await escaped!.next()).done,true);
});
test('preserves original VFS errors from native stepping',async()=>{
 const n=native(),wrap=n.module.cwrap.bind(n.module),failure=new Error('backing unavailable');let failed=false;
 n.module.cwrap=name=>name==='sqlite3_step'?async()=>{failed=true;return 10;}:wrap(name);
 await assert.rejects(withSqliteStatement(n.module,{...options(),check(){if(failed)throw failure;}},async s=>{for await(const ignoredRow of s.rows([new Uint8Array()],['blob'])){ /* Consume the cursor to exercise native validation. */ }}),error=>error===failure);
 assert.equal(n.calls.at(-1),'finalize');
});

test('rejects oversized controls and bindings before stepping',async()=>{
 const n=native();
 await assert.rejects(withSqliteStatement(n.module,{...options(),sql:'x'.repeat(65537)},async()=>{}),/control/);
 assert.equal(n.calls.length,0);
 await assert.rejects(withSqliteStatement(n.module,options(),async s=>{for await(const ignoredRow of s.rows([new Uint8Array(65537)],['blob'])){ /* Consume the cursor to exercise native validation. */ }}),/binding/);
 assert.equal(n.calls.includes('step'),false);assert.equal(n.calls.at(-1),'finalize');
});
test('cancellation waits for a pending native step before reset and finalize',async()=>{
 const n=native(),wrap=n.module.cwrap.bind(n.module),controller=new AbortController(),failure=new Error('cancel cursor');
 let release!:()=>void,entered!:()=>void;
 const ready=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 n.module.cwrap=name=>name==='sqlite3_step'?async()=>{entered();await gate;return 100;}:wrap(name);
 const pending=withSqliteStatement(n.module,{...options(),signal:controller.signal},async s=>{for await(const ignoredRow of s.rows([new Uint8Array()],['blob'])){assert.fail('aborted row');}});
 await ready;controller.abort(failure);await Promise.resolve();assert.equal(n.calls.includes('finalize'),false);
 release();await assert.rejects(pending,error=>error===failure);assert.deepEqual(n.calls.slice(-2),['reset','finalize']);
});
test('rejects overlapping cursors without resetting the active cursor',async()=>{
 const n=native();
 await withSqliteStatement(n.module,options(),async s=>{
  const first=s.rows([new Uint8Array()],['blob'])[Symbol.asyncIterator]();await first.next();
  const before=n.calls.length;
  await assert.rejects(s.rows([new Uint8Array()],['blob'])[Symbol.asyncIterator]().next(),{code:'EBUSY'});
  assert.equal(n.calls.length,before);await first.return?.();
 });
});

test('retains both query and reset bridge failures',async()=>{
 const n=native(),wrap=n.module.cwrap.bind(n.module),query=new Error('step bridge'),cleanup=new Error('reset bridge');
 n.module.cwrap=name=>name==='sqlite3_step'?async()=>{throw query;}:name==='sqlite3_reset'?async()=>{throw cleanup;}:wrap(name);
 await assert.rejects(withSqliteStatement(n.module,options(),async s=>{for await(const ignoredRow of s.rows([new Uint8Array()],['blob'])){ /* Consume the cursor to exercise native validation. */ }}),error=>error instanceof AggregateError&&error.errors[0]===query&&error.errors[1]===cleanup);
 assert.equal(n.calls.at(-1),'finalize');
});
test('recovers a statement handle when native preparation throws',async()=>{
 const n=native(),wrap=n.module.cwrap.bind(n.module),failure=new Error('prepare bridge');
 n.module.cwrap=name=>name==='sqlite3_prepare_v2'?async (_db:number,_sql:string,_length:number,out:number)=>{new DataView(n.module.HEAPU8.buffer).setInt32(out,7,true);throw failure;}:wrap(name);
 await assert.rejects(withSqliteStatement(n.module,options(),async()=>{assert.fail('callback');}),error=>error===failure);
 assert.equal(n.calls.at(-1),'finalize');assert.equal(n.freed.length,1);
});

test('admits a binary scalar spanning multiple filesystem transfer windows',async()=>{
 const n=native();
 await withSqliteStatement(n.module,options(),async s=>{for await(const ignoredRow of s.rows([new Uint8Array(32769)],['blob'])){ /* Consume the cursor to exercise native validation. */ }});
 assert.equal(n.bound[0]?.size,32769);
});
