import assert from "node:assert/strict";
import test from "node:test";
import type { FileStat, FsOptions } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../../src/fs/mount/index.js";
import { createReadOnlyFileSystem } from "../../../src/fs/readonly/index.js";

type Representation = "enumerable-own" | "nonenumerable-own" | "prototype-accessor";

class ReportingFileSystem extends MemoryFileSystem {
  readonly reported = new Map<string, number>();
  readonly reads: string[] = [];

  constructor(readonly representation: Representation = "prototype-accessor") { super(); }

  override async lstat(path: string, options?: FsOptions): Promise<FileStat> {
    const source = await super.lstat(path, options);
    const owner = this.representation === "prototype-accessor" ? {} : source;
    const filesystem = this;
    Object.defineProperty(owner, "allocatedBytes", {
      enumerable: this.representation === "enumerable-own",
      get() {
        assert.equal(this, source);
        filesystem.reads.push(path);
        return filesystem.reported.get(path);
      },
    });
    if (owner !== source) Object.setPrototypeOf(source, owner);
    Object.defineProperty(source, "adapterState", {
      enumerable: true,
      get() { throw new Error("must not copy unrelated provider metadata"); },
    });
    Object.defineProperty(source, "blocks", { value: 91, enumerable: true });
    return source;
  }
}

for (const representation of ["enumerable-own", "nonenumerable-own", "prototype-accessor"] as const) {
  for (const method of ["stat", "lstat"] as const) {
    for (const route of ["root", "mount"] as const) {
      test(`${method} forwards ${representation} allocation through ${route} routing`, async () => {
        const backend = new ReportingFileSystem(representation);
        await backend.writeFile("/file", new Uint8Array(7));
        const filesystem = createMountFileSystem(route === "root" ? { root: backend }
          : { root: new MemoryFileSystem(), mounts: { "/mounted": backend } });
        const path = route === "root" ? "/file" : "/mounted/file";
        for (const reported of [0, 1, 4096, Number.MAX_SAFE_INTEGER, undefined]) {
          if (reported === undefined) backend.reported.delete("/file");
          else backend.reported.set("/file", reported);
          const before = backend.reads.filter(value => value === "/file").length;
          const result = await filesystem[method](path);
          assert.equal(result.allocatedBytes, reported);
          assert.equal(Object.hasOwn(result, "allocatedBytes"), reported !== undefined);
          assert.equal(result.size, 7);
          assert.equal(Object.hasOwn(result, "adapterState"), false);
          assert.equal(Object.hasOwn(result, "blocks"), false);
          assert.equal(backend.reads.filter(value => value === "/file").length, before + 1);
          if (reported !== undefined) assert.equal(Object.getOwnPropertyDescriptor(result, "allocatedBytes")?.get, undefined);
          backend.reported.set("/file", 8192);
          assert.equal(result.allocatedBytes, reported);
        }
      });
    }
  }
}

test("synthetic mount ancestors have unknown allocation, not a mounted root's allocation", async () => {
  const backend = new ReportingFileSystem();
  backend.reported.set("/", 4096);
  const filesystem = createMountFileSystem({ root: new MemoryFileSystem(), mounts: { "/synthetic/nested/data": backend } });
  for (const method of ["stat", "lstat"] as const) {
    for (const path of ["/synthetic", "/synthetic/nested"]) {
      const result = await filesystem[method](path);
      assert.equal(result.type, "directory");
      assert.equal(result.allocatedBytes, undefined);
      assert.equal(Object.hasOwn(result, "allocatedBytes"), false);
    }
    assert.equal((await filesystem[method]("/synthetic/nested/data")).allocatedBytes, 4096);
  }
});

test("mount stat follows allocation to the target while lstat reports the link", async () => {
  const backend = new ReportingFileSystem();
  await backend.writeFile("/file", new Uint8Array(7));
  await backend.symlink("file", "/link");
  backend.reported.set("/file", 4096);
  backend.reported.set("/link", 0);
  const filesystem = createReadOnlyFileSystem(createMountFileSystem({
    root: new MemoryFileSystem(), mounts: { "/data": createReadOnlyFileSystem(backend) },
  }));
  const followed = await filesystem.stat("/data/link");
  const link = await filesystem.lstat("/data/link");
  assert.equal(followed.type, "file");
  assert.equal(followed.allocatedBytes, 4096);
  assert.equal(link.type, "symlink");
  assert.equal(link.allocatedBytes, 0);
});

test("mounted memory files do not acquire allocation from logical size", async () => {
  const backend = new MemoryFileSystem();
  await backend.writeFile("/file", new Uint8Array(8192));
  const filesystem = createMountFileSystem({ root: new MemoryFileSystem(), mounts: { "/data": backend } });
  for (const method of ["stat", "lstat"] as const) {
    const result = await filesystem[method]("/data/file");
    assert.equal(result.size, 8192);
    assert.equal(result.allocatedBytes, undefined);
    assert.equal(Object.hasOwn(result, "allocatedBytes"), false);
  }
});
