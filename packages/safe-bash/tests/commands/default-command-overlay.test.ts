import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem, OverlayFileSystem } from "@poe-code/safe-fs";
import { Shell } from "../../src/shell/shell.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { csvkitCommands } from "../../src/commands/csvkit/index.js";
import { createCompressionCommands } from "../../src/commands/bytes/compression/index.js";
import { createXmllintCommand } from "safe-bash-command-xmllint";

const content = new TextEncoder().encode("# Hello\n\nWorld\n");

for (const [compress, decompress, suffix] of [
  ["gzip", "gunzip", ".gz"], ["bzip2", "bunzip2", ".bz2"],
  ["xz", "unxz", ".xz"], ["lzma", "unlzma", ".lzma"],
]) {
  test(`${compress} publishes and ${decompress} removes inputs on an overlay`, async () => {
    const lower = new MemoryFileSystem();
    await lower.writeFile("/doc.md", content);
    const fs = new OverlayFileSystem({ lower, upper: new MemoryFileSystem() });
    const shell = new Shell({ fs, cwd: "/", commands: new CommandRegistry(createCompressionCommands()) });
    try {
      const compressed = await shell.exec(`${compress} -k /doc.md`);
      assert.equal(compressed.exitCode, 0, compressed.stderr);
      assert.deepEqual(await fs.readFile("/doc.md"), content);
      assert.ok((await fs.readFile(`/doc.md${suffix}`)).length > 0);
      const decoded = await shell.exec(`${decompress} -f /doc.md${suffix}`);
      assert.equal(decoded.exitCode, 0, decoded.stderr);
      assert.deepEqual(await fs.readFile("/doc.md"), content);
      await assert.rejects(fs.stat(`/doc.md${suffix}`), { code: "ENOENT" });
      const replaced = await shell.exec(`${compress} /doc.md`);
      assert.equal(replaced.exitCode, 0, replaced.stderr);
      await assert.rejects(fs.stat("/doc.md"), { code: "ENOENT" });
      const restored = await shell.exec(`${decompress} /doc.md${suffix}`);
      assert.equal(restored.exitCode, 0, restored.stderr);
      assert.deepEqual(await fs.readFile("/doc.md"), content);
      assert.deepEqual(await lower.readFile("/doc.md"), content);
      assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["doc.md"]);
    } finally { await shell.dispose(); }
  });
}

test("csvkit default locale formats csvstat counts and numeric statistics", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/data.csv", new TextEncoder().encode("name,score\nalice,95\nbob,82\n"));
  const shell = new Shell({ fs, cwd: "/", commands: new CommandRegistry() });
  shell.use(csvkitCommands());
  try {
    const result = await shell.exec("csvstat /data.csv");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.includes("88.5"), result.stdout);
    const count = await shell.exec("csvstat --count /data.csv");
    assert.equal(count.exitCode, 0, count.stderr);
    assert.equal(count.stdout, "2\n");
  } finally { await shell.dispose(); }
});

for (const options of [undefined, {}]) {
  test(`xmllint factory executes with ${options ? "empty" : "omitted"} options and runtime`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/test.xml", new TextEncoder().encode('<root><item id="1">alpha</item></root>\n'));
    const command = options ? createXmllintCommand(options) : createXmllintCommand();
    const shell = new Shell({ fs, cwd: "/", commands: new CommandRegistry([command]) });
    try {
      const result = await shell.exec('xmllint --xpath "//item/text()" /test.xml');
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "alpha\n");
    } finally { await shell.dispose(); }
  });
}
