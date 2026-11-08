import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { toByteSource } from 'safe-bash-contracts';
import { createLlmCommand } from './command.js';
import reference from './fixtures/schemas-reference.json' with { type: 'json' };
test('schema DSL output matches pinned reference without invoking a provider',async()=>{
 const fs=new MemoryFileSystem(); const command=createLlmCommand();
 for(const fixture of reference.cases) {
  const stdout:Uint8Array[]=[];const stderr:Uint8Array[]=[];
  const result=await command.execute({command:'llm',args:fixture.argv,fs,cwd:'/',env:{},signal:new AbortController().signal,stdin:toByteSource(''),stdout:{async write(chunk){stdout.push(chunk.slice());}},stderr:{async write(chunk){stderr.push(chunk.slice());}}});
  assert.equal(result.exitCode,fixture.exitCode,fixture.argv.join(' '));
  assert.equal(Buffer.concat(stdout).toString(),fixture.stdout);
  assert.equal(Buffer.concat(stderr).toString(),fixture.stderr);
 }
});
