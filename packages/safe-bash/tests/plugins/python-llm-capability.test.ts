import assert from 'node:assert/strict';
import test from 'node:test';
import { createPythonLlmCapability } from '../../src/commands/python/llm-capability.js';
import { createLlmService } from '../../src/commands/llm/service.js';
import { createLlmCommands } from '../../src/commands/llm/command.js';
import { MemoryFileSystem } from '../../src/fs/memory/index.js';
import { toByteSource } from '../../src/contracts/index.js';
import type { CommandContext } from '../../src/contracts/index.js';
import type { LlmRequest } from '../../src/commands/llm/types.js';

const signal = new AbortController().signal;

async function fixture(binary = false) {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/work');
  await fs.writeFile('/work/note.txt', new TextEncoder().encode('canonical'));
  const requests: LlmRequest[] = [];
  let closed = 0;
  const service = createLlmService({defaultModel:'alias', providers:[{
    name:'fake', models:[{id:'model', aliases:['alias'], capabilities:['messages','schema','embed'], attachmentTypes:['text/plain'], outputType:binary ? 'application/octet-stream' : 'text/plain'}],
    async *complete(request) {
      requests.push(request);
      try {
        yield binary ? new Uint8Array([0,255]) : 'answer';
        yield binary ? new Uint8Array([128]) : '!';
        return {usage:{input:3}, metadata:{id:'response-1'}};
      } finally {closed++;}
    },
    async embed(request) {return {model:request.model, vectors:request.inputs.map(() => [1,2]), usage:{input:request.inputs.length}};},
  }]});
  const capability = createPythonLlmCapability({fs,cwd:'/work'}, service);
  return {fs, service, requests, capability, closed:() => closed};
}

test('Bash and Python reuse one shared service and reach the same provider with equivalent requests', async () => {
  const {fs,service,requests,capability} = await fixture();
  const output:Uint8Array[] = [], diagnostic:Uint8Array[] = [];
  const cleanups:(() => void | Promise<void>)[] = [];
  const context:CommandContext = {command:'llm',args:['-m','alias','-s','terse','-o','mode','exact','-a','note.txt','question'],fs,cwd:'/work',env:{},signal,
    stdin:toByteSource(''), stdout:{async write(chunk) {output.push(chunk);}}, stderr:{async write(chunk) {diagnostic.push(chunk);}}, registerCleanup(cleanup) {cleanups.push(cleanup);}};
  try {
    const bash = await createLlmCommands({service})[0]!.execute(context);
    assert.equal(bash.exitCode,0,Buffer.concat(diagnostic).toString());
    const python = await capability.call!({operation:'complete', payload:{model:'alias',prompt:'question',system:'terse',options:{mode:'exact'},attachments:[{path:'note.txt'}]}}, {signal});
    assert.deepEqual(python, {model:'model',text:'answer!',data:[],usage:{input:3},metadata:{id:'response-1'}});
    const semantic = ({signal:_ignoredSignal,...request}: LlmRequest) => ({...request,options:{...request.options},messages:request.messages ?? []});
    assert.deepEqual(semantic(requests[0]!),semantic(requests[1]!));
    assert.equal(Buffer.concat(output).toString(),'answer!\n');
  } finally {for (const cleanup of cleanups) await cleanup();}
});

test('native requests retain typed options, messages, schema and canonical attachment bytes', async () => {
  const {requests,capability} = await fixture();
  await capability.call!({operation:'complete',payload:{prompt:'q',options:{enabled:true,count:2,nullable:null},messages:[{role:'assistant',content:'prior'}],schema:{type:'object'},attachments:[{path:'note.txt'}]}},{signal});
  const request = requests[0]!;
  assert.deepEqual(request.options,{enabled:true,count:2,nullable:null});
  assert.deepEqual(request.messages,[{role:'assistant',content:'prior'}]);
  assert.deepEqual(request.schema,{type:'object'});
  assert.deepEqual(request.attachments,[{mimeType:'text/plain',bytes:new TextEncoder().encode('canonical')}]);
  assert.equal(request.model,'model');
});

test('native discovery and embeddings expose data while provider objects remain on the host', async () => {
  const {capability} = await fixture();
  const models = await capability.call!({operation:'models',payload:{}},{signal}) as {id:string;capabilities:string[];metadata:unknown}[];
  assert.equal(models[0]!.id,'model');
  assert.deepEqual(models[0]!.capabilities,['messages','schema','embed']);
  assert.doesNotMatch(JSON.stringify(models),/complete|credentials/);
  assert.deepEqual(await capability.call!({operation:'embed',payload:{inputs:['one','two'],options:{count:2}}},{signal}), {model:'model',vectors:[[1,2],[1,2]],usage:{input:2}});
});

test('binary complete and incremental streams preserve bytes and final metadata; early close releases provider', async () => {
  const {capability,closed} = await fixture(true);
  assert.deepEqual(await capability.call!({operation:'complete',payload:{prompt:'binary'}},{signal}), {model:'model',text:'',data:[0,255,128],usage:{input:3},metadata:{id:'response-1'}});
  const events = [];
  for await (const event of capability.stream!({prompt:'binary'},{signal})) events.push(event);
  assert.deepEqual(events,[{type:'bytes',data:[0,255]},{type:'bytes',data:[128]},{type:'response',response:{model:'model',usage:{input:3},metadata:{id:'response-1'}}}]);
  const iterator = capability.stream!({prompt:'binary'},{signal})[Symbol.asyncIterator]();
  await iterator.next();
  await iterator.return!();
  assert.equal(closed(),3);
});

test('shared validation rejects rich unsupported features and finite output budgets', async () => {
  const {capability} = await fixture();
  for (const payload of [{template:'missing'},{conversation:'persisted'},{messages:[{role:'invalid',content:'x'}]},{max_response_bytes:1}]) {
    await assert.rejects(capability.call!({operation:'complete',payload},{signal}));
  }
});

test('canonical attachments inherit the parent invocation input budget before provider transport', async () => {
  const {fs,service,requests} = await fixture();
  const capability = createPythonLlmCapability({fs,cwd:'/work',inputBudget:{maxBytes:4,check(total) {
    if (total > 4) throw new RangeError('parent input budget');
  }}},service);
  await assert.rejects(capability.call!({operation:'complete',payload:{prompt:'q',attachments:[{path:'note.txt'}]}},{signal}), /input.*(budget|limit)/);
  assert.equal(requests.length,0);
});

test('large binary provider events split in order with one terminal metadata event and early-close cleanup', async () => {
  const {fs} = await fixture();
  const bytes = Uint8Array.from({length:16 * 1024 * 1024}, (_,index) => index % 256);
  let closed = 0;
  const service = createLlmService({providers:[{name:'image',models:[{id:'image',outputType:'application/octet-stream'}],async *complete() {
    try {yield bytes; return {metadata:{id:'large-image'}};} finally {closed++;}
  }}]});
  const capability = createPythonLlmCapability({fs,cwd:'/work'},service,{maxStreamChunkBytes:4096});
  let offset = 0, terminal = 0;
  for await (const value of capability.stream!({prompt:'image',model:'image'},{signal})) {
    const event = value as {type:string;data?:number[];response?:unknown};
    if (event.type === 'bytes') {
      assert.ok(event.data!.length <= 4096);
      assert.deepEqual(Uint8Array.from(event.data!),bytes.subarray(offset,offset + event.data!.length));
      offset += event.data!.length;
    } else {terminal++; assert.equal(offset,bytes.length);}
  }
  assert.equal(offset,bytes.length);
  assert.equal(terminal,1);
  const early = capability.stream!({prompt:'image',model:'image'},{signal})[Symbol.asyncIterator]();
  await early.next();
  await early.return!();
  assert.equal(closed,2);
});
