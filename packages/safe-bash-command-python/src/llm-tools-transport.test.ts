import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createLlmService } from 'safe-bash-command-llm';
import { createPythonLlmCapability } from './llm-capability.js';
import type { PythonHostValue } from './host-capabilities.js';

const tools = [{name: 'lookup', inputSchema: {type: 'object', properties: {query: {type: 'string'}}}}];
const toolCalls = [{id: 'call-1', name: 'lookup', arguments: {query: 'Zürich'}}];
const signal = new AbortController().signal;

for (const source of [false, true]) test(`Python bridge preserves tool definitions, calls and results: source=${source}`, async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/result', new TextEncoder().encode('found'));
  let received = 0;
  const service = createLlmService({defaultModel: 'fixture', providers: [{
    name: 'fixture', models: [{id: 'fixture', capabilities: ['messages', 'tools']}],
    async *complete(request) {
      received++;
      assert.deepEqual(request.tools, tools);
      assert.deepEqual(request.messages, [{role: 'assistant', content: '', toolCalls}, {role: 'tool', content: 'found', toolCallId: 'call-1'}]);
      yield "";
      return {toolCalls};
    },
    async *completeSources(request) {
      received++;
      assert.deepEqual(request.tools, tools);
      assert.deepEqual(request.messages?.[0]?.toolCalls, toolCalls);
      assert.equal(request.messages?.[1]?.toolCallId, 'call-1');
      let result = '';
      for await (const bytes of request.messages![1]!.content.bytes) result += new TextDecoder().decode(bytes);
      assert.equal(result, 'found');
      yield "";
      return {toolCalls};
    }
  }]});
  const capability = createPythonLlmCapability({fs, cwd: '/'}, service);
  const result = await capability.call!({operation: 'complete', payload: {
    prompt: '', tools, messages: [{role: 'assistant', content: '', toolCalls}, {role: 'tool', content: source ? {path: '/result'} : 'found', toolCallId: 'call-1'}]
  }}, {signal});
  assert.deepEqual(result, {model: 'fixture', toolCalls, text: '', data: []});
  assert.equal(received, 1);
});

test('Python tools retain shared model admission and host control-byte quotas', async () => {
  let received = 0;
  const service = createLlmService({defaultModel: 'plain', providers: [{
    name: 'fixture', models: [{id: 'plain'}], async *complete() { received++; yield ""; }
  }]});
  const context = {fs: new MemoryFileSystem(), cwd: '/'};
  const capability = createPythonLlmCapability(context, service);
  await assert.rejects(capability.call!({operation: 'complete', payload: {tools}}, {signal}), /does not support tools/);
  const bounded = createPythonLlmCapability(context, service, {maxBufferedInputBytes: 128});
  await assert.rejects(bounded.call!({operation: 'complete', payload: {tools: [{...tools[0]!, description: 'x'.repeat(256)}]} as PythonHostValue}, {signal}), /input byte limit/);
  assert.equal(received, 0);
});

for (const streamed of [false, true]) test(`Python tool response metadata remains bounded: streamed=${streamed}`, async () => {
  let retired = 0;
  const service = createLlmService({defaultModel: 'fixture', providers: [{
    name: 'fixture', models: [{id: 'fixture', capabilities: ['tools']}],
    async *complete() { try { yield ""; return {toolCalls}; } finally { retired++; } }
  }]});
  const capability = createPythonLlmCapability({fs: new MemoryFileSystem(), cwd: '/'}, service, {maxMetadataBytes: 32});
  await assert.rejects(async () => {
    if (streamed) for await (const ignoredEvent of capability.stream!({tools}, {signal})) { /* consume */ }
    else await capability.call!({operation: 'complete', payload: {tools}}, {signal});
  }, /response limit exceeded/);
  assert.equal(retired, 1);
});

test('malformed tool controls and result identities fail before provider dispatch', async () => {
  let received = 0;
  const service = createLlmService({defaultModel: 'fixture', providers: [{
    name: 'fixture', models: [{id: 'fixture', capabilities: ['tools', 'messages']}], async *complete() { received++; yield ""; }
  }]});
  const capability = createPythonLlmCapability({fs: new MemoryFileSystem(), cwd: '/'}, service);
  for (const payload of [
    {tools: {}}, {tools: [{name: '', inputSchema: {}}]},
    {messages: [{role: 'tool', content: 'result'}]},
    {messages: [{role: 'user', content: '', toolCalls}]},
    {messages: [{role: 'assistant', content: '', toolCalls: 'invalid'}]}
  ]) await assert.rejects(capability.call!({operation: 'complete', payload} as PythonHostValue, {signal}));
  assert.equal(received, 0);
});

test('empty tool declarations preserve plain message model admission', async () => {
  const service = createLlmService({defaultModel: 'plain', providers: [{
    name: 'fixture', models: [{id: 'plain', capabilities: ['messages']}], async *complete() { yield 'ok'; }
  }]});
  const capability = createPythonLlmCapability({fs: new MemoryFileSystem(), cwd: '/'}, service);
  const result = await capability.call!({operation: 'complete', payload: {tools: [], messages: [{role: 'assistant', content: '', toolCalls: []}]}}, {signal});
  assert.equal((result as {text: string}).text, 'ok');
});
