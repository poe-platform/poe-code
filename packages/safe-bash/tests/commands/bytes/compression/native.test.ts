import { strict as assert } from "node:assert";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { platform, release, arch } from "node:os";
import { test } from "node:test";
import { binary, chunks, helloMember, run } from "./helpers.js";

for (const executable of ["gzip", "gunzip"]) {
  test(`optional native ${executable} interoperability`, async (context) => {
    const version = spawnSync(executable, ["--version"], { encoding: "utf8", timeout: 3_000, maxBuffer: 64 * 1024 });
    if (version.error && "code" in version.error && version.error.code === "ENOENT") {
      context.skip(`${executable} unavailable; static fixtures still run`);
      return;
    }
    assert.ifError(version.error);
    assert.equal(version.status, 0, version.stderr);
    context.diagnostic(`${platform()} ${release()} ${arch()}; Node ${process.version}; ${executable}: ${(version.stdout || version.stderr).trim()}`);
    if (executable === "gzip") {
      for (const bytes of [new Uint8Array(), binary, binary.subarray(16, 193)]) {
        const reference: SpawnSyncReturns<Buffer> = spawnSync(executable, ["-n", "-c"], { input: bytes, timeout: 3_000, maxBuffer: 1024 * 1024 });
        assert.ifError(reference.error);
        assert.equal(reference.status, 0, reference.stderr.toString());
        const decoded = await run("gunzip", [], chunks(reference.stdout));
        assert.equal(decoded.exitCode, 0, decoded.stderr);
        assert.deepEqual(decoded.stdout, Buffer.from(bytes));
      }
    } else {
      const compressed = await run("gzip", ["-9"], chunks(binary));
      assert.equal(compressed.exitCode, 0, compressed.stderr);
      const reference = spawnSync(executable, ["-c"], { input: compressed.stdout, timeout: 3_000, maxBuffer: 1024 * 1024 });
      assert.ifError(reference.error);
      assert.equal(reference.status, 0, reference.stderr.toString());
      assert.deepEqual(reference.stdout, Buffer.from(binary));
      const concatenated = spawnSync(executable, ["-c"], {
        input: Buffer.concat([helloMember, compressed.stdout]), timeout: 3_000, maxBuffer: 1024 * 1024,
      });
      assert.equal(concatenated.status, 0, concatenated.stderr.toString());
      assert.deepEqual(concatenated.stdout, Buffer.concat([Buffer.from("hello\n"), binary]));
    }
  });
}
