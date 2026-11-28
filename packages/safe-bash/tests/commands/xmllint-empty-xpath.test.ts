import assert from "node:assert/strict";
import test from "node:test";
import { Shell, agentCommands, createMemoryFileSystem } from "../../src/index.js";

for (const [query, output, status] of [
  ["//z", "", 10],
  ["//a", "<a>1</a>\n", 0],
  ["string(//z)", "\n", 0],
  ["count(//z)", "0\n", 0],
  ["boolean(//z)", "false\n", 0],
] as const) {
  test(`xmllint XPath status reaches the shell: ${query}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/work");
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    try {
      const result = await shell.exec(`echo '<r><a>1</a></r>' > f.xml; xmllint --xpath '${query}' f.xml; echo "rc=$?"`);
      assert.equal(result.stdout, `${output}rc=${status}\n`);
      assert.equal(result.stderr, status === 10 ? "xmllint: XPath set is empty\n" : "");
      assert.equal(result.exitCode, 0);

      const direct = await shell.exec(`xmllint --xpath '${query}' f.xml`);
      assert.equal(direct.stdout, output);
      assert.equal(direct.stderr, result.stderr);
      assert.equal(direct.exitCode, status);
    } finally {
      await shell.dispose();
    }
  });
}
