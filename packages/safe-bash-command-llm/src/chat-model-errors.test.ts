import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createLlmService} from './service.js';
import {createLlmCommand} from './command.js';
import fixtures from './fixtures/chat-model-errors-0.27.1.json' with {type:'json'};

for (const fixture of fixtures) test(`native chat model error ${JSON.stringify(fixture.args)}`, async () => {
  let stdout = '', stderr = '';
  const fs = new MemoryFileSystem();
  await fs.mkdir('/config/templates', {recursive:true});
  for (const [name, content] of Object.entries(fixture.files ?? {})) await fs.writeFile('/config/' + name, new TextEncoder().encode(content));
  const command = createLlmCommand({providers: [{name:'fixture',models:[{id:'fixture'}],complete() {throw new Error('must not call provider');}}]});
  const result = await command.execute({command:'llm',args:['chat',...fixture.args],fs,cwd:'/',env:{LLM_USER_PATH:"/config"},signal:new AbortController().signal,
    stdin:{[Symbol.asyncIterator]() {throw new Error('must not read input');}},
    stdout:{async write(bytes) {stdout += new TextDecoder().decode(bytes);}},stderr:{async write(bytes) {stderr += new TextDecoder().decode(bytes);}}});
  assert.deepEqual({stdout,stderr,exitCode:result.exitCode},{stdout:fixture.stdout,stderr:fixture.stderr,exitCode:fixture.exitCode});
});

for (const failure of ['default', 'catalog']) test(`chat preserves ${failure} model resolution failure`, async () => {
  let stderr = '';
  const service = createLlmService({defaultModel:'missing',providers:[]});
  const command = createLlmCommand({service:failure === 'default' ? service : {...service,resolve() {throw new Error('catalog unavailable');}}});
  const result = await command.execute({command:'llm',args:['chat'],fs:new MemoryFileSystem(),cwd:'/',env:{},signal:new AbortController().signal,
    stdin:{[Symbol.asyncIterator]() {throw new Error('must not read input');}},stdout:{async write() {throw new Error('must not show banner');}},
    stderr:{async write(bytes) {stderr += new TextDecoder().decode(bytes);}}});
  assert.equal(result.exitCode, 1);
  assert.equal(stderr, failure === 'default' ? "Error: 'missing' is not a known model\n" : 'catalog unavailable\n');
});
