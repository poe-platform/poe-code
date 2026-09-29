import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { basicCommands } from "../../src/commands/basic.js";
import { textCommands } from "../../src/commands/text.js";

const cases = [
  ["10\\n2\\n", "-h -k1,1r", "2\n10\n"],
  ["FEB\\nJAN\\n", "-M -k1,1r", "JAN\nFEB\n"],
  ["a!\\na?\\n", "-d -k1,1r", "a?\na!\n"],
  ["a\\nB\\n", "-f -k1,1r", "a\nB\n"],
  [" a\\nB\\n", "-b -k1,1r", "B\n a\n"],
  ["10\\n2\\n", "-n -k1,1", "2\n10\n"],
  ["2 a\\n1 b\\n2 b\\n", "-r -k1,1n", "1 b\n2 b\n2 a\n"],
  ["10\\n2\\n", "-n -k1,1r", "2\n10\n"],
  ["1 a\\n1 B\\n", "-nf", "1 B\n1 a\n"],
  ["é\\nÉ\\n", "-fu", "É\né\n"],
  ["ß\\nSS\\n", "-fu", "SS\nß\n"],
  ["😀\\n！\\n", "", "！\n😀\n"],
  ["a\\nA\\n", "-fu", "a\n"],
  ["1 a\\n1 B\\n", "-nfs", "1 a\n1 B\n"],
  ["1 a\\n1 B\\n", "-nfr", "1 a\n1 B\n"],
  ["1 😀\\n1 ！\\n", "-n", "1 ！\n1 😀\n"],
] as const;

for (const [input, flags, expected] of cases) {
  for (const loop of [undefined, "for i in 1", "for ((i=0;i<1;i++))"]) {
    test(`sort ${flags} on ${input}: ${loop ?? "direct"}`, async () => {
      const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...basicCommands(), ...textCommands()]) });
      try {
        const pipeline = `printf '${input}' | sort ${flags}`;
        const result = await shell.exec(loop ? `${loop}; do x=$(${pipeline}); done; printf '%s\\n' "$x"` : pipeline);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, expected);
      } finally { await shell.dispose(); }
    });
  }
}
