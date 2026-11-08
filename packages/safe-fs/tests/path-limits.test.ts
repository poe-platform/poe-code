import { expect, it } from "vitest";
import { validatePath, normalizePath, resolvePath } from "../src/contracts/virtual-path.js";
import { MemoryFileSystem, tryMkdirMemorySync, tryOpenMemoryRedirectHandleSync, tryWriteMemoryFileInDirSync } from "../src/fs/memory/index.js";
import { lexicalDevicePath } from "../src/fs/devices/path.js";
import { createDeviceFileSystem } from "../src/fs/devices/index.js";

it("accepts virtual paths beyond the former byte and component ceilings", () => {
  expect(() => validatePath("/".repeat(70_000))).not.toThrow();
  expect(normalizePath("/" + "./".repeat(2050))).toBe("/");
});

it("supports explicit UTF-8 byte and component limits", () => {
  expect(() => validatePath("/é", { maxPathBytes: 3 })).not.toThrow();
  expect(() => validatePath("/é", { maxPathBytes: 2 })).toThrow("ENAMETOOLONG");
  expect(() => validatePath("/a/b", { maxPathComponents: 2 })).not.toThrow();
  expect(() => validatePath("/a/b", { maxPathComponents: 1 })).toThrow("ENAMETOOLONG");
  expect(() => validatePath("/a/b", 1)).toThrow("ENAMETOOLONG");
});

it("allows long memory and device paths by default", async () => {
  const fs = new MemoryFileSystem();
  const device = createDeviceFileSystem(fs);
  for (const path of ["/".repeat(70_000), "/" + "./".repeat(2050)]) {
    expect((await fs.stat(path)).type).toBe("directory");
    expect(lexicalDevicePath(path)).toBe("/");
    if (path.length < 65_536) expect((await device.stat(path)).type).toBe("directory");
  }
});

it("enforces configured memory path limits even on clean fast paths", async () => {
  const fs = new MemoryFileSystem({ maxPathBytes: 10, maxPathComponents: 2 });
  await fs.mkdir("/a/b", { recursive: true });
  await expect(fs.mkdir("/a/b/c")).rejects.toMatchObject({ code: "ENAMETOOLONG" });
  await expect(fs.stat("/".repeat(11))).rejects.toMatchObject({ code: "ENAMETOOLONG" });
});

it("resolves memory files beyond 256 real directory components", async () => {
  const fs = new MemoryFileSystem();
  const directory = "/a".repeat(257);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(`${directory}/file`, new Uint8Array([42]));
  expect(await fs.readFile(`${directory}/file`)).toEqual(new Uint8Array([42]));
  expect((await fs.stat(directory)).type).toBe("directory");
});

it("enforces per-operation device traversal limits", async () => {
  const device = createDeviceFileSystem(new MemoryFileSystem());
  await expect(device.stat("/././", { pathLimits: { maxPathComponents: 1 } }))
    .rejects.toMatchObject({ code: "ENAMETOOLONG" });
  await expect(device.stat("////", { pathLimits: { maxPathBytes: 3 } }))
    .rejects.toMatchObject({ code: "ENAMETOOLONG" });
});

it.each([-1, NaN, 1.5])("rejects invalid path limits %s", value => {
  expect(() => validatePath("/", { maxPathBytes: value })).toThrow(RangeError);
  expect(() => new MemoryFileSystem({ maxPathComponents: value })).toThrow(RangeError);
});

it("optimized mutations enforce path quotas before creating entries", async () => {
  const fs = new MemoryFileSystem({ maxPathBytes: 3 });
  expect(() => tryMkdirMemorySync(fs, "/long", false, 0o755)).toThrow("ENAMETOOLONG");
  expect(() => tryOpenMemoryRedirectHandleSync(fs, "/long", false, 0o644)).toThrow("ENAMETOOLONG");
  expect(() => tryWriteMemoryFileInDirSync(fs, "/", "long", new Uint8Array(), false, 0o644)).toThrow("ENAMETOOLONG");
  expect(await fs.readdir("/")).toEqual([]);
});

it("canonicalization applies cumulative path expansion quotas", async () => {
  const fs = new MemoryFileSystem({ maxPathComponents: 4 });
  await fs.symlink("a/a/a", "/l");
  expect(() => fs.canonicalizeMissingTarget("/l/missing")).toThrow("ENAMETOOLONG");
});

it("combined relative paths remain normalizable beyond former limits", () => {
  for (const [cwd, relative] of [
    ["/" + Array(1500).fill("a").join("/"), Array(1000).fill("b").join("/")],
    ["/" + "a".repeat(40_000), "b".repeat(30_000)],
  ]) {
    const resolved = resolvePath(cwd!, relative!);
    expect(resolved).toBe(`${cwd}/${relative}`);
    expect(normalizePath(resolved)).toBe(resolved);
  }
});
