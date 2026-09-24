import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { Shell, createMemoryFileSystem, agentCommands } from "../../../src/index.js";
import { run } from "./helpers.js";

const cases: [string, unknown][] = [
  ['capture("(?<key>[a-z]+)=(?<value>[0-9]+)")', 'foo=12'],
  ['capture("(?<key>[a-z]+)=(?<value>[0-9]+)")', 'no match'],
  ['capture("(?<x>a)?b")', 'b'],
  ['capture("(a)(?<x>b+)")', 'abbb'],
  ['capture("a")', 'a'],
  ['capture("(?<x>.)")', '😀'],
  ['capture("(?<__proto__>a)(?<constructor>b)")', 'ab'],
  ['capture("(?<x>a*)")', 'b'],
  ['capture("(?<x>.)";"g")', 'a😀b'],
  ['capture(["(?<x>a)","i"])', 'A'],
  ['capture("(?<x>a)";null)', 'a'],
  ['capture("(?<x>.)";"m")', '\n'],
  ['capture("(?<x>^a)";"s")', 'b\na'],
  ['capture("(?<x> a ) # comment";"x")', 'a'],
  ['capture("(?<x>a*)";"gn")', 'ba'],
  ['capture("(?<x>a*|b)";"n")', 'b'],
  ['capture("(?<x>a+?)")', 'aaa'],
  ['capture("(?<x>a*)";"g")', 'a'],
  ['capture(("(?<x>a)","(?<y>b)"))', 'ab'],
  ['capture("(?<x>a)";("","i"))', 'A'],
  ['capture("a")', 1],
  ['capture(1)', 'a'],
  ['capture(null)', 'a'],
  ['capture([])', 'a'],
  ['capture([1])', 'a'],
  ['capture("a";1)', 'a'],
  ['capture("a";"q")', 'a'],
  ['capture("[")', 'a'],
  ['capture("(")', 'a'],
  ['try capture("a") catch .', 1],
];

for (const [filter, value] of cases) test(`public jq capture matches native: ${filter}, ${JSON.stringify(value)}`, async () => {
  const stdin = `${JSON.stringify(value)}\n`;
  const native = spawnSync('/usr/bin/jq', ['-c', filter], { input: stdin, encoding: 'utf8', timeout: 2000, env: { ...process.env, LC_ALL: 'C' } });
  assert.equal(native.error, undefined);
  assert.equal(native.signal, null);
  assert.notEqual(native.status, null);
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  try {
    const result = await shell.exec(`jq -c '${filter}'`, { stdin });
    assert.deepEqual({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { exitCode: native.status, stdout: native.stdout, stderr: native.stderr });
  } finally { await shell.dispose(); }
});

test('capture backtracking cannot bypass or catch the work budget', async () => {
  const result = await run(['-c', 'try capture("(?<x>(a+)+)$") catch "caught"'], JSON.stringify('a'.repeat(18) + '!'), { limits: { maxSteps: 100 } });
  assert.equal(result.exitCode, 5);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.includes('maxSteps limit exceeded'), result.stderr);
});

test('capture matching state cannot bypass or catch the value-memory budget', async () => {
  const result = await run(['-c', 'try capture("(?<x>a+)") catch "caught"'], '"aaaa"', { limits: { maxValueBytes: 256 } });
  assert.equal(result.exitCode, 5);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.includes('maxValueBytes limit exceeded'), result.stderr);
});
