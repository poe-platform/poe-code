import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import {
  createFsBridge,
  FsError,
  MemoryFileSystem,
  MountFileSystem,
  OverlayFileSystem,
  ReadOnlyFileSystem
} from "../src/core.js";
import type { FileSystem, FsBridgeCodec } from "../src/core.js";
import { createNodeFsBridge } from "../src/node/filesystem.js";

const codec: FsBridgeCodec = {
  isEncoding: Buffer.isEncoding,
  encode(text, encoding) {
    return Buffer.from(text, encoding as BufferEncoding);
  },
  decode(bytes, encoding) {
    return Buffer.from(bytes).toString(encoding as BufferEncoding);
  }
};
type Bridge = ReturnType<typeof createNodeFsBridge> | ReturnType<typeof createFsBridge>;
const operations: ReadonlyArray<
  readonly [string, (bridge: Bridge, path: string) => Promise<unknown>]
> = [
  ["readFile", (bridge, path) => bridge.readFile(path)],
  ["writeFile", (bridge, path) => bridge.writeFile(path, "changed")],
  ["appendFile", (bridge, path) => bridge.appendFile(path, "changed")],
  ["stat", (bridge, path) => bridge.stat(path)],
  ["lstat", (bridge, path) => bridge.lstat(path)],
  ["readdir", (bridge, path) => bridge.readdir(path)],
  ["mkdir", (bridge, path) => bridge.mkdir(path, { recursive: true })],
  ["access", (bridge, path) => bridge.access(path)],
  ["rm", (bridge, path) => bridge.rm(path, { recursive: true, force: true })],
  ["rmdir", (bridge, path) => bridge.rmdir(path)],
  ["rename source", (bridge, path) => bridge.rename(path, "new")],
  ["rename destination", (bridge, path) => bridge.rename("file", path)],
  ["copyFile source", (bridge, path) => bridge.copyFile(path, "new")],
  ["copyFile destination", (bridge, path) => bridge.copyFile("file", path)],
  ["cp source", (bridge, path) => bridge.cp(path, "new", { recursive: true })],
  ["cp destination", (bridge, path) => bridge.cp("file", path)],
  ["readlink", (bridge, path) => bridge.readlink(path)],
  ["realpath", (bridge, path) => bridge.realpath(path)],
  ["mkdtemp", (bridge, path) => bridge.mkdtemp(path)],
  ["symlink path", (bridge, path) => bridge.symlink("file", path)],
  ["symlink target", (bridge, path) => bridge.symlink(path, "new-link")],
  ["link source", (bridge, path) => bridge.link(path, "new-link")],
  ["link destination", (bridge, path) => bridge.link("file", path)],
  ["chmod", (bridge, path) => bridge.chmod(path, 0o600)],
  ["utimes", (bridge, path) => bridge.utimes(path, 1, 2)],
  ["truncate", (bridge, path) => bridge.truncate(path)]
];

async function files() {
  const filesystem = new MemoryFileSystem();
  await filesystem.mkdir("/work/sub", { recursive: true });
  await filesystem.mkdir("/outside");
  await filesystem.mkdir("/work-sibling");
  for (const path of ["/work/file", "/outside/file", "/work-sibling/file"]) {
    await filesystem.writeFile(path, new TextEncoder().encode(path));
  }
  return filesystem;
}

describe.each([false, true])("bridge cwd confinement (node=%s)", (node) => {
  function bridge(filesystem: FileSystem, cwd = "/work", signal?: AbortSignal): Bridge {
    const options = { cwd, ...(signal === undefined ? {} : { signal }) };
    return node
      ? createNodeFsBridge(filesystem, options)
      : createFsBridge(filesystem, { codec, ...options });
  }

  it("checks the generated mkdtemp name before creating a root-prefix sibling", async () => {
    const filesystem = await files();
    const before = await filesystem.readdir("/");
    const mkdir = vi.spyOn(filesystem, "mkdir");
    await expect(bridge(filesystem).mkdtemp("/work")).rejects.toMatchObject({ code: "EACCES" });
    expect(mkdir).not.toHaveBeenCalled();
    expect(await filesystem.readdir("/")).toEqual(before);
  });

  it("preserves the trailing separator of a contained mkdtemp prefix", async () => {
    const filesystem = await files();
    const mkdir = vi.spyOn(filesystem, "mkdir");
    const created = await bridge(filesystem).mkdtemp("/work/");
    expect(typeof created).toBe("string");
    expect((created as string).startsWith("/work/")).toBe(true);
    expect(mkdir).toHaveBeenCalledTimes(1);
    expect(mkdir.mock.calls[0]?.[0]).toBe(created);
    expect((await filesystem.stat(created as string)).type).toBe("directory");
  });

  it.each(operations)(
    "denies %s outside both operands before any backing IO",
    async (_name, invoke) => {
      const filesystem = await files();
      const calls = [
        "readFile",
        "writeFile",
        "stat",
        "lstat",
        "readdir",
        "mkdir",
        "rm",
        "rename",
        "copyFile",
        "realpath",
        "access",
        "readlink",
        "symlink",
        "link",
        "chmod",
        "utimes",
        "truncate"
      ] as const;
      const spies = calls.map((method) => vi.spyOn(filesystem, method));
      try {
        for (const path of [
          "/outside/file",
          "../outside/file",
          "/work-sibling/file",
          "sub/../../outside/file",
          "/work/../work/file",
          "/outside/../work/file"
        ]) {
          await expect(invoke(bridge(filesystem), path)).rejects.toMatchObject({ code: "EACCES" });
          for (const spy of spies) expect(spy).not.toHaveBeenCalled();
        }
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
    }
  );

  it("keeps bounded absolute and normalized relative paths, shared writes and recursive creation", async () => {
    const filesystem = await files();
    const confined = bridge(filesystem, "/work//.");
    expect(await confined.readFile("/work/file", "utf8")).toBe("/work/file");
    expect(await confined.readFile("sub/.././file", "utf8")).toBe("/work/file");
    await confined.mkdir("new/deep", { recursive: true });
    await confined.writeFile("new/deep/file", "inside");
    expect(new TextDecoder().decode(await filesystem.readFile("/work/new/deep/file"))).toBe(
      "inside"
    );
    expect(await confined.realpath("new/../file")).toBe("/work/file");
    await expect(confined.readFile("/file")).rejects.toMatchObject({ code: "EACCES" });
  });

  it("keeps the default whole virtual root, without inventing a second virtual namespace", async () => {
    const filesystem = await files();
    const whole = node ? createNodeFsBridge(filesystem) : createFsBridge(filesystem, { codec });
    expect(await whole.readFile("/outside/file", "utf8")).toBe("/outside/file");
    expect(await bridge(filesystem, "/").readFile("work/../outside/file", "utf8")).toBe(
      "/outside/file"
    );
  });

  it("follows contained links but denies escaping, dangling and link-before-parent traversal", async () => {
    const filesystem = await files();
    await filesystem.symlink("/outside", "/work/escape");
    await filesystem.symlink("../outside/missing", "/work/dangling");
    await filesystem.symlink("/work", "/work/up");
    await filesystem.symlink("sub", "/work/inside");
    const confined = bridge(filesystem);
    const read = vi.spyOn(filesystem, "readFile");
    const write = vi.spyOn(filesystem, "writeFile");
    try {
      for (const path of ["escape/file", "escape/../file", "up/../outside/file", "dangling"]) {
        await expect(confined.readFile(path)).rejects.toMatchObject({ code: "EACCES" });
        await expect(confined.writeFile(path, "denied")).rejects.toMatchObject({ code: "EACCES" });
      }
      expect(read).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
      expect(await confined.readFile("inside/../file", "utf8")).toBe("/work/file");
      expect((await confined.lstat("escape")).isSymbolicLink()).toBe(true);
      expect(await confined.readlink("escape")).toBe("/outside");
      await confined.rm("escape");
      expect(new TextDecoder().decode(await filesystem.readFile("/outside/file"))).toBe(
        "/outside/file"
      );
      await confined.symlink("../file", "sub/relative");
      expect(await confined.readFile("sub/relative", "utf8")).toBe("/work/file");
      await expect(confined.symlink("../../outside/file", "sub/bad")).rejects.toMatchObject({
        code: "EACCES"
      });
    } finally {
      read.mockRestore();
      write.mockRestore();
    }
  });

  it("checks both resolved copy/rename/link operands before mutation", async () => {
    const filesystem = await files();
    await filesystem.symlink("/outside", "/work/link");
    const confined = bridge(filesystem);
    const mutations = [
      vi.spyOn(filesystem, "copyFile"),
      vi.spyOn(filesystem, "rename"),
      vi.spyOn(filesystem, "link")
    ];
    try {
      for (const invoke of [
        () => confined.copyFile("file", "link/new"),
        () => confined.rename("file", "link/new"),
        () => confined.link("file", "link/new")
      ]) {
        await expect(invoke()).rejects.toMatchObject({ code: "EACCES" });
      }
      for (const mutation of mutations) expect(mutation).not.toHaveBeenCalled();
    } finally {
      for (const mutation of mutations) mutation.mockRestore();
    }
  });

  it("refuses a symlink cwd rather than rebasing authority to its target", async () => {
    const filesystem = await files();
    await filesystem.symlink("/outside", "/alias");
    const read = vi.spyOn(filesystem, "readFile");
    try {
      await expect(bridge(filesystem, "/alias").readFile("file")).rejects.toMatchObject({
        code: "EACCES"
      });
      expect(read).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  });

  it("fails closed when link inspection or canonical paths cannot establish containment", async () => {
    const filesystem = await files();
    await filesystem.symlink("/outside/file", "/work/link");
    Object.defineProperty(filesystem, "readlink", { value: undefined });
    await expect(bridge(filesystem).readFile("link")).rejects.toMatchObject({ code: "ENOTSUP" });
    const other = await files();
    const canonical = vi.spyOn(other, "realpath").mockResolvedValue("/outside");
    const read = vi.spyOn(other, "readFile");
    try {
      await expect(bridge(other).readFile("file")).rejects.toMatchObject({ code: "EACCES" });
      expect(read).not.toHaveBeenCalled();
    } finally {
      canonical.mockRestore();
      read.mockRestore();
    }
  });

  it("keeps readonly, mounted and overlay adapters portable and confined", async () => {
    const lower = await files();
    const upper = new MemoryFileSystem();
    const overlay = new OverlayFileSystem({ lower, upper });
    const mounted = new MountFileSystem({
      root: new MemoryFileSystem(),
      mounts: { "/work": overlay }
    });
    const confined = bridge(mounted);
    expect(await confined.readFile("work/file", "utf8")).toBe("/work/file");
    await confined.writeFile("new", "upper");
    expect(new TextDecoder().decode(await upper.readFile("/new"))).toBe("upper");
    await expect(
      bridge(new ReadOnlyFileSystem(lower)).writeFile("file", "no")
    ).rejects.toMatchObject({ code: "EROFS" });
    await expect(confined.readFile("../outside/file")).rejects.toMatchObject({ code: "EACCES" });
  });

  it("keeps borrowed abort priority over a denied path with no backing IO", async () => {
    const filesystem = await files();
    const controller = new AbortController();
    const reason = { stop: true };
    controller.abort(reason);
    const stat = vi.spyOn(filesystem, "lstat");
    try {
      await expect(
        bridge(filesystem, "/work", controller.signal).readFile("../outside/file")
      ).rejects.toMatchObject({ name: "AbortError", code: "ABORT_ERR" });
      await expect(
        bridge(filesystem).writeFile("../outside/file", "no", { signal: controller.signal })
      ).rejects.toMatchObject({ code: "ABORT_ERR" });
      expect(stat).not.toHaveBeenCalled();
      expect(controller.signal.reason).toBe(reason);
    } finally {
      stat.mockRestore();
    }
  });

  it("treats backslashes as virtual filename characters, not parent separators", async () => {
    const filesystem = await files();
    const confined = bridge(filesystem);
    await confined.writeFile("..\\outside", "literal");
    expect(new TextDecoder().decode(await filesystem.readFile("/work/..\\outside"))).toBe(
      "literal"
    );
    expect(await confined.readFile("..\\outside", "utf8")).toBe("literal");
    await expect(confined.writeFile("/work\\..\\outside", "no")).rejects.toMatchObject({
      code: "EACCES"
    });
    await expect(confined.writeFile("../outside\\file", "no")).rejects.toMatchObject({
      code: "EACCES"
    });
    expect(new TextDecoder().decode(await filesystem.readFile("/outside/file"))).toBe(
      "/outside/file"
    );
  });

  it("enforces containment during readonly metadata operations", async () => {
    const filesystem = await files();
    await filesystem.symlink("/outside/file", "/work/escape");
    const confined = bridge(new ReadOnlyFileSystem(filesystem));
    expect((await confined.lstat("escape")).isSymbolicLink()).toBe(true);
    expect(await confined.readlink("escape")).toBe("/outside/file");
    expect(await confined.readdir(".")).toContain("escape");
    await expect(confined.stat("escape")).rejects.toMatchObject({ code: "EACCES" });
    await expect(confined.realpath("escape")).rejects.toMatchObject({ code: "EACCES" });
    await expect(confined.access("escape")).rejects.toMatchObject({ code: "EACCES" });
    await expect(confined.writeFile("file", "no")).rejects.toMatchObject({ code: "EROFS" });
  });

  it("does not let a capability flag waive actual symlink inspection", async () => {
    const filesystem = await files();
    await filesystem.symlink("/outside/file", "/work/escape");
    Object.defineProperty(filesystem, "capabilities", {
      value: { ...filesystem.capabilities, symlinks: false }
    });
    const read = vi.spyOn(filesystem, "readFile");
    try {
      await expect(bridge(filesystem).readFile("escape")).rejects.toMatchObject({ code: "EACCES" });
      expect(read).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  });

  it("keeps missing-parent, terminal-dot and symlink-loop failures without effects", async () => {
    const filesystem = await files();
    await filesystem.symlink("/outside", "/work/escape");
    await filesystem.symlink("cycle", "/work/cycle");
    const confined = bridge(filesystem);
    const write = vi.spyOn(filesystem, "writeFile");
    try {
      await expect(confined.writeFile("missing/../escape/file", "no")).rejects.toMatchObject({
        code: "ENOENT"
      });
      await expect(confined.writeFile("cycle", "no")).rejects.toMatchObject({ code: "ELOOP" });
      expect(write).not.toHaveBeenCalled();
      await expect(confined.rm("sub/..", { recursive: true })).rejects.toMatchObject({
        code: "EINVAL"
      });
      expect(await confined.readFile("file", "utf8")).toBe("/work/file");
      await expect(confined.stat("file/.")).rejects.toMatchObject({ code: "ENOTDIR" });
    } finally {
      write.mockRestore();
    }
  });

  it("refuses recursive creation of a missing ancestor outside the boundary without effects", async () => {
    const filesystem = new MemoryFileSystem();
    const confined = bridge(filesystem, "/new/root");
    const mkdir = vi.spyOn(filesystem, "mkdir");
    await expect(confined.mkdir("nested", { recursive: true })).rejects.toMatchObject({
      code: "EACCES"
    });
    expect(mkdir).not.toHaveBeenCalled();
    expect(await filesystem.readdir("/")).toEqual([]);
  });

  it("permits recursive creation inside a missing boundary only with a verified existing parent", async () => {
    const filesystem = new MemoryFileSystem();
    await filesystem.mkdir("/new");
    const confined = bridge(filesystem, "/new/root");
    expect(await confined.mkdir("nested", { recursive: true })).toBe("/new/root");
    await confined.writeFile("nested/file", "created");
    expect(await confined.readFile("nested/file", "utf8")).toBe("created");
  });

  it.each([false, true])(
    "fails closed on missing-boundary creation with unavailable canonical inspection (parent=%s)",
    async (parentExists) => {
      const filesystem = new MemoryFileSystem();
      if (parentExists) await filesystem.mkdir("/new");
      const realpath = vi
        .spyOn(filesystem, "realpath")
        .mockRejectedValue(new FsError("ENOTSUP", { syscall: "realpath" }));
      const mkdir = vi.spyOn(filesystem, "mkdir");
      await expect(
        bridge(filesystem, "/new/root").mkdir("nested", { recursive: true })
      ).rejects.toMatchObject({ code: parentExists ? "ENOTSUP" : "EACCES" });
      expect(mkdir).not.toHaveBeenCalled();
      if (parentExists) expect(realpath).toHaveBeenCalled();
      await expect(filesystem.stat("/new/root")).rejects.toMatchObject({ code: "ENOENT" });
      if (!parentExists) expect(await filesystem.readdir("/")).toEqual([]);
    }
  );

  it.each<readonly [string, (confined: Bridge) => Promise<unknown>]>([
    ["read file link", (confined) => confined.readFile("link", "utf8")],
    ["write file link", (confined) => confined.writeFile("link", "escaped")],
    ["copy source", (confined) => confined.copyFile("dir/file", "copy")],
    ["copy existing destination", (confined) => confined.copyFile("file", "dir/file")],
    ["copy missing destination", (confined) => confined.copyFile("file", "dir/new")],
    ["rename source", (confined) => confined.rename("dir/file", "moved")],
    ["rename existing destination", (confined) => confined.rename("file", "dir/file")],
    ["rename missing destination", (confined) => confined.rename("file", "dir/new")],
    ["hardlink source", (confined) => confined.link("dir/file", "hard")],
    ["hardlink destination", (confined) => confined.link("file", "dir/new")],
    ["symlink target", (confined) => confined.symlink("dir/file", "new-link")],
    ["symlink destination", (confined) => confined.symlink("file", "dir/new-link")],
    ["recursive directory", (confined) => confined.mkdir("dir/new/deep", { recursive: true })],
    ["metadata through directory link", (confined) => confined.lstat("dir/file")],
    ["remove through directory link", (confined) => confined.rm("dir/file")]
  ])("rejects mount-relative absolute target disagreement before %s", async (_name, invoke) => {
    const backend = new MemoryFileSystem();
    await backend.mkdir("/work");
    await backend.mkdir("/mnt/work", { recursive: true });
    await backend.writeFile("/work/file", new TextEncoder().encode("decoy"));
    await backend.writeFile("/mnt/work/file", new TextEncoder().encode("outside"));
    await backend.symlink("/mnt/work/file", "/work/link");
    await backend.symlink("/mnt/work", "/work/dir");
    const mounted = new MountFileSystem({
      root: new MemoryFileSystem(),
      mounts: { "/mnt": backend }
    });
    expect(await mounted.realpath("/mnt/work/link")).toBe("/mnt/mnt/work/file");
    const methods = [
      "readFile",
      "writeFile",
      "copyFile",
      "rename",
      "link",
      "symlink",
      "mkdir",
      "rm"
    ] as const;
    const effects = methods.map((method) => vi.spyOn(backend, method));
    const confined = bridge(mounted, "/mnt/work");
    await expect(invoke(confined)).rejects.toMatchObject({ code: "EACCES" });
    for (const effect of effects) expect(effect).not.toHaveBeenCalled();
    expect(new TextDecoder().decode(await backend.readFile("/work/file"))).toBe("decoy");
    expect(new TextDecoder().decode(await backend.readFile("/mnt/work/file"))).toBe("outside");
    await expect(backend.stat("/mnt/work/new")).rejects.toMatchObject({ code: "ENOENT" });
    expect((await confined.lstat("link")).isSymbolicLink()).toBe(true);
    expect(await confined.readlink("link")).toBe("/mnt/work/file");
  });

  it("keeps genuine contained mounted relative links and parent-checked creation", async () => {
    const backend = new MemoryFileSystem();
    await backend.mkdir("/work/sub", { recursive: true });
    await backend.writeFile("/work/file", new TextEncoder().encode("inside"));
    await backend.writeFile("/work/sub/new", new TextEncoder().encode("existing"));
    await backend.symlink("file", "/work/link");
    await backend.symlink("sub", "/work/dir");
    const mounted = new MountFileSystem({
      root: new MemoryFileSystem(),
      mounts: { "/mnt": backend }
    });
    const confined = bridge(mounted, "/mnt/work");
    expect(await confined.readFile("link", "utf8")).toBe("inside");
    await confined.copyFile("file", "dir/new");
    await confined.rename("dir/new", "dir/moved");
    expect(await confined.readFile("dir/moved", "utf8")).toBe("inside");
    await confined.mkdir("sub/deep/new", { recursive: true });
    expect((await backend.stat("/work/sub/deep/new")).type).toBe("directory");
  });

  it("rejects disagreement even when the adapter's different canonical target is still inside cwd", async () => {
    const backend = new MemoryFileSystem();
    await backend.mkdir("/work");
    await backend.mkdir("/mnt/work", { recursive: true });
    await backend.writeFile("/work/file", new TextEncoder().encode("decoy"));
    await backend.writeFile("/mnt/work/file", new TextEncoder().encode("different"));
    await backend.symlink("/mnt/work/file", "/work/link");
    const mounted = new MountFileSystem({
      root: new MemoryFileSystem(),
      mounts: { "/mnt": backend }
    });
    const read = vi.spyOn(backend, "readFile");
    await expect(bridge(mounted, "/mnt").readFile("work/link", "utf8")).rejects.toMatchObject({
      code: "EACCES"
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("does not infer canonical authority through an existing dangling link", async () => {
    const filesystem = await files();
    const confined = bridge(filesystem);
    await confined.symlink("missing/file", "dangling-inside");
    const write = vi.spyOn(filesystem, "writeFile");
    await expect(confined.writeFile("dangling-inside", "denied")).rejects.toMatchObject({
      code: "EACCES"
    });
    expect(write).not.toHaveBeenCalled();
    expect((await confined.lstat("dangling-inside")).isSymbolicLink()).toBe(true);
  });

  it("refuses confined absolute link creation after lexical checks without metadata or mutation", async () => {
    const filesystem = await files();
    const confined = bridge(filesystem);
    const symlink = vi.spyOn(filesystem, "symlink");
    const realpath = vi.spyOn(filesystem, "realpath");
    const lstat = vi.spyOn(filesystem, "lstat");
    for (const target of ["/work/file", "/work/missing"]) {
      await expect(confined.symlink(target, "absolute")).rejects.toMatchObject({ code: "ENOTSUP" });
    }
    await expect(confined.symlink("/outside/file", "outside-target")).rejects.toMatchObject({
      code: "EACCES"
    });
    await expect(confined.symlink("/work/file", "/outside/link")).rejects.toMatchObject({
      code: "EACCES"
    });
    expect(symlink).not.toHaveBeenCalled();
    expect(realpath).not.toHaveBeenCalled();
    expect(lstat).not.toHaveBeenCalled();
    await confined.symlink("file", "relative");
    expect(await confined.readlink("relative")).toBe("file");
    expect(await confined.readFile("relative", "utf8")).toBe("/work/file");
    await filesystem.symlink("/work/file", "/work/existing-absolute");
    expect(await confined.readFile("existing-absolute", "utf8")).toBe("/work/file");
  });

  it("does not create a mount-local absolute target outside cwd or rewrite whole-namespace targets", async () => {
    const backend = new MemoryFileSystem();
    await backend.mkdir("/work");
    await backend.mkdir("/mnt/work", { recursive: true });
    await backend.writeFile("/work/file", new TextEncoder().encode("decoy"));
    await backend.writeFile("/mnt/work/file", new TextEncoder().encode("outside"));
    const mounted = new MountFileSystem({
      root: new MemoryFileSystem(),
      mounts: { "/mnt": backend }
    });
    const symlink = vi.spyOn(backend, "symlink");
    await expect(
      bridge(mounted, "/mnt/work").symlink("/mnt/work/file", "new-link")
    ).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(symlink).not.toHaveBeenCalled();
    await expect(backend.lstat("/work/new-link")).rejects.toMatchObject({ code: "ENOENT" });
    const whole = node ? createNodeFsBridge(mounted) : createFsBridge(mounted, { codec });
    await whole.symlink("/mnt/work/file", "/mnt/work/default-link");
    expect(await whole.readlink("/mnt/work/default-link")).toBe("/mnt/work/file");
    expect(await whole.realpath("/mnt/work/default-link")).toBe("/mnt/mnt/work/file");
    expect(await whole.readFile("/mnt/work/default-link", "utf8")).toBe("outside");
  });

  it.each(["/work/file", "/outside/file"])(
    "retains cancellation priority over absolute target policy for %s",
    async (target) => {
      const filesystem = await files();
      const controller = new AbortController();
      controller.abort({ target });
      const symlink = vi.spyOn(filesystem, "symlink");
      const realpath = vi.spyOn(filesystem, "realpath");
      await expect(
        bridge(filesystem, "/work", controller.signal).symlink(target, "new-link")
      ).rejects.toMatchObject({ code: "ABORT_ERR" });
      expect(symlink).not.toHaveBeenCalled();
      expect(realpath).not.toHaveBeenCalled();
    }
  );

  it.each(["host", "operation"] as const)(
    "stops after held inspection when %s cancellation wins",
    async (origin) => {
      const filesystem = await files();
      const original = filesystem.lstat.bind(filesystem);
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const metadata = vi.spyOn(filesystem, "lstat").mockImplementation(async (path) => {
        enter();
        await held;
        return original(path);
      });
      const write = vi.spyOn(filesystem, "writeFile");
      const host = new AbortController();
      const operation = new AbortController();
      const added = vi.spyOn(host.signal, "addEventListener");
      const removed = vi.spyOn(host.signal, "removeEventListener");
      const reason = { origin };
      const result = expect(
        bridge(filesystem, "/work", host.signal).writeFile("file", "no", {
          signal: operation.signal
        })
      ).rejects.toMatchObject({ code: "ABORT_ERR" });
      try {
        await entered;
        (origin === "host" ? host : operation).abort(reason);
        await result;
        release();
        await metadata.mock.results[0]!.value;
        await Promise.resolve();
        expect(write).not.toHaveBeenCalled();
        expect((origin === "host" ? host : operation).signal.reason).toBe(reason);
        expect((origin === "host" ? operation : host).signal.aborted).toBe(false);
        expect(removed.mock.calls.length).toBe(added.mock.calls.length);
      } finally {
        release();
        await result;
        metadata.mockRestore();
        write.mockRestore();
        added.mockRestore();
        removed.mockRestore();
      }
    }
  );
});
