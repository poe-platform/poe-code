import assert from 'node:assert/strict';
import test from 'node:test';
import {sqliteFtsLeaves, type FtsPosting} from './sqlite-fts-leaf.js';
const signal=new AbortController().signal;
const source=(...chunks:number[][])=>(async function*(){for(const chunk of chunks)yield Uint8Array.from(chunk);})();
const records=(values:FtsPosting[])=>(async function*(){yield* values;})();
test('matches native SQLite alpha beta alpha golden leaf',async()=>{
 const pages=[];
 for await(const page of sqliteFtsLeaves(records([
  {term:new TextEncoder().encode('alpha'),rowid:1n,positionBytes:2,positions:source([2,4])},
  {term:new TextEncoder().encode('beta'),rowid:1n,positionBytes:1,positions:source([3])}
 ]),signal))pages.push(page);
 assert.equal(pages.length,1);assert.ok(pages[0]);
 assert.equal(Buffer.from(pages[0].bytes).toString('hex'),'000000180630616c70686101040204010462657461010203040b');
 assert.deepEqual(pages[0].indexTerm,new Uint8Array());
});

test('cancellation interrupts pending posting acquisition and closes its iterator',async()=>{
 const controller=new AbortController();let returned=0,started!:()=>void;
 const ready=new Promise<void>(resolve=>{started=resolve;});
 const input={ [Symbol.asyncIterator](){return {next(){started();return new Promise<IteratorResult<FtsPosting>>(()=>{});},async return(){returned++;return {done:true as const,value:undefined};}};}};
 const result=(async()=>{for await(const ignoredPage of sqliteFtsLeaves(input,controller.signal)){assert.fail('No page expected');}})();
 await ready;controller.abort(new Error('stop postings'));await assert.rejects(result,/stop postings/);assert.equal(returned,1);
});

test('short position lists, trailing partial varints and unsorted rows reject',async()=>{
 const encode=new TextEncoder();
 for(const entries of [
  [{term:encode.encode('a'),rowid:1n,positionBytes:2,positions:source([2])}],
  [{term:encode.encode('a'),rowid:1n,positionBytes:1,positions:source([128])}],
  [{term:encode.encode('z'),rowid:1n,positionBytes:1,positions:source([2])},{term:encode.encode('a'),rowid:1n,positionBytes:1,positions:source([2])}],
  [{term:encode.encode('a'),rowid:2n,positionBytes:1,positions:source([2])},{term:encode.encode('a'),rowid:1n,positionBytes:1,positions:source([2])}]
 ])await assert.rejects(async()=>{for await(const ignoredPage of sqliteFtsLeaves(records(entries),signal)){ /* Drain to exercise validation. */ }},RangeError);
});

test('long position sources yield owned bounded pages and early return closes sources',async()=>{
 let returned=0;const chunk=new Uint8Array(16384).fill(2);
 const values=(async function*(){try{for(let i=0;i<20;i++)yield chunk;}finally{returned++;}})();
 const iterator=sqliteFtsLeaves(records([{term:new TextEncoder().encode('long'),rowid:1n,positionBytes:chunk.length*20,positions:values}]),signal)[Symbol.asyncIterator]();
 const first=await iterator.next(),copy=first.value.bytes.slice();const second=await iterator.next();
 assert.ok(first.value.bytes.length<=4000&&second.value.bytes.length<=4000);
 assert.deepEqual(first.value.bytes,copy);assert.notEqual(first.value.bytes.buffer,second.value.bytes.buffer);
 await iterator.return?.();assert.equal(returned,1);
});

test('snapshots posting metadata before yielding output',async()=>{
 const shared={term:new TextEncoder().encode('long'),rowid:1n,positionBytes:10000,positions:source(Array(10000).fill(2))};
 const iterator=sqliteFtsLeaves(records([shared]),signal)[Symbol.asyncIterator]();
 const first=await iterator.next();assert.equal(first.done,false);
 shared.positionBytes=1;shared.rowid=7n;shared.positions=source([2]);
 while(!(await iterator.next()).done){ /* Drain after mutating caller metadata. */ }
});

test('empty position chunks cannot starve scheduled cancellation',async()=>{
 const controller=new AbortController();let closed=false;
 const timer=setImmediate(()=>controller.abort(new Error('scheduled stop')));
 const positions=(async function*(){try{for(let i=0;i<400;i++)yield new Uint8Array();yield Uint8Array.of(2);}finally{closed=true;}})();
 try{await assert.rejects(async()=>{for await(const ignoredPage of sqliteFtsLeaves(records([{term:Uint8Array.of(97),rowid:1n,positionBytes:1,positions}]),controller.signal)){ /* Drain to exercise validation. */ }},/scheduled stop/);}finally{clearImmediate(timer);}
 assert.equal(closed,true);
});

test('maximum native token prefix uses a bounded oversized term leaf',async()=>{
 const pages=[];
 for await(const page of sqliteFtsLeaves(records([{term:new Uint8Array(32768).fill(97),rowid:1n,positionBytes:1,positions:source([2])}]),signal))pages.push(page);
 assert.equal(pages.length,2);assert.ok(pages[0]);assert.ok(pages[1]);
 assert.ok(pages[0].bytes.length<=32800);assert.deepEqual(pages[1].bytes,Uint8Array.of(0,0,0,5,2));
 assert.equal(new DataView(pages[0].bytes.buffer).getUint16(2),pages[0].bytes.length-1);
});


test('a single large position chunk yields to scheduled cancellation',async()=>{
 const controller=new AbortController();let closed=false;
 const positions=(async function*(){try{yield new Uint8Array(1000000).fill(2);}finally{closed=true;}})();
 const timer=setImmediate(()=>controller.abort(new Error('large chunk stop')));
 try{await assert.rejects(async()=>{for await(const ignoredPage of sqliteFtsLeaves(records([{term:Uint8Array.of(97),rowid:1n,positionBytes:1000000,positions}]),controller.signal)){ /* Drain to exercise validation. */ }},/large chunk stop/);}finally{clearImmediate(timer);}
 assert.equal(closed,true);
});
