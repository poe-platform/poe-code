import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { Shell } from "../../../src/shell/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { agentCommands } from "../../../src/plugins/index.js";
import { run } from "./helpers.js";

const filters = [
  '[1,2] as [$a,$b] | $a+$b',
  '{"a":1} as {$a,$b} ?// [$a,$b] | [$a,$b]',
  '[1,{"x":[2]}] as [$a,{x:[$b,$c]}] | [$a,$b,$c,.]',
  'null as [$a,$b] | [$a,$b]',
  '{"key":3} as {"key":$a} | $a',
  '"x" as $k | {x:2} as {($k):$v} | $v',
  '"a" as $a | {a:1} as {($a):$a} | $a',
  '{a:[1,2]} as {$a:[$b,$c]} | [$a,$b,$c]',
  '{a:1,b:2} as {("a","b"):$v} | $v',
  '[1,2] as [$a,$a] | $a',
  '9 as $a | [1] as [$a] | $a',
  '[[1,2],{"a":3}][] as {$a} ?// [$b,$c] | [$a,$b,$c]',
  '[1,2] as {$a} ?// [$b,$c] ?// $d | [$a,$b,$c,$d]',
  '[1] as [$a] ?// $b | if $a then error("retry") else $b end',
  '[1,2] as [$a,$b] ?// $c | if $a then (1,error("retry")) else $c end',
  '[[1],[2]][] as [$a] | $a',
  'def f: . as [$a,$b] | $a+$b; [1,2] | f',
];

for (const filter of filters) test(`jq destructuring native parity: ${filter}`, async () => {
  const native = spawnSync('jq', ['-c', filter], {input:'null\n', encoding:'utf8'});
  assert.equal(native.error, undefined);
  assert.equal(native.signal, null);
  assert.equal(native.status, 0, native.stderr);
  const shell = new Shell({fs:createMemoryFileSystem()}).use(agentCommands());
  try {
    const result = await shell.exec(`jq -c '${filter}'`, {stdin:'null\n'});
    assert.equal(result.exitCode, native.status, result.stderr);
    assert.equal(result.stdout, native.stdout);
    assert.equal(result.stderr, native.stderr);
  } finally { await shell.dispose(); }
});

test('invalid patterns fail before consuming stdin and bindings remain lexical', async () => {
  const stdin = { [Symbol.asyncIterator](): never { throw new Error('unexpected input read'); } };
  for (const filter of ['. as [1] | .', '. as {a} | .', '. as [$a,] | .', '. as [] | .', '. as {} | .', '. as [$a] ?// | .', '(. as [$a] | $a), $a']) {
    assert.equal((await run([filter], stdin)).exitCode, 3, filter);
  }
});

test('pattern type errors and limits cannot be silently swallowed', async () => {
  for (const filter of ['1 as [$a] | $a', '{a:1} as {a:[$b]} | $b', '1 as [$a] ?// {$b} | .']) {
    const native = spawnSync('jq', ['-c', filter], {input:'null\n', encoding:'utf8'});
    assert.equal(native.error, undefined);
    assert.equal(native.signal, null);
    assert.equal(native.status, 5);
    const result = await run(['-c', filter], 'null\n');
    assert.equal(result.exitCode, native.status);
    assert.equal(result.stdout, native.stdout);
    assert.equal(result.stderr, native.stderr);
  }
  const result = await run(['-nc', '[1,2,3] as [$a,$b,$c] ?// $d | .'], '', {limits:{maxAstDepth:2}});
  assert.equal(result.exitCode, 5);
  assert.ok(result.stderr.includes('maxAstDepth'), result.stderr);
});
