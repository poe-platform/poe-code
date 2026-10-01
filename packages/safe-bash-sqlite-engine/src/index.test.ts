import test from 'node:test';
import assert from 'node:assert/strict';
import {createSqliteRuntime} from './index.js';
test('initializes the pinned native ABI with isolated callback slots and no global BigInt changes',async()=>{
 const before=Object.getOwnPropertyDescriptor(BigInt.prototype,'toJSON');
 const first=await createSqliteRuntime(),second=await createSqliteRuntime();
 assert.equal((first.module.cwrap('sqlite3_libversion','string',[]) as () => string)(),'3.53.0');
 assert.equal(first.table.get(first.slot),null);assert.equal(second.table.get(second.slot),null);
 assert.notEqual(first.table,second.table);assert.notEqual(first.module.HEAPU8.buffer,second.module.HEAPU8.buffer);
 assert.deepEqual(Object.getOwnPropertyDescriptor(BigInt.prototype,'toJSON'),before);
 assert.equal(first.callbackModule instanceof WebAssembly.Module,true);
});
test('rejects pre-cancelled runtime initialization with the original reason',async()=>{
 const controller=new AbortController(),reason=new Error('cancelled');controller.abort(reason);
 await assert.rejects(createSqliteRuntime({signal:controller.signal}),error=>error===reason);
});
