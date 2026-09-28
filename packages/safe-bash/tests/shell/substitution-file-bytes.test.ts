import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, MemoryFileSystem, agentCommands } from "../../src/index.js";

for (const [profile, bytes] of [
  ["invalid UTF-8", Uint8Array.of(128, 255, 10, 10)],
  ["UTF-8 with BOM", Uint8Array.of(239, 187, 191, 195, 169, 10, 10)],
  ["ASCII", Uint8Array.of(65, 10, 10)],
] as const) {
  for (const command of ["cat input", "cat < input", "head input", "tail input", "cat input | head", "cat < input | tail"]) {
    test(`file substitution preserves ${profile}: ${command}`, async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input", bytes);
      const source = `printf '%s' "$(${command})"`;
      await fs.writeFile("/saved.sh", new TextEncoder().encode(source));
      const shell = new Shell({ fs }).use(agentCommands());
      try {
        for (const script of [source, "sh /saved.sh"]) {
          const result = await shell.exec(script);
          assert.equal(result.exitCode, 0);
          assert.equal(result.stderr, "");
          assert.deepEqual(result.stdoutBytes, bytes.subarray(0, bytes.length - 2));
          assert.deepEqual(await fs.readFile("/input"), bytes);
        }
      } finally {
        await shell.dispose();
      }
    });
  }
}
