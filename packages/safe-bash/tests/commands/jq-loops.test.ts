import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { agentCommands } from "../../src/plugins/index.js";
import { structuredCommands } from "../../src/commands/structured/index.js";
import { Shell } from "../../src/shell/index.js";

const vectors: [string, string][] = [
  ["[while(.<4; .+1)]", "0\n"],
  ["until(.>=4; .+1)", "0\n"],
  ["[while(.<3; (.+1, .+2))]", "0\n"],
  ["[until(.>=3; (.+1, .+2))]", "0\n"],
  ["[while((.<2, false); .+1)]", "0\n"],
  ["[until((.>=2, true); .+1)]", "0\n"],
  ["[while(empty; error)]", "0\n"],
  ["[until(empty; error)]", "0\n"],
  ["[while(true; empty)]", "0\n"],
  ["[until(false; empty)]", "0\n"],
  ["[while(false; error)]", "0\n"],
  ["until(true; error)", "0\n"],
  ["[while(null; error)]", "0\n"],
  ["until(0; error)", "0\n"],
  ["first(while(true; error))", "0\n"],
  ["limit(3; while(true; .+1))", "0\n"],
  ['try while(error("bad"); .) catch .', "0\n"],
  ['try until(false; error("bad")) catch .', "0\n"],
  ["while(true; .+1)", '"bad"\n'],
  ["until(.>=4; .+1)", "0\n5\n"],
  ["while", "0\n"],
  ["while(true)", "0\n"],
  ["until(true; .; .)", "0\n"],
];
for (const [program, stdin] of vectors) {
  test(`jq native loop parity: ${program} / ${stdin.trim()}`, async () => {
    const native = spawnSync("/usr/bin/jq", ["-c", program], { input: stdin, encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
    assert.ifError(native.error);
    assert.equal(native.signal, null);
    assert.notEqual(native.status, null);
    const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
    try {
      const actual = await shell.exec(`jq -c '${program}'`, { stdin });
      assert.deepEqual({ exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr },
        { exitCode: native.status, stdout: native.stdout, stderr: native.stderr });
    } finally { await shell.dispose(); }
  });
}

for (const program of ["try while(true; .) catch 99", "try until(false; .) catch 99"]) {
  test(`jq loop work obeys noncatchable step budget: ${program}`, async () => {
    const shell = new Shell({ fs: createMemoryFileSystem() }).use(structuredCommands({ limits: { maxSteps: 100 } }));
    try {
      const result = await shell.exec(`jq -c '${program}'`, { stdin: "0\n" });
      assert.equal(result.exitCode, 5);
      assert.match(result.stderr, /maxSteps limit exceeded/);
      assert.ok(!result.stdout.includes("99"));
    } finally { await shell.dispose(); }
  });
}
