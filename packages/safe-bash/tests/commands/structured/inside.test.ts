import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { Shell, agentCommands, createMemoryFileSystem } from "../../../src/index.js";

const cases: [string, string][] = [
  ['[1,2]\n', 'inside([1,2,3])'],
  ['[1,4]\n', 'inside([1,2,3])'],
  ['[]\n', 'inside([]),inside([1])'],
  ['[1,1]\n', 'inside([1])'],
  ['[{"a":"bar"}]\n', 'inside([{a:"foobar",b:2}])'],
  ['{"a":{"b":2}}\n', 'inside({a:{b:2,c:3},d:4})'],
  ['{"a":2}\n', 'inside({a:3}),inside({})'],
  ['"bar"\n', 'inside("foobar"),inside("baz")'],
  ['""\n', 'inside("")'],
  ['"😀"\n', 'inside("a😀b")'],
  ['null\n', 'inside(null)'],
  ['true\n', 'inside(true),inside(false)'],
  ['false\n', 'inside(false),inside(true)'],
  ['[true]\n', 'inside([false])'],
  ['{"a":true}\n', 'inside({a:false})'],
  ['1.0\n', 'inside(1),inside(2)'],
  ['[1]\n', 'inside([1],[2]),inside(empty)'],
  ['[1]\n', 'inside(.)'],
  ['null\n', 'inside(1)'],
  ['"x"\n', 'inside(1)'],
  ['1\n', 'inside("x")'],
  ['[]\n', 'inside({})'],
  ['{}\n', 'inside([])'],
  ['true\n', 'inside(null)'],
  ['[1]\n', 'try inside({}) catch .'],
];

for (const [stdin, filter] of cases) test(`inside native parity: ${stdin.trim()} | ${filter}`, async () => {
  const native = spawnSync("jq", ["-c", filter], { input: stdin, encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
  assert.ifError(native.error);
  assert.equal(native.signal, null);
  assert.notEqual(native.status, null);
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  try {
    const actual = await shell.exec(`jq -c '${filter}'`, { stdin });
    assert.deepEqual({ exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr },
      { exitCode: native.status, stdout: native.stdout, stderr: native.stderr });
  } finally { await shell.dispose(); }
});
