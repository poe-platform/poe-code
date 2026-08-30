import assert from "node:assert/strict";
import test from "node:test";
import { filesystemCommands } from "../../../../../src/commands/filesystem.js";
import { FsError } from "../../../../../src/contracts/errors.js";
import type { FileSystem } from "../../../../../src/contracts/filesystem.js";
import { toByteSource } from "../../../../../src/contracts/io.js";
import { MemoryFileSystem } from "../../../../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../../../../src/fs/mount/index.js";
import { bytes, opaque, wrapped } from "./support.js";

async function run(name: "cp" | "mv", args: string[], filesystem: FileSystem) {
  const errors: Uint8Array[] = [];
  const command = filesystemCommands().find(candidate => candidate.name === name)!;
  const result = await command.execute({ command: name, args, fs: filesystem, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write() {} }, stderr: { async write(data) { errors.push(data.slice()); } },
  });
  return { ...result, stderr: Buffer.concat(errors).toString() };
}

test("current core cp -P: unscoped source symlink across two aliases is never unlinked", async () => {
  const base = new MemoryFileSystem();
  await base.writeFile("/data", bytes("preserved binary\u0000"));
  await base.symlink("data", "/link");
  const first = opaque(base);
  const second = opaque(base);
  const mounted = createMountFileSystem({ root: new MemoryFileSystem(), mounts: { "/first": first, "/second": second } });
  const mutations: string[] = [];
  const observed = wrapped(mounted, {
    rm: async (path, options) => { mutations.push(`rm:${path}`); await mounted.rm(path, options); },
    symlink: async (target, path, options) => { mutations.push(`symlink:${path}`); await mounted.symlink(target, path, options); },
  });
  const result = await run("cp", ["-P", "/first/link", "/second/link"], observed);
  assert.equal(result.exitCode, 1);
  assert.notEqual(result.stderr, "");
  assert.deepEqual(mutations, []);
  assert.equal(await base.readlink("/link"), "data");
  assert.deepEqual(await base.readFile("/data"), bytes("preserved binary\u0000"));
  assert.deepEqual((await base.readdir("/")).map(entry => entry.name).sort(), ["data", "link"]);
});

test("current core EXDEV mv: a known hardlink alias returns GNU status1 without copy or unlink", async () => {
  const base = new MemoryFileSystem();
  await base.writeFile("/source", bytes("alias sentinel\u0000"));
  await base.link("/source", "/target");
  const effects: string[] = [];
  const filesystem = wrapped(base, {
    rename: async () => { effects.push("rename:EXDEV"); throw new FsError("EXDEV"); },
    copyFile: async (source, target, options) => { effects.push("copy"); await base.copyFile(source, target, options); },
    rm: async (path, options) => { effects.push(`remove:${path}`); await base.rm(path, options); },
  });
  const result = await run("mv", ["/source", "/target"], filesystem);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /same file/u);
  assert.deepEqual(effects, ["rename:EXDEV"]);
  assert.deepEqual(await base.readFile("/source"), bytes("alias sentinel\u0000"));
  assert.deepEqual(await base.readFile("/target"), bytes("alias sentinel\u0000"));
  assert.deepEqual((await base.readdir("/")).map(entry => entry.name), ["source", "target"]);
});

for (const publication of ["success", "partial-failure", "unknown"] as const) {
  test(`current core EXDEV mv known-distinct ${publication}: remove follows completed copy only`, async () => {
    const base = new MemoryFileSystem();
    await base.writeFile("/source", bytes("source sentinel"));
    await base.writeFile("/target", bytes("target sentinel"));
    const events: string[] = [];
    const filesystem = wrapped(base, {
      rename: async () => { events.push("EXDEV"); throw new FsError("EXDEV"); },
      copyFile: async (source, target, options) => {
        events.push("copy:start");
        if (publication === "partial-failure") {
          await base.writeFile(target, bytes("partial"));
          events.push("copy:failed");
          throw new FsError("EIO");
        }
        await base.copyFile(source, target, options);
        events.push("copy:complete");
      },
      rm: async (path, options) => { events.push(`remove:${path}`); await base.rm(path, options); },
    });
    const result = await run("mv", ["/source", "/target"], publication === "unknown" ? opaque(filesystem) : filesystem);
    if (publication === "success") {
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(events, ["EXDEV", "copy:start", "copy:complete", "remove:/source"]);
      await assert.rejects(base.lstat("/source"), { code: "ENOENT" });
      assert.deepEqual(await base.readFile("/target"), bytes("source sentinel"));
    } else if (publication === "partial-failure") {
      assert.equal(result.exitCode, 1);
      assert.deepEqual(events, ["EXDEV", "copy:start", "copy:failed"]);
      assert.deepEqual(await base.readFile("/source"), bytes("source sentinel"));
      assert.deepEqual(await base.readFile("/target"), bytes("partial"));
    } else {
      assert.equal(result.exitCode, 1);
      assert.deepEqual(events, ["EXDEV"]);
      assert.deepEqual(await base.readFile("/source"), bytes("source sentinel"));
      assert.deepEqual(await base.readFile("/target"), bytes("target sentinel"));
    }
  });
}
