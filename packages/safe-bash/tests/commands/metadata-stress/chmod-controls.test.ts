import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { run } from "./helpers.js";

test("chmod verbose/changes/reference/error controls preserve bytes and aliases", async () => {
  const memory = new MemoryFileSystem();
  await memory.mkdir("/work");
  for (const fs of [memory]) {
    await fs.writeFile("/work/file", Uint8Array.of(0, 255, 13), { mode: 0o640 });
    await fs.writeFile("/work/reference", Uint8Array.of(8), { mode: 0o751 });
    await fs.symlink("reference", "/work/ref-link");
    await fs.link("/work/file", "/work/alias");
  }
  for (const args of [["-v", "600", "file"], ["-c", "600", "file"], ["--verbose", "600", "file"], ["--changes", "--reference=ref-link", "file"], ["-f", "644", "missing", "file"]]) {
    const actual = await run("chmod", args, memory);
    assert.equal((await memory.stat("/work/alias")).mode, (await memory.stat("/work/file")).mode);
    assert.deepEqual(await memory.readFile("/work/alias"), Uint8Array.of(0, 255, 13));
    assert.equal(await memory.readlink("/work/ref-link"), "reference");
    assert.deepEqual((await memory.readdir("/work")).map(entry => entry.name).sort(), ["alias", "file", "ref-link", "reference"]);
  }
});

test("chmod root and unsupported traversal controls fail without namespace effects", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/file", Uint8Array.of(3), { mode: 0o640 });
  for (const args of [["-R", "777", "/"], ["-RL", "777", "/work"], ["-RH", "777", "/work"], ["-RP", "777", "/work"], ["--no-preserve-root", "-R", "777", "/"]]) {
    const result = await run("chmod", args, fs);
    assert.equal(result.exitCode, 1);
    assert.equal((await fs.stat("/work/file")).mode & 0o777, 0o640);
    assert.deepEqual(await fs.readFile("/work/file"), Uint8Array.of(3));
  }
});
