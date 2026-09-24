import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { prCommands } from "../../../src/commands/pr/index.js";

for (const [flags, diagnostic] of [
  ["-250000 -w500000", "columns limit exceeded"],
  ["-w500000", "page width limit exceeded"],
] as const) test(`default layout bounds reject tiny input: ${flags}`, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), limits: { maxOutputBytes: 1024 } }).use(prCommands());
  try {
    const result = await shell.exec(`pr ${flags}`, { stdin: "a\n" });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes(diagnostic), result.stderr);
  } finally { await shell.dispose(); }
});

test("page output is admitted before constructing header padding", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(prCommands({ limits: { maxOutputBytes: 64 } }));
  const original = String.prototype.repeat;
  let largest = 0;
  String.prototype.repeat = function (count) { largest = Math.max(largest, count); return original.call(this, count); };
  try {
    const result = await shell.exec("pr -w10000", { stdin: "a\n" });
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("output bytes limit exceeded"), result.stderr);
    assert.ok(largest < 64, `constructed padding of ${largest} bytes`);
  } finally { String.prototype.repeat = original; await shell.dispose(); }
});

test("default buffer budget still bounds explicitly widened layouts", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(prCommands({ limits: { maxPageWidth: Infinity } }));
  try {
    const result = await shell.exec("pr -w5000000", { stdin: "a\n" });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes("buffered bytes limit exceeded"), result.stderr);
  } finally { await shell.dispose(); }
});
