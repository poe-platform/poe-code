import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { agentCommands, createMemoryFileSystem, Shell } from "../../../src/index.js";

const cases: [string, string][] = [
  ["[1,2,4]\n", "bsearch(3)"],
  ...[0, 1, 2, 4, 5].map(value => ["[1,2,4]\n", `bsearch(${value})`] as [string, string]),
  ["[]\n", "bsearch(1)"], ["[2,2]\n", "bsearch(2)"],
  ["[2,2,2,2]\n", "bsearch(2)"],
  ["[null,false,true,1,\"a\",[],{}]\n", "bsearch((null,false,true,1,\"a\",[],{}))"],
  ["[1,2,4]\n", "bsearch(.[])"], ["[1,2,4]\n", "bsearch(empty)"],
  ...["null", "{}", "{\"a\":1}", "0", "1", "-0.5", "true", "\"abc\""].map(input => [`${input}\n`, "bsearch(3)"] as [string, string]),
];
for (const [input, filter] of cases) test(`jq native parity: ${filter} on ${input.trim()}`, async () => {
  const native = spawnSync("jq", ["-c", filter], { input, encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
  assert.ifError(native.error);
  assert.equal(native.signal, null);
  assert.notEqual(native.status, null);
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  try {
    const result = await shell.exec(`jq -c '${filter}'`, { stdin: input });
    assert.deepEqual({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr },
      { exitCode: native.status, stdout: native.stdout, stderr: native.stderr });
  } finally { await shell.dispose(); }
});
