import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";

for (const flag of ["-l", "--list"]) {
  test(`zstd ${flag} supports listing in a pipeline and reports successful PIPESTATUS`, async () => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/work");
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    try {
      const result = await shell.exec(`echo hi > a; zstd -q a; zstd ${flag} a.zst | head -1 | awk '{print $1,$2}'; echo "st=\${PIPESTATUS[0]}"`);
      assert.equal(result.stdout, "Frames Skips\nst=0\n");
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      assert.equal(new TextDecoder().decode(await fs.readFile("/work/a")), "hi\n");
      assert.ok((await fs.stat("/work/a.zst")).size > 0);
    } finally { await shell.dispose(); }
  });
}
