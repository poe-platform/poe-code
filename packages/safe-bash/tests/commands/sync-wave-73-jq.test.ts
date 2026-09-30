import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { createByteCommands } from "../../src/commands/bytes/index.js";
import { createStructuredCommands } from "../../src/commands/structured/index.js";
import { createStreamFormatCommands } from "../../src/commands/stream-format/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

const cases = [
  { name: "jq reads own prototype-named properties", source: `for i in {1..2}; do x=$(printf '{"valueOf":7,"toString":8}\\n' | jq '.valueOf'); echo "$x"; done`, expected: "7\n7\n" },
  { name: "jq nested inherited properties", source: `for i in {1..2}; do x=$(printf '{"a":{}}\\n' | jq '.a.toString'); echo "$x"; done`, expected: "null\nnull\n" },
  { name: "jq inherited properties", source: `for i in {1..2}; do x=$(printf '{"a":1}\\n' | jq '.valueOf'); echo "$x"; done`, expected: "null\nnull\n" },
  { name: "jq array indexing rejects properties", source: `for i in {1..2}; do x=$(printf '{"items":[10,20]}\\n' | jq -r '.items.length'); echo "$?/$x"; done`, expected: "5/\n5/\n", diagnostic: "Cannot index array" },
];
for (const entry of cases) test(entry.name, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createByteCommands(), ...createStructuredCommands(), ...createStreamFormatCommands()]) });
  try {
    const result = await shell.exec(entry.source);
    assert.equal(result.stdout, entry.expected);
    if (entry.diagnostic) assert.ok(result.stderr.includes(entry.diagnostic), result.stderr);
  } finally { await shell.dispose(); }
});

for (const loop of [
  "for i in {1..2}",
  "for ((i=1;i<=2;i++))",
  "i=0; while ((i++<2))",
]) test(`jq fallback preserves effects, diagnostics and final status in ${loop}`, async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs, commands: new CommandRegistry([...createStandardCommands(), ...createStructuredCommands()]) });
  try {
    const result = await shell.exec(`${loop}; do echo before >> /effects; x=$(printf '{"items":[10,20]}' | jq -r '.items.length'); done`);
    assert.equal(result.stdout, "");
    assert.equal(result.exitCode, 5);
    assert.equal(result.stderr.split("Cannot index array").length - 1, 2, result.stderr);
    assert.equal(new TextDecoder().decode(await fs.readFile("/effects")), "before\nbefore\n");
    assert.equal((await shell.exec('printf "<%s>" "$x"')).stdout, "<>");
  } finally { await shell.dispose(); }
});
