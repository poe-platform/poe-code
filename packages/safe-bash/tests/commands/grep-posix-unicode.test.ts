import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, agentCommands, createMemoryFileSystem } from "../../src/index.js";

const cases = [
  [String.raw`printf 'héllo wörld\n' | grep -o '[[:alpha:]]*'`, "héllo\nwörld\n"],
  [String.raw`printf 'ÀB\n' | grep -c '[[:upper:]][[:upper:]]'`, "1\n"],
  [String.raw`printf 'é\n' | grep -c '^[[:lower:]]$'`, "1\n"],
  [String.raw`printf 'naïve1\n' | grep -o '[[:alnum:]]\+'`, "naïve1\n"],
] as const;

for (const [script, expected] of [...cases, [cases.map(([script]) => script).join("; "), cases.map(([, output]) => output).join("")] as const]) {
  test(`default grep C.UTF-8 POSIX classes: ${script}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/work");
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    try {
      const result = await shell.exec(script);
      assert.equal(result.stdout, expected);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });
}
