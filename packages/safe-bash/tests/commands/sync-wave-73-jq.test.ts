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
