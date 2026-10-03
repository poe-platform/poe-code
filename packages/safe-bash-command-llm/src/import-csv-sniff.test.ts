import assert from 'node:assert/strict';
import test from 'node:test';
import {sniffEmbeddingInput} from './import-csv-sniff.js';

test('sniffing replays the bounded prefix and borrowed tail before advancing the producer',async()=>{
 const signal=new AbortController().signal,original=new TextEncoder().encode('a,b\n1,2\n'.repeat(1024));
 const borrowed=original.slice();let advanced=false,retired=false;
 const input={async *[Symbol.asyncIterator](){try{yield borrowed;advanced=true;borrowed.fill(65);yield borrowed;}finally{retired=true;}}};
 const detected=await sniffEmbeddingInput(input,signal);assert.equal(detected.dialect?.delimiter,',');assert.equal(advanced,false);
 const chunks:Uint8Array[]=[];
 try{for await(const bytes of detected.bytes){if(chunks.length<2)assert.equal(advanced,false);chunks.push(bytes.slice());}}finally{await detected.close();}
 assert.deepEqual(Buffer.concat(chunks),Buffer.concat([original,new Uint8Array(original.length).fill(65)]));assert.equal(retired,true);
});

test('sniffing cancellation retires a pending input without waiting for a stalled return',async()=>{
 const controller=new AbortController();let entered!:()=>void;
 const ready=new Promise<void>(resolve=>{entered=resolve;});
 const input:AsyncIterable<Uint8Array>={[Symbol.asyncIterator](){return {next(){entered();return new Promise(()=>{});},return(){return new Promise(()=>{});}};}};
 const work=sniffEmbeddingInput(input,controller.signal);await ready;
 const reason=new Error('cancel peek');controller.abort(reason);await assert.rejects(work,error=>error===reason);
});

test('closing a detected source expires its retained prefix',async()=>{
 const detected=await sniffEmbeddingInput({async *[Symbol.asyncIterator](){yield new TextEncoder().encode('a,b\n1,2\n');}},new AbortController().signal);
 await detected.close();
 await assert.rejects(async()=>{for await(const ignored of detected.bytes)assert.fail('closed source yielded');},{code:'EBADF'});
});
