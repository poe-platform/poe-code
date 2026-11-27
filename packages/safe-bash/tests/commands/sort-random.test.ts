import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/shell.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { agentCommands } from "../../src/plugins/index.js";

for (const [script, stdout] of [
  ["printf 'a\\nb\\nc\\n' | sort -R | wc -l", "3\n"],
  ["printf 'a\\nb\\na\\n' | sort --random-sort | uniq -c | wc -l", "2\n"],
] as const) {
  test(`random sort pipeline: ${script}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work");
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    try {
      const result = await shell.exec(script);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, stdout);
    } finally { await shell.dispose(); }
  });
}
