import assert from 'node:assert/strict';
import test from 'node:test';
import {unpackCodepage} from './codepage-table.js';

test('compact codepage runs inherit immutable tables and preserve undefined bytes',()=>{
 const base=Object.freeze(Array.from({length:256},(_,byte)=>byte));
 const table=unpackCodepage(Buffer.from([128,0,4,128,2,255,255,255]).toString('base64'),base);
 assert.equal(table.length,256);
 assert.deepEqual(table.slice(127,132),[127,1024,1025,1026,131]);
 assert.equal(table[255],-1);
 assert.equal(base[128],128);
 assert.ok(Object.isFrozen(table));
 const empty=unpackCodepage(Buffer.from([0,255,255,0,255]).toString('base64'));
 assert.deepEqual(empty,Array(256).fill(-1));
});
