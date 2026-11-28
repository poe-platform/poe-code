import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, createMemoryFileSystem, agentCommands } from "../../../src/index.js";

test("rg Perl flags support lookaround and backreferences in shell scripts", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work", { recursive: true });
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  try {
    const result = await shell.exec(String.raw`printf 'aa ab\n' > f; rg -P 'a(?=b)' -o f; echo "rc=$?"; rg -P '(a)\1' -o f; echo "rc=$?"; rg --pcre2 '(?<=a)b' -o f; echo "rc=$?"; rg -oP '(?<!a)a' f`);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "a\nrc=0\naa\nrc=0\nb\nrc=0\na\na\n");
  } finally {
    await shell.dispose();
  }
});
