import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {chatOptionSuggestion} from './chat-options.js';
import {createLlmCommand} from './command.js';
import fixtures from './fixtures/chat-suggestions-0.27.1.json' with {type:'json'};

for (const fixture of fixtures) test(`native chat option suggestion ${JSON.stringify(fixture.args)}`, async () => {
  let stdout = '', stderr = '';
  const command = createLlmCommand({providers: [{name:'fixture',models:[{id:'fixture'}],complete() {throw new Error('must not call provider');}}]});
  const result = await command.execute({command:'llm',args:['chat',...fixture.args],fs:new MemoryFileSystem(),cwd:'/',env:{},signal:new AbortController().signal,
    stdin:{[Symbol.asyncIterator]() {throw new Error('must not read input');}},
    stdout:{async write(bytes) {stdout += new TextDecoder().decode(bytes);}},stderr:{async write(bytes) {stderr += new TextDecoder().decode(bytes);}}});
  assert.deepEqual({stdout,stderr,exitCode:result.exitCode},{stdout:fixture.stdout,stderr:fixture.stderr,exitCode:fixture.exitCode});
});

for (const char of ['x', '😀']) test(`long ${char} options stop matching within a bounded prefix`, async () => {
  let steps = 0;
  assert.equal(await chatOptionSuggestion('--' + char.repeat(100000), async () => {assert.ok(++steps < 128);}), '');
});
