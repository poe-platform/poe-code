import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { setup } from './helpers.js';

for (const [source, expected] of [
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
] as const) test(`array parameter operators: ${source}`, async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec(source);
    assert.equal(result.stderr, '');
    assert.equal(result.exitCode, 0);
    assert.deepEqual(JSON.parse(result.stdout), expected);

  } finally { await shell.dispose(); }
});

test('array element error operator stops execution', async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('a=(); args "${a[2]:?missing}"; args later');
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /missing/);
    assert.equal(result.stdout, '');
  } finally { await shell.dispose(); }
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
