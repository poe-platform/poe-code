import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { portableSearchCommands } from "../../src/commands/search/portable.js";

test("portable search defaults to the bounded provider", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input", new TextEncoder().encode("alpha\nbeta\n"));
  const shell = new Shell({ fs }).use(portableSearchCommands());
  try {
    const result = await shell.exec("grep alpha /input; rg beta /input");
    assert.equal(result.stdout, "alpha\nbeta\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally {
    await shell.dispose();
  }
});
