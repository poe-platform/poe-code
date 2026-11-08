import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { toByteSource } from 'safe-bash-contracts';
import { createLlmCommand } from './command.js';

for (const streamed of [false, true]) {
  test(`independent materialization limit with ${streamed ? 'source' : 'buffered'} provider`, async () => {
    const backing = new MemoryFileSystem();
    await backing.writeFile('/large.txt', new Uint8Array(1024).fill(97));
    let wholeReads = 0, received = 0;
    const fs = new Proxy(backing, { get(target, key) {
      if (key === 'readFile') return async (...args: Parameters<typeof backing.readFile>) => {
        if (args[0] === '/large.txt') wholeReads++;
        return target.readFile(...args);
      };
      const value: unknown = Reflect.get(target,key);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const command = createLlmCommand({defaultModel:'fixture',limits:{maxInputBytes:4096,maxBufferedInputBytes:128},providers:[{
      name:'fixture',models:[{id:'fixture',attachmentTypes:['text/plain']}],
      async *complete() { received++; yield 'buffered'; },
      ...(streamed ? {async *completeSources(request: import('./types.js').LlmSourceRequest) {
        for await (const chunk of request.attachments[0]!.source!.bytes) received += chunk.length;
        yield 'source';
      }} : {}),
    }]});
    let stderr = '';
    const result = await command.execute({command:'llm',args:['-a','/large.txt','hello'],fs,cwd:'/',env:{},signal:new AbortController().signal,
      stdin:toByteSource(''),stdout:{async write(){}},stderr:{async write(bytes){stderr += new TextDecoder().decode(bytes);}}});
    assert.equal(result.exitCode,streamed ? 0 : 1,stderr);
    assert.equal(wholeReads,0,'oversized buffered attachment must reject before whole-file acquisition');
    assert.equal(received,streamed ? 1024 : 0);
    if (!streamed) assert.match(stderr,/buffered input byte limit/);
  });
}

for (const args of [[],['--save','saved'],['-t','repeat']]) {
  test(`buffered stdin is capped before provider/save for ${JSON.stringify(args)}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir('/settings/templates',{recursive:true});
    await fs.writeFile('/settings/templates/repeat.yaml',new TextEncoder().encode('prompt: "$input $input"\n'));
    let calls = 0;
    const command = createLlmCommand({defaultModel:'fixture',limits:{maxInputBytes:4096,maxBufferedInputBytes:128},providers:[{
      name:'fixture',models:[{id:'fixture'}],async *complete(){calls++;yield 'unexpected';},
    }]});
    let stderr = '';
    const result = await command.execute({command:'llm',args,fs,cwd:'/',env:{LLM_USER_PATH:'/settings'},signal:new AbortController().signal,
      stdin:toByteSource('x'.repeat(256)),stdout:{async write(){}},stderr:{async write(bytes){stderr += new TextDecoder().decode(bytes);}}});
    assert.equal(result.exitCode,1,stderr);
    assert.equal(calls,0);
    assert.match(stderr,/buffered input byte limit/);
    assert.deepEqual((await fs.readdir('/settings/templates')).map(entry => entry.name),['repeat.yaml']);
  });
}

test('staged stdin exceeds materialization allowance but obeys total admission and cleans up', async () => {
  for (const maxInputBytes of [2048,512]) {
    const fs = new MemoryFileSystem();
    let received = 0, calls = 0, stderr = '';
    const command = createLlmCommand({defaultModel:'fixture',limits:{maxInputBytes,maxBufferedInputBytes:128},providers:[{
      name:'fixture',models:[{id:'fixture'}],complete(){throw new Error('must stream');},
      async *completeSources(request){calls++;for await(const bytes of request.prompt.bytes){assert.ok(bytes.length <= 16384);received += bytes.length;}yield 'ok';},
    }]});
    const result = await command.execute({command:'llm',args:[],fs,cwd:'/',env:{},signal:new AbortController().signal,
      stdin:toByteSource('x'.repeat(1024)),stdout:{async write(){}},stderr:{async write(bytes){stderr += new TextDecoder().decode(bytes);}}});
    assert.equal(result.exitCode,maxInputBytes === 2048 ? 0 : 1,stderr);
    assert.equal(received,maxInputBytes === 2048 ? 1024 : 0);
    assert.equal(calls,maxInputBytes === 2048 ? 1 : 0);
    assert.deepEqual(await fs.readdir('/'),[]);
  }
});

test('template expansion is admitted before repeated substitutions reach the provider', async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/repeat.yaml',new TextEncoder().encode('prompt: "$input $input $input $input"'));
  let calls = 0, stderr = '';
  const command = createLlmCommand({defaultModel:'fixture',limits:{maxInputBytes:4096,maxBufferedInputBytes:256},providers:[{
    name:'fixture',models:[{id:'fixture'}],async *complete(){calls++;yield 'wrong';},
  }]});
  const result = await command.execute({command:'llm',args:['-t','/repeat.yaml'],fs,cwd:'/',env:{},signal:new AbortController().signal,
    stdin:toByteSource('x'.repeat(64)),stdout:{async write(){}},stderr:{async write(bytes){stderr += new TextDecoder().decode(bytes);}}});
  assert.equal(result.exitCode,1);
  assert.equal(calls,0);
  assert.match(stderr,/buffered input byte limit/);
});

for (const kind of ['argument','schema','template','configuration']) {
  test(`${kind} controls consume materialization admission before provider execution`, async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir('/settings',{recursive:true});
    const large = 'x'.repeat(512);
    await fs.writeFile('/schema.json',new TextEncoder().encode(JSON.stringify({description:large})));
    await fs.writeFile('/template.yaml',new TextEncoder().encode(`prompt: ${large}`));
    if (kind === 'configuration') await fs.writeFile('/settings/model_options.json',new TextEncoder().encode(JSON.stringify({fixture:{unused:large}})));
    let calls = 0, stderr = '';
    const command = createLlmCommand({defaultModel:'fixture',limits:{maxInputBytes:4096,maxBufferedInputBytes:128},providers:[{
      name:'fixture',models:[{id:'fixture',capabilities:['schema']}],async *complete(){calls++;yield 'unexpected';},
    }]});
    const args = kind === 'argument' ? [large] : kind === 'schema' ? ['--schema','/schema.json','hello'] : kind === 'template' ? ['-t','/template.yaml'] : ['hello'];
    const result = await command.execute({command:'llm',args,fs,cwd:'/',env:{LLM_USER_PATH:'/settings'},signal:new AbortController().signal,
      stdin:toByteSource(''),stdout:{async write(){}},stderr:{async write(bytes){stderr += new TextDecoder().decode(bytes);}}});
    assert.equal(result.exitCode,1);
    assert.equal(calls,0);
    assert.match(stderr,/byte limit/);
  });
}

for (const streamed of [false, true]) {
  test(`shell admission counts only stdin and attachments with a ${streamed ? 'source' : 'buffered'} provider`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile('/input.txt', new TextEncoder().encode('ab'));
    let calls = 0;
    const command = createLlmCommand({ defaultModel:'fixture', limits:{maxInputBytes:128,maxBufferedInputBytes:128}, providers:[{
      name:'fixture', models:[{id:'fixture',attachmentTypes:['text/plain']}],
      async *complete(){calls++;yield 'ok';},
      ...(streamed ? {async *completeSources(request: import('./types.js').LlmSourceRequest){
        calls++;
        let promptBytes = 0, attachmentBytes = 0;
        for await(const chunk of request.prompt.bytes) promptBytes += chunk.length;
        for await(const chunk of request.attachments[0]!.source!.bytes) attachmentBytes += chunk.length;
        assert.equal(promptBytes,7);
        assert.equal(attachmentBytes,2);
        yield 'ok';
      }} : {}),
    }] });
    const failure = new Error('shell input exceeded');
    const run = async (stdin: string) => {
      const controller = new AbortController();
      return command.execute({command:'llm',args:['-a','/input.txt','hello'],fs,cwd:'/',env:{},signal:controller.signal,
        inputBudget:{maxBytes:3,check(size){if(size>3){controller.abort(failure);throw failure;}}},
        stdin:toByteSource(stdin),stdout:{async write(){}},stderr:{async write(){}}});
    };
    assert.equal((await run('a')).exitCode,0);
    await assert.rejects(run('aa'),error=>error===failure);
    assert.equal(calls,1);
  });
}

for (const budget of ['total', 'buffered', 'shell'] as const) {
  test(`key stdin obeys ${budget} admission before storage and retires its source`, async () => {
    const fs = new MemoryFileSystem();
    let pulls = 0, retired = false, stderr = '';
    const command = createLlmCommand({providers:[],limits:{
      maxInputBytes:budget === 'total' ? 32 : 1024,
      maxBufferedInputBytes:budget === 'buffered' ? 32 : 1024,
    }});
    const result = await command.execute({command:'llm',args:['keys','set','fixture'],fs,cwd:'/',env:{LLM_USER_PATH:'/settings'},signal:new AbortController().signal,
      ...(budget === 'shell' ? {inputBudget:{maxBytes:32,check(size:number){if(size>32) throw new Error('shell input exceeded');}}} : {}),
      stdin:{async *[Symbol.asyncIterator](){try{for(let index=0;index<3;index++){pulls++;yield new Uint8Array(64).fill(97);}}finally{retired=true;}}},
      stdout:{async write(){}},stderr:{async write(bytes){stderr += new TextDecoder().decode(bytes);}}});
    assert.equal(result.exitCode,1,stderr);
    assert.match(stderr,budget === 'shell' ? /shell input exceeded/ : /input byte limit/);
    assert.equal(pulls,1);
    assert.equal(retired,true);
    assert.deepEqual(await fs.readdir('/'),[],'rejected key must not create configuration');
  });
}

test('key stdin charges raw UTF8 bytes once and preserves split characters', async () => {
  const fs = new MemoryFileSystem(), charged:number[] = [];
  const command = createLlmCommand({providers:[],limits:{maxInputBytes:18,maxBufferedInputBytes:18}});
  const result = await command.execute({command:'llm',args:['keys','set','fixture'],fs,cwd:'/',env:{LLM_USER_PATH:'/settings'},signal:new AbortController().signal,
    inputBudget:{maxBytes:4,check(size){charged.push(size);assert.ok(size<=4);}},
    stdin:{async *[Symbol.asyncIterator](){yield Uint8Array.of(0xe2);yield Uint8Array.of(0x82,0xac,10);}},
    stdout:{async write(){}},stderr:{async write(){}}});
  assert.equal(result.exitCode,0);
  assert.deepEqual(charged,[1,4]);
  assert.equal(JSON.parse(new TextDecoder().decode(await fs.readFile('/settings/keys.json'))).fixture,'€');
});

test('SDK materialization preserves raw admission while enforcing the independent buffer cap', async () => {
  const {createLlmInputBudget} = await import('./input-budget.js');
  const checked: number[] = [];
  const budget = createLlmInputBudget({maxInputBytes: 4, maxBufferedInputBytes: 2}, {maxBytes: 4, check(size) {checked.push(size);}});
  budget.admit(4); budget.materialize(2);
  assert.equal(budget.totalBytes, 4); assert.deepEqual(checked, [4]);
  assert.throws(() => budget.materialize(1), /buffered input byte limit/);
  assert.throws(() => budget.admit(1), /input byte limit/);
  for (const size of [-1, 0.5, Infinity]) assert.throws(() => budget.materialize(size), RangeError);
});
