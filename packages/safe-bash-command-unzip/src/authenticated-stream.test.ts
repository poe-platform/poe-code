import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { collectBytes, toByteSource } from "safe-bash-contracts";
import { settings } from "safe-bash-io-engine/commands/archive/internal";
import { makeZipEntry, streamZipArchive } from "safe-bash-zip-engine/zip-format";
import { createUnzipCommand } from "./unzip.js";

for (const method of [0, 8]) for (const corrupt of [false, true]) for (const destination of ["stdout", "file"] as const) {
  test(`AES streamed ${method} ${corrupt ? "corrupt" : "valid"} member authenticates before ${destination}`, async () => {
    const fs = createMemoryFileSystem();
    const signal = new AbortController().signal;
    const limits = settings({ limits: { maxBufferedFileBytes: 1024, chunkSize: 1024 } });
    const body = Uint8Array.from({ length: 100003 }, (_, index) => (index * 37) % 251);
    const entry = await makeZipEntry("payload", new Uint8Array(), { modified: new Date(2026, 0, 1), mode: 0o100644, directory: false, symlink: false }, limits, signal, 0);
    entry.method = method;
    entry.source = toByteSource(body);
    entry.encryption = { aes: { strength: 256, version: 2 }, password: new TextEncoder().encode("secret"), entropy: n => new Uint8Array(n).fill(17) };
    const bytes = await collectBytes(streamZipArchive({ entries: [entry], comment: new Uint8Array() }, limits, signal), { signal });
    if (corrupt) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const payload = 30 + view.getUint16(26, true) + view.getUint16(28, true);
      bytes[payload + entry.compressedSize! - 1]! ^= 1;
    }
    await fs.writeFile("/archive.zip", bytes);
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = await createUnzipCommand({ limits: { maxBufferedFileBytes: 1024, chunkSize: 1024 } }).execute({
      command: "unzip", args: [destination === "stdout" ? "-p" : "-qq", "-P", "secret", "/archive.zip"],
      cwd: "/", env: {}, fs, signal, stdin: toByteSource(""),
      stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    if (corrupt) {
      assert.notEqual(result.exitCode, 0);
      assert.match(stderr, /authentication/);
      assert.equal(stdout.length, 0);
      await assert.rejects(fs.stat("/payload"));
    } else {
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(destination === "stdout" ? new Uint8Array(Buffer.concat(stdout)) : await fs.readFile("/payload"), body);
    }
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), destination === "file" && !corrupt ? ["archive.zip", "payload"] : ["archive.zip"]);
  });
}
