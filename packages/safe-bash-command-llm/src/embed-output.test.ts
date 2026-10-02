import assert from 'node:assert/strict';
import test from 'node:test';
import { serializeLlmEmbedding } from './embed-output.js';

test('float32 overflow fails before any embedding bytes are emitted',async()=>{
 const chunks:Uint8Array[]=[];
 await assert.rejects(async()=>{for await(const bytes of serializeLlmEmbedding([...new Array<number>(4000).fill(1),1e50],'blob',new AbortController().signal))chunks.push(bytes);},/float32/);
 assert.equal(chunks.length,0);
});
