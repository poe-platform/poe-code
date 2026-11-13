import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { createGitCommand } from './index.js';
import { runner } from '../tests/support.js';

for (const toStdout of [false, true]) {
  const mode = toStdout ? '-p' : 'in place';
  const args = ['merge-file', ...(toStdout ? ['-p'] : []), 'ours', 'base', 'theirs'];

  for (const unreadable of ['ours', 'base', 'theirs']) {
    for (const kind of ['missing', 'directory']) {
      test(`merge-file ${mode} preserves inputs when ${unreadable} is ${kind}`, async () => {
        const fs = new MemoryFileSystem();
        await fs.mkdir('/repo', { recursive: true });
        const saved = new TextEncoder().encode('save\n');
        for (const name of ['ours', 'base', 'theirs']) {
          if (name !== unreadable) await fs.writeFile(`/repo/${name}`, saved);
        }
        if (kind === 'directory') await fs.mkdir(`/repo/${unreadable}`);

        const result = await runner(fs)(args);
        assert.equal(result.exitCode, 255, result.stderr);
        assert.equal(result.stdout, '');
        assert.ok(result.stderr.includes(unreadable), result.stderr);
        for (const name of ['ours', 'base', 'theirs']) {
          if (name !== unreadable) {
            assert.deepEqual(await fs.readFile(`/repo/${name}`), saved);
          } else if (kind === 'directory') {
            assert.equal((await fs.stat(`/repo/${name}`)).type, 'directory');
          } else {
            await assert.rejects(fs.stat(`/repo/${name}`), { code: 'ENOENT' });
          }
        }
      });
    }
  }

  // Byte-for-byte results from native Git, including invalid UTF-8 text.
  const cases = [
    { name: 'non-UTF-8 one-sided edit', base: '61ff620a', ours: '61ff620a', theirs: '63ff640a',
      output: Buffer.from('63ff640a', 'hex'), exitCode: 0 },
    { name: 'non-UTF-8 independent edits', base: '61ff0a6d69640a62fe0a',
      ours: '63ff0a6d69640a62fe0a', theirs: '61ff0a6d69640a64fe0a',
      output: Buffer.from('63ff0a6d69640a64fe0a', 'hex'), exitCode: 0 },
    { name: 'non-UTF-8 conflict', base: '61ff620a', ours: '63ff640a', theirs: '65fe660a',
      output: Buffer.concat([Buffer.from('<<<<<<< ours\n'), Buffer.from('63ff640a', 'hex'),
        Buffer.from('=======\n'), Buffer.from('65fe660a', 'hex'), Buffer.from('>>>>>>> theirs\n')]),
      exitCode: 1 },
    { name: 'valid empty inputs', base: '', ours: '', theirs: '', output: Buffer.alloc(0), exitCode: 0 },
  ];
  for (const fixture of cases) {
    test(`merge-file ${mode} preserves bytes for ${fixture.name}`, async () => {
      const fs = new MemoryFileSystem();
      await fs.mkdir('/repo', { recursive: true });
      for (const name of ['ours', 'base', 'theirs'] as const) {
        await fs.writeFile(`/repo/${name}`, Buffer.from(fixture[name], 'hex'));
      }
      const stdout: Uint8Array[] = [];
      const stderr: Uint8Array[] = [];
      const result = await createGitCommand().execute({
        command: 'git', args, cwd: '/repo', env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { write(bytes) { stdout.push(bytes); } },
        stderr: { write(bytes) { stderr.push(bytes); } },
      });
      assert.equal(result.exitCode, fixture.exitCode, Buffer.concat(stderr).toString());
      assert.equal(Buffer.concat(stderr).length, 0);
      assert.deepEqual(Buffer.concat(stdout), toStdout ? fixture.output : Buffer.alloc(0));
      assert.deepEqual(Buffer.from(await fs.readFile('/repo/ours')),
        toStdout ? Buffer.from(fixture.ours, 'hex') : fixture.output);
      for (const name of ['base', 'theirs'] as const) {
        assert.deepEqual(Buffer.from(await fs.readFile(`/repo/${name}`)), Buffer.from(fixture[name], 'hex'));
      }
    });
  }
}
