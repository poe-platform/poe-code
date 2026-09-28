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
  { name: "empty arithmetic for preserves prior PIPESTATUS", source: 'false; for ((i=1;i<0;i++)); do ((0)); done; echo "$?|${PIPESTATUS[0]}"', expected: "0|1\n" },
  { name: "successful command after arithmetic resets status", source: 'for i in {1..3}; do ((0)); x=ok; done; echo "$?|${PIPESTATUS[0]}"', expected: "0|0\n" },
  { name: "loop failure selects or branch", source: 'for i in {1..3}; do ((i-3)); done || echo failed', expected: "failed\n" },
  { name: "materialized PIPESTATUS preserves failure", source: 'p=${PIPESTATUS[0]}; for i in {1..3}; do ((i-3)); done; echo "$?|${PIPESTATUS[0]}"', expected: "1|1\n" },
  { name: "arithmetic for final status", source: 'for ((i=1;i<=3;i++)); do ((i-3)); done; echo "$?|${PIPESTATUS[0]}"', expected: "1|1\n" },
  { name: "brace for final status", source: 'for i in {1..3}; do ((i-3)); done; echo "$?|${PIPESTATUS[0]}"', expected: "1|1\n" },
  { name: "array header", source: 'arr=(2 3); s=0; for x in "${arr[@]}"; do s=$((s+x)); done; echo "$s"', expected: "5\n" },
];
for (const entry of cases) test(entry.name, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createByteCommands(), ...createStructuredCommands(), ...createStreamFormatCommands()]) });
  try {
    const result = await shell.exec(entry.source);
    assert.equal(result.stdout, entry.expected);
  } finally { await shell.dispose(); }
});
test("dynamic seq headers are reevaluated on cached scripts", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createByteCommands(), ...createStructuredCommands(), ...createStreamFormatCommands()]) });
  try {
    const source = 's=0; for x in $(seq 1 $N); do s=$((s+x)); done; echo "$s"';
    for (const [N, expected] of [["3", "6\n"], ["5", "15\n"], ["2", "3\n"]] as const) {
      assert.equal((await shell.exec(source, { env: { N } })).stdout, expected);
    }
  } finally { await shell.dispose(); }
});
test("array headers are reevaluated on cached scripts", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
  try {
    const source = 'arr=($VALUES); s=0; for x in "${arr[@]}"; do s=$((s+x)); done; echo "$s"';
    assert.equal((await shell.exec(source, { env: { VALUES: "2 3" } })).stdout, "5\n");
    assert.equal((await shell.exec(source, { env: { VALUES: "4 5 6" } })).stdout, "15\n");
  } finally { await shell.dispose(); }
});
