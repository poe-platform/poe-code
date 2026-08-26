import { strict as assert } from "node:assert";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { FsError } from "../../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { binary, helloMember, run, wrap } from "./helpers.js";

test("existing destination is never truncated without force", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", binary);
  await fs.writeFile("/input.gz", Buffer.from("existing"));
  const result = await run("gzip", ["input"], undefined, { fs });
  assert.equal(result.exitCode, 1);
  assert.equal(Buffer.from(await fs.readFile("/input.gz")).toString(), "existing");
  assert.deepEqual(await fs.readFile("/input"), binary);
  assert.equal((await fs.readdir("/")).length, 2);
});

test("force atomically replaces a validated target", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", binary);
  await fs.writeFile("/input.gz", Buffer.from("existing"));
  const result = await run("gzip", ["--force", "--keep", "input"], undefined, { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(gunzipSync(await fs.readFile("/input.gz")), Buffer.from(binary));
});

test("bad CRC under force preserves both input and existing target", async () => {
  const fs = createMemoryFileSystem();
  const corrupt = Buffer.from(helloMember);
  corrupt[corrupt.length - 8] = 0;
  await fs.writeFile("/input.gz", corrupt);
  await fs.writeFile("/input", binary);
  const result = await run("gunzip", ["-f", "input.gz"], undefined, { fs });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(await fs.readFile("/input"), binary);
  assert.deepEqual(await fs.readFile("/input.gz"), new Uint8Array(corrupt));
  assert.equal((await fs.readdir("/")).length, 2);
});

for (const alias of ["symlink", "hardlink"]) {
  test(`force refuses destination ${alias} aliases`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/input", binary);
    if (alias === "symlink") await fs.symlink("/input", "/input.gz");
    else await fs.link("/input", "/input.gz");
    const result = await run("gzip", ["-f", "input"], undefined, { fs });
    assert.equal(result.exitCode, 1);
    assert.deepEqual(await fs.readFile("/input"), binary);
    assert.equal((await fs.readdir("/")).length, 2);
  });
}

test("source symlinks and directories are rejected without output", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/actual", binary);
  await fs.symlink("/actual", "/input");
  for (const operand of ["input", "/", "missing", ""]) {
    assert.equal((await run("gzip", [operand], undefined, { fs })).exitCode, 1);
  }
  assert.equal((await fs.readdir("/")).length, 2);
});

test("multioperand destination/source aliases fail before mutation", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", binary);
  await fs.writeFile("/input.gz", helloMember);
  const result = await run("gzip", ["-f", "input", "input.gz"], undefined, { fs });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(await fs.readFile("/input"), binary);
  assert.deepEqual(await fs.readFile("/input.gz"), new Uint8Array(helloMember));
});

test("staging write failure cleans its private directory and keeps source", async () => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", binary);
  const fs = wrap(memory, {
    async writeStream(path, source, options) {
      await memory.writeFile(path, Buffer.from("partial"), options);
      for await (const chunk of source) { assert.ok(chunk.length); break; }
      throw new FsError("EIO");
    },
  });
  const result = await run("gzip", ["input"], undefined, { fs });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(await memory.readFile("/input"), binary);
  assert.deepEqual((await memory.readdir("/")).map((entry) => entry.name), ["input"]);
});

test("exclusive publication failure never deletes a concurrently created target", async () => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", binary);
  const fs = wrap(memory, {
    async copyFile(_source, destination, options) {
      assert.equal(options?.exclusive, true);
      await memory.writeFile(destination, Buffer.from("concurrent"));
      throw new FsError("EEXIST");
    },
  });
  assert.equal((await run("gzip", ["input"], undefined, { fs })).exitCode, 1);
  assert.deepEqual(await memory.readFile("/input"), binary);
  assert.equal(Buffer.from(await memory.readFile("/input.gz")).toString(), "concurrent");
  assert.equal((await memory.readdir("/")).length, 2);
});

test("forced rename failure preserves previous destination and source", async () => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", binary);
  await memory.writeFile("/input.gz", Buffer.from("existing"));
  const fs = wrap(memory, { async rename() { throw new FsError("EIO"); } });
  assert.equal((await run("gzip", ["-f", "input"], undefined, { fs })).exitCode, 1);
  assert.deepEqual(await memory.readFile("/input"), binary);
  assert.equal(Buffer.from(await memory.readFile("/input.gz")).toString(), "existing");
  assert.equal((await memory.readdir("/")).length, 2);
});

test("non-atomic providers support absent targets but refuse forced replacement", async () => {
  const memory = createMemoryFileSystem();
  const fs = wrap(memory, { capabilities: { ...memory.capabilities, atomicRename: false } });
  await fs.writeFile("/input", binary);
  assert.equal((await run("gzip", ["-k", "input"], undefined, { fs })).exitCode, 0);
  assert.equal((await run("gzip", ["-f", "input"], undefined, { fs })).exitCode, 1);
  assert.deepEqual(await fs.readFile("/input"), binary);
});

test("stream capability failure never falls back to readFile", async () => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", binary);
  const fs = wrap(memory, {
    capabilities: { ...memory.capabilities, streamingRead: false },
    async readFile() { assert.fail("unbounded fallback"); },
  });
  const result = await run("gzip", ["input"], undefined, { fs });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /stream/i);
  assert.equal((await memory.readdir("/")).length, 1);
});

test("source replacement during encoding is not published or deleted", async () => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", binary);
  const fs = wrap(memory, {
    async *readStream(path, options) {
      yield* memory.readStream(path, options);
      await memory.rm(path);
      await memory.writeFile(path, Buffer.from("replacement"));
    },
  });
  assert.equal((await run("gzip", ["input"], undefined, { fs })).exitCode, 1);
  assert.equal(Buffer.from(await memory.readFile("/input")).toString(), "replacement");
  assert.equal((await memory.readdir("/")).length, 1);
});

test("source mutation after publication is not deleted", async () => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", binary);
  const fs = wrap(memory, {
    async copyFile(source, destination, options) {
      await memory.copyFile(source, destination, options);
      await memory.writeFile("/input", Buffer.from("changed"));
    },
  });
  assert.equal((await run("gzip", ["input"], undefined, { fs })).exitCode, 1);
  assert.equal(Buffer.from(await memory.readFile("/input")).toString(), "changed");
  assert.equal((await memory.readdir("/")).length, 2);
});

test("temporary directory collisions are not removed", async () => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", binary);
  let collision: string | undefined;
  const fs = wrap(memory, {
    async mkdir(path, options) {
      if (!collision) {
        collision = path;
        await memory.mkdir(path);
        await memory.writeFile(`${path}/owner`, binary);
        throw new FsError("EEXIST");
      }
      await memory.mkdir(path, options);
    },
  });
  assert.equal((await run("gzip", ["-k", "input"], undefined, { fs })).exitCode, 0);
  assert.ok(collision);
  assert.deepEqual(await memory.readFile(`${collision}/owner`), binary);
  assert.equal((await memory.readdir("/")).length, 3);
});

test("cleanup leaves foreign staging entries and retains the source", async () => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", binary);
  let directory = "";
  const fs = wrap(memory, {
    async writeStream(path, source, options) {
      directory = path.slice(0, path.lastIndexOf("/"));
      await memory.writeStream(path, source, options);
      await memory.writeFile(`${directory}/foreign`, binary);
    },
  });
  const result = await run("gzip", ["input"], undefined, { fs });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /unexpected staging entries/);
  assert.deepEqual(await memory.readFile(`${directory}/foreign`), binary);
  assert.deepEqual(await memory.readFile("/input"), binary);
  assert.deepEqual(gunzipSync(await memory.readFile("/input.gz")), Buffer.from(binary));
  assert.deepEqual((await memory.readdir(directory)).map((entry) => entry.name), ["foreign"]);
});

for (const replacement of ["file", "directory"]) {
  test(`cleanup refuses a replaced staging ${replacement}`, async () => {
    const memory = createMemoryFileSystem();
    await memory.writeFile("/input", binary);
    let staged = "";
    const fs = wrap(memory, {
      async writeStream(path) {
        staged = path;
        const directory = path.slice(0, path.lastIndexOf("/"));
        if (replacement === "directory") {
          await memory.rm(directory, { recursive: true });
          await memory.mkdir(directory);
        } else await memory.rm(path);
        await memory.writeFile(path, Buffer.from("foreign"));
        throw new FsError("EIO");
      },
    });
    const result = await run("gzip", ["input"], undefined, { fs });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /cleanup failed; input retained/);
    assert.equal(Buffer.from(await memory.readFile(staged)).toString(), "foreign");
    assert.deepEqual(await memory.readFile("/input"), binary);
    await assert.rejects(memory.stat("/input.gz"), { code: "ENOENT" });
  });
}
