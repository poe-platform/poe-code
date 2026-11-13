import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { runner } from '../tests/support.js';

// Exact output from native Git with merge.conflictStyle=merge.
const cases = [
  { name: 'unterminated ours', base: 'xx\n', ours: 'xx', theirs: 'yy\n', exitCode: 1,
    output: '<<<<<<< ours\nxx\n=======\nyy\n>>>>>>> theirs\n' },
  { name: 'unterminated theirs', base: 'xx\n', ours: 'yy\n', theirs: 'xx', exitCode: 1,
    output: '<<<<<<< ours\nyy\n=======\nxx\n>>>>>>> theirs\n' },
  { name: 'both unterminated', base: 'xx\n', ours: 'xx', theirs: 'yy', exitCode: 1,
    output: '<<<<<<< ours\nxx\n=======\nyy\n>>>>>>> theirs\n' },
  { name: 'terminated conflict', base: 'base\n', ours: 'xx\n', theirs: 'yy\n', exitCode: 1,
    output: '<<<<<<< ours\nxx\n=======\nyy\n>>>>>>> theirs\n' },
  { name: 'empty ours', base: 'base\n', ours: '', theirs: 'yy', exitCode: 1,
    output: '<<<<<<< ours\n=======\nyy\n>>>>>>> theirs\n' },
  { name: 'empty theirs', base: 'base\n', ours: 'xx', theirs: '', exitCode: 1,
    output: '<<<<<<< ours\nxx\n=======\n>>>>>>> theirs\n' },
  { name: 'clean unchanged', base: 'xx', ours: 'xx', theirs: 'xx', exitCode: 0, output: 'xx' },
  { name: 'clean ours', base: 'base\n', ours: 'xx', theirs: 'base\n', exitCode: 0, output: 'xx' },
  { name: 'clean theirs', base: 'base\n', ours: 'base\n', theirs: 'yy', exitCode: 0, output: 'yy' },
  { name: 'clean identical', base: 'base\n', ours: 'xx', theirs: 'xx', exitCode: 0, output: 'xx' },
  { name: 'clean common suffix', base: 'base\nend', ours: 'xx\nend', theirs: 'base\nend',
    exitCode: 0, output: 'xx\nend' },
];

for (const fixture of cases) {
  for (const toStdout of [true, false]) {
    test(`merge-file ${toStdout ? '-p' : 'in place'} matches native Git: ${fixture.name}`, async () => {
      const fs = new MemoryFileSystem();
      const run = runner(fs);
      await fs.mkdir('/repo', { recursive: true });
      assert.equal((await run(['init', '-q'])).exitCode, 0);
      const encoder = new TextEncoder();
      for (const name of ['ours', 'base', 'theirs'] as const) {
        await fs.writeFile(`/repo/${name}`, encoder.encode(fixture[name]));
      }
      const result = await run(['merge-file', ...(toStdout ? ['-p'] : []), 'ours', 'base', 'theirs']);
      assert.equal(result.exitCode, fixture.exitCode, result.stderr);
      assert.equal(result.stderr, '');
      assert.equal(result.stdout, toStdout ? fixture.output : '');
      assert.deepEqual(await fs.readFile('/repo/ours'), encoder.encode(toStdout ? fixture.ours : fixture.output));
      assert.deepEqual(await fs.readFile('/repo/base'), encoder.encode(fixture.base));
      assert.deepEqual(await fs.readFile('/repo/theirs'), encoder.encode(fixture.theirs));
    });
  }
}
