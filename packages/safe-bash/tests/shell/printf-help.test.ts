import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { MemoryFileSystem, Shell, standardCommands } from "../../src/index.js";

for (const script of [
  "printf --help",
  "builtin printf --help",
  "command printf --help",
  "printf --help ignored",
  "value=original; printf -v value --help; status=$?; printf '%s:%s' \"$value\" \"$status\"",
  "for ((i=0; i<2; i++)); do printf --help; done",
  "printf -- --help",
  "printf -- '--help:%s' literal",
  "printf %s --help",
  "printf -v value -- --help; printf %s \"$value\"",
]) {
  test(`printf builtin help: ${script}`, async () => {
    const oracle = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", script], {
      env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, timeout: 2000,
    });
    assert.ifError(oracle.error);
    assert.equal(oracle.signal, null);
    assert.equal(oracle.stderr.length, 0);
    const shell = new Shell({ fs: new MemoryFileSystem(), env: { LC_ALL: "C" } }).use(standardCommands());
    try {
      const result = await shell.exec(script);
      assert.equal(result.exitCode, oracle.status);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, oracle.stdout.toString());
    } finally { await shell.dispose(); }
  });
}
