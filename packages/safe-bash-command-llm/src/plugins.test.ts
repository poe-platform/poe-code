import assert from 'node:assert/strict';
import test from 'node:test';
import {MemoryFileSystem} from '@poe-code/safe-fs/core';
import {toByteSource, type CommandContext} from 'safe-bash-contracts';
import {createLlmCommand} from './command.js';
import fixtures from './fixtures/plugins-0.27.1.json' with {type: 'json'};

const plugins = [{name: 'fixture-tools', hooks: ['register_tools', 'register_fragment_loaders'], version: '1.2'},
  {name: 'fixture-界', hooks: ['register_template_loaders']}, {name: 'llm.default_plugins.default_tools', hooks: ['register_tools']}];
for (const fixture of fixtures) test(`pinned plugin listing ${JSON.stringify(fixture.args)}`, async () => {
  let stdout = '', stderr = '', opened = 0, closed = 0;
  const command = createLlmCommand({loadTools: async options => {
    opened++;
    const query = options.pluginQuery;
    assert.ok(query);
    return {tools: [], plugins: (query.all ? plugins : plugins.slice(0, -1)).filter(plugin => !query.hooks.length || plugin.hooks.some(hook => query.hooks.includes(hook))), async close() {closed++;}};
  }});
  const result = await command.execute({command: 'llm', args: ['plugins', ...fixture.args], fs: new MemoryFileSystem(), cwd: '/', env: {}, signal: new AbortController().signal,
    stdin: toByteSource(''), stdout: {async write(bytes) {stdout += new TextDecoder().decode(bytes);}}, stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}} as CommandContext);
  assert.deepEqual({stdout, stderr, exitCode: result.exitCode}, {stdout: fixture.stdout, stderr: fixture.stderr, exitCode: fixture.exitCode});
  assert.equal(closed, opened);
  if (fixture.args.includes('--help') && fixture.stdout.startsWith('Usage:')) assert.equal(opened, 0);
});

test('plugin output limits retire the loaded runtime without model requests', async () => {
  let closed = 0, stderr = '';
  const command = createLlmCommand({limits: {maxOutputBytes: 100}, loadTools: async () => ({tools: [],
    plugins: [{name: 'large'.repeat(1000), hooks: []}], async close() {closed++;}})});
  const result = await command.execute({command: 'llm', args: ['plugins'], fs: new MemoryFileSystem(), cwd: '/', env: {}, signal: new AbortController().signal,
    stdin: toByteSource(''), stdout: {async write() {}}, stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}} as CommandContext);
  assert.equal(result.exitCode, 1, stderr);
  assert.equal(closed, 1);
  assert.ok(stderr.includes('byte limit'), stderr);
});

test('plugin discovery requires a configured runtime', async () => {
  let stderr = '';
  const result = await createLlmCommand().execute({command: 'llm', args: ['plugins'], fs: new MemoryFileSystem(), cwd: '/', env: {}, signal: new AbortController().signal,
    stdin: toByteSource(''), stdout: {async write() {}}, stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}} as CommandContext);
  assert.equal(result.exitCode, 1);
  assert.equal(stderr, 'Error: Python plugin discovery is not configured\n');
});
