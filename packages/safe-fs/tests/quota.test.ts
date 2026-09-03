import assert from "node:assert/strict";
import { test } from "vitest";
import { createMemoryFileSystem } from "../src/fs/memory/index.js";
import { withFileSystemQuota } from "../src/fs/quota/index.js";

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

test("quota covers cumulative writes, copies, appends, and truncation", async () => {
  const raw = createMemoryFileSystem();
  const fs = withFileSystemQuota(raw, { maxBytes: 8 });
  await fs.writeFile("/a", bytes("1234"));
  await fs.copyFile("/a", "/b");
  await assert.rejects(fs.appendFile("/a", bytes("9")), /quota/i);
  await fs.rm("/b");
  await fs.appendFile("/a", bytes("9"));
  await assert.rejects(fs.truncate!("/a", 9), /quota/i);
  assert.equal(new TextDecoder().decode(await fs.readFile("/a")), "12349");
});

test("quota covers streaming writes without buffering the source", async () => {
  const raw = createMemoryFileSystem();
  const fs = withFileSystemQuota(raw, { maxBytes: 4 });
  const source = (async function* () { yield bytes("12"); yield bytes("345"); })();
  await assert.rejects(fs.writeStream!("/stream", source), /quota/i);
  assert.equal((await fs.stat("/stream")).size, 2);
});
