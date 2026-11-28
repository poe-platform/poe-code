import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { scopeFileSystem } from "@poe-code/safe-fs/core";
import { FsError } from "safe-bash-contracts";
import { run } from "./test-helpers.js";

for (const [command, args, source, destination, mode] of [
  ["gzip", ["a"], "/a", "/a.gz", 0o644],
  ["gunzip", ["a.gz"], "/a.gz", "/a", 0o644],
  ["gzip", ["-k", "a"], "/a", "/a.gz", 0o755],
] as const) {
  for (const creationMask of [0o022, 0o077]) {
    test(`${command} ${args.join(" ")} preserves ${mode.toString(8)} permissions with umask ${creationMask.toString(8)}`, async () => {
      const memory = createMemoryFileSystem();
      const content = Buffer.from("x\n");
      await memory.writeFile(source, command === "gunzip" ? gzipSync(content) : content, { mode });
      const signal = new AbortController().signal;
      const fs = scopeFileSystem(memory, () => {}, signal, () => {}, { creationMask });
      const result = await run(command, args, undefined, { fs, signal });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal((await memory.stat(destination)).mode & 0o7777, mode);
      if (command === "gunzip") assert.deepEqual(Buffer.from(await memory.readFile(destination)), content);
      if (args[0] === "-k") {
        assert.equal((await memory.stat(source)).mode & 0o7777, mode);
        assert.deepEqual(Buffer.from(await memory.readFile(source)), content);
      } else await assert.rejects(memory.stat(source), { code: "ENOENT" });
    });
  }
}

test("gzip retains the source and existing destination when restoring permissions fails", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/a", Buffer.from("x\n"), { mode: 0o644 });
  await fs.writeFile("/a.gz", Buffer.from("existing"), { mode: 0o600 });
  fs.chmod = async path => {
    assert.equal((await fs.stat(path)).mode & 0o7777, 0o600);
    throw new FsError("EPERM", { path });
  };
  const result = await run("gzip", ["-f", "a"], undefined, { fs });
  assert.equal(result.exitCode, 1);
  assert.equal(Buffer.from(await fs.readFile("/a")).toString(), "x\n");
  assert.equal((await fs.stat("/a")).mode & 0o7777, 0o644);
  assert.equal(Buffer.from(await fs.readFile("/a.gz")).toString(), "existing");
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), ["a", "a.gz"]);
});
