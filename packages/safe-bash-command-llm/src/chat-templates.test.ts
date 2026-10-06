import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {toByteSource} from 'safe-bash-contracts';
import type {LlmRequest,LlmSourceRequest,LlmInputSource} from './types.js';
import {createLlmCommand} from './command.js';
import {createLlmToolRegistry} from './tool-registry.js';
import fixtures from './fixtures/chat-templates-0.27.1.json' with {type:'json'};

for (const source of [false,true]) for (const fixture of fixtures) test(`native chat template ${JSON.stringify([fixture.args,fixture.template,fixture.input,source])}`, async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/config/templates', {recursive:true});
  await fs.writeFile('/config/templates/fixture.yaml', new TextEncoder().encode(JSON.stringify(fixture.template)));
  let stdout = '', stderr = '';
  const calls: unknown[] = [];
  const tools = createLlmToolRegistry(['llm_version','llm_time'].map(name => ({name,inputSchema:{},implementation() {throw new Error('unexpected tool call');}})));
  const read = async (value: string | LlmInputSource | undefined): Promise<string> => {
    if (value === undefined || typeof value === 'string') return value ?? '';
    let text = ''; const decoder = new TextDecoder();
    for await (const bytes of value.bytes) text += decoder.decode(bytes,{stream:true});
    return text + decoder.decode();
  };
  const complete = async function* (request: LlmRequest | LlmSourceRequest) {
    const prompt = await read(request.prompt);
    calls.push({prompt,system:await read(request.system)}); yield 'reply:' + prompt;
  };
  const command = createLlmCommand({defaultModel:'fixture',tools,providers:[{name:'fixture',models:[{id:'fixture',inputSources:source,canStream:false,capabilities:['messages','tools'],options:{count:{type:'integer'}}}],complete,...(source ? {completeSources:complete} : {})}]});
  const result = await command.execute({command:'llm',args:['chat','-t','fixture',...fixture.args],fs,cwd:'/',env:{LLM_USER_PATH:'/config'},signal:new AbortController().signal,
    stdin:toByteSource(fixture.input),stdout:{async write(bytes) {stdout += new TextDecoder().decode(bytes);}},stderr:{async write(bytes) {stderr += new TextDecoder().decode(bytes);}}});
  assert.deepEqual({stdout,stderr,calls,exitCode:result.exitCode},{stdout:fixture.stdout,stderr:fixture.stderr,calls:fixture.calls,exitCode:fixture.exitCode});
  assert.deepEqual((await fs.readdir('/')).map(entry => entry.name),['config']);
});
