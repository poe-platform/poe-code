import { expect, it, vi } from "vitest";
import type { FileSystem } from "../src/contracts/filesystem.js";
import { DeviceFileSystem } from "../src/fs/devices/index.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { MountFileSystem } from "../src/fs/mount/index.js";
import { withObjectFileDescriptors } from "../src/fs/object-publication/index.js";
import { withFileSystemQuota } from "../src/fs/quota/index.js";
import { scopeFileSystem } from "../src/fs/scoped.js";
import { S3FileSystem } from "../src/fs/s3/filesystem.js";
import { MockS3Client } from "../src/fs/s3/mock.js";
import { WebDavFileSystem } from "../src/fs/webdav/webdav.js";
import { PythonFileSystem } from "../src/python/index.js";
import { MockDav } from "./migration/fs/webdav/mock.js";

const backends = [
  {
    name: "S3 with conditional per-object deletion",
    async create() {
      const transport = new MockS3Client({ buckets: ["cleanup-review"] });
      const fs = new S3FileSystem({ transport, bucket: "cleanup-review", prefix: "owned" });
      await fs.mkdir("/temporary");
      await fs.writeFile("/temporary/keep", new Uint8Array([1, 2]));
      await fs.writeFile("/outside", new Uint8Array([3]));
      expect(transport.capabilities.conditionalDelete).toBe(true);
      expect(fs.capabilities.snapshotRmdir).toBe(true);
      return {
        fs,
        assertNoDestructiveRequests() {
          expect(transport.requests.filter(request => request.operation === "deleteObject")).toEqual([]);
        },
      };
    },
  },
  {
    name: "WebDAV with an authoritative empty-directory binding",
    async create() {
      const transport = new MockDav();
      transport.files.set("/temporary", null);
      transport.files.set("/temporary/keep", new Uint8Array([1, 2]));
      transport.files.set("/outside", new Uint8Array([3]));
      const removeEmptyDirectory = vi.fn(async () => {
        throw new Error("empty-only authority must not be used for Python tree cleanup");
      });
      const fs = new WebDavFileSystem({
        baseUrl: "https://example.invalid/dav/", fetch: transport.fetch,
        atomicEmptyDirectory: { namespaceUrl: "https://example.invalid/dav/", removeEmptyDirectory },
      });
      expect(fs.capabilities.removeDirectory).toBe(true);
      return {
        fs,
        assertNoDestructiveRequests() {
          expect(removeEmptyDirectory).not.toHaveBeenCalled();
          expect(transport.requests.filter(request => request.init.method === "DELETE"
            || request.init.method === "MOVE" || request.init.method === "LOCK")).toEqual([]);
        },
      };
    },
  },
];

for (const backend of backends) {
  for (const composition of ["bare", "object-descriptors", "mounted-policy-wrappers"] as const) {
    it(`#749 ${backend.name} refuses authoritative Python tree cleanup through ${composition}`, async () => {
      const host = await backend.create();
      const recursiveRemove = vi.spyOn(host.fs, "rm");
      const emptyRemove = vi.spyOn(host.fs, "rmdir");
      const acquire = vi.fn(async () => { throw new Error("tree cleanup must not open file descriptors"); });
      let fs: FileSystem = host.fs;
      let path = "/temporary";
      if (composition !== "bare") {
        fs = withObjectFileDescriptors(fs, { acquire });
        expect(fs.capabilities.versionedDescriptors).toBe(true);
        expect(fs.capabilities.open).toBe(true);
      }
      if (composition === "mounted-policy-wrappers") {
        const root = new MemoryFileSystem();
        expect(root.capabilities.atomicTreeRemoval).toBe(true);
        fs = new DeviceFileSystem(new MountFileSystem({ root, mounts: {
          "/remote": scopeFileSystem(withFileSystemQuota(fs, { maxBytes: 1024 }), () => {}, new AbortController().signal),
        } }));
        path = "/remote/temporary";
      }
      const service = new PythonFileSystem(fs, { cwd: "/" });
      try {
        expect(host.fs.capabilities.recursiveRemove).toBe(true);
        await expect(service.dispatch({ op: "rmtreeSupported", args: [path] })).resolves.toBe(false);
        await expect(service.dispatch({ op: "rmtree", args: [path] })).rejects.toMatchObject({ code: "ENOTSUP" });
        expect(recursiveRemove).not.toHaveBeenCalled();
        expect(emptyRemove).not.toHaveBeenCalled();
        expect(acquire).not.toHaveBeenCalled();
        host.assertNoDestructiveRequests();
        expect(await host.fs.readFile("/temporary/keep")).toEqual(new Uint8Array([1, 2]));
        expect(await host.fs.readFile("/outside")).toEqual(new Uint8Array([3]));
      } finally { await service.close(); }
    });
  }
}
