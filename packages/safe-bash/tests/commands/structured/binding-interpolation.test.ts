import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { row, run } from "./helpers.js";
import { standardCommands } from "../../../src/commands/index.js";
import { structuredCommands } from "../../../src/commands/structured/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";

const cases = [
  row('{"a":10,"b":5}', '.a as $x | .b + $x', [15]),
  row('[1,2]', '.[] as $x | {x:$x, original:.}', [{ x:1, original:[1,2] }, { x:2, original:[1,2] }]),
  row('null', '1 as $x | (2 as $x | $x), $x', [2,1]),
  row('null', '1 as $x | 2 as $y | [$x,$y,.]', [[1,2,null]]),
  row('null', 'empty as $x | $x', []),
  row('null', '1, 2 as $x | $x', [1,2]),
  row('null', '1, 2 as $x | [$x]', [1,[2]]),
  row('null', '{$x, a:1,}', [{x:'hello',a:1}], 0, ['--arg','x','hello']),
  row('null', '{$x: 42}', [{hello:42}], 0, ['--arg','x','hello']),
  row('null', '"key" as $x | {($x): 42,}', [{key:42}]),
  row('{"name":"k","val":42}', String.raw`"\(.name)=\(.val)"`, ['k=42']),
  row('null', String.raw`"a\((1,2))b\((3,4))"`, ['a1b3','a2b3','a1b4','a2b4']),
  row('null', String.raw`"\({a:1})/\(null)/\(true)"`, ['{"a":1}/null/true']),
  row('null', String.raw`"\("nested \(1)")"`, ['nested 1']),
  row('null', String.raw`"escaped \\(literal)\n\(1)"`, ['escaped \\(literal)\n1']),
  row('null', String.raw`1 as $x | {"k\($x)": "\($x)"}`, [{k1:'1'}]),
  row('null', String.raw`"\(empty)"`, []),
  row('{"k1":1,"k2":2}', String.raw`{"k\((1,2))"}`, [{k1:1},{k2:2}]),
  row('null', String.raw`"\("a)b")"`, ['a)b']),
  row('null', '3 as $x | reduce (1,2) as $y (0; .+$x+$y)', [9]),
];
for (const entry of cases) test(`jq binding/interpolation: ${entry.filter}`, async () => {
  const result = await run(['-c', ...entry.flags ?? [], entry.filter], entry.input);
  assert.equal(result.exitCode, entry.status ?? 0, result.stderr);
  assert.equal(result.stdout, entry.output);
  assert.equal(result.stderr, '');
});

test('binding and interpolation cases match native jq bytes', () => {
  for (const entry of cases) {
    const native = spawnSync('jq', ['-c', ...entry.flags ?? [], entry.filter], { input: entry.input, encoding: 'utf8' });
    assert.equal(native.error, undefined);
    assert.equal(native.signal, null);
    assert.equal(native.status, 0, native.stderr);
    assert.equal(native.stdout, entry.output, entry.filter);
  }
});

test('malformed bindings and interpolations fail before reading input', async () => {
  const stdin = { [Symbol.asyncIterator](): never { throw new Error('unexpected input read'); } };
  for (const source of ['1 as $x', '1 as x | .', '{$missing}', String.raw`"\($missing)"`, String.raw`"\(1"`, String.raw`"\(unknown)"`, '{(1)}']) {
    assert.equal((await run([source], stdin)).exitCode, 3, source);
  }
});

test('bindings and interpolation retain configured budgets', async () => {
  for (const [filter, limits, name] of [
    ['1 as $x | 2 as $y | $x+$y', {maxAstDepth:2}, 'maxAstDepth'],
    [String.raw`"\(1)"`, {maxSteps:2}, 'maxSteps'],
    [String.raw`"\("a"*100)"`, {maxValueBytes:16}, 'maxValueBytes'],
    ['range(100) as $x | $x', {maxResults:2}, 'maxResults'],
  ] as const) {
    const result = await run(['-nc', filter], '', {limits});
    assert.equal(result.exitCode, 5, result.stderr);
    assert.ok(result.stderr.includes(name), result.stderr);
  }
});

test('bindings do not escape parentheses', async () => {
  const result = await run(['(1 as $x | $x), $x']);
  assert.equal(result.exitCode, 3);
});

test('reported jq commands work through shell quoting and pipelines', async () => {
  const shell = new Shell({fs:new MemoryFileSystem()}).use(standardCommands()).use(structuredCommands());
  for (const [command, output] of [
    [String.raw`printf '%s\n' '{"a":10,"b":5}' | jq -c '.a as $x | .b + $x'`, '15\n'],
    [String.raw`printf '%s\n' '{"name":"k","val":42}' | jq -r '"\(.name)=\(.val)"'`, 'k=42\n'],
    [String.raw`printf '%s\n' 'null' | jq -c --arg x hello '{$x, a:1,}'`, '{"x":"hello","a":1}\n'],
  ]) {
    const result = await shell.exec(command!);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, output);
    assert.equal(result.stderr, '');
  }
});
