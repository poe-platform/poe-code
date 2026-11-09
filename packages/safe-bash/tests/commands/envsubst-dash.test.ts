import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { basicCommands } from "../../src/commands/basic.js";
import { envsubstCommands } from "../../src/commands/envsubst/index.js";

for (const args of ["-", "-- -", "-v -", "--variables -", "-v -- -", "-x", "--invalid"]) {
  for (const substitution of [false, true]) {
    test(`envsubst ${args} matches GNU ${substitution ? "in command substitution" : "in a pipeline"}`, async () => {
      const command = `printf '%s' '$A' | envsubst ${args}`;
      const source = `export A=blue; ${substitution
        ? `output=$(${command}); status=$?; printf '%s' "$output"; exit "$status"`
        : command}`;
      const expected = spawnSync("bash", ["--noprofile", "--norc", "-c", source], {
        encoding: "utf8",
        env: { ...process.env, LC_ALL: "C" },
      });
      assert.equal(expected.error, undefined);
      assert.equal(expected.status, args === "-x" || args === "--invalid" ? 1 : 0);
      const shell = new Shell({ fs: new MemoryFileSystem() }).use({
        name: "basic",
        setup(host) {
          for (const command of basicCommands()) host.commands.register(command);
        },
      }).use(envsubstCommands());
      const actual = await shell.exec(source);
      assert.equal(actual.exitCode, expected.status);
      assert.equal(actual.stdout, expected.stdout);
      if (expected.status === 0) assert.equal(actual.stderr, expected.stderr);
      else assert.notEqual(actual.stderr, "");
    });
  }
}
