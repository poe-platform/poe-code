import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource, type ByteSource, type CommandContext, type FileSystem, type FsOptions } from "safe-bash-contracts";
import { Extraction } from "./unzip/safety.js";
import { settings } from "safe-bash-io-engine/commands/archive/internal";

test("unzip writes retained staging before reading the next payload chunk", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  let writes = 0;
  const view = new Proxy(fs, { get(target, key) {
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<FileSystem["createStagedFile"]>>) => {
      const staging = await fs.createStagedFile!(...args);
      assert.ok(staging.writer);
      return { ...staging, writer: { ...staging.writer, async write(bytes: Uint8Array, options?: FsOptions) { writes++; await staging.writer!.write(bytes, options); } } };
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } }) as FileSystem;
  const context: CommandContext = { command: "unzip", args: [], fs: view, cwd: "/work", env: {}, signal: new AbortController().signal, stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} } };
  const extraction = new Extraction(context, settings({}));
  const parent = await fs.stat("/work");
  const source: ByteSource = (async function* () {
    yield Uint8Array.of(1, 2, 3);
    assert.equal(writes, 1, "first payload must reach retained staging before another pull");
    yield Uint8Array.of(4, 5);
  })();
  try {
    await extraction.publish("/work", "/work/file", source, undefined, parent, 0o100644, new Date(2026, 0, 1));
    assert.deepEqual(await fs.readFile("/work/file"), Uint8Array.of(1, 2, 3, 4, 5));
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["file"]);
  } finally { await extraction.close(); }
});

import { makeZipEntry, writeZipArchive } from "safe-bash-zip-engine/zip-format";
import { createUnzipCommand } from "./unzip.js";

test("unzip restores spilled directory identities and deferred symlinks", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  const signal = new AbortController().signal, limits = settings({});
  const modified = new Date(2026, 0, 2, 3, 4, 6);
  const entries = [];
  for (let index = 0; index < 70; index++) {
    entries.push(await makeZipEntry(`dir-${index}/`, new Uint8Array(), { modified, mode: 0o40750, directory: true, symlink: false }, limits, signal, 0));
    entries.push(await makeZipEntry(`link-${index}`, new TextEncoder().encode("target"), { modified, mode: 0o120777, directory: false, symlink: true }, limits, signal, 0));
  }
  await fs.writeFile("/work/archive.zip", await writeZipArchive({ entries, comment: new Uint8Array() }, limits, signal));
  let stderr = "";
  const result = await createUnzipCommand().execute({ command: "unzip", args: ["-qq", "archive.zip"], fs, cwd: "/work", env: {}, signal, stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  assert.equal(result.exitCode, 0, stderr);
  for (const index of [0, 31, 69]) {
    const directory = await fs.stat(`/work/dir-${index}`);
    assert.equal(directory.mode & 0o777, 0o750);
    assert.equal(directory.mtimeMs, modified.getTime());
    assert.equal(await fs.readlink!(`/work/link-${index}`), "target");
  }
  assert.equal((await fs.readdir("/work")).length, 141);
});
