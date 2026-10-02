import assert from "node:assert/strict";
import test from "node:test";
import { Shell, agentCommands } from "../../src/node.js";
import { adapters } from "../fs/conformance/fixtures.js";

// The rooted real adapter is exercised by manual integration checks; these
// fixtures keep file contents in memory, including the HTTP WebDAV server.
for (const adapter of adapters.filter(adapter => adapter.name !== "real")) {
  test(`timeout kill-after preserves bytes and retires children on ${adapter.name}`, async context => {
    const { fs } = await adapter.create(context);
    const bytes = new TextEncoder().encode("Changed12\r\n");
    await fs.writeFile("/Changed input.txt", bytes);
    const shell = new Shell({ fs }).use(agentCommands());
    try {
      for (const option of ["-k 0.03", "-k0.03", "--kill-after 0.03", "--kill-after=0.03"]) {
        const result = await shell.exec(`timeout ${option} 2 cat 'Changed input.txt'`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.deepEqual(result.stdoutBytes, bytes);
        assert.equal(result.stderr, "");
        const exited = await shell.exec(`timeout ${option} 2 sh -c 'printf "child output\\r\\n"; exit 9'`);
        assert.equal(exited.exitCode, 9, exited.stderr);
        assert.deepEqual(exited.stdoutBytes, new TextEncoder().encode("child output\r\n"));
        assert.equal(exited.stderr, "");
      }
      const killed = await shell.exec("timeout -k0.03 0.2 sh -c 'trap \"\" TERM; printf ready; while :; do :; done'");
      assert.equal(killed.exitCode, 137, killed.stderr);
      assert.equal(killed.stdout, "ready");
      assert.equal(killed.stderr, "");
      // Settlement must leave the caller usable and its backing bytes intact.
      const reused = await shell.exec("timeout -k0.03 2 cat 'Changed input.txt'");
      assert.equal(reused.exitCode, 0, reused.stderr);
      assert.deepEqual(reused.stdoutBytes, bytes);
      assert.deepEqual(await fs.readFile("/Changed input.txt"), bytes);
    } finally { await shell.dispose(); }
  });
}
