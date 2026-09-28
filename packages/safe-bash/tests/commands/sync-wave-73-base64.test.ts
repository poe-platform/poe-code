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
  { name: "base64 decode preserves non-UTF8 pipeline bytes", source: 'for i in {1..2}; do x=$(printf //4= | base64 -d | base64); echo "$x"; done', expected: "//4=\n//4=\n" },
  { name: "base64 encodes raw non-UTF8 bytes", source: String.raw`for i in {1..2}; do x=$(printf '\377\376' | base64); echo "$x"; done`, expected: "//4=\n//4=\n" },
  { name: "base64 decode", source: 'for i in {1..2}; do x=$(printf aGk= | base64 -d); echo "$x"; done', expected: "hi\nhi\n" },
];
for (const entry of cases) test(entry.name, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createByteCommands(), ...createStructuredCommands(), ...createStreamFormatCommands()]) });
  try {
    const result = await shell.exec(entry.source);
    assert.equal(result.stdout, entry.expected);
  } finally { await shell.dispose(); }
});
test("base64 loops work without the Node Buffer global", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Buffer")!;
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...createStandardCommands(), ...createByteCommands()]) });
  try {
    Reflect.deleteProperty(globalThis, "Buffer");
    const result = await shell.exec('for i in {1..2}; do x=$(printf hi | base64); y=$(printf "$x" | base64 -d); echo "$x/$y"; done');
    assert.equal(result.stdout, "aGk=/hi\naGk=/hi\n");
    assert.equal(result.stderr, "");
  } finally {
    Object.defineProperty(globalThis, "Buffer", descriptor);
    await shell.dispose();
  }
});
