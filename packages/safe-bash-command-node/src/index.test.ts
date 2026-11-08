import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryFileSystem, toByteSource } from '@poe-code/safe-fs/core';
import { createNodeCommand, type NodeCommandsOptions } from './index.js';

async function run(args: string[], options: NodeCommandsOptions = {}, stdin = '') {
  let stdout = ''; let stderr = '';
  const fs = createMemoryFileSystem();
  const result = await createNodeCommand(options).execute({command:'node', args, fs, cwd:'/', env:{}, signal:new AbortController().signal,
    stdin:toByteSource(stdin), stdout:{async write(bytes) { stdout += new TextDecoder().decode(bytes); }}, stderr:{async write(bytes) { stderr += new TextDecoder().decode(bytes); }},
  });
  return {...result, stdout, stderr, fs};
}

test('QuickJS executes JavaScript and exposes no native process bindings', async () => {
  const result = await run(['-p', 'JSON.stringify([2n ** 10n + "", typeof fetch, typeof process.binding])']);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, '["1024","undefined","undefined"]\n');
});
test('filesystem operations preserve binary bytes through safe-fs', async () => {
  const result = await run(['-e', `const fs = require('node:fs'); fs.writeFileSync('/out', Buffer.from([0,255,42])); console.log(fs.readFileSync('/out')[1]);`]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, '255\n');
  assert.deepEqual(await result.fs.readFile('/out'), new Uint8Array([0,255,42]));
});
test('stdin and process status work', async () => {
  assert.equal((await run([], {}, 'console.log(42)')).stdout, '42\n');
  assert.equal((await run(['-e', 'process.exitCode = 7'])).exitCode, 7);
});
test('unavailable modules and dispatch fail closed', async () => {
  assert.equal((await run(['-e', `require('node:net')`])).exitCode, 1);
  const result = await run(['-e', `require('child_process').execSync('echo unsafe')`]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /dispatch unavailable/);
});
test('CPU and output limits cannot be suppressed by guest catch', async () => {
  assert.equal((await run(['-e', 'while(true) {}'], {limits:{timeoutMs:100}})).exitCode, 1);
  assert.equal((await run(['-e', 'try {console.log("x".repeat(101))} catch(e) {}'], {limits:{outputBytes:100}})).exitCode, 1);
});
test('errors retain filesystem codes', async () => {
  assert.equal((await run(['-e', `try { require('fs').readFileSync('/missing') } catch(e) {console.log(e.code)}`])).stdout, 'ENOENT\n');
});

test('unsupported filesystem write options fail without changing data', async () => {
  const result = await run(['-e', `require('fs').writeFileSync('/out', 'x', {flag:'a'})`]);
  assert.equal(result.exitCode, 1);
  await assert.rejects(result.fs.stat('/out'));
});

test('caller cancellation propagates into safe-fs and preserves its reason', async () => {
  const controller = new AbortController();
  const reason = new Error('cancelled by caller');
  const fs = createMemoryFileSystem();
  fs.readFile = async (path, options) => {
    assert.equal(path, '/blocked');
    assert.ok(options?.signal);
    controller.abort(reason);
    options.signal.throwIfAborted();
    return new Uint8Array();
  };
  await assert.rejects(async () => createNodeCommand().execute({command:'node',args:['-e', `require('fs').readFileSync('/blocked')`],fs,cwd:'/',env:{},signal:controller.signal,stdin:toByteSource(''),stdout:{async write() {}},stderr:{async write() {}}}), (error: unknown) => error === reason);
});
