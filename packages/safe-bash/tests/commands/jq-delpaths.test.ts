import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { agentCommands } from "../../src/plugins/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

const cases: readonly [string, string][] = [
  ['delpaths([["a",1]])', '{"a":[1,2,3]}'],
  ['delpaths([[0],[1],[1],[-1]])', '[0,1,2,3]'],
  ['delpaths([[0,0],[0,1],[1]])', '[[1,2,3],4]'],
  ['delpaths([["a","b"],["a"]])', '{"a":{"b":1},"c":2}'],
  ['delpaths([[],[true]])', '{}'],
  ['delpaths([])', 'false'],
  ['delpaths([["missing",true]])', '{}'],
  ['delpaths([[99],[-99],[1.9]])', '[1,2,3]'],
  ['delpaths([[true]])', 'null'],
  ['delpaths([["__proto__","constructor"]])', '{"__proto__":{"constructor":7}}'],
  ['delpaths(.paths)', '{"paths":[["a"]],"a":1}'],
  ['delpaths([[0]], [[1]])', '[1,2,3]'],
  ['delpaths(empty)', '{}'],
  ['delpaths(null)', '{}'],
  ['delpaths([1])', '{}'],
  ['delpaths([null])', '{}'],
  ['delpaths([[true]])', '{}'],
  ['delpaths([[null]])', '[1]'],
  ['delpaths([[{}]])', '{}'],
  ['delpaths([[0]])', '{}'],
  ['delpaths([["a"]])', '1'],
  ['delpaths([["a","b"]])', '{"a":1}'],
  ['try delpaths([[true]]) catch .', '{}'],
];

for (const [filter, input] of cases) test(`jq native delpaths parity: ${filter} on ${input}`, async () => {
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
  } finally { await shell.dispose(); }
});
