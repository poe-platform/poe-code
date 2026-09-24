import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { agentCommands } from "../../src/plugins/index.js";
import { structuredCommands } from "../../src/commands/structured/index.js";
import { Shell } from "../../src/shell/index.js";

const vectors: [string, string, string?][] = [
  ["halt_error(7)", '"bad"\n'],
  ["halt_error(0)", 'null\n', "-e"],
  ["halt", 'null\n', "-e"],
  ["halt_error", '"bad"\n'],
  ["halt", '"bad"\n'],
  ["halt_error(0)", '"bad"\n'],
  ["halt_error(7)", 'null\n'],
  ["halt_error(7)", '[1,2]\n'],
  ["halt_error(7)", 'false\n'],
  ["halt_error(2.9)", '"bad"\n'],
  ["halt_error(-1)", '"bad"\n'],
  ["halt_error(256)", '"bad"\n'],
  ['try halt_error(7) catch "caught"', '"bad"\n'],
  ["halt_error(7)?", '"bad"\n'],
  ["(., halt_error(7), 99)", '"bad"\n"later"\n'],
  ["halt_error(empty)", '"bad"\n'],
  ["halt_error((7,8))", '"bad"\n'],
  ['try halt_error("x") catch .', '"bad"\n'],
  ['halt_error("x")', '"bad"\n'],
  ["halt_error(null)", '"bad"\n'],
  ["halt_error(7)", '{"a":1}\n'],
  ["halt_error(7)", '"a\\nb\\u0000"\n'],
  ["halt_error(7;8)", '"bad"\n'],
];
for (const [program, stdin, flag] of vectors) {
  test(`jq native halt parity: ${program} / ${stdin.trim()}`, async () => {
    const native = spawnSync("/usr/bin/jq", ["-c", ...(flag ? [flag] : []), program], { input: stdin, encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
    assert.ifError(native.error);
    assert.equal(native.signal, null);
    assert.notEqual(native.status, null);
    const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
    try {
      const actual = await shell.exec(`jq -c ${flag ?? ""} '${program}'`, { stdin });
      assert.deepEqual({ exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr },
        { exitCode: native.status, stdout: native.stdout, stderr: native.stderr });
    } finally { await shell.dispose(); }
  });
}

for (const stdin of ['"long text"', '[1,2,3]']) {
  test(`halt stderr obeys output budget: ${stdin}`, async () => {
    const shell = new Shell({ fs: createMemoryFileSystem() }).use(structuredCommands({ limits: { maxOutputBytes: 3 } }));
    try {
      const result = await shell.exec("jq -c 'try halt_error(7) catch 0'", { stdin });
      assert.equal(result.exitCode, 5);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /maxOutputBytes limit exceeded/);
    } finally { await shell.dispose(); }
  });
}
