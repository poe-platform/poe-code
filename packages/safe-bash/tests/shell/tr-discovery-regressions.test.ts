import assert from "node:assert/strict";
import { test } from "node:test";
import { standardCommands } from "../../src/commands/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

for (const form of ["assignment", "inline"] as const) for (const [set, expected] of [["0-9", "abcdefXYZ-"], ["a-z", "123XYZ-"], ["A-Z", "abc123def-"], ["a-f", "123XYZ-"], ["-", "abc123defXYZ"], ["[:digit:]", "abcdefXYZ-"]] as const) {
  test(`substitution tr deletion preserves set semantics (${form}): ${set}`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    context.after(() => shell.dispose());
    const pipeline = `$(printf 'abc123defXYZ-\\n' | tr -d '${set}')`;
    const result = await shell.exec(form === "assignment" ? `x=${pipeline}; printf '%s\\n' "$x"` : `echo "${pipeline}"`);
    assert.equal(result.stdout, `${expected}\n`);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}

test("discovery survives unrelated memory symlinks in direct and substituted calls", async context => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs, env: { PATH: "/bin" } }).use(standardCommands());
  context.after(() => shell.dispose());
  await fs.mkdir("/bin");
  await fs.writeFile("/bin/mytool", new TextEncoder().encode(":"), { mode: 0o755 });
  await fs.symlink("/missing", "/unrelated");
  for (const command of ["command -v mytool", "type -t mytool", 'printf "%s\\n" "$(command -v mytool)"', 'printf "%s\\n" "$(type -t mytool)"']) {
    const result = await shell.exec(command);
    assert.equal(result.stdout, command.includes("type -t") ? "file\n" : "/bin/mytool\n");
    assert.equal(result.exitCode, 0);
  }
});
