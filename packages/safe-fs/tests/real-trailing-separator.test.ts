import * as native from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fs, vol } from "memfs";
import { RealFileSystem } from "../src/fs/real/index.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    lstat: vi.fn(async (path: string, options?: { bigint?: boolean }) => {
      if (path.endsWith("/") && !(await fs.promises.stat(path)).isDirectory()) {
        throw Object.assign(new Error("not a directory"), { code: "ENOTDIR" });
      }
      return fs.promises.lstat(path, options);
    }),
    open: vi.fn(),
    mkdir: vi.fn(),
    copyFile: vi.fn()
  };
});

const data = new TextEncoder().encode("changed");
const operations = [
  ...(["w", "wx", "a", "ax"] as const).map((flag) => ({
    name: `writeFile ${flag}`, syscall: "open" as const,
    run: (filesystem: RealFileSystem, path: string) => filesystem.writeFile(path, data, { flag })
  })),
  {
    name: "appendFile", syscall: "open" as const,
    run: (filesystem: RealFileSystem, path: string) => filesystem.appendFile(path, data)
  },
  {
    name: "writeStream", syscall: "open" as const,
    run: (filesystem: RealFileSystem, path: string) => filesystem.writeStream(path, (async function* () { yield data; })())
  },
  ...[false, true].map((recursive) => ({
    name: `mkdir recursive=${recursive}`, syscall: "mkdir" as const,
    run: (filesystem: RealFileSystem, path: string) => filesystem.mkdir(path, { recursive })
  })),
  ...[false, true].map((exclusive) => ({
    name: `copyFile exclusive=${exclusive}`, syscall: "copyFile" as const,
    run: (filesystem: RealFileSystem, path: string) => filesystem.copyFile("/safe", path, { exclusive })
  }))
];

beforeEach(() => {
  vi.clearAllMocks();
  vol.reset();
  vol.fromJSON({
    "/machine/file": "original",
    "/machine/safe": "source",
    "/machine/dir/file": "nested",
    "/machine/dir/deep/keep": "keep",
    "/outside/secret": "outside"
  });
  fs.symlinkSync("file", "/machine/link");
  fs.symlinkSync("dir/deep", "/machine/dirlink");
  fs.symlinkSync("/outside", "/machine/escape");
  fs.symlinkSync("../outside", "/machine/relative-escape");
  fs.symlinkSync("loop", "/machine/loop");
});

describe.each(operations)("$name trailing separators", ({ run, syscall }) => {
  it.each(["EISDIR", "ENOTDIR", "EEXIST", "EACCES"])("preserves the final host syscall's %s without changing the tree", async (code) => {
    const filesystem = new RealFileSystem("/machine");
    const host = vi.mocked(native[syscall]);
    host.mockRejectedValue(Object.assign(new Error("host failure"), { code }));
    const before = vol.toJSON();
    for (const [path, resolved] of [
      ["/file/", "/machine/file/"],
      ["/file//", "/machine/file/"],
      ["/link/", "/machine/file/"],
      ["/dirlink/../file/", "/machine/dir/file/"]
    ]) {
      host.mockClear();
      await expect(run(filesystem, path!), path).rejects.toMatchObject({ code });
      expect(host, path).toHaveBeenCalledOnce();
      expect(host.mock.calls[0]?.[syscall === "copyFile" ? 1 : 0], path).toBe(resolved);
      expect(vol.toJSON(), path).toEqual(before);
    }
  });

  it("still rejects invalid traversal and escaping or looping links before any mutation syscall", async () => {
    const filesystem = new RealFileSystem("/machine");
    const before = vol.toJSON();
    for (const [path, code] of [
      ["/file/.", "ENOTDIR"],
      ["/file/..", "ENOTDIR"],
      ["/file/../new/", "ENOTDIR"],
      ["/file//child/", "ENOTDIR"],
      ["/escape/", "EACCES"],
      ["/escape/../file/", "EACCES"],
      ["/relative-escape/", "EACCES"],
      ["/loop/", "ELOOP"]
    ]) {
      await expect(run(filesystem, path!), path).rejects.toMatchObject({ code });
      expect(vol.toJSON(), path).toEqual(before);
    }
    expect(native.open).not.toHaveBeenCalled();
    expect(native.mkdir).not.toHaveBeenCalled();
    expect(native.copyFile).not.toHaveBeenCalled();
  });
});
