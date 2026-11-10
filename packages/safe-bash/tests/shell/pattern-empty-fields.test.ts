import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { setup } from './helpers.js';
import { bashExecutable, modernBashSkip } from '../helpers/bash-oracle.js';

for (const operator of ['', '#a', '##a', '%x', '%%x', '/a/', '//a/', '/#a/', '/%a/']) {
  for (const quoted of [false, true]) {
    for (const ifs of ["' :'", "$' :\\xff'"]) {
      test(`array pattern leading whitespace boundary: ${operator}, quoted=${quoted}, IFS=${ifs}`, async t => {
        const { shell } = setup({ env: { LC_ALL: 'C' } });
        t.after(() => shell.dispose());
        const expansion = `\${a[@]${operator}}`;
        const source = `IFS=${ifs}; a=('' ':b'); set -- ${quoted ? `"${expansion}"` : expansion}; args "$@"`;
        const expected = quoted ? ['', ':b'] : ['b'];
        await t.test('matches GNU Bash 5.2+', { skip: modernBashSkip }, () => {
          const native = spawnSync(bashExecutable, ['--noprofile', '--norc', '-c', `args() { printf '%s\\0' "$@"; }; ${source}`], {
            encoding: 'utf8', env: { LC_ALL: 'C' },
          });
          assert.ifError(native.error);
          assert.equal(native.signal, null);
          assert.equal(native.status, 0, native.stderr);
          assert.equal(native.stderr, '');
          assert.deepEqual(native.stdout.slice(0, -1).split('\0'), expected);
        });
        const result = await shell.exec(`for iteration in 1 2; do ${source}; done`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, '');
        assert.equal(result.stdout, JSON.stringify(expected).repeat(2));
      });
    }
  }
}

for (const [initialization, expansion, expected] of [
  ['set -- ax "" bx', '${@//x/y}', ['ay', '', 'by']],
  ['a=(ax "" bx)', '${a[@]//x/y}', ['ay', '', 'by']],
  ['a=(ax "" bx)', '${a[@]#a}', ['x', '', 'bx']],
] as const) for (const quoted of [false, true]) {
  test(`pattern expansion preserves empty middle fields: ${expansion}, quoted=${quoted}`, async t => {
    const { shell } = setup();
    t.after(() => shell.dispose());
    const source = `IFS=:; ${initialization}; set -- ${quoted ? `"${expansion}"` : expansion}; args "$@"`;
    await t.test('matches GNU Bash 5.2+', { skip: modernBashSkip }, () => {
      const native = spawnSync(bashExecutable, ['--noprofile', '--norc', '-c', `args() { printf '%s\\0' "$@"; }; ${source}`], { encoding: 'utf8' });
      assert.equal(native.error, undefined);
      assert.equal(native.signal, null);
      assert.equal(native.status, 0, native.stderr);
      assert.equal(native.stderr, '');
      assert.deepEqual(native.stdout.slice(0, -1).split('\0'), expected);
    });
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), expected);
  });
}
