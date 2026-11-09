import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { pasteCommands } from "../../src/commands/paste/index.js";

for (const [options, full] of [
  ["--he", "--help"],
  ["--vers", "--version"],
  ["--ser --version", "--version"],
  ["--del=: --he", "--help"],
  ["--del --help --vers", "--version"],
] as const) {
  test(`paste information prefixes across shell execution paths: ${options}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(pasteCommands()).use({
      name: "standard",
      setup(host) { for (const command of createStandardCommands()) host.commands.register(command); },
    });
    const expected = await shell.exec(`paste ${full}`);
    assert.equal(expected.exitCode, 0);
    assert.notEqual(expected.stdout, "");
    for (const script of [
      `paste ${options}`,
      `paste ${options} | cat`,
      `x=$(paste ${options}); printf '%s\\n' "$x"`,
    ]) {
      const result = await shell.exec(script);
      assert.equal(result.exitCode, 0, script);
      assert.equal(result.stderr, "", script);
      assert.equal(result.stdout, expected.stdout, script);
    }
  });
}
