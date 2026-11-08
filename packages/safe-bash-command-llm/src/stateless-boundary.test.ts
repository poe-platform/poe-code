import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { toByteSource } from 'safe-bash-contracts';
import { createLlmCommand } from './command.js';
import { createLlmService } from './service.js';
import type { LlmRequest } from './types.js';

test('history commands and stored schema IDs never access a history database or call a provider', async () => {
  const backing = new MemoryFileSystem();
  const accessed: string[] = [];
  const fs = new Proxy(backing, { get(target, key) {
    const value = Reflect.get(target, key);
    if (typeof value !== 'function') return value;
    return (...args: unknown[]) => {
      if (typeof args[0] === 'string') accessed.push(args[0]);
      return value.apply(target, args);
    };
  } });
  let calls = 0;
  const command = createLlmCommand({ defaultModel: 'fixture', providers: [{ name: 'fixture', models: [{ id: 'fixture', capabilities: ['schema'] }], async *complete() { calls++; yield 'ok'; } }] });
  for (const args of [['schemas'], ['schemas', 'list'], ['schemas', 'show', 'saved'], ['--schema', 'saved', 'hello']]) {
    let stderr = '';
    const result = await command.execute({ command: 'llm', args, fs, cwd: '/', env: { LLM_USER_PATH: '/settings' }, signal: new AbortController().signal,
      stdin: toByteSource(''), stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
    assert.notEqual(result.exitCode, 0, JSON.stringify(args));
    assert.match(stderr, /history|Invalid schema/);
  }
  assert.equal(calls, 0);
  assert.equal(accessed.some(path => path.includes('logs.db')), false, JSON.stringify(accessed));
  assert.deepEqual(await backing.readdir('/'), []);
});

test('the shared service forwards caller messages without retaining them for the next request', async () => {
  const received: LlmRequest[] = [];
  const service = createLlmService({ defaultModel: 'fixture', providers: [{ name: 'fixture', models: [{ id: 'fixture', capabilities: ['messages'] }], async *complete(request) { received.push(request); yield 'ok'; } }] });
  const request = { prompt: 'hello', attachments: [], options: {}, signal: new AbortController().signal };
  const messages = [{ role: 'assistant' as const, content: 'caller context' }];
  for await (const chunk of service.complete({ ...request, messages })) assert.equal(chunk, 'ok');
  for await (const chunk of service.complete(request)) assert.equal(chunk, 'ok');
  assert.deepEqual(received[0]?.messages, messages);
  assert.equal(received[1]?.messages, undefined);
});
