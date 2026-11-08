import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import type { CommandContext } from 'safe-bash-contracts';
import { createGitCommand, evalSyncGit } from './index.js';

test('git commands preserve the caller stdin unless their invocation needs it', async () => {
  const fs = new MemoryFileSystem();
  const command = createGitCommand();
  await fs.mkdir('/repo', { recursive: true });
  await fs.writeFile('/repo/a', new TextEncoder().encode('a'));
  for (const args of [['init'], ['add', 'a'], ['status'], ['commit', '-m', '--stdin'], ['hash-object', 'a'], ['apply', '/patch'], ['am', '/patch'], ['cat-file', '-p', 'HEAD'], ['-C', '/repo', 'status']]) {
    let reads = 0;
    await command.execute({ command: 'git', args, cwd: '/repo', env: {}, fs,
      signal: new AbortController().signal,
      stdin: (async function* () { reads++; yield new TextEncoder().encode('b.txt\nc.txt\n'); })(),
      stdout: { write() {} }, stderr: { write() {} },
    } as CommandContext);
    assert.equal(reads, 0, args.join(' '));
  }
});

test('WASM forwards scoped environment and quiet options', async () => {
  const fs = new MemoryFileSystem();
  const command = createGitCommand();
  const run = async (args: string[], env: Record<string, string> = {}, cwd = '/repo') => {
    let stdout = '', stderr = '';
    const result = await command.execute({ command: 'git', args, cwd, env, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { write(b: Uint8Array) { stdout += new TextDecoder().decode(b); } },
      stderr: { write(b: Uint8Array) { stderr += new TextDecoder().decode(b); } },
    } as CommandContext);
    assert.equal(result.exitCode, 0, stderr);
    return stdout;
  };
  assert.equal(await run(['init', '--quiet']), '');
  const env = { GIT_DIR: '/repo/.git', GIT_WORK_TREE: '/repo', GIT_AUTHOR_NAME: 'Override Author', GIT_AUTHOR_EMAIL: 'author@example.com', GIT_COMMITTER_NAME: 'Override Committer', GIT_COMMITTER_EMAIL: 'committer@example.com', GIT_AUTHOR_DATE: '1700000000 +0530', GIT_COMMITTER_DATE: '1700000100 -0400' };
  assert.equal(await run(['rev-parse', '--show-toplevel'], env, '/'), '/repo\n');
  assert.equal(await run(['commit', '-q', '--allow-empty', '-m', 'first'], env, '/'), '');
  const object = await run(['cat-file', '-p', 'HEAD']);
  assert.ok(object.includes('author Override Author <author@example.com> 1700000000 +0530'));
  assert.ok(object.includes('committer Override Committer <committer@example.com> 1700000100 -0400'));
  await fs.mkdir('/custom-home', { recursive: true });
  await fs.writeFile('/custom-home/.gitconfig', new TextEncoder().encode('[user]\nname = Home User\nemail = home@example.com\n'));
  await run(['commit', '--quiet', '--allow-empty', '-m', 'second'], { HOME: '/custom-home' });
  assert.ok((await run(['cat-file', '-p', 'HEAD'])).includes('Home User <home@example.com>'));
  await run(['commit', '--quiet', '--allow-empty', '-m', 'third']);
  assert.ok(!(await run(['cat-file', '-p', 'HEAD'])).includes('Home User'));
});

test('stdin reads respect limits and aliases while preserving binary bytes', async () => {
  const fs = new MemoryFileSystem();
  const command = createGitCommand();
  const run = async (args: string[], stdin: AsyncIterable<Uint8Array>, cmd = command) => {
    let stdout = '', stderr = '';
    const result = await cmd.execute({ command: 'git', args, cwd: '/repo', env: {}, fs,
      signal: new AbortController().signal, stdin,
      stdout: { write(b: Uint8Array) { stdout += new TextDecoder().decode(b); } },
      stderr: { write(b: Uint8Array) { stderr += new TextDecoder().decode(b); } },
    } as CommandContext);
    return { ...result, stdout, stderr };
  };
  const empty = () => (async function* () {})();
  await run(['init'], empty());
  await run(['config', 'alias.hash', 'hash-object --stdin'], empty());
  const input = new Uint8Array([0, 255, 10]);
  const direct = await run(['hash-object', '--stdin'], (async function* () { yield input; })());
  const alias = await run(['-C', '/repo', 'hash'], (async function* () { yield input; })());
  assert.equal(alias.exitCode, 0, alias.stderr);
  assert.equal(alias.stdout, direct.stdout);
  const budget = createGitCommand({ limits: { maxBytes: 4096 } });
  const limited = await run(['hash-object', '--stdin'], (async function* () { yield new Uint8Array(4097); })(), budget);
  assert.equal(limited.exitCode, 128);
  assert.ok(limited.stderr.includes('stdin byte limit exceeded'));
});

test('synchronous Git distinguishes unavailable stdin from explicit empty input', () => {
  const inspect = (path: string) => path === '/' ? { type: 'directory' as const, mode: 0o755, children: [] } : undefined;
  const refuseMutation = () => assert.fail('hash-object without -w must not mutate the filesystem');
  const run = (input: Uint8Array | undefined) => evalSyncGit(input, ['hash-object', '--stdin'], '/', inspect, () => undefined, undefined, refuseMutation, refuseMutation, refuseMutation);
  assert.equal(run(undefined), undefined);
  assert.equal(run(new Uint8Array()), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391\n');
});
