import assert from "node:assert/strict";
import test from "node:test";
import { Shell, MemoryFileSystem, agentCommands } from "../../src/index.js";

test("find ignores deleted memory-directory entries", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/kept", Uint8Array.of(65));
  await fs.writeFile("/deleted", Uint8Array.of(66));
  await fs.unlink("/deleted");
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    const result = await shell.exec("find / -type f");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "/kept\n");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});
