import { describe, expect, it, vi } from "vitest";
import type { CapabilityQueryOptions, FileSystem } from "../src/contracts/filesystem.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { DeviceFileSystem } from "../src/fs/devices/index.js";
import { MountFileSystem } from "../src/fs/mount/index.js";
import { ReadOnlyFileSystem } from "../src/fs/readonly/index.js";
import { scopeFileSystem } from "../src/fs/scoped.js";
import { openRetainedResizeFile } from "../src/fs/capabilities.js";
import { withFileSystemQuota } from "../src/fs/quota/index.js";
import { pathNamespace } from "../src/fs/path-namespace.js";

function view(backing: FileSystem, overrides: { [Key in keyof FileSystem]?: FileSystem[Key] | undefined }): FileSystem {
  return new Proxy(backing, {
    get(target, property) {
      if (Object.hasOwn(overrides, property)) return Reflect.get(overrides, property);
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function fixture() {
  const memory = new MemoryFileSystem();
  for (const path of ["directory", "blocked", "readonly-parent"]) await memory.mkdir(`/${path}`);
  for (const path of ["file", "readonly-file", "blocked/child"]) await memory.writeFile(`/${path}`, Uint8Array.of(1, 2, 3));
  for (const [path, target] of [["link-file", "file"], ["link-directory", "directory"], ["dangling", "missing"], ["loop", "loop"], ["link-blocked", "blocked"]]) {
    await memory.symlink(target!, `/${path}`);
  }
  await memory.chmod("/blocked", 0);
  await memory.chmod("/readonly-parent", 0o555);
  await memory.chmod("/readonly-file", 0o444);
  return memory;
}

const matrix: readonly [string, readonly string[]][] = [
  ["missing", ["ENOENT", "OK", "ENOENT", "EISDIR", "ENOENT", "ENOENT", "ENOENT", "ENOENT"]],
  ["file", ["OK", "OK", "ENOTDIR", "EISDIR", "ENOTDIR", "ENOTDIR", "ENOTDIR", "ENOTDIR"]],
  ["directory", Array(8).fill("EISDIR")],
  ["link-file", ["OK", "OK", "ENOTDIR", "EISDIR", "ENOTDIR", "ENOTDIR", "ENOTDIR", "ENOTDIR"]],
  ["link-directory", Array(8).fill("EISDIR")],
  ["dangling", ["ENOENT", "OK", "ENOENT", "EISDIR", "ENOENT", "ENOENT", "ENOENT", "ENOENT"]],
  ["loop", ["ELOOP", "ELOOP", "ELOOP", "EISDIR", "ELOOP", "ELOOP", "ELOOP", "ELOOP"]],
  ["file/child", Array(8).fill("ENOTDIR")],
  ["no-parent/child", Array(8).fill("ENOENT")],
  ["link-file/child", Array(8).fill("ENOTDIR")],
  ["loop/child", Array(8).fill("ELOOP")],
  ["blocked", ["EISDIR", "EISDIR", "EISDIR", "EISDIR", "EACCES", "EACCES", "EACCES", "EACCES"]],
  ["blocked/child", Array(8).fill("EACCES")],
  ["readonly-parent/child", ["ENOENT", "EACCES", "ENOENT", "EISDIR", "ENOENT", "ENOENT", "ENOENT", "ENOENT"]],
  ["readonly-file", ["EACCES", "EACCES", "ENOTDIR", "EISDIR", "ENOTDIR", "ENOTDIR", "ENOTDIR", "ENOTDIR"]],
  ["link-blocked", ["EISDIR", "EISDIR", "EISDIR", "EISDIR", "EACCES", "EACCES", "EACCES", "EACCES"]],
];
const cases = matrix.flatMap(([path, outcomes]) => ["", "/", "/.", "/.."].flatMap((suffix, index) =>
  [false, true].map((create, offset) => ({ path: `/${path}${suffix}`, create, expected: outcomes[index * 2 + offset] })),
));
const routes: readonly [string, (memory: MemoryFileSystem) => FileSystem, boolean][] = [
  ["memory", memory => memory, false],
  ["devices", memory => new DeviceFileSystem(memory), false],
  ["helper-devices", memory => new DeviceFileSystem(memory), true],
  ["scoped-devices", memory => scopeFileSystem(new DeviceFileSystem(memory), () => {}, new AbortController().signal), false],
  ["mount-devices", memory => new MountFileSystem({ root: new DeviceFileSystem(memory) }), false],
  ["helper-mount", memory => new MountFileSystem({ root: new DeviceFileSystem(memory) }), true],
];

async function outcome(filesystem: FileSystem, path: string, create: boolean, helper = false) {
  try {
    const handle = await (helper ? openRetainedResizeFile(filesystem, path, { create }) : filesystem.openResizeFile!(path, { create }));
    try { await handle.truncate(0); } finally { await handle.close(); }
    return "OK";
  } catch (error) {
    return (error as { code?: string }).code ?? error;
  }
}

describe.each(routes)("%s resize path matrix", (_name, wrap, helper) => {
  it.each(cases)("$path create=$create -> $expected", async ({ path, create, expected }) => {
    const memory = await fixture();
    expect(await outcome(wrap(memory), path, create, helper)).toBe(expected);
  });

  it.each([
    ["file/", "ENOTDIR", "EISDIR"], ["missing/", "ENOENT", "EISDIR"], ["loop/", "ELOOP", "EISDIR"],
    ["file/child/", "ENOTDIR", "ENOTDIR"], ["blocked/child/", "EACCES", "EACCES"],
    ["readonly-parent/child/", "ENOENT", "EISDIR"],
    ["blocked/", "EISDIR", "EISDIR"],
  ])("preserves separators expanded from %s", async (target, existing, creation) => {
    for (const create of [false, true]) {
      const memory = await fixture();
      await memory.symlink(target, "/alias");
      expect(await outcome(wrap(memory), "/alias", create, helper)).toBe(create ? creation : existing);
    }
  });

  it("does not turn adjacent expanded separators into a search inside the final directory", async () => {
    const memory = await fixture();
    await memory.symlink("blocked/", "/alias");
    expect(await outcome(wrap(memory), "/alias//", false, helper)).toBe("EISDIR");
    expect(await outcome(wrap(memory), "/alias/.", false, helper)).toBe("EACCES");
  });
});

describe("creation intent policy", () => {
  it("does not reinterpret query options forwarded to generic lstat as an open", async () => {
    const devices = new DeviceFileSystem(await fixture());
    const options: CapabilityQueryOptions = { create: true };
    expect((await devices.lstat("/loop", options)).type).toBe("symlink");
    expect((await devices.lstat("/dangling", options)).type).toBe("symlink");
  });

  it.each([false, true])("readonly rejects intent %s without consulting metadata", async create => {
    const memory = await fixture();
    const query = vi.fn(async () => memory.capabilities);
    Object.defineProperty(memory, "capabilitiesFor", { value: query });
    const readonly = new ReadOnlyFileSystem(memory);
    await expect(readonly.capabilitiesFor("/missing/", { create })).rejects.toMatchObject({ code: "EROFS" });
    expect(query).not.toHaveBeenCalled();
  });

  it("generic memory queries remain non-resolving", async () => {
    const memory: FileSystem = await fixture();
    expect(await memory.capabilitiesFor?.("/no-parent/child") ?? memory.capabilities).toBe(memory.capabilities);
  });

  it.each([false, true])("readonly preserves falsey cancellation for intent %s", async create => {
    const readonly = new ReadOnlyFileSystem(await fixture());
    const controller = new AbortController();
    controller.abort(false);
    await expect(readonly.capabilitiesFor("/missing/", { create, signal: controller.signal })).rejects.toBe(false);
  });
});

describe.each(routes.filter(([name]) => name !== "memory"))("%s virtual device path admission", (_name, wrap, helper) => {
  it.each([false, true])("rejects virtual directories at admission with create=%s", async create => {
    const filesystem = wrap(await fixture());
    for (const path of ["/dev", "/dev/", "/dev/.", "/dev/.."]) {
      expect(await outcome(filesystem, path, create, helper)).toBe("EISDIR");
    }
    expect(await outcome(filesystem, "/dev/null/", create, helper)).toBe(create ? "EISDIR" : "ENOTDIR");
    expect(await outcome(filesystem, "/dev/null/.", create, helper)).toBe("ENOTDIR");
  });
});

describe.each([
  ["devices", (memory: FileSystem) => new DeviceFileSystem(memory)],
  ["mount", (memory: FileSystem) => new MountFileSystem({ root: memory })],
] as const)("%s capability admission", (_name, wrap) => {
  it("checks parent search even with permissions:false", async () => {
    const memory = await fixture();
    const open = vi.fn(memory.openResizeFile.bind(memory));
    const filesystem = wrap(view(memory, { capabilities: { ...memory.capabilities, permissions: false }, openResizeFile: open }));
    await expect(filesystem.capabilitiesFor("/blocked/child/", { create: true })).rejects.toMatchObject({ code: "EACCES" });
    expect(open).not.toHaveBeenCalled();
  });

  it("does not inspect a final loop before reporting a creation separator", async () => {
    const memory = await fixture();
    const lstat = vi.fn(memory.lstat.bind(memory));
    const readlink = vi.fn(memory.readlink.bind(memory));
    const open = vi.fn(memory.openResizeFile.bind(memory));
    const filesystem = wrap(view(memory, { lstat, readlink, openResizeFile: open }));
    await expect(filesystem.capabilitiesFor("/loop/", { create: true })).rejects.toMatchObject({ code: "EISDIR" });
    expect(lstat.mock.calls.some(([path]) => path === "/loop")).toBe(false);
    expect(readlink).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    await expect(filesystem.capabilitiesFor("/loop/")).rejects.toMatchObject({ code: "ELOOP" });
  });

  it.each([false, undefined])("does not grant missing-target support from a parent when selected support is %s", async retainedResize => {
    const memory = await fixture();
    const open = vi.fn(memory.openResizeFile.bind(memory));
    const query = vi.fn(async (path: string) => {
      const capabilities = { ...memory.capabilities };
      Reflect.set(capabilities, "retainedResize", path === "/" ? true : retainedResize);
      return capabilities;
    });
    const filesystem = wrap(view(memory, { capabilitiesFor: query, openResizeFile: open }));
    await expect(openRetainedResizeFile(filesystem, "/missing", { create: true })).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(query.mock.calls.every(([path]) => path === "/missing")).toBe(true);
    expect(open).not.toHaveBeenCalled();
    await expect(memory.stat("/missing")).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("mount dangling creation, independent of separators", () => {
  it.each([false, true])("keeps Device-over-Mount absolute dangling creation scoped with helper=%s", async helper => {
    const run = async (devices: boolean) => {
      const root = new MemoryFileSystem();
      await root.mkdir("/blocked");
      await root.chmod("/blocked", 0);
      const child = new MemoryFileSystem();
      await child.mkdir("/blocked");
      await child.symlink("/blocked/missing", "/alias");
      const mount = new MountFileSystem({ root, mounts: { "/mounted": child } });
      const filesystem = devices ? new DeviceFileSystem(mount) : mount;
      const result = await outcome(filesystem, "/mounted/alias", true, helper);
      const entries = await child.readdir("/blocked");
      const created = entries.length === 0 ? undefined : Array.from(await child.readFile("/blocked/missing"));
      const target = await child.readlink("/alias");
      await root.chmod("/blocked", 0o755);
      return { result, entries, created, target, rootEntries: await root.readdir("/blocked") };
    };
    const direct = await run(false);
    expect(direct).toEqual({ result: "OK", entries: [{ name: "missing", type: "file" }], created: [], target: "/blocked/missing", rootEntries: [] });
    expect(await run(true)).toEqual(direct);
  });

  it("does not reinterpret a mounted absolute null alias as the global virtual device", async () => {
    const run = async (devices: boolean) => {
      const root = new MemoryFileSystem();
      const child = new MemoryFileSystem();
      await child.mkdir("/dev");
      await child.writeFile("/dev/null", Uint8Array.of(1, 2, 3));
      await child.symlink("/dev/null", "/alias");
      const mount = new MountFileSystem({ root, mounts: { "/mounted": child } });
      const result = await outcome(devices ? new DeviceFileSystem(mount) : mount, "/mounted/alias", false, true);
      return { result, contents: Array.from(await child.readFile("/dev/null")), target: await child.readlink("/alias"), rootEntries: await root.readdir("/") };
    };
    const direct = await run(false);
    expect(direct).toEqual({ result: "OK", contents: [], target: "/dev/null", rootEntries: [] });
    expect(await run(true)).toEqual(direct);
  });

  it("does not turn a mount escape into virtual null acquisition", async () => {
    const root = new MemoryFileSystem();
    const child = new MemoryFileSystem();
    await child.symlink("../dev/null", "/alias");
    const mount = new MountFileSystem({ root, mounts: { "/mounted": child } });
    expect(await outcome(mount, "/mounted/alias", true, true)).toBe("EACCES");
    const devices = new DeviceFileSystem(mount);
    await expect(devices.openResizeFile("/mounted/alias", { create: true })).rejects.toMatchObject({ code: "EACCES" });
    expect(await child.readdir("/")).toEqual([{ name: "alias", type: "symlink" }]);
    expect(await root.readdir("/")).toEqual([]);
  });

  it.each(["missing", "/missing", "directory/missing"])("creates the pinned target of %s", async target => {
    const memory = await fixture();
    await memory.symlink(target, "/alias");
    const mount = new MountFileSystem({ root: memory });
    expect(await outcome(mount, "/alias", true)).toBe("OK");
    expect((await memory.lstat("/alias")).type).toBe("symlink");
    expect((await memory.stat(`/${target.startsWith("/") ? target.slice(1) : target}`)).size).toBe(0);
  });

  it("follows an intermediate alias to a missing leaf without creating ancestors", async () => {
    const memory = await fixture();
    await memory.symlink("directory", "/alias");
    const mount = new MountFileSystem({ root: memory });
    expect(await outcome(mount, "/alias/missing", true)).toBe("OK");
    expect((await memory.stat("/directory/missing")).size).toBe(0);
  });

  it("keeps absolute dangling targets inside their selected mount", async () => {
    const root = await fixture();
    const child = new MemoryFileSystem();
    await child.symlink("/missing", "/alias");
    const mount = new MountFileSystem({ root, mounts: { "/mounted": child } });
    expect(await outcome(mount, "/mounted/alias", true)).toBe("OK");
    expect((await child.stat("/missing")).size).toBe(0);
    await expect(root.stat("/missing")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["../missing", "../missing/"])("refuses escaping target %s before any acquisition", async target => {
    const root = await fixture();
    const child = new MemoryFileSystem();
    await child.symlink(target, "/alias");
    const mount = new MountFileSystem({ root, mounts: { "/mounted": child } });
    expect(await outcome(mount, "/mounted/alias", true)).toBe("EACCES");
    expect(await child.readdir("/")).toEqual([{ name: "alias", type: "symlink" }]);
    await expect(root.stat("/missing")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses inconsistent canonical parent inspection", async () => {
    const memory = await fixture();
    await memory.symlink("directory/missing", "/alias");
    const realpath = memory.realpath.bind(memory);
    const backing = new Proxy(memory, {
      get(target, property) {
        if (property === "realpath") return async (path: string) => path === "/directory" ? "/elsewhere" : realpath(path);
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const mount = new MountFileSystem({ root: backing });
    expect(await outcome(mount, "/alias", true)).toBe("ENOTSUP");
    await expect(memory.stat("/directory/missing")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a missing target replaced by a symlink during parent verification", async () => {
    const memory = await fixture();
    await memory.symlink("missing", "/alias");
    const open = vi.fn(memory.openResizeFile.bind(memory));
    const realpath = async (path: string) => {
      await memory.symlink("file", "/missing");
      return memory.realpath(path);
    };
    const mount = new MountFileSystem({ root: view(memory, { realpath, openResizeFile: open }) });
    expect(await outcome(mount, "/alias", true)).toBe("ENOTSUP");
    expect(open).not.toHaveBeenCalled();
    expect((await memory.stat("/file")).size).toBe(3);
  });
});

describe("Device namespace projection", () => {
  it("captures Mount's namespace selector rather than looking up a replacement callback", () => {
    const mount = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/mounted": new MemoryFileSystem() } });
    const projection = Reflect.get(mount, pathNamespace) as { select(path: string): string };
    const lateLookup = vi.fn(() => { throw new Error("late selector lookup"); });
    Object.defineProperty(mount, "select", { get: lateLookup });
    expect(projection.select("/mounted/alias")).toBe("/mounted");
    expect(lateLookup).not.toHaveBeenCalled();
  });

  it("preserves projected namespaces when Device and Mount come from separate module loads", async () => {
    const root = new MemoryFileSystem();
    await root.writeFile("/blocked", Uint8Array.of(9));
    const child = new MemoryFileSystem();
    await child.mkdir("/blocked");
    await child.writeFile("/blocked/file", Uint8Array.of(1, 2, 3));
    await child.symlink("/blocked/file", "/alias");
    const mount = new MountFileSystem({ root, mounts: { "/mounted": child } });
    vi.resetModules();
    const { DeviceFileSystem: ReloadedDeviceFileSystem } = await import("../src/fs/devices/index.js");
    const devices = new ReloadedDeviceFileSystem(mount);
    expect(await outcome(devices, "/mounted/alias", false, true)).toBe("OK");
    expect(await child.readFile("/blocked/file")).toEqual(new Uint8Array());
    expect(await root.readFile("/blocked")).toEqual(Uint8Array.of(9));
  });

  it("leaves original-backend admission authoritative after an alias changes during inspection", async () => {
    const root = new MemoryFileSystem();
    await root.mkdir("/directory");
    await root.symlink("directory/missing", "/alias");
    const nested = new MemoryFileSystem();
    let replaced = false;
    const readlink = async (path: string) => {
      const target = await root.readlink(path);
      if (path === "/alias" && !replaced) {
        replaced = true;
        await root.rm("/alias");
        await root.symlink("/nested/missing", "/alias");
      }
      return target;
    };
    const open = vi.fn(root.openResizeFile.bind(root));
    const mount = new MountFileSystem({ root: view(root, { readlink, openResizeFile: open }), mounts: { "/nested": nested } });
    expect(await outcome(new DeviceFileSystem(mount), "/alias", true, true)).toBe("EACCES");
    expect(open).not.toHaveBeenCalled();
    expect(await root.readdir("/directory")).toEqual([]);
    expect(await nested.readdir("/")).toEqual([]);
    expect(await root.readlink("/alias")).toBe("/nested/missing");
  });

  it("preserves missing-parent verification when the parent is replaced after projection", async () => {
    const memory = new MemoryFileSystem();
    await memory.mkdir("/directory");
    await memory.mkdir("/other");
    await memory.symlink("directory/missing", "/alias");
    let replaced = false;
    const realpath = async (path: string) => {
      if (!replaced && path === "/directory") {
        replaced = true;
        await memory.rename("/directory", "/moved");
        await memory.symlink("/other", "/directory");
      }
      return memory.realpath(path);
    };
    const open = vi.fn(memory.openResizeFile.bind(memory));
    const mount = new MountFileSystem({ root: view(memory, { realpath, openResizeFile: open }) });
    expect(await outcome(new DeviceFileSystem(mount), "/alias", true, true)).toBe("ENOTSUP");
    expect(replaced).toBe(true);
    expect(open).not.toHaveBeenCalled();
    expect(await memory.readdir("/other")).toEqual([]);
    expect(await memory.readdir("/moved")).toEqual([]);
  });

  it.each(["direct", "scoped", "quota", "devices", "readonly", "scoped-quota", "readonly-scoped"])("preserves namespace metadata and exact effects through %s", async wrapper => {
    const root = new MemoryFileSystem();
    await root.writeFile("/blocked", Uint8Array.of(9));
    const child = new MemoryFileSystem();
    await child.mkdir("/blocked");
    await child.writeFile("/blocked/file", Uint8Array.of(1, 2, 3));
    await child.symlink("/blocked/file", "/existing");
    await child.symlink("/blocked/missing", "/alias");
    const mount = new MountFileSystem({ root, mounts: { "/mounted": child } });
    const controller = new AbortController();
    let backing: FileSystem = mount;
    if (wrapper === "quota" || wrapper === "scoped-quota") backing = withFileSystemQuota(backing, { maxBytes: 256, maxScanEntries: 64 });
    if (wrapper === "scoped" || wrapper === "scoped-quota" || wrapper === "readonly-scoped") backing = scopeFileSystem(backing, () => {}, controller.signal);
    if (wrapper === "readonly" || wrapper === "readonly-scoped") backing = new ReadOnlyFileSystem(backing);
    if (wrapper === "devices") backing = new DeviceFileSystem(backing);
    const projection: unknown = Reflect.get(mount, pathNamespace);
    expect(Object.isFrozen(projection)).toBe(true);
    const forwarded = Reflect.get(backing, pathNamespace);
    if (wrapper.startsWith("readonly")) {
      expect(forwarded).not.toBe(projection);
      expect(Object.isFrozen(forwarded)).toBe(true);
      expect(Reflect.ownKeys(forwarded)).toEqual(["select"]);
      expect(forwarded.select("/mounted/existing")).toBe("/mounted");
    } else expect(forwarded).toBe(projection);
    const devices = new DeviceFileSystem(backing);
    expect(await devices.readFile("/mounted/existing")).toEqual(Uint8Array.of(1, 2, 3));
    expect((await devices.stat("/mounted/existing")).type).toBe("file");
    expect(await devices.readlink("/mounted/existing")).toBe("/blocked/file");
    expect((await devices.capabilitiesFor("/mounted/existing")).retainedResize).toBe(!wrapper.startsWith("readonly"));
    expect(await outcome(devices, "/mounted/alias", true, true)).toBe(wrapper.startsWith("readonly") ? "EROFS" : "OK");
    expect(await child.readdir("/blocked")).toEqual(wrapper.startsWith("readonly")
      ? [{ name: "file", type: "file" }]
      : [{ name: "file", type: "file" }, { name: "missing", type: "file" }]);
    if (!wrapper.startsWith("readonly")) expect(await child.readFile("/blocked/missing")).toEqual(new Uint8Array());
    expect(await root.readFile("/blocked")).toEqual(Uint8Array.of(9));
    expect(await child.readlink("/alias")).toBe("/blocked/missing");
  });

  it("uses the innermost flattened mount root without creating in either outer store", async () => {
    const root = new MemoryFileSystem();
    const middle = new MemoryFileSystem();
    const leaf = new MemoryFileSystem();
    await leaf.mkdir("/data");
    await leaf.symlink("/data/missing", "/alias");
    const inner = new MountFileSystem({ root: middle, mounts: { "/deep": leaf } });
    const mount = new MountFileSystem({ root, mounts: { "/mounted": inner } });
    const devices = new DeviceFileSystem(mount);
    expect(await outcome(devices, "/mounted/deep/alias", true, true)).toBe("OK");
    expect(await leaf.readFile("/data/missing")).toEqual(new Uint8Array());
    expect(await middle.readdir("/")).toEqual([]);
    expect(await root.readdir("/")).toEqual([]);
  });

  it.each(["nested/file", "nested/", "../outside", "../dev/null", "/nested/file"])("preserves mount confinement for expanded %s", async target => {
    const root = new MemoryFileSystem();
    const child = new MemoryFileSystem();
    await child.symlink(target, "/alias");
    const mount = new MountFileSystem({ root, mounts: { "/mounted": child, "/mounted/nested": child } });
    expect(await outcome(mount, "/mounted/alias", true, true)).toBe("EACCES");
    expect(await outcome(new DeviceFileSystem(mount), "/mounted/alias", true, true)).toBe("EACCES");
    expect(await child.readdir("/")).toEqual([{ name: "alias", type: "symlink" }]);
    expect(await root.readdir("/")).toEqual([]);
  });

  it("permits dotdot within a selected mount and preserves literal directory traversal", async () => {
    const child = new MemoryFileSystem();
    await child.mkdir("/directory");
    await child.mkdir("/data");
    await child.symlink("../data/missing", "/directory/alias");
    const mount = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/mounted": child } });
    const devices = new DeviceFileSystem(mount);
    expect(await outcome(devices, "/mounted/directory/alias", true, true)).toBe("OK");
    expect(await child.readFile("/data/missing")).toEqual(new Uint8Array());
    expect(await outcome(devices, "/mounted/directory/alias/..", true, true)).toBe("ENOTDIR");
  });

  it.each([false, true])("keeps missing mounted null targets ordinary with create=%s", async create => {
    const root = new MemoryFileSystem();
    const child = new MemoryFileSystem();
    await child.mkdir("/dev");
    await child.symlink("/dev/null", "/alias");
    const mount = new MountFileSystem({ root, mounts: { "/mounted": child } });
    const devices = new DeviceFileSystem(mount);
    expect(await outcome(devices, "/mounted/alias", create, true)).toBe(create ? "OK" : "ENOENT");
    expect(await child.readdir("/dev")).toEqual(create ? [{ name: "null", type: "file" }] : []);
    expect(await root.readdir("/")).toEqual([]);
  });

  it("preserves the global virtual null over a mounted shadow and through root aliases", async () => {
    const root = new MemoryFileSystem();
    const shadow = new MemoryFileSystem();
    await shadow.writeFile("/null", Uint8Array.of(7, 8, 9));
    await root.symlink("/dev/null", "/alias");
    const devices = new DeviceFileSystem(new MountFileSystem({ root, mounts: { "/dev": shadow } }));
    for (const path of ["/dev/null", "/alias"]) {
      const handle = await openRetainedResizeFile(devices, path, { create: false });
      expect(await handle.stat()).toMatchObject({ type: "character", size: 0, preferredIoBlockSize: 4096 });
      await expect(handle.truncate(0)).rejects.toMatchObject({ code: "EINVAL", syscall: "ftruncate" });
      await handle.close();
    }
    expect(await shadow.readFile("/null")).toEqual(Uint8Array.of(7, 8, 9));
    expect(await root.readdir("/")).toEqual([{ name: "alias", type: "symlink" }]);
  });

  it("does not impose mount-style root dotdot denial on an unprojected Memory store", async () => {
    const memory = new MemoryFileSystem();
    await memory.writeFile("/file", Uint8Array.of(1));
    await memory.symlink("../file", "/alias");
    expect(await outcome(new DeviceFileSystem(memory), "/alias", false, true)).toBe("OK");
    expect(await memory.readFile("/file")).toEqual(new Uint8Array());
  });
});
