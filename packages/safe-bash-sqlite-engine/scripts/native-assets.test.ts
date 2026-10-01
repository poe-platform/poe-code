import assert from 'node:assert/strict';
import test from 'node:test';
import {reserveSqliteCallbackSlots,sqliteUnicodeCallback} from './native-assets.ts';
const source=Uint8Array.of(0,97,115,109,1,0,0,0,4,5,1,112,1,0,0,7,5,1,1,116,1,0);
test('reserves fixed callback capacity without changing the initial table size',()=>{
 const patched=reserveSqliteCallbackSlots(source,128);
 const table=new WebAssembly.Instance(new WebAssembly.Module(patched)).exports.t as WebAssembly.Table;
 assert.equal(table.length,0);assert.equal(table.grow(128),0);assert.throws(()=>table.grow(1),RangeError);
 assert.equal(source[14],0);assert.deepEqual(patched.slice(-7),source.slice(-7));
 assert.throws(()=>reserveSqliteCallbackSlots(patched,128),/fixed/);
});
test('rejects invalid budgets, truncated binaries and unexpected table layouts',()=>{
 for(const slots of [0,-1,1.5,Infinity,0x100000000])assert.throws(()=>reserveSqliteCallbackSlots(source,slots),RangeError);
 for(const input of [source.slice(0,7),source.slice(0,14),source.slice(0,8),Uint8Array.of(...source.slice(0,8),4,5,2,112,1,0,0)])assert.throws(()=>reserveSqliteCallbackSlots(input,64));
});
test('the static unicode callback forwards all six integers and the result',()=>{
 const observed:number[][]=[];
 const module=new WebAssembly.Module(sqliteUnicodeCallback());
 const fn=new WebAssembly.Instance(module,{e:{f:(...args:number[])=>{observed.push(args);return 17;}}}).exports.f as (...args:number[])=>number;
 assert.equal(fn(1,2,3,4,5,6),17);assert.deepEqual(observed,[[1,2,3,4,5,6]]);
 const first=sqliteUnicodeCallback();first.fill(0);assert.equal(WebAssembly.validate(sqliteUnicodeCallback()),true);
});
