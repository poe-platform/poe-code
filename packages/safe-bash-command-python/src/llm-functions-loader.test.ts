import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {toByteSource, type CommandContext} from 'safe-bash-contracts';
import {createPythonLlmToolLoader} from './llm-functions-loader.js';

function context(): CommandContext {
  return {command: 'llm', args: [], fs: new MemoryFileSystem(), cwd: '/', env: {}, signal: new AbortController().signal,
    stdin: toByteSource(''), stdout: {async write() {}}, stderr: {async write() {}}} as CommandContext;
}
test('Python loader owns interpreter, retained outputs and terminal cleanup', async () => {
  let terminated = 0;
  const load = createPythonLlmToolLoader({createExecutor: () => ({
    terminate() {terminated++;},
    async run(start) {
      start.onReady();
      const send = (value: Parameters<NonNullable<typeof start.host>['request']>[0]) => start.host!.request({version: 1, operation: 'call', capability: 'llm_tools', value});
      assert.deepEqual(await send({op: 'definitions'}), ['def add(a): return a + 1']);
      await send({op: 'register', index: 0, name: 'add', inputSchema: {}, signature: '(a)', asynchronous: false});
      await send({op: 'ready'});
      const call = await send({op: 'next'}) as {id: number};
      await send({op: 'text', id: call.id, text: '3'});
      await send({op: 'text', id: call.id, text: '😀'.repeat(4096)});
      await send({op: 'done', id: call.id});
      assert.equal(await send({op: 'next'}), null);
      return 0;
    }
  })});
  const ctx = context();
  const session = await load({context: ctx, definitions: ['def add(a): return a + 1'], maxInputBytes: 4096, maxOutputBytes: 20000});
  const result = await session.tools[0]!.implementation!({a: 2}, {fs: ctx.fs, cwd: '/', signal: ctx.signal, maxBytes: 20000});
  assert.ok(result.source);
  let text = '';
  const decoder = new TextDecoder('utf-8', {fatal: true});
  for await (const bytes of result.source.bytes) text += decoder.decode(bytes, {stream: true});
  text += decoder.decode();
  assert.equal(text, '3' + '😀'.repeat(4096));
  await result.source.dispose();
  await session.close(); await session.close();
  assert.equal(terminated, 1); assert.deepEqual(await ctx.fs.readdir('/'), []);
});

test('Python tool sessions share the configured executor capacity', async () => {
  let started = 0;
  const load = createPythonLlmToolLoader({maxConcurrentWorkers: 1, createExecutor: () => ({terminate() {}, async run(start) {
    started++; start.onReady();
    const send = (op: string) => start.host!.request({version: 1, operation: 'call', capability: 'llm_tools', value: {op}});
    await send('ready');
    assert.equal(await send('next'), null);
    return 0;
  }})});
  const settings = {context: context(), definitions: [], maxInputBytes: 4096, maxOutputBytes: 4096};
  const first = await load(settings);
  let unexpected: Awaited<ReturnType<typeof load>> | undefined;
  try {await assert.rejects(async () => {unexpected = await load({...settings, context: context()});}, /exited with status 1/);}
  finally {await unexpected?.close(); await first.close();}
  assert.equal(started, 1);
});

test('host protocol failures reject pending tools and retire the interpreter', async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('test deadline')), 250);
  const ctx = {...context(), signal: controller.signal};
  let failure: unknown;
  const load = createPythonLlmToolLoader({createExecutor: () => ({terminate() {}, async run(start) {
    start.onReady();
    const send = (value: Parameters<NonNullable<typeof start.host>['request']>[0]) => start.host!.request({version: 1, operation: 'call', capability: 'llm_tools', value});
    await send({op: 'register', index: 0, name: 'large', inputSchema: {}, signature: '()', asynchronous: false});
    await send({op: 'ready'});
    const call = await send({op: 'next'}) as {id: number};
    try {await send({op: 'text', id: call.id, text: 'too large'});} catch (error) {failure = error;}
    assert.deepEqual(await send({op: 'next'}), {cancel: true});
    return 0;
  }})});
  const session = await load({context: ctx, definitions: [], maxInputBytes: 4096, maxOutputBytes: 2});
  try {
    await assert.rejects(async () => session.tools[0]!.implementation!({}, {fs: ctx.fs, cwd: '/', signal: ctx.signal, maxBytes: 2}), (error: unknown) => error === failure);
    assert.ok(failure instanceof RangeError);
  } finally {clearTimeout(timeout); await session.close();}
  assert.deepEqual(await ctx.fs.readdir('/'), []);
});

test('registered invocation cleanup retires borrowed attachment storage', async () => {
  let cleanup: (() => void | Promise<void>) | undefined;
  const ctx = {...context(), registerCleanup(value: () => void | Promise<void>) {cleanup = value;}};
  const load = createPythonLlmToolLoader({createExecutor: () => ({terminate() {}, async run(start) {
    start.onReady();
    const send = (value: Parameters<NonNullable<typeof start.host>['request']>[0]) => start.host!.request({version: 1, operation: 'call', capability: 'llm_tools', value});
    await send({op: 'register', index: 0, name: 'file', inputSchema: {}, signature: '()', asynchronous: false});
    await send({op: 'ready'});
    const call = await send({op: 'next'}) as {id: number};
    const attachment = await send({op: 'attachment', id: call.id, descriptor: {mimeType: 'application/octet-stream', id: 'file'}});
    await send({op: 'bytes', id: call.id, attachment, bytes: [0, 255, 10]});
    await send({op: 'attachment', id: call.id, descriptor: {mimeType: 'text/plain', id: 'remote', url: 'https://example.com/file'}});
    await send({op: 'done', id: call.id});
    assert.equal(await send({op: 'next'}), null);
    return 0;
  }})});
  const session = await load({context: ctx, definitions: [], maxInputBytes: 4096, maxOutputBytes: 4096});
  try {
    const result = await session.tools[0]!.implementation!({}, {fs: ctx.fs, cwd: '/', signal: ctx.signal, maxBytes: 4096});
    const bytes: number[] = [];
    for await (const chunk of result.attachments![0]!.source!.bytes) bytes.push(...chunk);
    assert.deepEqual(bytes, [0, 255, 10]);
    assert.equal(result.attachments![1]!.url, 'https://example.com/file');
    assert.ok(cleanup);
    await cleanup();
    assert.deepEqual(await ctx.fs.readdir('/'), []);
  } finally {await session.close();}
});
