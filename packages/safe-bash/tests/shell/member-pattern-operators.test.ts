import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { setup } from './helpers.js';
import { basicCommands } from '../../src/commands/basic.js';

// Each expected value is a transformed member, before @/* field joining.
const cases = [
  ['#pre_', ['a_pre_a.txt', 'b_pre_b.txt']],
  ['##*pre_', ['a.txt', 'b.txt']],
  ['%.txt', ['pre_a_pre_a', 'pre_b_pre_b']],
  ['%%_*', ['pre', 'pre']],
  ['/pre_/X', ['Xa_pre_a.txt', 'Xb_pre_b.txt']],
  ['//pre_/X', ['Xa_Xa.txt', 'Xb_Xb.txt']],
  ['/#pre_/X', ['Xa_pre_a.txt', 'Xb_pre_b.txt']],
  ['/%txt/md', ['pre_a_pre_a.md', 'pre_b_pre_b.md']],
] as const;

for (const [operator, members] of cases) {
  for (const selector of ['@', '*', 'a[@]', 'a[*]']) {
    for (const ifs of [' ', ':', '']) {
      test(`member pattern ${selector}${operator} with IFS=${JSON.stringify(ifs)}`, async () => {
        const { shell } = setup();
        try {
          const result = await shell.exec(`set -- pre_a_pre_a.txt pre_b_pre_b.txt; a=("$@"); IFS='${ifs}'; args "\${${selector}${operator}}"`);
          assert.equal(result.exitCode, 0, result.stderr);
          assert.equal(result.stderr, '');
          assert.deepEqual(JSON.parse(result.stdout), selector.includes('@') ? members : [members.join(ifs)]);
        } finally { await shell.dispose(); }
      });
    }
    test(`empty member pattern ${selector}${operator}`, async () => {
      const { shell } = setup();
      try {
        const result = await shell.exec(`set --; a=(); args "\${${selector}${operator}}"`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, '');
        assert.deepEqual(JSON.parse(result.stdout), selector.includes('@') ? [] : ['']);
      } finally { await shell.dispose(); }
    });
  }
}

const effectPatterns = [
  '#$(echo pattern >&2; echo a)',
  '##$(echo pattern >&2; echo "a*")',
  '%$(echo pattern >&2; echo a)',
  '%%$(echo pattern >&2; echo "*a")',
  '/$(echo pattern >&2; echo a)/$(echo replacement >&2; echo "$((++i))")',
  '//$(echo pattern >&2; echo a)/$((++i))',
  '/#$(echo pattern >&2; echo a)/$((++i))',
  '/%$(echo pattern >&2; echo a)/$((++i))',
];

for (const selector of ['@', '*', 'a[@]', 'a[*]']) {
  for (const operator of effectPatterns) {
    test(`member pattern operands expand once: ${selector}${operator}`, async () => {
      const expansion = `\${${selector}${operator}}`;
      const source = [
        'report() { printf "argc=%s\\n" "$#"; printf "<%s>\\n" "$@"; }',
        ...[' ', ':'].flatMap(ifs => ['aa "a a" ""', 'bb cc', 'aa', ''].flatMap(members => [
          `set -- ${members}; a=("$@"); i=0; IFS='${ifs}'`,
          `report "pre${expansion}post"; echo "i=$i"`,
          `report ${expansion}; echo "i=$i"`,
          `joined=${expansion}; report "$joined"; echo "i=$i"`,
        ])),
      ].join('\n');
      const native = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', source], {
        encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
      });
      assert.equal(native.error, undefined);
      assert.equal(native.signal, null);
      assert.equal(native.status, 0, native.stderr);
      const { shell, commands } = setup({ env: { LC_ALL: 'C' } });
      for (const command of basicCommands()) commands.register(command);
      try {
        const result = await shell.exec(source);
        assert.equal(result.exitCode, native.status, result.stderr);
        assert.equal(result.stdout, native.stdout);
        assert.equal(result.stderr, native.stderr);
      } finally { await shell.dispose(); }
    });
  }
}

test('replacement arithmetic runs once per expansion, including unmatched members', async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('a=(aa aa aa); i=0; args "${a[@]/a/$((++i))}" "${a[@]/z/$((++i))}" "${a[*]/a/$((++i))}" "$i"');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), ['1a', '1a', '1a', 'aa', 'aa', 'aa', '3a 3a 3a', '3']);
  } finally { await shell.dispose(); }
});

test('scalar pattern and replacement operands retain their evaluation order', async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('v=112; i=0; args "${v/$((++i))/$((++i))}" "$i" "${v#$((++i))}" "$i"');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), ['212', '2', '112', '3']);
  } finally { await shell.dispose(); }
});
