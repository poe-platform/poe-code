import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { toByteSource } from 'safe-bash-contracts';
import fixture from './fixtures/stored-schemas.json' with { type: 'json' };
import { createLlmCommand } from './command.js';

async function setup() {
  const fs = new MemoryFileSystem();
  await fs.mkdir('/settings');
  await fs.writeFile('/settings/logs.db', Buffer.from(fixture.database, 'base64'));
  return { fs, cwd: '/', env: { LLM_USER_PATH: '/settings' }, signal: new AbortController().signal };
}

test('stored schema IDs match the pinned reference through CLI and multi-schema prompts', async () => {
  const context = await setup();
  const received: unknown[] = [];
  const command = createLlmCommand({ defaultModel: 'fixture', providers: [{ name: 'fixture', models: [{ id: 'fixture', capabilities: ['schema'] }],
    async *complete(request) { received.push(request.schema); yield 'ok'; },
  }] });
  async function run(input: string, multi = false) {
    let stderr = '';
    const result = await command.execute({ ...context, command: 'llm', args: [multi ? '--schema-multi' : '--schema', input, 'hello'],
      stdin: toByteSource(''), stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
    return { ...result, stderr };
  }
  for (const [id, schema] of Object.entries(fixture.schemas)) {
    const result = await run(id);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(received.at(-1), schema);
  }
  const multi = await run('unicode', true);
  assert.equal(multi.exitCode, 0, multi.stderr);
  assert.deepEqual(received.at(-1), { type: 'object', properties: { items: { type: 'array', items: fixture.schemas.unicode } }, required: ['items'] });
  const count = received.length;
  const missing = await run('missing-id');
  assert.notEqual(missing.exitCode, 0);
  assert.ok(missing.stderr.includes(fixture.missing));
  assert.equal(received.length, count);
});

test('stored schema SDK accounts selected content and closes retained files on errors', async () => {
  const { loadLlmStoredSchema } = await import('./stored-schema.js');
  const context = await setup();
  let opened = 0, closed = 0, peak = 0;
  const open = context.fs.openReadFile.bind(context.fs);
  const observedOpen = async (...args: Parameters<MemoryFileSystem['openReadFile']>) => {
    opened++;
    const file = await open(...args), close = file.close.bind(file), read = file.read.bind(file);
    file.close = async () => { closed++; await close(); };
    file.read = async (position, size, options) => { peak = Math.max(peak, size); return read(position, Math.min(size, 97), options); };
    return file;
  };
  context.fs = new Proxy(context.fs, { get(target, key) {
    if (key === 'openReadFile') return observedOpen;
    const value: unknown = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  let admitted = 0;
  assert.deepEqual(await loadLlmStoredSchema(context, 'unicode', { admitBytes: size => { admitted += size; } }), fixture.schemas.unicode);
  assert.ok(admitted > 0);
  await assert.rejects(loadLlmStoredSchema(context, 'large', { maxBytes: 100 }), /byte limit/);
  await assert.rejects(loadLlmStoredSchema(context, 'first', { admitBytes() { throw new Error('quota'); } }), /quota/);
  assert.equal(await loadLlmStoredSchema(context, 'absent'), undefined);
  assert.equal(opened, closed);
  assert.ok(peak <= 512);
  await context.fs.writeFile('/settings/logs.db-wal', new Uint8Array([1]));
  await assert.rejects(loadLlmStoredSchema(context, 'first'), /checkpointed/);
  assert.equal(opened, closed);
});

test('stored schema lookup leaves an absent database absent and observes cancellation', async () => {
  const { loadLlmStoredSchema } = await import('./stored-schema.js');
  const context = { fs: new MemoryFileSystem(), cwd: '/', env: { LLM_USER_PATH: '/absent' }, signal: new AbortController().signal };
  assert.equal(await loadLlmStoredSchema(context, 'first'), undefined);
  assert.deepEqual(await context.fs.readdir('/'), []);
  await assert.rejects(loadLlmStoredSchema({ ...context, signal: AbortSignal.abort(new Error('cancel')) }, 'first'), /cancel/);
});

test('stored schemas decode native UTF-16 databases using their header encoding', async () => {
  const { loadLlmStoredSchema } = await import('./stored-schema.js');
  for (const database of Object.values(fixture.encodings)) {
    const context = await setup();
    await context.fs.writeFile('/settings/logs.db', Buffer.from(database, 'base64'));
    assert.deepEqual(await loadLlmStoredSchema(context, 'unicode'), fixture.schemas.unicode);
  }
});
