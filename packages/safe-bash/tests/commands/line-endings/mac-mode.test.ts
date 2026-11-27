import assert from "node:assert/strict";
import test from "node:test";
import { agentCommands, createMemoryFileSystem, Shell } from "../../../src/index.js";

for (const [command, input, expected] of [
  ["dos2unix", "a\\rb\\r", "0000000   a  \\n   b  \\n\n"],
  ["unix2dos", "a\\nb\\n", "0000000   a  \\r   b  \\r\n"],
]) {
  test(`${command} supports Mac conversion in an agent command pipeline`, async () => {
    const shell = new Shell({ fs: createMemoryFileSystem(), cwd: "/work" }).use(agentCommands());
    try {
      const result = await shell.exec(`printf '${input}' | ${command} -c mac | od -c | head -1`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, expected);
    } finally { await shell.dispose(); }
  });
}
