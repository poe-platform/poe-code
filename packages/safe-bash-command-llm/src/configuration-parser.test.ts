import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {toByteSource} from 'safe-bash-contracts';
import {createLlmCommand} from './command.js';
import reference from './fixtures/configuration-parser-0.27.1.json' with {type:'json'};

for (const fixture of reference.cases) test(`configuration reference: ${fixture.argv.join(' ')}`, async () => {
  const command = createLlmCommand({defaultModel:'gpt-4o-mini',providers:[{name:'fixture',models:[{id:'gpt-4o-mini',aliases:['mini']}],complete(){throw new Error('Unexpected provider call');}}]});
  const fs=new MemoryFileSystem();
  let stdout='',stderr='';
  const result=await command.execute({command:'llm',args:fixture.argv,fs,cwd:'/',env:{LLM_USER_PATH:'/settings'},signal:new AbortController().signal,stdin:toByteSource(fixture.stdin),stdout:{async write(bytes){stdout+=new TextDecoder().decode(bytes);}},stderr:{async write(bytes){stderr+=new TextDecoder().decode(bytes);}}});
  assert.deepEqual({exitCode:result.exitCode,stdout,stderr},{exitCode:fixture.exitCode,stdout:fixture.stdout.replaceAll('<USER_PATH>','/settings'),stderr:fixture.stderr});
  for (const [name, contents] of Object.entries(fixture.files)) assert.equal(new TextDecoder().decode(await fs.readFile(`/settings/${name}`)), contents);
});

for (const input of ['fixture\nignored\n', '\nfixture\n', '\r\nfixture\r\n', 'fixture']) test(`key prompt reads one nonempty line: ${JSON.stringify(input)}`, async () => {
  const fs=new MemoryFileSystem(); let retired=0;
  const command=createLlmCommand({providers:[]});
  const result=await command.execute({command:'llm',args:['keys','set','synthetic'],fs,cwd:'/',env:{LLM_USER_PATH:'/settings'},signal:new AbortController().signal,
    stdin:{async *[Symbol.asyncIterator](){try{yield new TextEncoder().encode(input);}finally{retired++;}}},stdout:{async write(){}},stderr:{async write(){}}});
  assert.equal(result.exitCode,0);
  assert.equal(retired,1);
  assert.equal(JSON.parse(new TextDecoder().decode(await fs.readFile('/settings/keys.json'))).synthetic,'fixture');
});

test('key prompt preserves unread shell input and emits no secret',async()=>{
  const fs=new MemoryFileSystem(),bytes=new TextEncoder().encode('fixture\nnext\n');let position=0,stdout='';
  const result=await createLlmCommand({providers:[]}).execute({command:'llm',args:['keys','set','synthetic'],fs,cwd:'/',env:{LLM_USER_PATH:'/settings'},signal:new AbortController().signal,
    stdin:{[Symbol.asyncIterator](){throw new Error('Must use positioned shell input');}},
    stdinInput:{get position(){return position;},async read(max){assert.equal(max,1);return position===bytes.length?{done:true,value:undefined}:{done:false,value:bytes.subarray(position,++position)};}},
    stdout:{async write(bytes){stdout+=new TextDecoder().decode(bytes);}},stderr:{async write(){}}});
  assert.equal(result.exitCode,0);assert.equal(position,8);assert.equal(stdout,'Enter key: \n');
});

test('key EOF aborts without creating an empty credential',async()=>{
  const fs=new MemoryFileSystem();let stderr='';
  const result=await createLlmCommand({providers:[]}).execute({command:'llm',args:['keys','set','synthetic'],fs,cwd:'/',env:{LLM_USER_PATH:'/settings'},signal:new AbortController().signal,
    stdin:toByteSource(''),stdout:{async write(){}},stderr:{async write(bytes){stderr+=new TextDecoder().decode(bytes);}}});
  assert.equal(result.exitCode,1);assert.equal(stderr,'Aborted!\n');assert.deepEqual(await fs.readdir('/'),[]);
});

test('cancelling a stalled key input retires it without publishing',async()=>{
  const fs=new MemoryFileSystem(),controller=new AbortController();let retired=0;
  await assert.rejects(async () => createLlmCommand({providers:[]}).execute({command:'llm',args:['keys','set','synthetic'],fs,cwd:'/',env:{LLM_USER_PATH:'/settings'},signal:controller.signal,
    stdin:{[Symbol.asyncIterator](){return {next(){controller.abort(new Error('stop'));return new Promise(()=>{});},async return(){retired++;return {done:true,value:undefined};}};}},stdout:{async write(){}},stderr:{async write(){}}}),/stop/);
  assert.equal(retired,1);assert.deepEqual(await fs.readdir('/'),[]);
});
