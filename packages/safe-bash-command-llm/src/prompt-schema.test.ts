import assert from 'node:assert/strict';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { toByteSource } from 'safe-bash-contracts';
import { createLlmCommand } from './command.js';
import type { LlmProvider } from './types.js';

for (const streamed of [false, true]) test('prompt schema inputs reach ' + (streamed ? 'streamed' : 'buffered') + ' providers', async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/settings/templates', { recursive: true });
  const schema = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] };
  await fs.writeFile('/schema.json', new TextEncoder().encode(JSON.stringify(schema)));
  await fs.writeFile('/settings/templates/record.yaml', new TextEncoder().encode(JSON.stringify({prompt: 'Describe Ada', schema_object: schema})));
  const received: unknown[] = [];
  const provider: LlmProvider = {
    name: 'fixture', models: [{ id: 'fixture', capabilities: ['schema'] }],
    async *complete(request) { received.push(request.schema); yield '{"name":"Ada"}'; },
    ...(streamed ? { async *completeSources(request: Parameters<NonNullable<LlmProvider['completeSources']>>[0]) {
      received.push(request.schema); for await (const ignored of request.prompt.bytes) { void ignored; } yield '{"name":"Ada"}';
    } } : {}),
  };
  const command = createLlmCommand({providers: [provider], defaultModel: 'fixture'});
  const run = async (args: string[]) => {
    let stdout = '', stderr = '';
    const result = await command.execute({command: 'llm', args, fs, cwd: '/', env: {LLM_USER_PATH: '/settings'}, signal: new AbortController().signal,
      stdin: toByteSource(''), stdout: {async write(chunk) {stdout += new TextDecoder().decode(chunk);}}, stderr: {async write(chunk) {stderr += new TextDecoder().decode(chunk);}}});
    return {...result, stdout, stderr};
  };
  for (const input of [JSON.stringify(schema), '/schema.json', 't:record']) {
    const result = await run(['--schema', input, 'Describe Ada']);
    assert.equal(result.exitCode, 0, result.stderr); assert.deepEqual(received.at(-1), schema);
  }
  const dsl = await run(['--schema', 'name, age int', 'Describe Ada']);
  assert.equal(dsl.exitCode, 0, dsl.stderr);
  assert.deepEqual(JSON.parse(JSON.stringify(received.at(-1))), {type: 'object', properties: {name: {type: 'string'}, age: {type: 'integer'}}, required: ['name', 'age']});
  const multi = await run(['--schema-multi', '/schema.json', 'Describe people']);
  assert.equal(multi.exitCode, 0, multi.stderr);
  assert.deepEqual(received.at(-1), {type: 'object', properties: {items: {type: 'array', items: schema}}, required: ['items']});
  const template = await run(['-t', 'record']);
  assert.equal(template.exitCode, 0, template.stderr); assert.deepEqual(received.at(-1), schema);
  const saved = await run(['--schema', '/schema.json', '--save', 'saved', 'Describe Ada']);
  assert.equal(saved.exitCode, 0, saved.stderr);
  assert.deepEqual(parseYaml(new TextDecoder().decode(await fs.readFile('/settings/templates/saved.yaml'))).schema_object, schema);
  await fs.writeFile('/bad.json', new TextEncoder().encode('{invalid'));
  const before = received.length;
  const invalid = await run(['--schema', '/bad.json', 'test']);
  assert.notEqual(invalid.exitCode, 0); assert.match(invalid.stderr, /Schema file contained invalid JSON/); assert.equal(received.length, before);
});
