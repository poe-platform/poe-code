import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs";
import { Shell } from "../../../src/shell/index.js";
import { textProgramCommands } from "../../../src/commands/text-programs/index.js";

for (const [program, stdin, stdout] of [
  ["N;P;D", "a\nb\nc\n", "a\nb\n"],
  ["N", "a\n", ""],
  ["N", "a\nb\n", "a\nb\n"],
  ["n", "a\n", "a\n"],
  ["p;N", "a\n", "a\n"],
  ["N;p", "a\n", ""],
  ["a\\\nqueued\nN", "a\n", "queued\n"],
] as const) {
  test(`sed EOF semantics for ${program} on ${JSON.stringify(stdin)}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(textProgramCommands());
    try {
      const result = await shell.exec(`sed '${program}'`, { stdin });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, stdout);
    } finally { await shell.dispose(); }
  });
}
