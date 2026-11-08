import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {toByteSource, type CommandContext} from 'safe-bash-contracts';
import {createLlmCommand} from './command.js';

for (const args of [['hello', '--functions', 'def add(a: int): return a + 1'], ['tools', 'list', '--functions=def add(a: int): return a + 1', '--json']]) test(`CLI loads invocation-owned Python functions: ${args[0]}`, async () => {
  let closed = 0, stdout = '', stderr = '', calls = 0;
  const fs = new MemoryFileSystem();
  const command = createLlmCommand({defaultModel: 'fixture', providers: [{name: 'fixture', models: [{id: 'fixture', capabilities: ['messages', 'tools']}], async *complete(request) {
    calls++; assert.equal(request.tools?.[0]?.name, 'add');
    if (request.messages?.some(message => message.role === 'tool')) {yield 'finished'; return;}
    return {toolCalls: [{name: 'add', arguments: {a: 2}, id: 'one'}]};
  }}], loadTools: async ({definitions, context}) => {
    assert.deepEqual(definitions, ['def add(a: int): return a + 1']); assert.equal(context.fs, fs);
    return {tools: [{name: 'add', inputSchema: {type: 'object'}, signature: '(a: int)', implementation: args => ({output: Number(args.a) + 1})}], async close() {closed++;}};
  }});
  const result = await command.execute({command: 'llm', args, fs, cwd: '/', env: {}, signal: new AbortController().signal,
    stdin: toByteSource(''), stdout: {async write(bytes) {stdout += new TextDecoder().decode(bytes);}}, stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}
  } as CommandContext);
  assert.equal(result.exitCode, 0, stderr); assert.equal(closed, 1);
  if (args[0] === 'tools') {assert.equal(JSON.parse(stdout).tools[0].name, 'add'); assert.equal(calls, 0);}
  else {assert.equal(stdout, 'finished\n'); assert.equal(calls, 2);}
  assert.deepEqual(await fs.readdir('/'), []);
});

for (const selected of [false, true]) test(`function discovery collision ordering with selected=${selected}`, async () => {
  let stdout = '';
  const command = createLlmCommand({tools: new Map([['same', {name: 'same', description: 'registered', inputSchema: {}, implementation: () => ({output: ''})}]]),
    loadTools: async () => ({tools: [{name: 'same', description: 'function', inputSchema: {}, implementation: () => ({output: ''})}], async close() {}})});
  const result = await command.execute({command: 'llm', args: ['tools', 'list', '--json', '--functions', 'code', ...(selected ? ['same'] : [])],
    fs: new MemoryFileSystem(), cwd: '/', env: {}, signal: new AbortController().signal, stdin: toByteSource(''),
    stdout: {async write(bytes) {stdout += new TextDecoder().decode(bytes);}}, stderr: {async write() {}}} as CommandContext);
  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(stdout).tools[0].description, selected ? 'registered' : 'function');
});

test('saved functions load only from trusted templates and preserve definition order', async () => {
  const fs = new MemoryFileSystem();
  const loaded: (readonly string[])[] = [];
  const command = createLlmCommand({defaultModel: 'fixture', providers: [{name: 'fixture', models: [{id: 'fixture'}], async *complete() {yield 'ok';}}],
    templateLoaders: new Map([['external', async () => ({name: 'external', prompt: 'hello', functions: 'untrusted'})]]),
    loadTools: async ({definitions}) => {loaded.push(definitions); return {tools: [], async close() {}};}});
  const run = async (args: string[]) => {
    let stderr = '';
    const result = await command.execute({command: 'llm', args, fs, cwd: '/', env: {LLM_USER_PATH: '/config'}, signal: new AbortController().signal,
      stdin: toByteSource(''), stdout: {async write() {}}, stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}} as CommandContext);
    assert.equal(result.exitCode, 0, stderr);
  };
  await run(['hello', '--functions', 'first', '--functions=second', '--save', 'saved']);
  assert.deepEqual(loaded, []);
  await run(['-t', 'saved', '--functions', 'third']);
  assert.deepEqual(loaded, [['first\n\nsecond', 'third']]);
  await run(['-t', 'external:value']);
  assert.equal(loaded.length, 1);
});

test('CLI discovers runtime plugin tools and toolbox schemas without function code', async () => {
  let stdout = '', closed = 0;
  const result = await createLlmCommand({loadTools: async options => {
    assert.equal(options.discovery, true); assert.deepEqual(options.toolNames, []);
    return {tools: [{name: 'version', registryKey: 'version_1', plugin: 'fixture', inputSchema: {}}],
      toolboxes: [{name: 'Counter', tools: [{name: 'Counter_add', inputSchema: {type: 'object'}, signature: '(value: int)'}]}],
      async close() {closed++;}};
  }}).execute({command: 'llm', args: ['tools', 'list', '--json'], fs: new MemoryFileSystem(), cwd: '/', env: {}, signal: new AbortController().signal,
    stdin: toByteSource(''), stdout: {async write(bytes) {stdout += new TextDecoder().decode(bytes);}}, stderr: {async write() {}}} as CommandContext);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(stdout), {tools: [{name: 'version_1', description: null, arguments: {}, plugin: 'fixture'}],
    toolboxes: [{name: 'Counter', tools: [{name: 'Counter_add', description: null, arguments: {type: 'object'}}]}]});
  assert.equal(closed, 1);
});

test('CLI selects registered runtime tools through the shared executor', async () => {
  const events: string[] = [];
  const result = await createLlmCommand({defaultModel: 'fixture', loadTools: async options => {
    assert.deepEqual(options.toolNames, ['Counter(3)']);
    return {tools: [{name: 'Counter_add', inputSchema: {}, prepare() {events.push('prepare');}, implementation() {events.push('execute'); return {output: 5};}}], async close() {events.push('close');}};
  }, providers: [{name: 'fixture', models: [{id: 'fixture', capabilities: ['messages', 'tools']}], async *complete(request) {
    if (request.messages?.some(message => message.role === 'tool')) {yield 'done'; return;}
    return {toolCalls: [{id: 'one', name: 'Counter_add', arguments: {value: 2}}]};
  }}]}).execute({command: 'llm', args: ['hello', '-T', 'Counter(3)'], fs: new MemoryFileSystem(), cwd: '/', env: {}, signal: new AbortController().signal,
    stdin: toByteSource(''), stdout: {async write() {}}, stderr: {async write() {}}} as CommandContext);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(events, ['prepare', 'execute', 'prepare', 'close']);
});

test('mixed host and Python selections retain explicit tool order', async () => {
  let seen: unknown;
  const result = await createLlmCommand({defaultModel: 'fixture', tools: new Map([['host', {name: 'host', inputSchema: {}}]]),
    loadTools: async () => ({tools: [{name: 'Box_one', inputSchema: {}, selectionIndex: 0}, {name: 'Box_two', inputSchema: {}, selectionIndex: 0}], async close() {}}),
    providers: [{name: 'fixture', models: [{id: 'fixture', capabilities: ['messages', 'tools']}], async *complete(request) {seen = request.tools?.map(tool => tool.name); yield 'done';}}]
  }).execute({command: 'llm', args: ['hello', '-T', 'host', '-T', 'Box()'], fs: new MemoryFileSystem(), cwd: '/', env: {}, signal: new AbortController().signal,
    stdin: toByteSource(''), stdout: {async write() {}}, stderr: {async write() {}}} as CommandContext);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(seen, ['host', 'Box_one', 'Box_two']);
});
