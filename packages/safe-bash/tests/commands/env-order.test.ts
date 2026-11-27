import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";

for (const [script, expected] of [
  ["env -i A=1 B=2 C=3 env", "A=1\nB=2\nC=3\n"],
  ["env -i A=1 env N1=a N2=b env", "A=1\nN1=a\nN2=b\n"],
  ["env -i A=1 B=2 printenv", "A=1\nB=2\n"],
  ["env -i A=1 B=2", "A=1\nB=2\n"],
  ["env -i A=1 B=2 env A=3 C=4 A=5", "A=5\nB=2\nC=4\n"],
  ["env -i A=1 B=2 env -u A A=3", "B=2\nA=3\n"],
] as const) {
  test(`env preserves assignment order: ${script}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/work", { recursive: true });
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    try {
      const result = await shell.exec(script);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, expected);
    } finally {
      await shell.dispose();
    }
  });
}
