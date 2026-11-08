import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {createLlmCommand} from './command.js';
import fixtures from './fixtures/chat-parse-0.27.1.json' with {type:'json'};

for (const fixture of fixtures) test(`native chat parser ${JSON.stringify([fixture.args, fixture.env])}`, async () => {
  let stdout = '', stderr = '';
  const command = createLlmCommand({providers: [{name:'fixture',models:[{id:'fixture'}],complete() {throw new Error('must not call provider');}}]});
  const result = await command.execute({command:'llm',args:['chat',...fixture.args],fs:new MemoryFileSystem(),cwd:'/',env:fixture.env ?? {},signal:new AbortController().signal,
    stdin:{[Symbol.asyncIterator]() {throw new Error('must not read input');}},
    stdout:{async write(bytes) {stdout += new TextDecoder().decode(bytes);}},stderr:{async write(bytes) {stderr += new TextDecoder().decode(bytes);}}});
  const expectedOutput = fixture.stdout.split('\n').filter(line => !['  -c, --continue ', '  --cid, --conversation ', '  -d, --database '].some(prefix => line.startsWith(prefix))).join('\n');
  assert.deepEqual({stdout,stderr,exitCode:result.exitCode},{stdout:expectedOutput,stderr:fixture.stderr,exitCode:fixture.exitCode});
});
