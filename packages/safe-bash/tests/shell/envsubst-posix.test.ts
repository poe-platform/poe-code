import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import "../../src/shell/sync-extra-evaluators.js";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { standardCommands } from "../../src/commands/index.js";
import { envsubstCommands } from "../../src/commands/envsubst/index.js";

for (const environment of [
  "unset POSIXLY_CORRECT",
  "export POSIXLY_CORRECT=1",
  "export POSIXLY_CORRECT=",
  "unset POSIXLY_CORRECT; POSIXLY_CORRECT=1",
]) {
  for (const invocation of [
    "envsubst '$A' -v",
    "envsubst '$A' --variables",
    "envsubst -v '$A'",
    "envsubst -- '$A' -v",
    "POSIXLY_CORRECT=1 envsubst '$A' -v",
    "envsubst '$A' --help",
    "envsubst '' -v",
  ]) {
    // Help text identifies the implementation; compare the POSIX operand error only.
    if (invocation.endsWith("--help") && !environment.startsWith("export")) continue;
    test(`envsubst matches GNU option ordering: ${environment}; ${invocation}`, async context => {
      const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands()).use(envsubstCommands());
      context.after(() => shell.dispose());
      const command = `printf '%s' '[$A]' | ${invocation}`;
      for (const body of [
        command,
        `out=$(${command}); status=$?; printf %s "$out"; exit "$status"`,
        `for ((i=0;i<2;i++)); do out=$(${command}); status=$?; done; printf %s "$out"; exit "$status"`,
      ]) {
        const script = `${environment}; ${body}`;
        const expected = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", script], {
          env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, encoding: "utf8", timeout: 2000,
        });
        assert.ifError(expected.error);
        assert.notEqual(expected.status, 127, "GNU envsubst must be installed");
        const actual = await shell.exec(script);
        assert.deepEqual({ stdout: actual.stdout, stderr: actual.stderr, exitCode: actual.exitCode }, {
          stdout: expected.stdout, stderr: expected.stderr, exitCode: expected.status,
        }, script);
      }
    });
  }
}
