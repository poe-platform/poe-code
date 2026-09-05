import assert from "node:assert/strict";
import { describe, test } from "node:test";

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

describe("compiled public descriptor provider API", { skip: selected === undefined ? "Requires a current public build and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  for (const name of ["poe-code/safe-fs", "poe-code/safe-fs/core"] as const) {
    test(`${name} exposes managed observation without granting read access`, async () => {
      const published = name === "poe-code/safe-fs" ? await import("poe-code/safe-fs") : await import("poe-code/safe-fs/core");
      assert.equal(typeof published.openFileDescriptor, "function");
      const resource = { closes: 0, writes: 0 };
      const descriptor = await published.openFileDescriptor<typeof resource>("/device", { access: "write", truncate: true }, {
        positionedRead: false, positionedWrite: false, truncate: false,
        openTruncate: true, readObservation: true, synchronization: "none",
      }, async () => ({
        resource,
        async probeRead(retained) { assert.equal(retained, resource); return "ready"; },
        async stat() { return { type: "character", size: 0, mode: 0o020666, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 }; },
        async read() { assert.fail("Observation must not consume input"); },
        async write(retained, bytes) { retained.writes++; return bytes.length; },
        async truncate() { assert.fail("Open truncation must not call ftruncate"); },
        async sync() { assert.fail("Synchronization is not advertised"); },
        async close(retained) { retained.closes++; },
      }));
      try {
        assert.equal(await descriptor.probeRead!(), "ready");
        assert.equal(resource.writes, 0);
        await assert.rejects(descriptor.read(new Uint8Array(1), null), error => error instanceof published.FsError && error.code === "EBADF");
        await assert.rejects(descriptor.truncate(0), error => error instanceof published.FsError && error.code === "ENOTSUP");
        assert.equal(await descriptor.write(Uint8Array.of(0, 255), null), 2);
        assert.equal(resource.writes, 1);
      } finally { await descriptor.close(); }
      await descriptor.close();
      assert.equal(resource.closes, 1);
      await assert.rejects(descriptor.probeRead!(), error => error instanceof published.FsError && error.code === "EBADF");
    });

    test(`${name} does not install devices in a fresh filesystem`, async () => {
      const published = name === "poe-code/safe-fs" ? await import("poe-code/safe-fs") : await import("poe-code/safe-fs/core");
      const filesystem = published.createMemoryFileSystem();
      for (const device of ["null", "zero", "random", "urandom"]) {
        await assert.rejects(filesystem.stat(`/dev/${device}`), error => error instanceof published.FsError && error.code === "ENOENT");
      }
    });
  }
});
