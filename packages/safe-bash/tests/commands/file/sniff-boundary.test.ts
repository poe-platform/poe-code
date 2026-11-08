import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { fileCommands } from "../../../src/commands/file/index.js";
import { toByteSource } from "../../../src/contracts/index.js";
import { proxyFs, run } from "./helpers.js";

for (const size of [65535, 65536, 65537, 131072, 262143]) {
  test(`complete ${size}-byte JSON is recognized through Shell`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input", Buffer.from(`{"value":"${"x".repeat(size - 12)}"}`));
    const shell = new Shell({ fs });
    shell.use(fileCommands());
    try {
      for (const [flags, expected] of [["-bi", "application/json; charset=us-ascii\n"], ["-b --mime-type", "application/json\n"]]) {
        const result = await shell.exec(`file ${flags} /input`);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, expected);
      }
    } finally { await shell.dispose(); }
  });
}

test("whole-read and stdin JSON share the larger bounded extent", async () => {
  const bytes = Buffer.from(`{"value":"${"x".repeat(65537 - 12)}"}`);
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", bytes);
  const fs = proxyFs(memory, { readStream: undefined });
  for (const result of [
    await run(["-bi", "/input"], {}, { fs }),
    await run(["-bi", "-"], {}, { stdin: toByteSource(bytes) }),
  ]) {
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "application/json; charset=us-ascii\n");
  }
});

test("an explicit cap and invalid suffix retain plain-text classification", async () => {
  const fs = createMemoryFileSystem();
  for (const text of [
    `{"value":"${"x".repeat(262144 - 12)}"}`,
    `${" ".repeat(65534)}{} trailing bytes`,
  ]) {
    await fs.writeFile("/input", Buffer.from(text));
    const result = await run(["-bi", "/input"], { limits: { maxSniffBytes: 256 * 1024 } }, { fs });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "text/plain; charset=us-ascii\n");
  }
});

test("the configured sniff cap never certifies a JSON prefix from metadata", async () => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", Buffer.from("{} trailing bytes"));
  let reads = 0;
  let closed = false;
  const fs = proxyFs(memory, {
    async lstat() { return { ...(await memory.lstat("/input")), size: 2 }; },
    async *readStream() {
      try {
        reads++;
        yield Buffer.from("{}");
        reads++;
        yield Buffer.from(" trailing bytes");
      } finally { closed = true; }
    },
  });
  const result = await run(["-bi", "/input"], { limits: { maxSniffBytes: 2 } }, { fs });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "text/plain; charset=us-ascii\n");
  assert.equal(reads, 1);
  assert.equal(closed, true);
});
