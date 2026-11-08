import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { agentCommands } from "../../src/plugins/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

const cases: readonly [string, string][] = [
  ['getpath(["a",0])', '{"a":[5]}'],
  ['getpath([])', '{"a":[5]}'],
  ['getpath([])', 'false'],
  ['getpath(["missing",0,"nested"])', '{}'],
  ['getpath(["a",-1])', '{"a":[5,6]}'],
  ['getpath(["a",20])', '{"a":[5,6]}'],
  ['getpath([1.9])', '[5,6,7]'],
  ['getpath([{start:0,end:2},1])', '[5,6,7]'],
  ['getpath([{start:1,end:3}])', '"a😀bc"'],
  ['getpath([{start:null,end:null}])', '[5,6,7]'],
  ['getpath([{start:0.5,end:2.5}])', '[5,6,7]'],
  ['getpath([{}])', 'null'],
  ['getpath([{}])', '[5,6,7]'],
  ['getpath([{start:1}])', '[5,6,7]'],
  ['getpath([{start:"a",end:2}])', '[5,6,7]'],
  ['getpath(["__proto__","constructor"])', '{"__proto__":{"constructor":7}}'],
  ['getpath(["__proto__"])', '{}'],
  ['getpath(.path)', '{"path":["a",0],"a":[5]}'],
  ['getpath(["a"], ["b"])', '{"a":5,"b":6}'],
  ['getpath(empty)', '{}'],
  ['getpath(["a",0])', '{"a":[5]}\n{"a":[6]}'],
  ['getpath(null)', '{}'],
  ['getpath("a")', '{}'],
  ['getpath(0)', '{}'],
  ['getpath([true])', '{}'],
  ['getpath([null])', 'null'],
  ['getpath([[]])', '{}'],
  ['getpath([{}])', '{}'],
  ['getpath([0])', '{}'],
  ['getpath(["a"])', '5'],
  ['getpath(["a"])', '[5]'],
  ['getpath(["a"], [true])', '{"a":5}'],
  ['try getpath([true]) catch .', '{}'],
  ['getpath([true])?', '{}'],
];

for (const [filter, input] of cases) test(`jq native getpath parity: ${filter} on ${input}`, async () => {
  const stdin = `${input}\n`;
  const native = spawnSync("jq", ["-c", filter], { input: stdin, encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
  assert.ifError(native.error);
  assert.equal(native.signal, null);
  assert.notEqual(native.status, null);
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  try {
    const result = await shell.exec(`jq -c '${filter}'`, { stdin });
    assert.deepEqual({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      exitCode: native.status, stdout: native.stdout, stderr: native.stderr,
    });
  } finally {
    await shell.dispose();
  }
});
