import assert from "node:assert/strict";
import { constants } from "node:fs";
import { access, lstat, open } from "node:fs/promises";
import { release } from "node:os";
import test from "node:test";
import { collectBytes, FsError } from "poe-code/safe-fs";
import { createDeviceFileSystem } from "../../../src/fs/devices/index.js";

const supported = process.platform === "darwin" || process.platform === "linux";

for (const name of ["null", "zero", "random", "urandom"] as const) {
  test(`native device oracle: ${name}`, { skip: !supported }, async context => {
    context.diagnostic(`Native profile: ${process.platform} ${release()}, ${process.version}; existing /dev nodes only`);
    const fs = createDeviceFileSystem();
    const path = `/dev/${name}`;
    const nativeStat = await lstat(path);
    assert.equal(nativeStat.isCharacterDevice(), true);
    const virtualStat = await fs.lstat(`/${name}`);
    assert.equal(virtualStat.type, "character");
    assert.equal(virtualStat.mode & constants.S_IFMT, nativeStat.mode & constants.S_IFMT);
    assert.equal(virtualStat.size, nativeStat.size);
    await access(path, constants.R_OK | constants.W_OK);
    await fs.access(`/${name}`, 6);
    const handle = await open(path, constants.O_RDWR | constants.O_APPEND | constants.O_NONBLOCK);
    try {
      const payload = new Uint8Array([0, 1, 127, 128, 255]);
      if (process.platform === "darwin" && name === "urandom") {
        await assert.rejects(handle.write(payload), { code: "EPERM" });
        context.diagnostic("Intentional mismatch: Darwin urandom rejects writes; virtual devices accept/discard without reseeding Web Crypto");
      } else {
        const written = await handle.write(payload);
        assert.equal(written.bytesWritten, payload.length);
      }
      await fs.appendFile(`/${name}`, payload);
      const nativeBytes = new Uint8Array(256);
      const observed = await handle.read(nativeBytes, 0, nativeBytes.length, null);
      const virtualBytes = await collectBytes(fs.readStream(`/${name}`, { endExclusive: 256 }), { maxBytes: 256 });
      assert.equal(virtualBytes.byteLength, observed.bytesRead);
      if (name === "null" || name === "zero") {
        assert.deepEqual(virtualBytes, nativeBytes.subarray(0, observed.bytesRead));
      } else {
        assert.ok(nativeBytes.some(byte => byte !== 0));
        assert.ok(virtualBytes.some(byte => byte !== 0));
        assert.notDeepEqual(virtualBytes, nativeBytes);
      }
    } finally { await handle.close(); }
  });
}

test("native path-resolution error oracle", { skip: !supported }, async () => {
  const fs = createDeviceFileSystem();
  for (const suffix of ["null/", "zero/.", "random/child", "urandom/../null", "virtual-bash-absent-device/../null"]) {
    let nativeCode: string | undefined;
    try { await lstat(`/dev/${suffix}`); }
    catch (error) { nativeCode = (error as NodeJS.ErrnoException).code; }
    assert.ok(nativeCode, `native ${suffix} must fail`);
    await assert.rejects(fs.lstat(`/${suffix}`), error => {
      assert.ok(error instanceof FsError);
      assert.equal(error.code, nativeCode);
      return true;
    });
  }
});
