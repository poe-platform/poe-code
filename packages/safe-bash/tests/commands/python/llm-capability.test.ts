import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem } from 'poe-code/safe-fs/core';
import { Shell } from '../../../src/core.js';
import { createLlmService, llmCommands, type LlmRequest, type LlmProvider } from '../../../src/commands/llm/index.js';
import { pythonCommands } from '../../../src/commands/python/index.js';
import { createPythonLlmCapability } from '../../../src/commands/python/llm-capability.js';

test('Python and Bash share provider resolution, typed requests and canonical attachments', async () => {
  const requests: LlmRequest[] = [];
  const provider: LlmProvider = { name:'fixture', models:[{id:'model',aliases:['short'],attachmentTypes:['text/plain']}], async *complete(request:LlmRequest) { requests.push(request); yield 'answer'; },async embed(request) { return {model:request.model,vectors:request.inputs.map(value => [value.length])}; } };
  const service = createLlmService({providers:[provider],defaultModel:'short'});
  const fs = new MemoryFileSystem();
  await fs.mkdir('/work');
  await fs.writeFile('/work/attachment', new TextEncoder().encode('attached'));
  let response: unknown;
  const shell = new Shell({fs,cwd:'/work'}).use(llmCommands({providers:[provider],defaultModel:'short'})).use(pythonCommands({
    createCapabilities: context => createPythonLlmCapability(context,service),
    createExecutor: () => ({async run(start) {
      const embeddings = await start.dispatch({op:'capability',args:['llm.embed',{inputs:['hello'],options:{}}]});
      assert.deepEqual(embeddings,{model:'model',vectors:[[5]]});
      const models = await start.dispatch({op:'capability',args:['llm.models',{}]});
      assert.deepEqual(models,[{id:'model',provider:'fixture',aliases:['short']}]);
      response = await start.dispatch({op:'capability',args:['llm.complete',{model:'short',prompt:'hello',options:{temperature:0.2,store:false},attachments:[{path:'attachment',mimeType:'text/plain'}]}]});
      return 0;
    },terminate() {}}),
  }));
  try {
    assert.equal((await shell.exec('python -c pass')).exitCode,0);
    assert.deepEqual(response,{model:'model',text:'answer',data:[]});
    assert.equal((await shell.exec('llm --at attachment text/plain hello')).stdout,'answer\n');
    assert.equal(requests.length,2);
    assert.equal(requests[0]!.model,requests[1]!.model);
    assert.equal(requests[0]!.prompt,requests[1]!.prompt);
    assert.deepEqual(requests[0]!.attachments,requests[1]!.attachments);
    assert.deepEqual(requests[0]!.options,{temperature:0.2,store:false});
  } finally { await shell.dispose(); }
});

test('Python LLM host deadline aborts a suspended provider and retires it', {timeout:1500}, async () => {
  let retired = 0;
  const service = createLlmService({defaultModel:'slow',providers:[{name:'fixture',models:[{id:'slow'}],async *complete(request) {
    try {
      await new Promise<void>((resolve,reject) => {
        request.signal.addEventListener('abort',() => reject(request.signal.reason),{once:true});
        if (request.signal.aborted) reject(request.signal.reason);
      });
      yield 'unexpected';
    } finally { retired++; }
  }}]});
  const shell = new Shell({fs:new MemoryFileSystem()}).use(pythonCommands({
    createCapabilities: context => createPythonLlmCapability(context,service),
    createExecutor: () => ({async run(start) {
      const response = await start.dispatch({op:'capability',args:['llm.complete',{prompt:'',options:{},timeout:0.01}]}) as {error:{code:string}};
      assert.equal(response.error.code,'timeout');
      assert.equal(retired,1);
      return 0;
    },terminate() {}}),
  }));
  try { assert.equal((await shell.exec('python -c pass')).exitCode,0); }
  finally { await shell.dispose(); }
});

test('Python host response limits retire the provider before reading excess chunks', async () => {
  let retired = 0;
  let excess = false;
  const service = createLlmService({defaultModel:'model',providers:[{name:'fixture',models:[{id:'model'}],async *complete() {
    try { yield 'ab'; excess = true; yield 'excess'; } finally { retired++; }
  }}]});
  const shell = new Shell({fs:new MemoryFileSystem()}).use(pythonCommands({
    createCapabilities: context => createPythonLlmCapability(context,service),
    createExecutor:() => ({async run(start) {
      const result = await start.dispatch({op:'capability',args:['llm.complete',{prompt:'',max_response_bytes:1}]}) as {error:{code:string}};
      assert.equal(result.error.code,'limit');assert.equal(retired,1);assert.equal(excess,false);
      return 0;
    },terminate() {}}),
  }));
  try { const result = await shell.exec('python -c pass');assert.equal(result.exitCode,0,result.stderr); }
  finally { await shell.dispose(); }
});


test('Python forwards registered templates and host input limits to the shared service', async () => {
  let prompt = '';
  const service = createLlmService({defaultModel:'model',templates:{greet:'Hello {name}'},providers:[{name:'fixture',models:[{id:'model'}],async *complete(request) {prompt = request.prompt;yield 'ok';}}]});
  const shell = new Shell({fs:new MemoryFileSystem()}).use(pythonCommands({
    createCapabilities: context => createPythonLlmCapability(context,service),
    createExecutor:() => ({async run(start) {
      await start.dispatch({op:'capability',args:['llm.complete',{prompt:'',template:'greet',parameters:{name:'Python'}}]});
      assert.equal(prompt,'Hello Python');
      const result = await start.dispatch({op:'capability',args:['llm.complete',{prompt:'',system:'x'.repeat(128*1024+1)}]}) as {error:{code:string}};
      assert.equal(result.error.code,'limit');
      return 0;
    },terminate() {}}),
  }));
  try {const result = await shell.exec('python -c pass');assert.equal(result.exitCode,0,result.stderr);}
  finally {await shell.dispose();}
});


test('Python embedding deadlines abort suspended providers', {timeout:1500}, async () => {
  let aborted = false;
  const service = createLlmService({defaultModel:'model',providers:[{name:'fixture',models:[{id:'model'}],async *complete() {},async embed(request) {
    await new Promise<void>((resolve,reject) => request.signal.addEventListener('abort',() => {aborted = true;reject(request.signal.reason);},{once:true}));
    return {model:request.model,vectors:[]};
  }}]});
  const shell = new Shell({fs:new MemoryFileSystem()}).use(pythonCommands({
    createCapabilities:context => createPythonLlmCapability(context,service),
    createExecutor:() => ({async run(start) {
      const result = await start.dispatch({op:'capability',args:['llm.embed',{inputs:[],timeout:0.01}]}) as {error:{code:string}};
      assert.equal(result.error.code,'timeout');assert.equal(aborted,true);return 0;
    },terminate() {}}),
  }));
  try {const result = await shell.exec('python -c pass');assert.equal(result.exitCode,0,result.stderr);}
  finally {await shell.dispose();}
});
