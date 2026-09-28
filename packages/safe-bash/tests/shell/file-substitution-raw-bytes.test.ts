import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, createMemoryFileSystem, agentCommands } from "../../src/index.js";

for (const bytes of [Uint8Array.of(128, 255), Uint8Array.of(239, 187, 191, 97), Uint8Array.of(226, 130, 172)]) {
  test(`file command substitutions retain bytes ${Array.from(bytes).join(",")}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/raw", bytes);
    const shell = new Shell({ fs }).use(agentCommands());
    try {
      for (const command of ["cat", "head -n 1", "tail -n 1"]) {
        const result = await shell.exec(`printf "%s" "$(${command} /raw)"`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.deepEqual(result.stdoutBytes, bytes);
      }
    } finally { await shell.dispose(); }
  });
}
