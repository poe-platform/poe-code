import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { setup } from './helpers.js';

for (const [source, expected] of [
  ['unset u; a=(); set --; set -- ${u:-"${a[@]}"}', []],
  ['unset u; a=(); set --; set -- "${a[@]}"', []],
  ['unset u; a=(""); set -- ""; set -- ${u:-"${a[@]}"}', ['']],
  ['unset u; a=(); set --; set -- "${u:-${a[@]}}"', ['']],
  ['unset u; a=(); set -- ${u-"${a[@]}"}', []],
  ['u=set; a=(); set -- ${u:+"${a[@]}"}', []],
  ['u=set; a=(); set -- ${u+"${a[@]}"}', []],
  ['unset u; a=(); set -- ${u:-"""${a[@]}"}', ['']],
  ['unset u; a=(); set -- ${u:-"${a[@]}"""}', ['']],
  ['unset u; a=(); set -- ${u:-pre"${a[@]}"post}', ['prepost']],
  ['unset u; a=("" "two words"); set -- ${u:-"${a[@]}"}', ['', 'two words']],
] as const) test(`quoted array fallback preserves argument count: ${source}`, async t => {
  const native = spawnSync(process.env.SAFE_BASH_TEST_BASH ?? '/bin/bash', ['--noprofile', '--norc', '-c', `${source}; printf '%s\\0' "$#"; for arg do printf '%s\\0' "$arg"; done`], { encoding: 'utf8', env: { LC_ALL: 'C', PATH: process.env.PATH } });
  assert.equal(native.error, undefined);
  assert.equal(native.status, 0, native.stderr);
  assert.equal(native.stderr, '');
  assert.deepEqual(native.stdout.slice(0, -1).split('\0'), [String(expected.length), ...expected]);
  const { shell } = setup();
  t.after(() => shell.dispose());
  const result = await shell.exec(`${source}; args "$@"`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), expected);
});

for (const nounset of ['+u', '-u']) for (const selector of ['@', '*']) {
  for (const [initialize, slice] of [
    ['a=abc', '1:1'], ['a=abc', ' -2:1'], ['a=abc', '0:-1'],
    ['a=abc', '3:1'], ['a=abc', '4:1'], ['a=abc', '0:0'],
    ['a=', '0:0'], ['unset a', '1:1'],
    ['a=(abc)', '1:1'], ['a=(abc def ghi)', '1:1'],
  ]) test(`scalar member substring matches Bash: ${nounset}, ${initialize}, [${selector}]:${slice}`, async () => {
    const expansion = '${a[' + selector + ']:' + slice + '}';
    const source = `set ${nounset}; ${initialize}; args "${expansion}"`;
    const native = spawnSync(process.env.SAFE_BASH_TEST_BASH ?? '/bin/bash', ['--noprofile', '--norc', '-c', `args() { printf '%s\\0' "$#" "$@"; }; ${source}`], { encoding: 'utf8', env: { LC_ALL: 'C', PATH: process.env.PATH } });
    assert.equal(native.error, undefined);
    assert.equal(native.status, 0, native.stderr);
    assert.equal(native.stderr, '');
    const fields = native.stdout.slice(0, -1).split('\0');
    assert.equal(Number(fields.shift()), fields.length);
    const { shell } = setup({ env: { LC_ALL: 'C' } });
    try {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, '');
      assert.deepEqual(JSON.parse(result.stdout), fields);
    } finally { await shell.dispose(); }
  });
}

for (const bounded of [false, true]) for (const [operator, values] of [
  ['#a', ['b', 'cd']],
  ['##a*', ['', 'cd']],
  ['%d', ['ab', 'c']],
  ['%%d*', ['ab', 'c']],
] as const) for (const selector of ['@', '*']) for (const quoted of [false, true]) {
  test(`empty IFS array trimming: ${operator}, ${selector}, quoted=${quoted}, bounded=${bounded}`, async t => {
    const { shell } = setup(bounded ? { limits: { maxExpansionBytes: 1024 * 1024 } } : {});
    t.after(() => shell.dispose());
    const expansion = `\${a[${selector}]${operator}}`;
    const result = await shell.exec(`IFS=""; a=(ab cd); set -- ${quoted ? `"${expansion}"` : expansion}; args "$@"`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), quoted && selector === '@' ? values : [values.join(quoted ? '' : ' ')]);
  });
}

for (const quoted of [false, true]) test(`empty IFS positional trimming preserves arguments: quoted=${quoted}`, async t => {
  const { shell } = setup();
  t.after(() => shell.dispose());
  const result = await shell.exec(`IFS=""; set -- ab cd; set -- ${quoted ? '"${@#a}"' : '${@#a}'}; args "$@"`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), ['b', 'cd']);
});

for (const selector of ['@', '*']) for (const nounset of [true, false]) {
  for (const [initialization, count, assigned] of [
    ['unset a', 0, false],
    ['a=abc', 1, false],
    ['declare -a a', 0, false],
    ['declare -A a', 0, false],
    ['a=()', 0, true],
    ['declare -A a=()', 0, true],
    ['a=([3]=three [8]=eight)', 2, true],
    ['declare -A a=([key]=value)', 1, true],
    ['a=(value); unset "a[0]"', 0, true],
    ['a=(value); unset "a[@]"', 0, true],
    ['a=abc; declare -a a', 1, true],
  ] as const) test(`array member count with set ${nounset ? '-' : '+'}u: ${initialization}, [${selector}]`, async t => {
    const { shell } = setup();
    t.after(() => shell.dispose());
    const result = await shell.exec(`set ${nounset ? '-' : '+'}u; ${initialization}; args "\${#a[${selector}]}"; say end`);
    const unbound = nounset && !assigned;
    assert.equal(result.exitCode, unbound ? 1 : 0);
    assert.equal(result.stdout, unbound ? '' : `["${count}"]end\n`);
    assert.equal(result.stderr, unbound ? 'shell: line 1: a: unbound variable\n' : '');
  });
}

for (const bounded of [false, true]) for (const [source, expected, diagnostic] of [
  ['set -u; s=none; a=abc; say "${#a[0]}"; say end', '', 'a[0]: unbound variable'],
  ['set -u; a=abc; say "${#a}"; say end', '3\nend\n', ''],
  ['set +u; a=abc; say "${#a[0]}"; say end', '3\nend\n', ''],
  ['set -u; a=(abc); say "${#a[0]}"; say end', '3\nend\n', ''],
  ['set -u; a=abc; say "${a[0]}"; say end', 'abc\nend\n', ''],
] as const) test(`scalar subscript length (${bounded ? 'bounded' : 'unbounded'}): ${source}`, async t => {
  const { shell } = setup(bounded ? { limits: { maxExpansionBytes: 1024 * 1024 } } : {});
  t.after(() => shell.dispose());
  const result = await shell.exec(source);
  assert.equal(result.stdout, expected);
  if (diagnostic) {
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes(diagnostic), result.stderr);
  } else {
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, '');
  }
});

for (const mode of ['inline', 'bash', 'sh'] as const) for (const [source, expected] of [
  ['a=abcdef; args "${a[@]:2}" "${a[*]:2}"', ['cdef', 'cdef']],
  ['a="ab cd"; args ${a[@]:1:3} ${a[*]:1:3}', ['b', 'c', 'b', 'c']],
  ['a=abcdef; b="${a[@]:1:2}"; c=${a[*]:2:2}; args "$b" "$c"', ['bc', 'cd']],
  ['a=abc; i=0; args "${a[@]:i+=1:1}" "$i" "${a[*]:0:i+=1}" "$i"', ['b', '1', 'ab', '2']],
  ['unset a; i=0; args "${a[@]:i+=1:1}" "${a[*]:i+=1:1}" "$i"', ['', '0']],
  ['a=abc; for i in 1 2; do b="${a[@]:i:1}"; done; args "$b"', ['c']],
  ['a=abc; declare -n ref=a; args "${ref[@]:1:1}" "${ref[*]:1:1}"', ['b', 'b']],
  ['a=(a b c d); args "${a[@]:1:2}" "${a[*]:1:2}"', ['b', 'c', 'b c']],
  ['a=(hello world); args "${a[0]:1:3}" "${a[1]: -3}"', ['ell', 'rld']],
  ['a=(dir/foo.txt dir/bar.txt); args "${a[0]%.txt}" "${a[@]##*/}" "${a[*]%.txt}"', ['dir/foo', 'foo.txt', 'bar.txt', 'dir/foo dir/bar']],
  ['a=(hello world); args "${a[0]/l/L}" "${a[@]//o/O}" "${a[*]//l/L}"', ['heLlo', 'hellO', 'wOrld', 'heLLo worLd']],
  ['a=(abc); args "${a[0]#a}" "${a[0]%%b*}" "${a[@]%c}"', ['bc', 'a', 'ab']],
  ['a=("" yes); args "${a[0]:-fallback}" "${a[0]-kept}" "${a[1]:+alt}" "${a[2]+alt}"', ['fallback', '', 'alt', '']],
  ['a=(keep); args "${a[2]:=init}" "${a[2]}" "${a[0]}"', ['init', 'init', 'keep']],
  ['declare -A m; m[k]=hello; args "${m[k]:1:3}" "${m[k]//l/L}" "${m[x]:-fallback}" "${m[x]:=init}" "${m[x]}"', ['ell', 'heLLo', 'fallback', 'init', 'init']],
  ['a=("" keep); args "${a[0]=ignored}" "${a[0]:=init}" "${a[0]}" "${a[2]=new}"', ['', 'init', 'init', 'new']],
  ['i=0; a=(""); args "${a[i++]:=init}" "$i" "${a[0]}"', ['init', '1', 'init']],
  ['declare -A m; key=x; args "${m[$key]:=init}" "${m[x]}" "${m[x]#i}" "${m[x]:+alt}"', ['init', 'init', 'nit', 'alt']],
  ['a=([2]=two [5]=five [8]=eight); args "${a[@]:3:2}" "${a[@]: -2}"', ['five', 'eight', 'eight']],
  ['a=(foo.txt bar.txt); IFS=:; args "${a[*]%.txt}" "${a[@]%.txt}"', ['foo:bar', 'foo', 'bar']],
  ['a=(); args "${a[@]%.txt}" "${a[*]%.txt}"', ['']],
  ['a=("" yes); b=(); args "${a[@]:-fallback}" "${a[@]:+alt}" "${b[@]:-fallback}" "${b[@]:+alt}"', ['', 'yes', 'alt', 'fallback', '']],
  ['a=("" yes); args "${a[0]?missing}" "${a[0]+set}" "${a[1]-fallback}" "${a[2]:+alt}"', ['', 'set', 'yes', '']],
  ['declare -A m; m[k]=dir/foo.txt; args "${m[k]##*/}" "${m[k]%.txt}" "${m[k]/foo/bar}" "${m[k]?missing}"', ['foo.txt', 'dir/foo', 'dir/bar.txt', 'dir/foo.txt']],
  ['a=(aaab.txt ab.txt); args "${a[@]#a}" "${a[@]##a*}" "${a[@]%.txt}" "${a[@]%%b*}"', ['aab.txt', 'b.txt', '', '', 'aaab', 'ab', 'aaa', 'a']],
] as const) test(`array parameter operators through ${mode}: ${source}`, async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec(mode === 'inline' ? source : `${mode} -c '${source}'`);
    assert.equal(result.stderr, '');
    assert.equal(result.exitCode, 0);
    assert.deepEqual(JSON.parse(result.stdout), expected);

  } finally { await shell.dispose(); }
});

for (const mode of ['inline', 'bash', 'sh'] as const) for (const source of [
  'a=(); args "${a[2]:?missing}"; args later',
  'a=(); args "${a[2]?missing}"; args later',
  'a=(""); args "${a[0]:?missing}"; args later',
  'declare -A m; args "${m[k]:?missing}"; args later',
  'declare -A m; args "${m[k]?missing}"; args later',
]) test(`array element error operator stops execution through ${mode}: ${source}`, async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec(mode === 'inline' ? source : `${mode} -c '${source}'`);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /missing/);
    assert.equal(result.stdout, '');
  } finally { await shell.dispose(); }
});

for (const nounset of [false, true]) for (const selector of ['@', '*']) for (const [assignment, expected] of [
  ['a=("")', ['fallback', '', '', 'yes']],
  ['a=(x)', ['x', 'yes', 'x', 'yes']],
] as const) test(`single array member defaults: ${assignment}, ${selector}, nounset=${nounset}`, async t => {
  const { shell } = setup();
  t.after(() => shell.dispose());
  const result = await shell.exec(`set ${nounset ? '-' : '+'}u; ${assignment}; args "\${a[${selector}]:-fallback}" "\${a[${selector}]:+yes}" "\${a[${selector}]-fallback}" "\${a[${selector}]+yes}"`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), expected);
});

test('array trimming, substitution and slices match native Bash', async () => {
  const source = 'a=(dir/foo.txt dir/bar.txt); args "${a[@]##*/}" "${a[*]%.txt}" "${a[0]//o/O}" "${a[@]:1:1}" "${a[0]:4:3}"';
  const native = spawnSync('/bin/bash', ['-c', `args() { printf '%s\\0' "$@"; }; ${source}`], { encoding: 'utf8' });
  assert.equal(native.error, undefined);
  assert.equal(native.signal, null);
  assert.equal(native.status, 0, native.stderr);
  const { shell } = setup();
  try {
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), native.stdout.slice(0, -1).split('\0'));
  } finally { await shell.dispose(); }
});
