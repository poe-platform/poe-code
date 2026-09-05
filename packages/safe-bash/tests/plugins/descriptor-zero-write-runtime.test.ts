import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FileDescriptorCapabilities } from "poe-code/safe-fs";

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

describe("compiled public zero-length write delegation", { skip: selected === undefined ? "Requires a current public build and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  for (const entry of ["poe-code/safe-fs", "poe-code/safe-fs/core"] as const) {
    for (const advertised of [true, false, undefined]) {
      for (const access of ["read", "write", "readwrite"] as const) {
        test(`${entry}: ${access} delegates empty writes only when explicitly advertised ${String(advertised)}`, async context => {
          const published = entry === "poe-code/safe-fs" ? await import("poe-code/safe-fs") : await import("poe-code/safe-fs/core");
          const resource = { writes: [] as number[], reads: 0, closes: 0 };
          const capabilities: FileDescriptorCapabilities = {
            positionedRead: true, positionedWrite: true, truncate: false, synchronization: "none",
            ...(advertised === undefined ? {} : { delegateZeroLengthWrite: advertised }),
          };
          const descriptor = await published.openFileDescriptor("/device", { access }, capabilities, async () => ({
            resource,
            async stat() { return { type: "character", size: 0, mode: 0o020666, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 }; },
            async read(retained) { retained.reads++; return 0; },
            async write(retained, bytes) {
              retained.writes.push(bytes.length);
              if (bytes.length === 0) throw new published.FsError("EPERM", { syscall: "write", path: "/device" });
              return bytes.length;
            },
            async truncate() { assert.fail("Truncation is not advertised"); },
            async sync() { assert.fail("Synchronization is not advertised"); },
            async close(retained) { retained.closes++; },
          }));
          context.after(() => descriptor.close());
          if (access === "read") {
            await assert.rejects(descriptor.write(new Uint8Array(), null), { code: "EBADF" });
            assert.deepEqual(resource.writes, []);
          } else {
            if (advertised === true) {
              await assert.rejects(descriptor.write(new Uint8Array(), null), { code: "EPERM" });
              assert.deepEqual(resource.writes, [0]);
            } else {
              assert.equal(await descriptor.write(new Uint8Array(), null), 0);
              assert.deepEqual(resource.writes, []);
            }
            assert.equal(await descriptor.write(Uint8Array.of(255), null), 1);
            assert.equal(resource.writes.at(-1), 1);
          }
          if (access !== "write") assert.equal(await descriptor.read(new Uint8Array(), null), 0);
          assert.equal(resource.reads, 0);
          assert.equal(Reflect.get(descriptor.capabilities, "delegateZeroLengthWrite"), advertised === true ? access !== "read" : advertised);
          assert.equal(Object.hasOwn(descriptor.capabilities, "delegateZeroLengthWrite"), advertised !== undefined);
          await descriptor.close();
          await descriptor.close();
          assert.equal(resource.closes, 1);
          await assert.rejects(descriptor.write(new Uint8Array(), null), { code: "EBADF" });
        });
      }
    }
  }
});
