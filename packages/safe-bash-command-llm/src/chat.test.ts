import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {toByteSource, type CommandContext} from 'safe-bash-contracts';
import {createLlmCommand} from './command.js';
import fixtures from './fixtures/chat-0.27.1.json' with {type: 'json'};
for (const fixture of fixtures) test(`pinned chat ${JSON.stringify([fixture.args, fixture.input])}`, async () => {
  let stdout = '', stderr = '';
  const calls: unknown[] = [];
  const fs = new MemoryFileSystem();
  await fs.mkdir('/config/templates', {recursive: true});
  await fs.writeFile('/config/templates/input.yaml', new TextEncoder().encode('prompt: "$input"\nsystem: Template system\noptions:\n  count: 9\nfragments: [ignored]\n'));
  await fs.writeFile('/config/templates/prefix.yaml', new TextEncoder().encode('prompt: Prefix\nsystem: Template system\noptions:\n  count: 9\nfragments: [ignored]\n'));
  await fs.writeFile('/frag.txt', new TextEncoder().encode('Fragment'));
  const initial = await fs.readdir('/');
  const command = createLlmCommand({defaultModel: 'fixture', providers: [{name: 'fixture', models: [{id: 'fixture', canStream: false, capabilities: ['messages'], options: {count: {type: 'integer'}}}], async *complete(request) {
    const messages = request.messages ?? [];
    const previous = messages.flatMap((message, index) => message.role === 'user' ? [{prompt: message.content, text: messages[index + 1]?.content}] : []);
    calls.push({prompt: request.prompt, system: request.system ?? '', options: {count: request.options.count ?? 1}, stream: request.stream, previous});
    yield 'reply:' + request.prompt;
  }}]});
  const result = await command.execute({command: 'llm', args: ['chat', ...fixture.args], fs, cwd: '/', env: {LLM_USER_PATH: '/config'}, signal: new AbortController().signal,
    stdin: toByteSource(fixture.input), stdout: {async write(bytes) {stdout += new TextDecoder().decode(bytes);}}, stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}} as CommandContext);
  assert.deepEqual({stdout, stderr, calls, exitCode: result.exitCode}, {stdout: fixture.args.includes('--help') ? fixture.stdout.split('\n').filter(line => !['  -c, --continue ', '  --cid, --conversation ', '  -d, --database '].some(prefix => line.startsWith(prefix))).join('\n') : fixture.stdout, stderr: fixture.stderr, calls: fixture.calls, exitCode: fixture.exitCode});
  assert.deepEqual(await fs.readdir('/'), initial);
});

for (const edit of ['saved', 'unchanged', 'failure', 'cancelled'] as const) test(`chat editor ${edit} uses caller invocation and cleans scratch`, async () => {
  const fs = new MemoryFileSystem(), controller = new AbortController();
  const prompts: string[] = []; let stdout = '', stderr = '';
  const command = createLlmCommand({defaultModel: 'fixture', providers: [{name: 'fixture', models: [{id: 'fixture', capabilities: ['messages']}], async *complete(request) {prompts.push(request.prompt); yield 'ok';}}]});
  const run = command.execute({command: 'llm', args: ['chat'], fs, cwd: '/', env: {EDITOR: 'fixture-editor'}, signal: controller.signal,
    stdin: toByteSource('!edit\nexit\n'), stdout: {async write(bytes) {stdout += new TextDecoder().decode(bytes);}}, stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}},
    async invoke(name, args) {
      assert.equal(name, 'sh'); assert.equal(args[1], 'fixture-editor "$1"');
      const path = args[args.length - 1]!;
      const before = await fs.stat(path);
      if (edit !== 'unchanged') {await fs.writeFile(path, new TextEncoder().encode('  edited\ntext \n')); await fs.utimes!(path, before.atimeMs, before.mtimeMs + 1000);}
      if (edit === 'cancelled') {controller.abort(new Error('editor cancelled')); throw controller.signal.reason;}
      return {exitCode: edit === 'failure' ? 1 : 0};
    }
  } as CommandContext);
  if (edit === 'cancelled') await assert.rejects(async () => run, (error: unknown) => error === controller.signal.reason);
  else {const result = await run; assert.equal(result.exitCode, edit === 'failure' ? 1 : 0, stderr);}
  assert.deepEqual(prompts, edit === 'saved' ? ['edited\ntext'] : []);
  if (edit === 'unchanged') assert.equal(stderr, 'Editor closed without saving.\n');
  if (edit === 'saved') assert.ok(stdout.includes('ok\n'));
  assert.deepEqual(await fs.readdir('/'), []);
});

test('chat streams large prompts and prior context with bounded caller filesystem reads', async () => {
  const backing = new MemoryFileSystem(); let maximum = 0;
  const fs = new Proxy(backing, {get(target, key) {
    if (key === 'openReadFile') return async (...args: Parameters<typeof target.openReadFile>) => {
      const handle = await target.openReadFile(...args);
      return {stat: handle.stat.bind(handle), close: handle.close.bind(handle), async read(offset: number, length: number, options: Parameters<typeof handle.read>[2]) {
        maximum = Math.max(maximum, length); assert.ok(length <= 16384); return handle.read(offset, length, options);
      }};
    };
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  }});
  const sizes: number[] = [], previous: number[][] = [];
  const command = createLlmCommand({defaultModel: 'fixture', limits: {maxInputBytes: 2_000_000, maxBufferedInputBytes: 128}, providers: [{name: 'fixture', models: [{id: 'fixture', capabilities: ['messages']}], complete() {throw new Error('buffered fallback');}, async *completeSources(request) {
    let size = 0; for await (const bytes of request.prompt.bytes) size += bytes.length; await request.prompt.dispose(); sizes.push(size);
    const history: number[] = [];
    for (const message of request.messages ?? []) {let size = 0; for await (const bytes of message.content.bytes) size += bytes.length; await message.content.dispose(); history.push(size);}
    previous.push(history); yield 'ok';
  }}]});
  const bytes = new TextEncoder().encode('😀'.repeat(50000) + '\nsecond\nexit\n');
  const result = await command.execute({command: 'llm', args: ['chat'], fs, cwd: '/', env: {}, signal: new AbortController().signal,
    stdin: {async *[Symbol.asyncIterator]() {for (let offset = 0; offset < bytes.length; offset += 4093) yield bytes.subarray(offset, offset + 4093);}},
    stdout: {async write() {}}, stderr: {async write(bytes) {assert.fail(new TextDecoder().decode(bytes));}}} as CommandContext);
  assert.equal(result.exitCode, 0); assert.deepEqual(sizes, [200000, 6]); assert.deepEqual(previous, [[], [200000, 2]]); assert.ok(maximum > 0);
  assert.deepEqual(await fs.readdir('/'), []);
});

test('chat cancellation retires a pending stdin read and caller staging', async () => {
  const fs = new MemoryFileSystem(), controller = new AbortController(); let retired = 0;
  const reason = new Error('stop chat');
  const command = createLlmCommand({defaultModel: 'fixture', providers: [{name: 'fixture', models: [{id: 'fixture'}], complete() {throw new Error('unexpected model request');}}]});
  const run = command.execute({command: 'llm', args: ['chat'], fs, cwd: '/', env: {}, signal: controller.signal,
    stdin: {[Symbol.asyncIterator]() {return {next() {queueMicrotask(() => controller.abort(reason)); return new Promise<IteratorResult<Uint8Array>>(() => {});}, async return() {retired++; return {done: true, value: undefined};}};}},
    stdout: {async write() {}}, stderr: {async write() {}}} as CommandContext);
  await assert.rejects(async () => run, error => error === reason);
  assert.equal(retired, 1); assert.deepEqual(await fs.readdir('/'), []);
});

test('chat shares input with approvals and retains one tool runtime until exit', async () => {
  const fs = new MemoryFileSystem(); let loaded = 0, closed = 0, executed = 0, stdout = '', stderr = '';
  const command = createLlmCommand({defaultModel: 'fixture', loadTools: async () => {loaded++; return {tools: [{name: 'counter', inputSchema: {}, implementation() {return {output: ++executed};}}], async close() {closed++;}};},
    providers: [{name: 'fixture', models: [{id: 'fixture', capabilities: ['messages', 'tools']}], async *complete(request) {
      assert.ok(!(request.messages ?? []).some(message => message.role === 'user' && message.content === ''), 'native conversation replay omits empty tool continuation prompts');
      if (request.prompt) return {toolCalls: [{name: 'counter', arguments: {}, id: 'call'}]};
      yield 'done';
    }}]});
  const result = await command.execute({command: 'llm', args: ['chat', '--functions', 'code', '--ta'], fs, cwd: '/', env: {}, signal: new AbortController().signal,
    stdin: toByteSource('one\ny\ntwo\ny\nexit\n'), stdout: {async write(bytes) {stdout += new TextDecoder().decode(bytes);}}, stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}} as CommandContext);
  assert.equal(result.exitCode, 0, stderr); assert.equal(loaded, 1); assert.equal(closed, 1); assert.equal(executed, 2);
  assert.ok(stdout.endsWith('> Approve tool call? [y/N]: done\n> '), stdout);
  assert.deepEqual(await fs.readdir('/'), []);
});

for (const replacement of [false, true]) test(`chat editor shares stdin and processes fragment lines (replacement=${replacement})`, async () => {
  const fs = new MemoryFileSystem(), encoder = new TextEncoder(); let stderr = '';
  await fs.writeFile('/frag.txt', encoder.encode('Fragment'));
  const prompts: string[] = [];
  const command = createLlmCommand({defaultModel: 'fixture', providers: [{name: 'fixture', models: [{id: 'fixture', capabilities: ['messages']}], async *complete(request) {prompts.push(request.prompt); yield 'ok';}}]});
  const result = await command.execute({command: 'llm', args: ['chat'], fs, cwd: '/', env: {EDITOR: 'fixture'}, signal: new AbortController().signal,
    stdin: toByteSource('!edit\neditor input\nexit\n'), stdout: {async write() {}}, stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}},
    async invoke(_name, args, options) {
      const input = options!.stdin![Symbol.asyncIterator]();
      assert.equal(new TextDecoder().decode((await input.next()).value), 'editor input\n');
      await input.return?.();
      const path = args.at(-1)!, stat = await fs.stat(path);
      if (replacement) await fs.unlink(path);
      await fs.writeFile(path, encoder.encode('!fragment frag.txt\nbody\n!fragment frag.txt'));
      await fs.utimes!(path, stat.atimeMs, stat.mtimeMs + 1000);
      return {exitCode: 0};
    }
  } as CommandContext);
  assert.equal(result.exitCode, 0, stderr); assert.deepEqual(prompts, ['Fragment\nFragment\nbody']);
  assert.deepEqual((await fs.readdir('/')).map(entry => entry.name), ['frag.txt']);
});

test('chat context is discarded between invocations of the same command', async () => {
  const fs = new MemoryFileSystem(), contexts: number[] = [];
  const command = createLlmCommand({defaultModel: 'fixture', providers: [{name: 'fixture', models: [{id: 'fixture', capabilities: ['messages']}], async *complete(request) {contexts.push(request.messages?.length ?? 0); yield 'ok';}}]});
  for (let invocation = 0; invocation < 2; invocation++) {
    const result = await command.execute({command: 'llm', args: ['chat'], fs, cwd: '/', env: {}, signal: new AbortController().signal, stdin: toByteSource('one\ntwo\nexit\n'), stdout: {async write() {}}, stderr: {async write(bytes) {assert.fail(new TextDecoder().decode(bytes));}}});
    assert.equal(result.exitCode, 0); assert.deepEqual(await fs.readdir('/'), []);
  }
  assert.deepEqual(contexts, [0, 2, 0, 2]);
});

for (const quota of ['input', 'buffered', 'output'] as const) test(`chat obeys ${quota} admission and cleans retained context`, async () => {
  const fs = new MemoryFileSystem(); let calls = 0, stderr = '';
  const command = createLlmCommand({defaultModel: 'fixture', limits: quota === 'output' ? {maxOutputBytes: 500} : quota === 'input' ? {maxInputBytes: 128} : {maxBufferedInputBytes: 128},
    providers: [{name: 'fixture', models: [{id: 'fixture', capabilities: ['messages']}], async *complete() {calls++; yield 'x'.repeat(1000);}}]});
  const result = await command.execute({command: 'llm', args: ['chat'], fs, cwd: '/', env: {}, signal: new AbortController().signal,
    stdin: toByteSource((quota === 'output' ? 'hello' : 'x'.repeat(256)) + '\nexit\n'), stdout: {async write() {}}, stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}});
  assert.equal(result.exitCode, 1); assert.equal(calls, quota === 'output' ? 1 : 0); assert.ok(stderr.includes('byte limit'), stderr);
  assert.deepEqual(await fs.readdir('/'), []);
});

test('initial chat fragments are snapshotted once before stdin and charged once', async () => {
  const backing = new MemoryFileSystem(), encoder = new TextEncoder(); let reads = 0, stderr = '';
  await backing.writeFile('/fragment', encoder.encode('a'.repeat(512)));
  const fs = new Proxy(backing, {get(target, key) {
    if (key === 'openReadFile') return async (...args: Parameters<typeof target.openReadFile>) => {if (args[0] === '/fragment') reads++; return target.openReadFile(...args);};
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  }});
  const prompts: string[] = [];
  const command = createLlmCommand({defaultModel: 'fixture', limits: {maxInputBytes: 700, maxBufferedInputBytes: 128}, providers: [{name: 'fixture', models: [{id: 'fixture', capabilities: ['messages']}],
    complete() {throw new Error('buffered fallback');}, async *completeSources(request) {let prompt = ''; const decoder = new TextDecoder(); for await (const bytes of request.prompt.bytes) prompt += decoder.decode(bytes, {stream: true}); prompts.push(prompt + decoder.decode()); yield 'ok';}
  }]});
  const result = await command.execute({command: 'llm', args: ['chat', '-f', '/fragment'], fs, cwd: '/', env: {}, signal: new AbortController().signal,
    stdin: {async *[Symbol.asyncIterator]() {await backing.writeFile('/fragment', encoder.encode('changed')); yield encoder.encode('hello\nsecond\nexit\n');}},
    stdout: {async write() {}}, stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}});
  assert.equal(result.exitCode, 0, stderr); assert.equal(reads, 1); assert.deepEqual(prompts, ['a'.repeat(512) + '\nhello', 'second']);
  assert.deepEqual((await backing.readdir('/')).map(entry => entry.name), ['fragment']);
});

test('invalid UTF8 in an initial fragment fails before banner or stdin acquisition', async () => {
  const fs = new MemoryFileSystem(); await fs.writeFile('/fragment', Uint8Array.of(255)); let stdout = '', stderr = '', reads = 0;
  const command = createLlmCommand({defaultModel: 'fixture', providers: [{name: 'fixture', models: [{id: 'fixture'}], complete() {throw new Error('unexpected model call');}}]});
  const result = await command.execute({command: 'llm', args: ['chat', '-f', '/fragment'], fs, cwd: '/', env: {}, signal: new AbortController().signal,
    stdin: {async *[Symbol.asyncIterator]() {reads++; yield new TextEncoder().encode('exit\n');}}, stdout: {async write(bytes) {stdout += new TextDecoder().decode(bytes);}}, stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}});
  assert.equal(result.exitCode, 1); assert.equal(stdout, ''); assert.equal(reads, 0); assert.ok(stderr.includes('encoded data'), stderr);
  assert.deepEqual((await fs.readdir('/')).map(entry => entry.name), ['fragment']);
});

test('inline fragment control materialization does not count stdin bytes twice', async () => {
  const fs = new MemoryFileSystem(); let calls = 0, stderr = '';
  const command = createLlmCommand({defaultModel: 'fixture', limits: {maxInputBytes: 80, maxBufferedInputBytes: 32}, providers: [{name: 'fixture', models: [{id: 'fixture'}], complete() {throw new Error('buffered fallback');},
    async *completeSources(request) {let length = 0; for await (const bytes of request.prompt.bytes) length += bytes.length; assert.equal(length, 58); calls++; yield 'ok';}
  }]});
  const result = await command.execute({command: 'llm', args: ['chat'], fs, cwd: '/', env: {}, signal: new AbortController().signal,
    stdin: toByteSource('!fragment -\n' + 'x'.repeat(52) + '\nexit\n'), stdout: {async write() {}}, stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}});
  assert.equal(result.exitCode, 1); assert.equal(stderr, 'Aborted!\n'); assert.equal(calls, 1); assert.deepEqual(await fs.readdir('/'), []);
});

test('startup fragment admission bounds an empty plugin stream before retaining every item', async () => {
  const fs = new MemoryFileSystem(); let loaded = 0, stderr = '';
  const command = createLlmCommand({defaultModel: 'fixture', limits: {maxInputBytes: 96}, fragmentLoaders: new Map([['empty', async function* () {
    for (let index = 0; index < 200; index++) {loaded++; yield {type: 'text' as const, source: {bytes: toByteSource(''), async dispose() {}}};}
  }]]), providers: [{name: 'fixture', models: [{id: 'fixture'}], complete() {throw new Error('unexpected model call');}}]});
  const result = await command.execute({command: 'llm', args: ['chat', '-f', 'empty:items'], fs, cwd: '/', env: {}, signal: new AbortController().signal,
    stdin: toByteSource('hello\nexit\n'), stdout: {async write() {}}, stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}});
  assert.equal(result.exitCode, 1); assert.ok(stderr.includes('byte limit'), stderr); assert.ok(loaded <= 96, String(loaded)); assert.deepEqual(await fs.readdir('/'), []);
});
