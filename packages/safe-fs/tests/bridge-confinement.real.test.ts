import { Buffer } from "node:buffer";
import { beforeEach, expect, it, vi } from "vitest";
import { fs, vol } from "memfs";
import { RealFileSystem } from "../src/fs/real/index.js";
import { createNodeFsBridge } from "../src/node/filesystem.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  const promises = {
    ...fs.promises,
    async rm(path: string, options?: import("node:fs").RmOptions) {
      const stat = await fs.promises.lstat(path);
      if (stat.isSymbolicLink()) return fs.promises.unlink(path);
      return fs.promises.rm(path, {
        force: options?.force ?? false,
        recursive: options?.recursive ?? false
      });
    }
  };
  return { ...promises, default: promises };
});
vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return { constants: fs.constants };
});

beforeEach(() => {
  vol.reset();
  vol.fromJSON({
    "/host/work/file": "inside",
    "/host/outside/file": "outside",
    "/outside-host/file": "host outside"
  });
});

it("confines a real adapter's symlinks to cwd as well as its host root (memfs)", async () => {
  await fs.promises.symlink("/host/outside", "/host/work/escape");
  await fs.promises.symlink("/host/outside/file", "/host/work/file-escape");
  await fs.promises.symlink("/outside-host", "/host/work/host-escape");
  const filesystem = new RealFileSystem({ root: "/host" });
  const bridge = createNodeFsBridge(filesystem, { cwd: "/work" });
  const read = vi.spyOn(filesystem, "readFile");
  const write = vi.spyOn(filesystem, "writeFile");
  try {
    for (const path of ["escape/file", "escape/new", "host-escape/file"]) {
      await expect(bridge.readFile(path)).rejects.toMatchObject({ code: "EACCES" });
      await expect(bridge.writeFile(path, "no")).rejects.toMatchObject({ code: "EACCES" });
    }
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect((await bridge.lstat("escape")).isSymbolicLink()).toBe(true);
    expect(await bridge.readlink("escape")).toBe("/outside");
    await bridge.rm("escape");
    await bridge.rm("file-escape");
    expect(await fs.promises.readFile("/host/outside/file", "utf8")).toBe("outside");
    expect(await fs.promises.readFile("/outside-host/file", "utf8")).toBe("host outside");
    await bridge.symlink("file", "inside");
    expect(await bridge.readFile("inside", "utf8")).toBe("inside");
  } finally {
    read.mockRestore();
    write.mockRestore();
  }
});

it("applies confinement after Buffer/file-URL conversion and preserves POSIX backslash filenames (memfs)", async () => {
  const filesystem = new RealFileSystem({ root: "/host" });
  const bridge = createNodeFsBridge(filesystem, { cwd: "/work" });
  expect(await bridge.readFile(Buffer.from("file"), "utf8")).toBe("inside");
  expect(await bridge.readFile(new URL("file:///work/file"), "utf8")).toBe("inside");
  const read = vi.spyOn(filesystem, "readFile");
  try {
    for (const path of [
      Buffer.from("../outside/file"),
      new URL("file:///outside/file"),
      new URL("file:///work%5c..%5coutside/file")
    ]) {
      await expect(bridge.readFile(path)).rejects.toMatchObject({ code: "EACCES" });
    }
    expect(read).not.toHaveBeenCalled();
  } finally {
    read.mockRestore();
  }
  await bridge.writeFile("..\\outside", "literal");
  expect(await fs.promises.readFile("/host/work/..\\outside", "utf8")).toBe("literal");
  expect(await bridge.readFile("..\\outside", "utf8")).toBe("literal");
  expect(await fs.promises.readFile("/host/outside/file", "utf8")).toBe("outside");
});
