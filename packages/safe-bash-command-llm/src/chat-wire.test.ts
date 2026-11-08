import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {toByteSource} from 'safe-bash-contracts';
import {createLlmCommand} from './command.js';
import {createOpenAiProvider} from './openai.js';
import fixtures from './fixtures/chat-wire-0.27.1.json' with {type: 'json'};

for (const source of [false, true]) for (const fixture of fixtures) test(`native chat wire: ${fixture.name}, source=${source}`, async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/config/templates', {recursive: true});
  await fs.writeFile('/config/templates/input.yaml', new TextEncoder().encode('prompt: "$input"\nsystem: system\n'));
  await fs.writeFile('/config/templates/dynamic.yaml', new TextEncoder().encode('prompt: "$input"\nsystem: "$input"\n'));
  const initial = await fs.readdir('/');
  let stdout = '', stderr = '';
  const requests: unknown[] = [];
  const provider = createOpenAiProvider({apiKey: 'synthetic', models: [{id: 'fixture', endpoint: 'chat', inputSources: source, capabilities: ['messages', 'tools'], attachmentTypes: ['image/png']}], transport: async request => {
    let body = ''; const decoder = new TextDecoder();
    for await (const bytes of request.body!) body += decoder.decode(bytes, {stream: true});
    requests.push(JSON.parse(body + decoder.decode()).messages);
    const message = fixture.responses[requests.length - 1];
    assert.ok(message, 'unexpected provider call');
    return {status: 200, statusText: 'OK', headers: [], body: toByteSource(JSON.stringify({choices: [{message: {role: 'assistant', ...message}}]})), async dispose() {}};
  }});
  const command = createLlmCommand({defaultModel: 'fixture', providers: [provider], fragmentLoaders: new Map([['image', async function* () {yield {type: 'attachment' as const, mimeType: 'image/png', source: {bytes: toByteSource('abc'), async dispose() {}}};}]]), loadTools: async () => ({tools: [{name: 'lookup', inputSchema: {type: 'object', properties: {}}, implementation() {
    return {output: 'tool value', ...(fixture.name === 'tool-attachment' ? {attachments: [{mimeType: 'image/png', source: {bytes: toByteSource('abc'), async dispose() {}}}]} : {})};
  }}], async close() {}})});
  const result = await command.execute({command: 'llm', args: ['chat', '--no-stream', ...fixture.args], fs, cwd: '/', env: {LLM_USER_PATH: '/config'}, signal: new AbortController().signal,
    stdin: toByteSource(fixture.input), stdout: {async write(bytes) {stdout += new TextDecoder().decode(bytes);}}, stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}});
  assert.equal(result.exitCode, fixture.exitCode, stderr); assert.equal(stdout, fixture.stdout); assert.equal(stderr, fixture.stderr);
  assert.deepEqual(requests, fixture.requests);
  assert.deepEqual(await fs.readdir('/'), initial);
});

for (const cancel of [false, true]) test(`system comparison handles partial retained reads and cancellation=${cancel}`, async () => {
  const backing = new MemoryFileSystem(), controller = new AbortController(), encoder = new TextEncoder();
  const prefix = 'x'.repeat(97), reason = new Error('cancel system comparison');
  await backing.mkdir('/config/templates', {recursive: true});
  await backing.writeFile('/config/templates/input.yaml', encoder.encode('prompt: "$input"\nsystem: "' + prefix + '$input"\n'));
  let opened = 0, closed = 0, calls = 0, interrupt = false, intercepted = false, stderr = '';
  const fs = new Proxy(backing, {get(target, key) {
    if (key === 'openReadFile') return async (...args: Parameters<typeof target.openReadFile>) => {
      const handle = await target.openReadFile(...args), stat = await handle.stat();
      const width = ++opened % 2 ? 7 : 11; let retired = false;
      return {stat: handle.stat.bind(handle), async close() {if (!retired) {retired = true; closed++;} await handle.close();}, async read(offset: number, length: number, options: Parameters<typeof handle.read>[2]) {
        assert.ok(length <= 16384);
        if (cancel && interrupt && stat.size === 100) {intercepted = true; queueMicrotask(() => controller.abort(reason)); return new Promise<Uint8Array>(() => {});}
        return handle.read(offset, Math.min(length, width), options);
      }};
    };
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  }});
  const systems: string[][] = [];
  const command = createLlmCommand({defaultModel: 'fixture', providers: [{name: 'fixture', models: [{id: 'fixture', capabilities: ['messages']}], complete() {throw new Error('buffered fallback');}, async *completeSources(request) {
    const current: string[] = [];
    const sources = [...(request.system ? [request.system] : []), ...request.messages?.filter(message => message.role === 'system').map(message => message.content) ?? []];
    for (const source of sources) {let text = ''; for await (const bytes of source.bytes) text += new TextDecoder().decode(bytes); current.push(text);}
    systems.push(current); calls++; yield 'ok'; interrupt = true;
  }}]});
  const run = command.execute({command: 'llm', args: ['chat', '-t', 'input'], fs, cwd: '/', env: {LLM_USER_PATH: '/config'}, signal: controller.signal,
    stdin: toByteSource('one\none\ntwo\nexit\n'), stdout: {async write() {}}, stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}});
  if (cancel) {await assert.rejects(async () => run, error => error === reason); assert.equal(intercepted, true); assert.equal(calls, 1);}
  else {assert.equal((await run).exitCode, 0, stderr); assert.deepEqual(systems, [[prefix + 'one'], [prefix + 'one'], [prefix + 'one', prefix + 'two']]);}
  assert.equal(closed, opened); assert.deepEqual((await backing.readdir('/')).map(entry => entry.name), ['config']);
});
