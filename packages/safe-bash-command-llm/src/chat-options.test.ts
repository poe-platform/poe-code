import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {toByteSource} from 'safe-bash-contracts';
import type {LlmRequest,LlmSourceRequest} from './types.js';
import {createLlmCommand} from './command.js';
import fixtures from './fixtures/chat-options-0.27.1.json' with {type:'json'};

for (const source of [false,true]) for (const fixture of fixtures) test(`native chat model options ${JSON.stringify([fixture.args,fixture.configured,fixture.mutateConfigured,source])}`, async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/config', {recursive:true});
  await fs.writeFile('/config/model_options.json', new TextEncoder().encode(JSON.stringify({fixture:fixture.configured ?? {}})));
  let stdout = '', stderr = '', toolLoads = 0;
  const calls: unknown[] = [];
  const complete = async function* (request: LlmRequest | LlmSourceRequest) {
    let prompt = request.prompt;
    if (typeof prompt !== 'string') {let text = ''; const decoder = new TextDecoder(); for await (const bytes of prompt.bytes) text += decoder.decode(bytes,{stream:true}); prompt = text + decoder.decode();}
    calls.push({prompt,options:{count:request.options.count ?? 1,enabled:request.options.enabled ?? true}});
    if (fixture.mutateConfigured) await fs.writeFile('/config/model_options.json', new TextEncoder().encode(JSON.stringify({fixture:{count:'7'}})));
    yield 'reply:' + prompt;
  };
  const command = createLlmCommand({defaultModel:'fixture',providers:[{name:'fixture',models:[{id:'fixture',inputSources:source,canStream:false,capabilities:['messages','tools'],options:{count:{type:'integer'},enabled:{type:'boolean'}}}],complete,...(source ? {completeSources:complete} : {})}],
    loadTools:async () => {toolLoads++; throw new Error('tool discovery ran before validation');}});
  const result = await command.execute({command:'llm',args:['chat',...fixture.args],fs,cwd:'/',env:{LLM_USER_PATH:'/config'},signal:new AbortController().signal,
    stdin:toByteSource(fixture.input),stdout:{async write(bytes) {stdout += new TextDecoder().decode(bytes);}},stderr:{async write(bytes) {stderr += new TextDecoder().decode(bytes);}}});
  assert.deepEqual({stdout,stderr,calls,exitCode:result.exitCode},{stdout:fixture.stdout,stderr:fixture.stderr,calls:fixture.calls,exitCode:fixture.exitCode});
  assert.equal(toolLoads,0);
  assert.deepEqual((await fs.readdir('/')).map(entry => entry.name),['config']);
});
