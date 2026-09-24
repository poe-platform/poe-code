import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { row, run } from "./helpers.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell, agentCommands } from "../../../src/core.js";

const cases = [
  row('{"a1":42}', String.raw`."a\(1)"`, [42]),
  row('{"x":{"a1":42}}', String.raw`.x."a\(1)"`, [42]),
  row('{"a1":1,"a2":2}', String.raw`."a\((1,2))"`, [1,2]),
  row('{"a1":1}', String.raw`."a\(1)" |= . + 1`, [{a1:2}]),
  row('5', 'def f: 10; def f(x): . + x; [f, f(2)]', [[10,7]]),
  row('5', 'def f(x): . + x; def f: f(10); [f, f(2)]', [[15,7]]),
  row('5', 'def f: 1; def f(x): . + x; def f: 2; [f, f(3)]', [[2,8]]),
  row('{"a":1,"b":2}', 'def at($k): .[$k]; del(at("a"))', [{b:2}]),
  row('{"a":1,"b":2}', 'def at($k): .[$k]; at("a") = 9', [{a:9,b:2}]),
  row('{"a":1,"b":2}', 'def at($k): .[$k]; at("a") |= . + 9', [{a:10,b:2}]),
  row('{"a":1,"b":2}', 'def at($k): .[$k]; at(("a","b")) += 3', [{a:4,b:5}]),
  row('{"a":1,"b":2}', 'del("a" as $k | .[$k])', [{b:2}]),
  row('{"a":1,"b":2}', '("a" as $k | .[$k]) = 9', [{a:9,b:2}]),
  row('{"a":1,"b":2}', '(("a","b") as $k | .[$k]) |= . * 2', [{a:2,b:4}]),
  row('{"x":{"a":1,"b":2}}', '.x |= del("a" as $k | .[$k])', [{x:{b:2}}]),
  row('{"a":1}', 'del(empty as $k | .[$k])', [{a:1}]),
  row('123', '[ltrimstr("1"), rtrimstr("3")]', [[123,123]]),
  row('"123"', '[ltrimstr(1), rtrimstr(3)]', [['123','123']]),
  row('null', '[ltrimstr(null), rtrimstr(null)]', [[null,null]]),
  row('[1]', '[ltrimstr("1"), rtrimstr("1")]', [[[1],[1]]]),
  row('"abc"', '[ltrimstr((1,"a")), rtrimstr((null,"c"))]', [['abc','bc','abc','ab']]),
];
for (const entry of cases) test(`jq property/functions: ${entry.filter} on ${entry.input}`, async () => {
  const native = spawnSync('jq', ['-c', entry.filter], {input:entry.input, encoding:'utf8'});
  assert.equal(native.error, undefined);
  assert.equal(native.signal, null);
  assert.equal(native.status, 0, native.stderr);
  assert.equal(native.stdout, entry.output);
  const result = await run(['-c', entry.filter], entry.input);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, entry.output);
  assert.equal(result.stderr, '');
});

test('startswith and endswith retain type errors', async () => {
  for (const filter of ['123 | startswith("1")', '"123" | endswith(3)']) {
    const result = await run(['-c', filter]);
    assert.equal(result.exitCode, 5);
    assert.ok(result.stderr.includes('requires strings'));
  }
});

test('overloaded module functions preserve arities with includes and namespaces', async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/keys.jq', Buffer.from('def f: 10; def f($k): .[$k];'));
  for (const filter of ['include "keys"; [f, f("a")]', 'import "keys" as k; [k::f, k::f("a")]']) {
    const result = await run(['-c', '-L', '/', filter], '{"a":42}', {}, {fs});
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, '[10,42]\n');
  }
});

test('bound path frames do not leak and retain resource limits', async () => {
  const result = await run(['-nc', '"b" as $k | ({a:1} | del("a" as $k | .[$k])), $k']);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, '{}\n"b"\n');
  const limited = await run(['-nc', '{a:1} | del(range(100) as $k | .a)'], '', {limits:{maxSteps:50}});
  assert.equal(limited.exitCode, 5);
  assert.ok(limited.stderr.includes('maxSteps'), limited.stderr);
});

test('reported constructs work through the public shell command registration', async () => {
  const shell = new Shell({fs:new MemoryFileSystem()}).use(agentCommands());
  for (const [filter, expected] of [
    [String.raw`{"a1":42} | ."a\(1)"`, '42\n'],
    ['def f(x): . + x; def f: f(10); 5 | f', '15\n'],
    ['def at($k): .[$k]; {a:1,b:2} | del(at("a"))', '{"b":2}\n'],
    ['123 | [ltrimstr("1"), rtrimstr("3")]', '[123,123]\n'],
  ]) {
    const result = await shell.exec(`jq -nc '${filter}'`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
  }
});
