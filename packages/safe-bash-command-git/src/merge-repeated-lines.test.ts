import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFileSystem } from '@poe-code/safe-fs/core';
import { runner } from '../tests/support.js';

// Expected conflicts and clean results captured with native Git's merge style.
for (const row of ['b', '']) {
  const base = `a\n${row}\n${row}\n`;
  const ours = `a\n${row}\n`;
  const theirs = `${row}\n`;
  const conflict = `<<<<<<< ours\na\n=======\n>>>>>>> theirs\n${row}\n`;
  const cases = [
    { name: 'ambiguous deletion', base, ours, theirs, output: conflict, exitCode: 1 },
    { name: 'reversed deletion', base, ours: theirs, theirs: ours,
      output: `<<<<<<< ours\n=======\na\n>>>>>>> theirs\n${row}\n`, exitCode: 1 },
    { name: 'later edit', base: `${base}c\nd\n`, ours: `${ours}c\nd\n`,
      theirs: `${theirs}c\ne\n`, output: `${conflict}c\ne\n`, exitCode: 1 },
    { name: 'identical deletion', base, ours, theirs: ours, output: ours, exitCode: 0 },
    { name: 'one-sided deletion', base, ours, theirs: base, output: ours, exitCode: 0 },
    { name: 'independent edit', base: `${base}c\nd\n`, ours: `${ours}c\nd\n`,
      theirs: `${base}c\ne\n`, output: `${ours}c\ne\n`, exitCode: 0 },
  ];
  for (const fixture of cases) {
    for (const stdout of [true, false]) {
      test(`merge-file ${stdout ? '-p' : 'in place'}: ${fixture.name} with repeated ${row || 'blank'} rows`, async () => {
        const fs = new MemoryFileSystem();
        await fs.mkdir('/repo', { recursive: true });
        const encoder = new TextEncoder();
        for (const name of ['base', 'ours', 'theirs'] as const) {
          await fs.writeFile(`/repo/${name}`, encoder.encode(fixture[name]));
        }
        const result = await runner(fs)(['merge-file', ...(stdout ? ['-p'] : []), 'ours', 'base', 'theirs']);
        assert.equal(result.exitCode, fixture.exitCode, result.stderr);
        assert.equal(result.stdout, stdout ? fixture.output : '');
        assert.equal(result.stderr, '');
        assert.deepEqual(await fs.readFile('/repo/ours'), encoder.encode(stdout ? fixture.ours : fixture.output));
        for (const name of ['base', 'theirs'] as const) {
          assert.deepEqual(await fs.readFile(`/repo/${name}`), encoder.encode(fixture[name]));
        }
      });
    }
  }

  test(`merge preserves HEAD and records all conflict stages for repeated ${row || 'blank'} rows`, async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir('/repo', { recursive: true });
    const run = runner(fs);
    const ok = async (args: string[]) => {
      const result = await run(args);
      assert.equal(result.exitCode, 0, result.stderr);
      return result.stdout;
    };
    const commit = async (text: string, message: string) => {
      await fs.writeFile('/repo/f', new TextEncoder().encode(text));
      await ok(['add', 'f']);
      await ok(['commit', '-m', message]);
    };
    await ok(['init', '-b', 'main']);
    await commit(base, 'base');
    await ok(['checkout', '-b', 'topic']);
    await commit(theirs, 'theirs');
    const topic = await ok(['rev-parse', 'HEAD']);
    await ok(['checkout', 'main']);
    await commit(ours, 'ours');
    const head = await ok(['rev-parse', 'HEAD']);
    assert.equal(await ok(['status', '--porcelain']), '');

    const result = await run(['merge', topic.trim()]);
    assert.equal(result.exitCode, 1, result.stdout);
    assert.equal(await ok(['rev-parse', 'HEAD']), head);
    assert.equal(new TextDecoder().decode(await fs.readFile('/repo/.git/MERGE_HEAD')), topic);
    const stages = (await ok(['ls-files', '--stage'])).trim().split('\n');
    assert.deepEqual(stages.map(line => line.split(' ')[2]), ['1\tf', '2\tf', '3\tf']);
    for (const [index, text] of [base, ours, theirs].entries()) {
      assert.equal(await ok(['show', `:${index + 1}:f`]), text);
    }
    assert.equal(new TextDecoder().decode(await fs.readFile('/repo/f')),
      `<<<<<<< main\na\n=======\n>>>>>>> ${topic.trim()}\n${row}\n`);
    await ok(['merge', '--abort']);
    assert.equal(new TextDecoder().decode(await fs.readFile('/repo/f')), ours);
    assert.equal(await ok(['rev-parse', 'HEAD']), head);
    assert.equal((await ok(['ls-files', '--stage'])).trim().split(' ')[2], '0\tf');
  });
}
