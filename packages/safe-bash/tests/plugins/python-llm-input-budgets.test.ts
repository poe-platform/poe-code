import assert from 'node:assert/strict';
import test from 'node:test';
import { createPythonLlmCapability } from '../../src/commands/python/llm-capability.js';
import { createLlmService } from '../../src/commands/llm/service.js';
import { MemoryFileSystem } from '../../src/fs/memory/index.js';

test('Python input materialization and streamed attachment budgets are independent', async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/large.txt',new Uint8Array(1024).fill(97));
  let received = 0, calls = 0;
  const service = createLlmService({defaultModel:'fixture',providers:[{
    name:'fixture',models:[{id:'fixture',attachmentTypes:['text/plain']}],
    async *complete(){calls++;yield 'answer';},
    async *completeSources(request){calls++;for await(const bytes of request.attachments[0]!.source.bytes)received += bytes.length;yield 'answer';},
  }]});
  const options = {maxInputBytes:4096,maxBufferedInputBytes:128};
  const capability = createPythonLlmCapability({fs,cwd:'/'},service,options);
  const signal = new AbortController().signal;
  await capability.call!({operation:'complete',payload:{prompt:'hello',attachments:[{path:'/large.txt'}]}},{signal});
  assert.equal(received,1024);
  assert.equal(calls,1);
  await assert.rejects(capability.call!({operation:'complete',payload:{prompt:'x'.repeat(256)}},{signal}),/buffered input.*limit/);
  assert.equal(calls,1);
  const capped = createPythonLlmCapability({fs,cwd:'/'},service,{...options,maxInputBytes:512});
  await assert.rejects(capped.call!({operation:'complete',payload:{attachments:[{path:'/large.txt'}]}},{signal}),/input byte limit/);
  assert.equal(calls,1);
});

test('Python template expansion consumes buffering admission before transport', async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/repeat.yaml',new TextEncoder().encode('prompt: "$input $input $input $input"'));
  let calls = 0;
  const service = createLlmService({defaultModel:'fixture',providers:[{name:'fixture',models:[{id:'fixture'}],async *complete(){calls++;yield 'wrong';}}]});
  const capability = createPythonLlmCapability({fs,cwd:'/'},service,{maxInputBytes:4096,maxBufferedInputBytes:256});
  await assert.rejects(capability.call!({operation:'complete',payload:{template:'/repeat.yaml',prompt:'x'.repeat(64)}},{signal:new AbortController().signal}),/buffered input byte limit/);
  assert.equal(calls,0);
});

test('Python materialized controls reach a dynamic parent budget even without a static ceiling', async () => {
  let calls = 0;
  const service = createLlmService({defaultModel:'fixture',providers:[{name:'fixture',models:[{id:'fixture'}],async *complete(){calls++;yield 'wrong';}}]});
  const capability = createPythonLlmCapability({fs:new MemoryFileSystem(),cwd:'/',inputBudget:{maxBytes:Infinity,check(bytes){if(bytes>32)throw new Error('parent input budget');}}},service);
  await assert.rejects(capability.call!({operation:'complete',payload:{prompt:'x'.repeat(64)}},{signal:new AbortController().signal}),/parent input budget/);
  assert.equal(calls,0);
});


test('Python source requests charge materialized text only once', async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/file.txt', new Uint8Array(32).fill(97));
  const payload = {model: 'fixture', options: {}, prompt: 'hello', attachments: [{path: '/file.txt', mimeType: 'text/plain'}]};
  const controlBytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  let calls = 0;
  const service = createLlmService({defaultModel: 'fixture', providers: [{
    name: 'fixture', models: [{id: 'fixture', attachmentTypes: ['text/plain']}],
    complete() { return assert.fail('retained input was buffered'); },
    async *completeSources(request) {
      calls++;
      let bytes = 0;
      for await (const chunk of request.prompt.bytes) bytes += chunk.byteLength;
      for await (const chunk of request.attachments[0]!.source.bytes) bytes += chunk.byteLength;
      assert.equal(bytes, 37);
      yield 'ok';
    },
  }]});
  const capability = createPythonLlmCapability({fs, cwd: '/'}, service, {
    maxBufferedInputBytes: controlBytes, maxInputBytes: controlBytes + 32,
  });
  await capability.call!({operation: 'complete', payload}, {signal: new AbortController().signal});
  assert.equal(calls, 1);
});
