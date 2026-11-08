import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource, type FileSystem } from "safe-bash-contracts";
import { createZipCommand } from "./index.js";

for (const size of [131071, 2097153]) test(`hardlinked ZIP update streams ${size} bytes with bounded outstanding I/O`, async () => {
  // MemoryFileSystem supplies test backing storage; these counters measure
  // command I/O admission, not external-spool or process-RSS qualification.
  const fs = createMemoryFileSystem();
  await fs.writeFile("/first", new Uint8Array(size).fill(17));
  await fs.writeFile("/second", new Uint8Array(size).fill(23));
  let current = 0, peak = 0, maximumRead = 0, activeWrites = 0, peakWrites = 0, publications = 0;
  let stagedBytes = 0, peakStagedBytes = 0;
  const view = new Proxy(fs, { get(target, key) {
    if (key === "readFile") return () => { throw new Error("whole-file assembly is forbidden"); };
    if (key === "openReadFile") return async (...args: Parameters<NonNullable<FileSystem["openReadFile"]>>) => {
      const handle = await fs.openReadFile!(...args);
      return { ...handle, async read(...args: Parameters<typeof handle.read>) {
        maximumRead = Math.max(maximumRead, args[1]);
        return handle.read(...args);
      } };
    };
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<FileSystem["createStagedFile"]>>) => {
      const stage = await fs.createStagedFile!(...args);
      let ownedBytes = 0, removed = false;
      return { ...stage, cleanup: { ...stage.cleanup!, async remove(...controls: Parameters<NonNullable<typeof stage.cleanup>["remove"]>) {
        await stage.cleanup!.remove(...controls);
        if (!removed) { removed = true; stagedBytes -= ownedBytes; }
      } }, writer: { ...stage.writer!, async write(...args: Parameters<NonNullable<typeof stage.writer>["write"]>) {
        activeWrites++; current += args[0].length;
        peakWrites = Math.max(peakWrites, activeWrites); peak = Math.max(peak, current);
        try {
          await Promise.resolve(); await stage.writer!.write(...args);
          ownedBytes += args[0].length; stagedBytes += args[0].length;
          peakStagedBytes = Math.max(peakStagedBytes, stagedBytes);
        }
        finally { activeWrites--; current -= args[0].length; }
      } } };
    };
    if (key === "publishStagedFile") return async (...args: Parameters<NonNullable<FileSystem["publishStagedFile"]>>) => {
      if (args[2].preserveIdentity) publications++;
      return fs.publishStagedFile!(...args);
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const command = createZipCommand({ limits: { chunkSize: 4096, maxBufferedFileBytes: 1024, maxInputMemoryBytes: 1024 } });
  for (const file of ["first", "second"]) {
    let stderr = "";
    const result = await command.execute({ command: "zip", args: ["-q", "-0", "/archive.zip", file], cwd: "/", env: {}, fs: view,
      signal: new AbortController().signal, stdin: toByteSource(""), stdout: { async write() {} },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    assert.equal(result.exitCode, 0, stderr);
    if (file === "first") await fs.link!("/archive.zip", "/alias.zip");
  }
  assert.equal(publications, 1);
  assert.equal((await fs.stat("/archive.zip")).ino, (await fs.stat("/alias.zip")).ino);
  assert.equal((await fs.stat("/archive.zip")).nlink, 2);
  assert.equal(peakWrites, 1);
  assert.ok(peak > 0 && peak <= 4096, `outstanding write bytes: ${peak}`);
  assert.ok(maximumRead > 0 && maximumRead <= 4096, `range read size: ${maximumRead}`);
  assert.equal(current, 0);
  assert.equal(stagedBytes, 0);
  // Backing bytes intentionally scale with the payload and are NOT part of the
  // bounded transfer assertion. A memory-backed run cannot qualify Worker RAM.
  assert.ok(peakStagedBytes >= size * 2, `provider staged storage: ${peakStagedBytes}`);
  assert.ok(peakStagedBytes > peak * 32);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), ["alias.zip", "archive.zip", "first", "second"]);
});
