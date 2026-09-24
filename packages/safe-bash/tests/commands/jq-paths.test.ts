import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { Shell, agentCommands, createMemoryFileSystem } from "../../src/index.js";

const cases: readonly [string, string][] = [
  ["[paths(scalars)]", '{"a":[1,2]}\n'],
  ["[paths]", '{"z":[1,{"a":null}],"empty":[],"obj":{}}\n'],
  ["[paths(scalars)]", '[null,false,true,0,"",[],{}]\n'],
  ["[paths]", 'null\nfalse\n42\n"text"\n[]\n{}\n'],
  ["[paths(arrays)]", '{"a":[[],[1]],"b":{}}\n'],
  ["[paths((false,null,true,1))]", '{"a":1}\n'],
  ["[paths(empty)]", '{"a":1}\n'],
  ["[paths(. > 1)]", '[0,1,2,3]\n'],
  ["def f(p): paths(p); [f(numbers)]", '{"a":[1,"s",2]}\n'],
  ["[paths(true)]", '{"2":2,"1":1,"0":0}\n'],
  ['try [paths(error("stop"))] catch .', '{"a":1}\n'],
  ["[paths(scalars)]", '{"a":}\n'],
  ["paths(true;false)", 'null\n'],
];

for (const [filter, stdin] of cases) test(`jq paths matches native: ${filter} ${stdin.trim()}`, async () => {
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
