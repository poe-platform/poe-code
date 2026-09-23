import { expect, it } from "vitest";
import type { FileStat, FileSystem } from "../src/contracts/filesystem.js";
import { createMemoryFileSystem } from "../src/fs/memory/index.js";
import { createReadOnlyFileSystem } from "../src/fs/readonly/index.js";
import { createMountFileSystem } from "../src/fs/mount/index.js";
import { createOverlayFileSystem } from "../src/fs/overlay/index.js";

const views = [
  { name: "readonly", wrap: (fs: FileSystem) => createReadOnlyFileSystem(fs) },
  { name: "mount", wrap: (fs: FileSystem) => createMountFileSystem({ root: fs }) },
  { name: "overlay", wrap: (fs: FileSystem) => createOverlayFileSystem({ upper: createMemoryFileSystem(), lower: fs }) },
];

for (const view of views) for (const method of ["stat", "lstat"] as const) {
  it(`${view.name} ${method} snapshots filesystemType once per metadata snapshot without a live accessor`, async () => {
    const backing = createMemoryFileSystem();
    await backing.writeFile("/file", Uint8Array.of(7));
    let filesystemType = "fixture";
    let reads = 0;
    let sizeReads = 0;
    const metadata: FileStat = {
      type: "file", mode: 0o100644, mtimeMs: 1, atimeMs: 2, ctimeMs: 3,
      get size() { sizeReads++; return 1; },
      get filesystemType() { reads++; return filesystemType; },
    };
    const provider = new Proxy(backing, { get(target, key) {
      if (key === "stat" || key === "lstat") return async (path: string, options?: Parameters<typeof target.stat>[1]) => path === "/file" ? metadata : target[key](path, options);
      const member: unknown = Reflect.get(target, key, target);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    const fs = view.wrap(provider);
    const snapshot = await fs[method]("/file");
    expect(snapshot.filesystemType).toBe("fixture");
    expect(reads).toBe(sizeReads);
    const firstReads = reads;
    const descriptor = Object.getOwnPropertyDescriptor(snapshot, "filesystemType");
    expect(descriptor?.value).toBe("fixture");
    expect(descriptor?.get).toBeUndefined();
    filesystemType = "changed-fixture";
    expect(snapshot.filesystemType).toBe("fixture");
    expect((await fs[method]("/file")).filesystemType).toBe("changed-fixture");
    expect(reads).toBe(firstReads * 2);
    expect(reads).toBe(sizeReads);
    expect(await backing.readFile("/file")).toEqual(Uint8Array.of(7));
  });
}
