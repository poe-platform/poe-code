import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FileDescriptorCapabilities } from "poe-code/safe-fs";

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

describe("compiled public positioned append capability", { skip: selected === undefined ? "Requires a current public build and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  for (const entry of ["poe-code/safe-fs", "poe-code/safe-fs/core"] as const) {
    for (const advertised of [true, false, undefined]) {
      for (const access of ["write", "readwrite"] as const) {
        test(`${entry}: ${access} append requires affirmative positioned support ${String(advertised)}`, async context => {
          const published = entry === "poe-code/safe-fs" ? await import("poe-code/safe-fs") : await import("poe-code/safe-fs/core");
          const resource = { cursor: 7, writes: [] as { position: number | null; bytes: number[] }[], closes: 0 };
          const capabilities: FileDescriptorCapabilities = {
            position: true, positionedRead: true, positionedWrite: true, truncate: false,
            synchronization: "none",
            ...(advertised === undefined ? {} : { positionedAppendWrite: advertised }),
          };
          const descriptor = await published.openFileDescriptor("/device", { access, append: true }, capabilities, async () => ({
            resource,
            async getPosition(retained) { return retained.cursor; },
            async stat() { return { type: "character", size: 0, mode: 0o020666, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 }; },
            async read() { assert.fail("Positioned output must not consume input"); },
            async write(retained, bytes, position) {
              retained.writes.push({ position, bytes: [...bytes] });
              if (position === null) retained.cursor += bytes.length;
              return bytes.length;
            },
            async truncate() { assert.fail("Truncation is not advertised"); },
            async sync() { assert.fail("Synchronization is not advertised"); },
            async close(retained) { retained.closes++; },
          }));
          context.after(() => descriptor.close());
          assert.equal(descriptor.capabilities.positionedWrite, advertised === true);
          assert.equal(descriptor.capabilities.positionedAppendWrite, advertised);
          assert.equal(await descriptor.getPosition!(), 7);
          if (advertised === true) {
            assert.equal(await descriptor.write(Uint8Array.of(0, 255), 3), 2);
            assert.equal(await descriptor.getPosition!(), 7);
            assert.deepEqual(resource.writes, [{ position: 3, bytes: [0, 255] }]);
          } else {
            await assert.rejects(descriptor.write(Uint8Array.of(0, 255), 3), { code: "EINVAL" });
            await assert.rejects(descriptor.write(new Uint8Array(), 3), { code: "EINVAL" });
            assert.deepEqual(resource.writes, []);
          }
          assert.equal(await descriptor.write(Uint8Array.of(97), null), 1);
          assert.equal(await descriptor.getPosition!(), 8);
          assert.deepEqual(resource.writes.at(-1), { position: null, bytes: [97] });
          await descriptor.close();
          await descriptor.close();
          assert.equal(resource.closes, 1);
          await assert.rejects(descriptor.write(Uint8Array.of(1), 3), { code: "EBADF" });
        });
      }
    }

    test(`${entry}: new capability does not silently change memory append semantics`, async context => {
      const published = entry === "poe-code/safe-fs" ? await import("poe-code/safe-fs") : await import("poe-code/safe-fs/core");
      const filesystem = published.createMemoryFileSystem();
      await filesystem.writeFile("/file", Uint8Array.of(1, 2));
      const descriptor = await filesystem.open!("/file", { access: "write", append: true });
      context.after(() => descriptor.close());
      assert.equal(descriptor.capabilities.positionedWrite, false);
      assert.notEqual(descriptor.capabilities.positionedAppendWrite, true);
      await assert.rejects(descriptor.write(Uint8Array.of(9), 0), { code: "EINVAL" });
      assert.deepEqual(await filesystem.readFile("/file"), Uint8Array.of(1, 2));
      assert.equal(await descriptor.write(Uint8Array.of(3), null), 1);
      assert.deepEqual(await filesystem.readFile("/file"), Uint8Array.of(1, 2, 3));
      for (const device of ["null", "zero", "random", "urandom"]) {
        await assert.rejects(filesystem.stat(`/dev/${device}`), { code: "ENOENT" });
      }
    });

    test(`${entry}: capability cannot grant positioned writes to read-only access`, async context => {
      const published = entry === "poe-code/safe-fs" ? await import("poe-code/safe-fs") : await import("poe-code/safe-fs/core");
      const capabilities: FileDescriptorCapabilities = {
        positionedRead: true, positionedWrite: true, positionedAppendWrite: true,
        truncate: false, synchronization: "none",
      };
      let writes = 0;
      const descriptor = await published.openFileDescriptor("/device", { access: "read" }, capabilities, async () => ({
        resource: undefined,
        async stat() { return { type: "character", size: 0, mode: 0o020666, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 }; },
        async read() { return 0; },
        async write(_resource, bytes) { writes++; return bytes.length; },
        async truncate() { assert.fail("Truncation is not advertised"); },
        async sync() { assert.fail("Synchronization is not advertised"); },
        async close() {},
      }));
      context.after(() => descriptor.close());
      assert.equal(descriptor.capabilities.positionedWrite, false);
      assert.equal(descriptor.capabilities.positionedAppendWrite, false);
      await assert.rejects(descriptor.write(Uint8Array.of(1), 0), { code: "EBADF" });
      assert.equal(writes, 0);
    });
  }
});
