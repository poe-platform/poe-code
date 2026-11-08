import { expect, it } from "vitest";
import type { FileStat, FsOptions } from "../src/contracts/filesystem.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { MountFileSystem } from "../src/fs/mount/index.js";
import { OverlayFileSystem } from "../src/fs/overlay/index.js";
import { ReadOnlyFileSystem } from "../src/fs/readonly/index.js";

class CharacterMetadataFileSystem extends MemoryFileSystem {
  constructor(readonly numbers: Pick<FileStat, "rdevMajor" | "rdevMinor">) { super(); }

  override async stat(path: string, options?: FsOptions): Promise<FileStat> {
    const stat = await super.stat(path, options);
    return stat.type === "file" ? { ...stat, type: "character", mode: 0o020666, ...this.numbers } : stat;
  }

  override async lstat(path: string, options?: FsOptions): Promise<FileStat> {
    const stat = await super.lstat(path, options);
    return stat.type === "file" ? { ...stat, type: "character", mode: 0o020666, ...this.numbers } : stat;
  }
}

for (const kind of ["readonly", "mount", "overlay"] as const) {
  it.each([
    { label: "known", numbers: { rdevMajor: 7, rdevMinor: 11 } },
    { label: "zero", numbers: { rdevMajor: 0, rdevMinor: 0 } },
    { label: "unknown", numbers: {} },
    { label: "major only", numbers: { rdevMajor: 7 } },
    { label: "minor only", numbers: { rdevMinor: 11 } },
  ] satisfies { label: string; numbers: Pick<FileStat, "rdevMajor" | "rdevMinor"> }[])(`${kind} preserves $label character-device numbers`, async ({ numbers }) => {
    const source = new CharacterMetadataFileSystem(numbers);
    await source.writeFile("/node", new Uint8Array());
    await source.symlink("/node", "/link");
    const fs = kind === "readonly" ? new ReadOnlyFileSystem(source)
      : kind === "mount" ? new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/devices": source } })
        : new OverlayFileSystem({ lower: source, upper: new MemoryFileSystem() });
    for (const operation of ["stat", "lstat"] as const) {
      const stat = await fs[operation](kind === "mount" ? "/devices/node" : "/node");
      expect(stat.type).toBe("character");
      expect(stat.mode).toBe(0o020666);
      for (const field of ["rdevMajor", "rdevMinor"] as const) {
        expect(stat[field]).toBe(numbers[field]);
        expect(Object.hasOwn(stat, field)).toBe(Object.hasOwn(numbers, field));
      }
    }
    const linkPath = kind === "mount" ? "/devices/link" : "/link";
    const target = await fs.stat(linkPath);
    expect(target.type).toBe("character");
    for (const field of ["rdevMajor", "rdevMinor"] as const) {
      expect(target[field]).toBe(numbers[field]);
      expect(Object.hasOwn(target, field)).toBe(Object.hasOwn(numbers, field));
    }
    const link = await fs.lstat(linkPath);
    expect(link.type).toBe("symlink");
    expect(Object.hasOwn(link, "rdevMajor")).toBe(false);
    expect(Object.hasOwn(link, "rdevMinor")).toBe(false);
  });
}
