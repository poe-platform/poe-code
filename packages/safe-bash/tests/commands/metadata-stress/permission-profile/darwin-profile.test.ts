import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { FsError } from "../../../../src/contracts/index.js";
import { run } from "../helpers.js";

const sentinel = Uint8Array.of(0, 255, 10);

for (const input of [
  { name: "directory04755 +2000", measured: 0o4755, mode: "+2000", requested: 0o6755, umask: 0o022 },
  { name: "directory0051 ug+s", measured: 0o051, mode: "ug+s", requested: 0o6051, umask: 0 },
]) test(`memory chmod preserves requested setid bits: ${input.name}`, async () => {
  const memory = new MemoryFileSystem();
  await memory.mkdir("/work/directory", { recursive: true });
  await memory.writeFile("/work/sentinel", sentinel);
  await memory.chmod("/work/directory", input.measured);
  const result = await run("chmod", ["--", input.mode, "directory"], memory, { umask: input.umask });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stdout, Buffer.alloc(0));
  assert.equal(result.stderr, "");
  assert.equal((await memory.stat("/work/directory")).mode & 0o7777, input.requested);
  assert.deepEqual(await memory.readFile("/work/sentinel"), sentinel);
  assert.deepEqual((await memory.readdir("/work")).map(entry => entry.name).sort(), ["directory", "sentinel"]);
});

test("search-permission failure preserves typed EACCES, diagnostics and child metadata/bytes", async () => {
  const memory = new MemoryFileSystem();
  await memory.mkdir("/work/blocked", { recursive: true });
  await memory.writeFile("/work/blocked/file", sentinel, { mode: 0o600 });
  const lstat = memory.lstat.bind(memory);
  const before = await lstat("/work/blocked/file");
  const failure = new FsError("EACCES", { syscall: "lstat", path: "/work/blocked/file" });
  memory.lstat = async (path, options) => {
    if (path === "/work/blocked/file") throw failure;
    return lstat(path, options);
  };
  await assert.rejects(memory.lstat("/work/blocked/file"), error => {
    assert.equal(error, failure);
    assert.ok(error instanceof FsError);
    assert.equal(error.code, "EACCES");
    assert.equal(error.path, "/work/blocked/file");
    return true;
  });
  const actual = await run("chmod", ["--", "644", "blocked/file"], memory);
  assert.equal(actual.exitCode, 1);
  assert.deepEqual(actual.stdout, Buffer.alloc(0));
  assert.equal(actual.stderr, "chmod: EACCES: permission denied, lstat '/work/blocked/file'\n");
  assert.deepEqual(await lstat("/work/blocked/file"), before);
  assert.deepEqual(await memory.readFile("/work/blocked/file"), sentinel);
});
