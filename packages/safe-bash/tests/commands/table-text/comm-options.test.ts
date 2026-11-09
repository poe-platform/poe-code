import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { standardCommands } from "../../../src/commands/index.js";
import { commCommands } from "../../../src/commands/comm/index.js";

for (const captured of [false, true]) {
  for (const [options, expected, exitCode] of [
    ["--out=:", "::a\n", 0],
    ["--out :", "::a\n", 0],
    ["--tot", "\t\ta\n0\t0\t1\ttotal\n", 0],
    ["--check", "\t\ta\n", 0],
    ["--nocheck", "\t\ta\n", 0],
    ["--unknown", "", 1],
  ] as const) {
    test(`comm ${options} ${captured ? "in command substitution" : "directly"}`, async () => {
      const fs = createMemoryFileSystem();
      await fs.writeFile("/one", new TextEncoder().encode("a\n"));
      const shell = new Shell({ fs, env: { LC_ALL: "C" } }).use(standardCommands()).use(commCommands());
      try {
        const command = `comm ${options} /one /one`;
        const script = captured ? `value=$(${command}); status=$?; printf '%s' "$value"; exit "$status"` : command;
        const result = await shell.exec(script);
        assert.equal(result.exitCode, exitCode, result.stderr);
        assert.equal(result.stdout, captured ? expected.trimEnd() : expected);
        if (exitCode === 0) assert.equal(result.stderr, "");
        else assert.ok(result.stderr.includes("unsupported option --unknown"), result.stderr);
      } finally {
        await shell.dispose();
      }
    });
  }
}
