import * as nodeFsPromises from "node:fs/promises";
import { resolve } from "node:path";
import { setImmediate as flushMicrotasks } from "node:timers/promises";
import {
  createMemoryFileSystem,
  createMountFileSystem,
  createOverlayFileSystem,
  createReadOnlyFileSystem,
  type FileSystem,
  FsError,
  MemoryFileSystem,
  MountFileSystem
} from "@poe-code/safe-fs";
import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dump } from "../dump.js";
import { readHostOperationPolicy } from "../interp/host-bridge.js";
import { restore } from "../restore.js";
import { run } from "../run.js";
import { makeFsModule, type FsImplementation, type FsModuleOptions } from "./fs.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

beforeEach(() => {
  vol.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("shared filesystem adapters", () => {
  it("shares one memory instance with direct callers and explicitly registered guests", async () => {
    const adapter = createMemoryFileSystem();
    await adapter.writeFile("/shared.txt", Buffer.from("from adapter"));
    const fs = makeFsModule({ adapter });

    await expect(fs.readFile("/shared.txt", "utf8")).resolves.toBe("from adapter");
    await fs.writeFile("/shared.txt", "from module");
    expect(Buffer.from(await adapter.readFile("/shared.txt")).toString()).toBe("from module");

    await expect(
      run(
        'import { readFile, appendFile } from "fs"; await appendFile("/shared.txt", " + guest"); return await readFile("/shared.txt", "utf8");',
        { modules: { fs } }
      )
    ).resolves.toMatchObject({ ok: true, returnValue: "from module + guest" });
    expect(Buffer.from(await adapter.readFile("/shared.txt")).toString()).toBe(
      "from module + guest"
    );
    await expect(
      run('import { readFile } from "fs"; return await readFile("/shared.txt", "utf8");')
    ).rejects.toThrow("Unknown module 'fs'. No modules are registered.");
    expect(vol.toJSON()).toEqual({});
  });

  it("resolves unrooted adapter paths from virtual /, never the host cwd", async () => {
    const adapter = createMemoryFileSystem();
    await adapter.writeFile("/shared.txt", Buffer.from("virtual"));
    vol.fromJSON({ [resolve("shared.txt")]: "host" });
    const hostRead = vi.spyOn(nodeFsPromises, "readFile");
    const fs = makeFsModule({ adapter });

    await expect(fs.readFile("shared.txt", "utf8")).resolves.toBe("virtual");
    await expect(fs.realpath("shared.txt")).resolves.toBe("/shared.txt");
    expect(hostRead).not.toHaveBeenCalled();
  });

  it("retains the default Node implementation and host-relative roots", async () => {
    const root = "safejs-adapter-default";
    const path = resolve(root, "input.txt");
    vol.fromJSON({ [path]: "node default" });

    await expect(makeFsModule().readFile(path, "utf8")).resolves.toBe("node default");
    await expect(makeFsModule({ root }).readFile("input.txt", "utf8")).resolves.toBe(
      "node default"
    );
    await expect(
      makeFsModule({ root, fs: nodeFsPromises }).readFile("input.txt", "utf8")
    ).resolves.toBe("node default");
  });

  it("rejects conflicting adapter and Node-shaped fs injection before any I/O", () => {
    const adapter = createMemoryFileSystem();
    const read = vi.spyOn(adapter, "readFile");

    expect(() =>
      makeFsModule({ adapter, fs: nodeFsPromises } as unknown as FsModuleOptions)
    ).toThrow("fs module accepts either adapter or fs, not both.");
    expect(read).not.toHaveBeenCalled();
    expect(vol.toJSON()).toEqual({});
  });

  it.each(["/project", "project"])(
    "interprets adapter root %s inside the adapter namespace",
    async (root) => {
      const adapter = createMemoryFileSystem();
      await adapter.mkdir("/project");
      await adapter.writeFile("/project/input.txt", Buffer.from("scoped"));
      const fs = makeFsModule({ adapter, root });

      await expect(fs.readFile("input.txt", "utf8")).resolves.toBe("scoped");
      await expect(fs.realpath("input.txt")).resolves.toBe("/project/input.txt");
      await fs.writeFile("output.txt", "created");
      expect(Buffer.from(await adapter.readFile("/project/output.txt")).toString()).toBe("created");
      expect((await fs.readdir(".", { withFileTypes: true }))[0].parentPath).toBe("/project");
    }
  );

  it.each(["", "   "])("rejects blank adapter roots before normalizing %j", (root) => {
    expect(() => makeFsModule({ adapter: createMemoryFileSystem(), root })).toThrow(
      "fs module root must be a non-empty string."
    );
  });

  it("denies traversal, absolute paths, escaping symlinks and two-path destinations", async () => {
    const adapter = createMemoryFileSystem();
    await adapter.mkdir("/project");
    await adapter.writeFile("/secret.txt", Buffer.from("secret"));
    await adapter.writeFile("/project/input.txt", Buffer.from("safe"));
    await adapter.symlink("/secret.txt", "/project/escape");
    await adapter.symlink("/outside/missing.txt", "/project/dangling");
    const fs = makeFsModule({ adapter, root: "/project" });

    for (const path of ["../secret.txt", "/secret.txt", "escape"]) {
      await expect(fs.readFile(path, "utf8")).rejects.toMatchObject({ code: "EACCES" });
    }
    await expect(fs.writeFile("dangling", "escaped")).rejects.toMatchObject({ code: "EACCES" });
    await expect(fs.copyFile("input.txt", "/copied.txt")).rejects.toMatchObject({
      code: "EACCES",
      syscall: "copyfile",
      path: "/project/input.txt",
      dest: "/copied.txt"
    });
    await expect(fs.rename("input.txt", "../moved.txt")).rejects.toMatchObject({
      code: "EACCES",
      syscall: "rename"
    });
    await expect(fs.link("../secret.txt", "hardlink")).rejects.toMatchObject({
      code: "EACCES",
      syscall: "link"
    });
    await expect(fs.symlink("../secret.txt", "new-link")).rejects.toMatchObject({
      code: "EACCES"
    });
    await expect(adapter.stat("/copied.txt")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(adapter.stat("/moved.txt")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(adapter.lstat("/project/new-link")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(adapter.lstat("/project/hardlink")).rejects.toMatchObject({ code: "ENOENT" });
    expect(Buffer.from(await adapter.readFile("/secret.txt")).toString()).toBe("secret");
    expect(Buffer.from(await adapter.readFile("/project/input.txt")).toString()).toBe("safe");
  });

  it("preserves relative symlink targets and allows links contained within the root", async () => {
    const adapter = createMemoryFileSystem();
    await adapter.mkdir("/project/nested", { recursive: true });
    await adapter.writeFile("/project/input.txt", Buffer.from("linked"));
    const fs = makeFsModule({ adapter, root: "/project" });

    await fs.symlink("../input.txt", "nested/link");
    await expect(adapter.readlink("/project/nested/link")).resolves.toBe("../input.txt");
    await expect(fs.readFile("nested/link", "utf8")).resolves.toBe("linked");
  });

  it("uses read-only wrappers without bypassing their mutation restrictions", async () => {
    const memory = createMemoryFileSystem();
    await memory.writeFile("/input.txt", Buffer.from("original"));
    const fs = makeFsModule({ adapter: createReadOnlyFileSystem(memory) });

    await expect(fs.readFile("/input.txt", "utf8")).resolves.toBe("original");
    await expect(fs.writeFile("/input.txt", "changed")).rejects.toMatchObject({ code: "EROFS" });
    expect(Buffer.from(await memory.readFile("/input.txt")).toString()).toBe("original");
  });

  it("uses overlay copy-on-write without changing its lower filesystem", async () => {
    const lower = createMemoryFileSystem();
    const upper = createMemoryFileSystem();
    await lower.writeFile("/input.txt", Buffer.from("lower"));
    const adapter = createOverlayFileSystem({ lower, upper });
    const fs = makeFsModule({ adapter });

    await expect(fs.readFile("/input.txt", "utf8")).resolves.toBe("lower");
    await fs.writeFile("/input.txt", "upper");
    expect(Buffer.from(await adapter.readFile("/input.txt")).toString()).toBe("upper");
    expect(Buffer.from(await upper.readFile("/input.txt")).toString()).toBe("upper");
    expect(Buffer.from(await lower.readFile("/input.txt")).toString()).toBe("lower");
  });

  it("confines a mounted namespace while sharing writes with the mounted instance", async () => {
    const root = createMemoryFileSystem();
    const mounted = createMemoryFileSystem();
    await root.writeFile("/outside.txt", Buffer.from("outside"));
    await mounted.writeFile("/input.txt", Buffer.from("mounted"));
    const adapter = createMountFileSystem({ root, mounts: { "/workspace": mounted } });
    const fs = makeFsModule({ adapter, root: "/workspace" });

    await expect(fs.readFile("input.txt", "utf8")).resolves.toBe("mounted");
    await fs.writeFile("output.txt", "shared");
    expect(Buffer.from(await mounted.readFile("/output.txt")).toString()).toBe("shared");
    await expect(fs.readFile("/outside.txt", "utf8")).rejects.toMatchObject({ code: "EACCES" });
  });

  it.each([undefined, "unknown"] as const)(
    "does not trust synthesized stat identities when comparison authority is %s",
    async (comparison) => {
      const memory = createMemoryFileSystem();
      await memory.mkdir("/project");
      await memory.writeFile("/project/input.txt", Buffer.from("allowed"));
      await memory.writeFile("/outside.txt", Buffer.from("denied"));
      const stat = memory.stat.bind(memory);
      vi.spyOn(memory, "stat").mockImplementation(async (...args) => ({
        ...(await stat(...args)),
        identityScope: undefined,
        dev: undefined,
        ino: undefined
      }));
      const adapter: FileSystem = new Proxy(memory, {
        get(target, property) {
          if (property === "compareEntry") {
            return comparison === undefined ? undefined : async () => comparison;
          }
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
      const fs = makeFsModule({ adapter, root: "/project" });

      await expect(fs.readFile("input.txt", "utf8")).resolves.toBe("allowed");
      await expect(fs.readFile("/outside.txt", "utf8")).rejects.toMatchObject({ code: "EACCES" });
      await expect(fs.writeFile("/escaped.txt", "denied")).rejects.toMatchObject({
        code: "EACCES"
      });
      await expect(memory.stat("/escaped.txt")).rejects.toMatchObject({ code: "ENOENT" });
    }
  );

  it("accepts authoritative directory aliases without granting unrelated paths", async () => {
    const memory = createMemoryFileSystem();
    await memory.mkdir("/project");
    await memory.writeFile("/project/input.txt", Buffer.from("aliased"));
    await memory.writeFile("/outside.txt", Buffer.from("outside"));
    const adapter = createMountFileSystem({
      root: createMemoryFileSystem(),
      mounts: { "/first": memory, "/second": memory }
    });
    const fs = makeFsModule({ adapter, root: "/first/project" });

    await expect(fs.readFile("/second/project/input.txt", "utf8")).resolves.toBe("aliased");
    await fs.writeFile("/second/project/output.txt", "shared");
    expect(Buffer.from(await memory.readFile("/project/output.txt")).toString()).toBe("shared");
    await expect(fs.readFile("/second/outside.txt", "utf8")).rejects.toMatchObject({
      code: "EACCES"
    });
  });

  it("propagates comparison errors and rejects invalid authority answers before effects", async () => {
    const adapter = createMemoryFileSystem();
    await adapter.mkdir("/project");
    const comparison = vi.spyOn(adapter, "compareEntry");
    const failure = new FsError("EIO", { syscall: "stat", path: "/project" });
    comparison.mockRejectedValueOnce(failure);
    const fs = makeFsModule({ adapter, root: "/project" });

    await expect(fs.writeFile("/outside.txt", "denied")).rejects.toBe(failure);
    comparison.mockResolvedValue("invalid" as "unknown");
    await expect(fs.writeFile("/outside.txt", "denied")).rejects.toMatchObject({ code: "EIO" });
    await expect(adapter.stat("/outside.txt")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves FsError metadata through host calls and sandbox error conversion", async () => {
    const adapter = createMemoryFileSystem();
    const failure = new FsError("EXDEV", {
      syscall: "copyfile",
      path: "/source.txt",
      dest: "/destination.txt"
    });
    vi.spyOn(adapter, "copyFile").mockRejectedValue(failure);
    const fs = makeFsModule({ adapter });

    await expect(fs.copyFile("/source.txt", "/destination.txt")).rejects.toBe(failure);
    await expect(
      run(
        'import { copyFile } from "fs"; try { await copyFile("/source.txt", "/destination.txt"); } catch (error) { return JSON.stringify({ code: error.code, errno: error.errno, syscall: error.syscall, path: error.path, dest: error.dest, message: error.message }); }',
        { modules: { fs } }
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: JSON.stringify({
        code: failure.code,
        errno: failure.errno,
        syscall: failure.syscall,
        path: failure.path,
        dest: failure.dest,
        message: failure.message
      })
    });
  });

  it("keeps stat and dirent sandbox conversions in SafeJS", async () => {
    const adapter = createMemoryFileSystem();
    await adapter.writeFile("/input.txt", Buffer.from("data"));
    const fs = makeFsModule({ adapter });

    await expect(
      run(
        'import { stat, readdir } from "fs"; const info = await stat("/input.txt"); const entries = await readdir("/", { withFileTypes: true }); return JSON.stringify([info.size, info.isFile(), typeof info.mtimeMs, typeof info.mtime, entries[0].name, entries[0].parentPath, entries[0].isFile()]);',
        { modules: { fs } }
      )
    ).resolves.toMatchObject({
      ok: true,
      returnValue: JSON.stringify([4, true, "number", "undefined", "input.txt", "/", true])
    });
  });

  it("rejects unsupported paths and options before calling the adapter", async () => {
    const adapter = createMemoryFileSystem();
    const read = vi.spyOn(adapter, "readFile");
    const copy = vi.spyOn(adapter, "copyFile");
    const fs = makeFsModule({ adapter, root: "/project" });
    const untyped = fs as unknown as FsImplementation;

    await expect(untyped.readFile("input.txt")).rejects.toThrow("cannot return a Buffer");
    await expect(untyped.readFile(42 as unknown as string, "utf8")).rejects.toMatchObject({
      code: "ERR_INVALID_ARG_TYPE"
    });
    await expect(untyped.readFile("bad\0path", "utf8")).rejects.toMatchObject({
      code: "ERR_INVALID_ARG_VALUE"
    });
    await expect(
      untyped.readFile("input.txt", { encoding: "utf8", signal: undefined })
    ).rejects.toThrow("cannot honour the 'signal' option");
    const unknownOptions = { encoding: "utf8" as const, unexpected: true };
    await expect(untyped.readFile("input.txt", unknownOptions)).rejects.toThrow(
      "cannot honour the 'unexpected' option"
    );
    await expect(untyped.stat("input.txt", { bigint: true })).rejects.toThrow(
      "cannot return BigInt fields"
    );
    await expect(untyped.cp("input.txt", "copy.txt", { filter: () => true })).rejects.toThrow(
      "cannot honour the 'filter' option"
    );
    await expect(untyped.cp("input.txt", "copy.txt", { dereference: true })).rejects.toThrow(
      "cannot honour the 'dereference' option"
    );
    expect(read).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
  });

  it("retains read re-issue and mutation reconciliation policies for every operation", () => {
    const fs = makeFsModule({ adapter: createMemoryFileSystem() });
    const reads = new Set([
      "access",
      "lstat",
      "readFile",
      "readdir",
      "readlink",
      "realpath",
      "stat"
    ]);

    for (const [name, operation] of Object.entries(fs)) {
      if (typeof operation === "function") {
        expect(readHostOperationPolicy(operation), name).toBe(
          reads.has(name) ? "re-issue" : "read-side-effect"
        );
      }
    }
  });

  it("requires reconciliation for a pending write instead of repeating its effect", async () => {
    const adapter = createMemoryFileSystem();
    const writeFile = adapter.writeFile.bind(adapter);
    let release!: () => void;
    const pending = new Promise<void>((resolvePending) => {
      release = resolvePending;
    });
    const write = vi.spyOn(adapter, "writeFile").mockImplementation(async (...args) => {
      await writeFile(...args);
      await pending;
    });
    const fs = makeFsModule({ adapter });
    const source =
      'import { writeFile } from "fs"; await writeFile("/effect.txt", "once"); return "done";';
    const first = run(source, { modules: { fs } });
    const settled = Promise.allSettled([first]);
    const checkpoint = dump(first);

    try {
      await flushMicrotasks();
      const snapshot = JSON.parse(await checkpoint);
      expect(write).toHaveBeenCalledTimes(1);
      expect(Buffer.from(await adapter.readFile("/effect.txt")).toString()).toBe("once");
      await expect(
        run(source, { modules: { fs }, snapshot: restore(snapshot, { source }) })
      ).rejects.toMatchObject({
        action: "external-reconciliation",
        name: "HostCallResumabilityError"
      });
      await expect(
        run(source, {
          modules: { fs },
          snapshot: restore(snapshot, { source }),
          hostCallResumeProvider: (request) => ({
            callId: request.callId,
            sourceHash: request.sourceHash,
            moduleId: request.moduleId,
            operation: request.operation,
            argumentDigest: request.argumentDigest,
            outcome: { status: "fulfilled", value: undefined }
          })
        })
      ).resolves.toMatchObject({ ok: true, returnValue: "done" });
      expect(write).toHaveBeenCalledTimes(1);
    } finally {
      release();
      expect(await settled).toMatchObject([
        { status: "fulfilled", value: { ok: true, returnValue: "done" } }
      ]);
    }
  });

  it("re-issues pending reads against the same adapter on restore", async () => {
    const adapter = createMemoryFileSystem();
    await adapter.writeFile("/input.txt", Buffer.from("original"));
    let release!: (value: Uint8Array) => void;
    const pending = new Promise<Uint8Array>((resolvePending) => {
      release = resolvePending;
    });
    const read = vi.spyOn(adapter, "readFile").mockImplementationOnce(() => pending);
    const fs = makeFsModule({ adapter });
    const source = 'import { readFile } from "fs"; return await readFile("/input.txt", "utf8");';
    const first = run(source, { modules: { fs } });
    const settled = Promise.allSettled([first]);
    const checkpoint = dump(first);

    try {
      await flushMicrotasks();
      const snapshot = JSON.parse(await checkpoint);
      expect(read).toHaveBeenCalledTimes(1);
      await adapter.writeFile("/input.txt", Buffer.from("updated"));
      await expect(
        run(source, { modules: { fs }, snapshot: restore(snapshot, { source }) })
      ).resolves.toMatchObject({ ok: true, returnValue: "updated" });
      expect(read).toHaveBeenCalledTimes(2);
    } finally {
      release(Buffer.from("original"));
      expect(await settled).toMatchObject([
        { status: "fulfilled", value: { ok: true, returnValue: "original" } }
      ]);
    }
  });
});

describe("adapter cwd and host signal", () => {
  it("control: preserves Node defaults and host-relative roots without new options", async () => {
    const root = "cwd-signal-node-control";
    vol.fromJSON({ [resolve(root, "input")]: "node" });
    await expect(makeFsModule().readFile(resolve(root, "input"), "utf8")).resolves.toBe("node");
    await expect(makeFsModule({ root }).readFile("input", "utf8")).resolves.toBe("node");
    await expect(
      makeFsModule({ root, fs: nodeFsPromises }).readFile("input", "utf8")
    ).resolves.toBe("node");
  });

  it("control: retains root-relative adapter paths when cwd is omitted", async () => {
    const adapter = createMemoryFileSystem();
    await adapter.mkdir("/project");
    await adapter.writeFile("/project/input", Buffer.from("root default"));
    await expect(
      makeFsModule({ adapter, root: "project" }).readFile("input", "utf8")
    ).resolves.toBe("root default");
  });

  it("confines unrooted adapter paths to virtual cwd without outside effects", async () => {
    const adapter = createMemoryFileSystem();
    await adapter.mkdir("/work");
    await adapter.writeFile("/work/input", Buffer.from("cwd"));
    await adapter.writeFile("/outside", Buffer.from("absolute"));
    const options = { adapter, cwd: "/work" };
    const fs = makeFsModule(options);
    await expect(fs.readFile("input", "utf8")).resolves.toBe("cwd");
    const read = vi.spyOn(adapter, "readFile");
    const write = vi.spyOn(adapter, "writeFile");
    await expect(fs.readFile("/outside", "utf8")).rejects.toMatchObject({ code: "EACCES" });
    await expect(fs.writeFile("../outside", "denied")).rejects.toMatchObject({ code: "EACCES" });
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(Buffer.from(await adapter.readFile("/outside")).toString()).toBe("absolute");
    await fs.writeFile("output", "relative write");
    expect(Buffer.from(await adapter.readFile("/work/output")).toString()).toBe("relative write");
    expect(vol.toJSON()).toEqual({});
  });

  it("denies unrooted symlink-before-parent escapes without backing data effects", async () => {
    const adapter = createMemoryFileSystem();
    await adapter.mkdir("/work");
    await adapter.mkdir("/other/deep", { recursive: true });
    await adapter.writeFile("/work/input", Buffer.from("lexical"));
    await adapter.writeFile("/other/input", Buffer.from("followed"));
    await adapter.symlink("/other/deep", "/work/link");
    const options = { adapter, cwd: "/work" };
    const read = vi.spyOn(adapter, "readFile");
    const write = vi.spyOn(adapter, "writeFile");
    const fs = makeFsModule(options);
    await expect(fs.readFile("link/../input", "utf8")).rejects.toMatchObject({ code: "EACCES" });
    await expect(fs.writeFile("link/../input", "denied")).rejects.toMatchObject({ code: "EACCES" });
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(Buffer.from(await adapter.readFile("/other/input")).toString()).toBe("followed");
  });

  it("uses adapter cwd through an explicitly registered guest module", async () => {
    const adapter = createMemoryFileSystem();
    await adapter.mkdir("/work");
    await adapter.writeFile("/work/input", Buffer.from("guest cwd"));
    const options = { adapter, cwd: "/work" };
    await expect(
      run('import * as fs from "fs"; return await fs.readFile("input", "utf8");', {
        modules: { fs: makeFsModule(options) }
      })
    ).resolves.toMatchObject({ ok: true, returnValue: "guest cwd" });
  });

  it("uses explicit cwd inside rooted normalization but keeps relative root anchored at virtual /", async () => {
    const adapter = createMemoryFileSystem();
    await adapter.mkdir("/project/work", { recursive: true });
    await adapter.writeFile("/project/work/input", Buffer.from("cwd"));
    await adapter.writeFile("/project/input", Buffer.from("root"));
    await adapter.writeFile("/outside", Buffer.from("outside"));
    const options = { adapter, root: "project", cwd: "/project/work" };
    const fs = makeFsModule(options);
    await expect(fs.readFile("input", "utf8")).resolves.toBe("cwd");
    await expect(fs.readFile("../input", "utf8")).resolves.toBe("root");
    await expect(fs.readFile("../../outside", "utf8")).rejects.toMatchObject({ code: "EACCES" });
    await expect(fs.rename("input", "../../outside")).rejects.toMatchObject({ code: "EACCES" });
    expect(Buffer.from(await adapter.readFile("/outside")).toString()).toBe("outside");
  });

  it("resolves a symlink link path from cwd, but its relative target from the link directory", async () => {
    const adapter = createMemoryFileSystem();
    await adapter.mkdir("/project/work", { recursive: true });
    await adapter.writeFile("/project/input", Buffer.from("target"));
    const options = { adapter, root: "/project", cwd: "/project/work" };
    const fs = makeFsModule(options);
    await fs.symlink("../input", "link");
    await expect(adapter.readlink("/project/work/link")).resolves.toBe("../input");
    await expect(fs.readFile("link", "utf8")).resolves.toBe("target");
  });

  it.each(["", "relative", "/bad\0cwd", null, 1, {}, true])(
    "rejects invalid adapter cwd %j before effects",
    (cwd) => {
      const adapter = createMemoryFileSystem();
      const realpath = vi.spyOn(adapter, "realpath");
      const stat = vi.spyOn(adapter, "stat");
      const options = { adapter, root: "/project", cwd: cwd as string };
      expect(() => makeFsModule(options)).toThrow(TypeError);
      expect(realpath).not.toHaveBeenCalled();
      expect(stat).not.toHaveBeenCalled();
      expect(vol.toJSON()).toEqual({});
    }
  );

  it("defaults unrooted adapter cwd to virtual slash without host cwd leakage", async () => {
    const adapter = createMemoryFileSystem();
    await adapter.writeFile("/input", Buffer.from("virtual root"));
    await expect(makeFsModule({ adapter }).readFile("input", "utf8")).resolves.toBe("virtual root");
  });

  it("does not turn cwd into the root boundary or reject absolute in-root paths", async () => {
    const adapter = createMemoryFileSystem();
    await adapter.mkdir("/project");
    await adapter.writeFile("/project/input", Buffer.from("inside"));
    const options = { adapter, root: "/project", cwd: "/elsewhere" };
    const fs = makeFsModule(options);
    await expect(fs.readFile("/project/input", "utf8")).resolves.toBe("inside");
    await expect(fs.writeFile("output", "denied")).rejects.toMatchObject({ code: "EACCES" });
  });

  it("keeps the host signal borrowed after success and confinement rejection", async () => {
    const adapter = createMemoryFileSystem();
    await adapter.mkdir("/project");
    const controller = new AbortController();
    const abort = vi.fn();
    controller.signal.addEventListener("abort", abort);
    const options = { adapter, root: "/project", signal: controller.signal };
    const fs = makeFsModule(options);
    await fs.writeFile("inside", "ok");
    await expect(fs.writeFile("/outside", "denied")).rejects.toMatchObject({ code: "EACCES" });
    expect(controller.signal.aborted).toBe(false);
    expect(abort).not.toHaveBeenCalled();
  });

  it("forwards the host signal through root canonicalization and missing-path probes", async () => {
    const adapter = createMemoryFileSystem();
    await adapter.mkdir("/project");
    const realpath = vi.spyOn(adapter, "realpath");
    const readlink = vi.spyOn(adapter, "readlink");
    const write = vi.spyOn(adapter, "writeFile");
    const controller = new AbortController();
    const options = { adapter, root: "/project", signal: controller.signal };
    await makeFsModule(options).writeFile("new", "ok");
    expect(realpath).toHaveBeenCalled();
    expect(readlink).toHaveBeenCalled();
    expect(realpath.mock.calls.every((call) => call[1]?.signal === controller.signal)).toBe(true);
    expect(readlink.mock.calls.every((call) => call[1]?.signal === controller.signal)).toBe(true);
    expect(write.mock.calls[0]?.[2]?.signal).toBe(controller.signal);
  });

  it.each(["realpath", "readlink"] as const)(
    "cancels a pending %s confinement probe without admitting a write",
    async (probe) => {
      const adapter = createMemoryFileSystem();
      await adapter.mkdir("/project");
      const controller = new AbortController();
      let admit!: () => void;
      let release!: (path: string) => void;
      const entered = new Promise<void>((resolveEntered) => {
        admit = resolveEntered;
      });
      const pending = new Promise<string>((resolvePending) => {
        release = resolvePending;
      });
      vi.spyOn(adapter, probe).mockImplementationOnce(() => {
        admit();
        return pending;
      });
      const write = vi.spyOn(adapter, "writeFile");
      const options = { adapter, root: "/project", signal: controller.signal };
      let settled = false;
      const outcome = makeFsModule(options)
        .writeFile("new", "denied")
        .then(
          (value) => {
            settled = true;
            return { value };
          },
          (error) => {
            settled = true;
            return { error };
          }
        );
      try {
        await entered;
        controller.abort();
        await flushMicrotasks();
        expect(settled).toBe(true);
        expect(await outcome).toMatchObject({ error: { name: "AbortError", code: "ABORT_ERR" } });
        expect(write).not.toHaveBeenCalled();
      } finally {
        release("/project");
        await outcome;
      }
    }
  );

  it.each(["default", "injected"])(
    "rejects cwd/signal in legacy %s Node mode rather than ignoring them",
    (mode) => {
      const node = mode === "injected" ? { fs: nodeFsPromises } : {};
      const options = { ...node, root: "/project", cwd: "/work" };
      expect(() => makeFsModule(options as unknown as FsModuleOptions)).toThrow();
      const signalOptions = { ...node, root: "/project", signal: new AbortController().signal };
      expect(() => makeFsModule(signalOptions as unknown as FsModuleOptions)).toThrow();
    }
  );

  it("forwards the borrowed signal and rejects pre-aborted writes before effects", async () => {
    const adapter = createMemoryFileSystem();
    await adapter.writeFile("/input", Buffer.from("read"));
    const read = vi.spyOn(adapter, "readFile");
    const write = vi.spyOn(adapter, "writeFile");
    const controller = new AbortController();
    const options = { adapter, signal: controller.signal };
    const fs = makeFsModule(options);
    await expect(fs.readFile("/input", "utf8")).resolves.toBe("read");
    expect(read.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    controller.abort();
    await expect(fs.writeFile("/output", "denied")).rejects.toMatchObject({
      name: "AbortError",
      code: "ABORT_ERR"
    });
    expect(write).not.toHaveBeenCalled();
  });

  it("propagates signal into rooted alias authority checks", async () => {
    const memory = createMemoryFileSystem();
    await memory.mkdir("/project");
    await memory.writeFile("/project/input", Buffer.from("alias"));
    const adapter = createMountFileSystem({
      root: createMemoryFileSystem(),
      mounts: { "/first": memory, "/second": memory }
    });
    const compare = vi.spyOn(adapter, "compareEntry");
    const controller = new AbortController();
    const options = { adapter, root: "/first/project", signal: controller.signal };
    await expect(makeFsModule(options).readFile("/second/project/input", "utf8")).resolves.toBe(
      "alias"
    );
    expect(compare).toHaveBeenCalled();
    expect(compare.mock.calls.every((call) => call[3]?.signal === controller.signal)).toBe(true);
  });

  it("retains bridge cancellation while an admitted read is still pending", async () => {
    const adapter = createMemoryFileSystem();
    const controller = new AbortController();
    let admit!: () => void;
    let release!: (bytes: Uint8Array) => void;
    const entered = new Promise<void>((resolveEntered) => {
      admit = resolveEntered;
    });
    const pending = new Promise<Uint8Array>((resolvePending) => {
      release = resolvePending;
    });
    vi.spyOn(adapter, "readFile").mockImplementationOnce(() => {
      admit();
      return pending;
    });
    const options = { adapter, signal: controller.signal };
    let settled = false;
    const outcome = makeFsModule(options)
      .readFile("/pending", "utf8")
      .then(
        (value) => {
          settled = true;
          return { value };
        },
        (error) => {
          settled = true;
          return { error };
        }
      );
    try {
      await entered;
      controller.abort();
      await flushMicrotasks();
      expect(settled).toBe(true);
      expect(await outcome).toMatchObject({ error: { name: "AbortError", code: "ABORT_ERR" } });
    } finally {
      release(Buffer.from("late completion"));
      await outcome;
    }
  });

  it.each(["ENOENT", "ENOTDIR"] as const)(
    "does not swallow %s-shaped abort during authority resolution or write after cancellation",
    async (code) => {
      const adapter = createMemoryFileSystem();
      await adapter.mkdir("/project");
      const controller = new AbortController();
      const reason = new FsError(code, { message: "host cancelled" });
      const compare = vi.spyOn(adapter, "compareEntry");
      compare.mockImplementationOnce(() => {
        controller.abort(reason);
        throw reason;
      });
      compare.mockResolvedValue("same");
      const write = vi.spyOn(adapter, "writeFile");
      const options = { adapter, root: "/project", signal: controller.signal };
      await expect(makeFsModule(options).writeFile("/outside", "denied")).rejects.toBe(reason);
      expect(compare).toHaveBeenCalledTimes(1);
      expect(write).not.toHaveBeenCalled();
    }
  );

  it("cancels a pending authority wait without admitting the protected write", async () => {
    const adapter = createMemoryFileSystem();
    await adapter.mkdir("/project");
    const controller = new AbortController();
    let admit!: () => void;
    let release!: (comparison: "same") => void;
    const entered = new Promise<void>((resolveEntered) => {
      admit = resolveEntered;
    });
    const pending = new Promise<"same">((resolvePending) => {
      release = resolvePending;
    });
    vi.spyOn(adapter, "compareEntry").mockImplementationOnce(() => {
      admit();
      return pending;
    });
    const write = vi.spyOn(adapter, "writeFile");
    const options = { adapter, root: "/project", signal: controller.signal };
    let settled = false;
    const outcome = makeFsModule(options)
      .writeFile("/outside", "denied")
      .then(
        (value) => {
          settled = true;
          return { value };
        },
        (error) => {
          settled = true;
          return { error };
        }
      );
    try {
      await entered;
      controller.abort();
      await flushMicrotasks();
      expect(settled).toBe(true);
      expect(await outcome).toMatchObject({ error: { name: "AbortError" } });
      expect(write).not.toHaveBeenCalled();
    } finally {
      release("same");
      await outcome;
    }
  });

  it("detaches authority abort listeners and observes late rejection after cancellation", async () => {
    const adapter = createMemoryFileSystem();
    await adapter.mkdir("/project");
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    let admit!: () => void;
    let rejectPending!: (error: Error) => void;
    const entered = new Promise<void>((resolveEntered) => {
      admit = resolveEntered;
    });
    const pending = new Promise<"same">((_, reject) => {
      rejectPending = reject;
    });
    vi.spyOn(adapter, "compareEntry").mockImplementationOnce(() => {
      admit();
      return pending;
    });
    const options = { adapter, root: "/project", signal: controller.signal };
    const outcome = makeFsModule(options)
      .writeFile("/outside", "denied")
      .catch((error) => error);
    await entered;
    controller.abort();
    await flushMicrotasks();
    rejectPending(new FsError("EIO", { message: "late backend failure" }));
    await expect(outcome).resolves.toMatchObject({ name: "AbortError" });
    await flushMicrotasks();
    expect(add.mock.calls.length).toBeGreaterThan(0);
    expect(remove.mock.calls.map((call) => call[1])).toEqual(
      expect.arrayContaining(add.mock.calls.map((call) => call[1]))
    );
  });
});

it("preserves legacy Node-shaped recursive mkdir and absolute symlink behavior", async () => {
  const fs = makeFsModule({ root: "/legacy/new" });
  await fs.mkdir("nested", { recursive: true });
  expect(vol.existsSync("/legacy/new/nested")).toBe(true);
  await fs.writeFile("input", "legacy");
  await fs.symlink("/legacy/new/input", "absolute");
  expect(await fs.readlink("absolute")).toBe("/legacy/new/input");
  expect(await fs.readFile("absolute", "utf8")).toBe("legacy");
});

type TestedFsModule = ReturnType<typeof makeFsModule>;

const rootedOperations: readonly {
  operation: Exclude<keyof TestedFsModule, "constants">;
  operand: string;
  inside: string;
  call(fs: TestedFsModule, path: string): Promise<unknown>;
}[] = [
  { operation: "access", operand: "path", inside: "input", call: (fs, path) => fs.access(path) },
  {
    operation: "appendFile",
    operand: "path",
    inside: "input",
    call: (fs, path) => fs.appendFile(path, "added")
  },
  {
    operation: "chmod",
    operand: "path",
    inside: "input",
    call: (fs, path) => fs.chmod(path, 0o600)
  },
  {
    operation: "copyFile",
    operand: "source",
    inside: "input",
    call: (fs, path) => fs.copyFile(path, "/project/output")
  },
  {
    operation: "copyFile",
    operand: "destination",
    inside: "output",
    call: (fs, path) => fs.copyFile("/project/input", path)
  },
  {
    operation: "cp",
    operand: "source",
    inside: "input",
    call: (fs, path) => fs.cp(path, "/project/output")
  },
  {
    operation: "cp",
    operand: "destination",
    inside: "output",
    call: (fs, path) => fs.cp("/project/input", path)
  },
  {
    operation: "link",
    operand: "source",
    inside: "input",
    call: (fs, path) => fs.link(path, "/project/hardlink")
  },
  {
    operation: "link",
    operand: "destination",
    inside: "hardlink",
    call: (fs, path) => fs.link("/project/input", path)
  },
  { operation: "lstat", operand: "path", inside: "input", call: (fs, path) => fs.lstat(path) },
  { operation: "mkdir", operand: "path", inside: "new", call: (fs, path) => fs.mkdir(path) },
  {
    operation: "mkdtemp",
    operand: "prefix",
    inside: "prefix-",
    call: (fs, path) => fs.mkdtemp(path)
  },
  {
    operation: "readFile",
    operand: "path",
    inside: "input",
    call: (fs, path) => fs.readFile(path, "utf8")
  },
  { operation: "readdir", operand: "path", inside: "empty", call: (fs, path) => fs.readdir(path) },
  { operation: "readlink", operand: "path", inside: "link", call: (fs, path) => fs.readlink(path) },
  {
    operation: "realpath",
    operand: "path",
    inside: "input",
    call: (fs, path) => fs.realpath(path)
  },
  {
    operation: "rename",
    operand: "source",
    inside: "input",
    call: (fs, path) => fs.rename(path, "/project/output")
  },
  {
    operation: "rename",
    operand: "destination",
    inside: "output",
    call: (fs, path) => fs.rename("/project/input", path)
  },
  { operation: "rm", operand: "path", inside: "input", call: (fs, path) => fs.rm(path) },
  { operation: "rmdir", operand: "path", inside: "empty", call: (fs, path) => fs.rmdir(path) },
  { operation: "stat", operand: "path", inside: "input", call: (fs, path) => fs.stat(path) },
  {
    operation: "symlink",
    operand: "target",
    inside: "input",
    call: (fs, path) => fs.symlink(path, "/project/new-link")
  },
  {
    operation: "symlink",
    operand: "link",
    inside: "new-link",
    call: (fs, path) => fs.symlink("input", path)
  },
  {
    operation: "truncate",
    operand: "path",
    inside: "input",
    call: (fs, path) => fs.truncate(path, 1)
  },
  {
    operation: "utimes",
    operand: "path",
    inside: "input",
    call: (fs, path) => fs.utimes(path, 1, 2)
  },
  {
    operation: "writeFile",
    operand: "path",
    inside: "input",
    call: (fs, path) => fs.writeFile(path, "changed")
  }
];

describe("explicit adapter root confinement", () => {
  const facade = "Node";
  const createModule = makeFsModule;

  it(`${facade} resolves a new relative symlink against its actual destination parent`, async () => {
    const adapter = new MemoryFileSystem();
    await adapter.mkdir("/work/deep", { recursive: true });
    await adapter.mkdir("/outside/deep", { recursive: true });
    const fs = createModule({ adapter, root: "/work", cwd: "/work" });
    await fs.symlink("..", "deep/up");
    const symlink = vi.spyOn(adapter, "symlink");
    await expect(fs.symlink("../../outside/deep", "deep/up/sub")).rejects.toMatchObject({
      code: "EACCES"
    });
    expect(symlink).not.toHaveBeenCalled();
    await expect(adapter.lstat("/work/sub")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await adapter.readdir("/outside")).toMatchObject([{ name: "deep" }]);
  });

  it.each(["writeFile", "copyFile"] as const)(
    `${facade} %s refuses an existing dangling link without collapsing symlink-before-parent traversal`,
    async (operation) => {
      const adapter = new MemoryFileSystem();
      await adapter.mkdir("/work/deep", { recursive: true });
      await adapter.mkdir("/outside/deep", { recursive: true });
      await adapter.writeFile("/work/input", new TextEncoder().encode("ESCAPED"));
      await adapter.symlink("..", "/work/deep/up");
      await adapter.symlink("../../outside/deep", "/work/deep/up/sub");
      await adapter.symlink("sub/../new", "/work/link");
      const write = vi.spyOn(adapter, "writeFile");
      const copy = vi.spyOn(adapter, "copyFile");
      const fs = createModule({ adapter, root: "/work", cwd: "/work" });
      await expect(
        operation === "writeFile" ? fs.writeFile("link", "ESCAPED") : fs.copyFile("input", "link")
      ).rejects.toMatchObject({ code: "EACCES" });
      expect(write).not.toHaveBeenCalled();
      expect(copy).not.toHaveBeenCalled();
      await expect(adapter.lstat("/outside/new")).rejects.toMatchObject({ code: "ENOENT" });
      await expect(adapter.lstat("/work/new")).rejects.toMatchObject({ code: "ENOENT" });
    }
  );

  it(`${facade} preserves contained dangling-link traversal and destination-parent aliases`, async () => {
    const adapter = new MemoryFileSystem();
    await adapter.mkdir("/work/deep/sub", { recursive: true });
    await adapter.writeFile("/work/input", new TextEncoder().encode("inside"));
    await adapter.symlink("deep/sub", "/work/sub");
    await adapter.symlink("sub/../new", "/work/link");
    const fs = createModule({ adapter, root: "/work", cwd: "/work" });
    await fs.writeFile("link", "contained");
    expect(new TextDecoder().decode(await adapter.readFile("/work/deep/new"))).toBe("contained");
    await expect(adapter.lstat("/work/new")).rejects.toMatchObject({ code: "ENOENT" });
    await fs.symlink("..", "deep/up");
    await fs.symlink("input", "deep/up/relative");
    expect(await adapter.readlink("/work/relative")).toBe("input");
    expect(await fs.readFile("relative", "utf8")).toBe("inside");
  });

  it(`${facade} rejects a root-equal mkdtemp prefix before generating an outside sibling`, async () => {
    const adapter = new MemoryFileSystem();
    await adapter.mkdir("/work");
    const mkdir = vi.spyOn(adapter, "mkdir");
    const fs = createModule({ adapter, root: "/work", cwd: "/work" });
    await expect(fs.mkdtemp("/work")).rejects.toMatchObject({ code: "EACCES" });
    expect(mkdir).not.toHaveBeenCalled();
    expect((await adapter.readdir("/")).map((entry) => entry.name)).toEqual(["work"]);
  });

  it.each(["/work/", "/work/.", "./", "tmp-"])(
    `${facade} preserves mkdtemp prefix semantics for %s and contains the actual allocation`,
    async (prefix) => {
      const adapter = new MemoryFileSystem();
      await adapter.mkdir("/work");
      const mkdir = vi.spyOn(adapter, "mkdir");
      const fs = createModule({ adapter, root: "/work", cwd: "/work" });
      const created = await fs.mkdtemp(prefix);
      expect(created.startsWith("/work/")).toBe(true);
      if (prefix === "/work/.") expect(created.startsWith("/work/.")).toBe(true);
      if (prefix === "tmp-") expect(created.startsWith("/work/tmp-")).toBe(true);
      expect(mkdir).toHaveBeenCalledTimes(1);
      expect(mkdir.mock.calls[0]?.[0]).toBe(created);
      expect((await adapter.stat(created)).type).toBe("directory");
      expect((await adapter.readdir("/")).map((entry) => entry.name)).toEqual(["work"]);
    }
  );

  it(`${facade} explicit root cannot recursively create a missing outside ancestor`, async () => {
    const adapter = new MemoryFileSystem();
    const mkdir = vi.spyOn(adapter, "mkdir");
    const fs = createModule({ adapter, root: "/new/root", cwd: "/new/root" });
    await expect(fs.mkdir("nested", { recursive: true })).rejects.toMatchObject({ code: "EACCES" });
    expect(mkdir).not.toHaveBeenCalled();
    expect(await adapter.readdir("/")).toEqual([]);
  });

  it(`${facade} creates a missing root beneath an existing parent and recursively creates only contained directories`, async () => {
    const adapter = new MemoryFileSystem();
    await adapter.mkdir("/new");
    const fs = createModule({ adapter, root: "/new/root", cwd: "/new/root" });
    expect(await fs.mkdir("nested", { recursive: true })).toBe("/new/root");
    expect((await adapter.stat("/new/root/nested")).type).toBe("directory");
    expect(await fs.mkdir("nested/deep/inside", { recursive: true })).toBe("/new/root/nested/deep");
    expect((await adapter.stat("/new/root/nested/deep/inside")).type).toBe("directory");
    expect((await adapter.readdir("/")).map((entry) => entry.name)).toEqual(["new"]);
  });

  it(`${facade} refuses recursive mkdir when canonical parent inspection is unsupported`, async () => {
    const adapter = new MemoryFileSystem();
    await adapter.mkdir("/project/work", { recursive: true });
    const original = adapter.realpath.bind(adapter);
    const failure = new FsError("ENOTSUP", { syscall: "realpath", path: "/" });
    const realpath = vi.spyOn(adapter, "realpath").mockImplementation(async (path, options) => {
      if (path === "/") throw failure;
      return original(path, options);
    });
    const mkdir = vi.spyOn(adapter, "mkdir");
    const fs = createModule({ adapter, root: "/project", cwd: "/project/work" });
    await expect(fs.mkdir("new/deep", { recursive: true })).rejects.toBe(failure);
    expect(realpath).toHaveBeenCalledWith("/", expect.any(Object));
    expect(mkdir).not.toHaveBeenCalled();
    await expect(adapter.stat("/project/work/new")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["/project", "/"])(
    `${facade} adapter root %s refuses absolute link creation but preserves relative and existing targets`,
    async (root) => {
      const adapter = new MemoryFileSystem();
      await adapter.mkdir("/project/work", { recursive: true });
      await adapter.mkdir("/outside");
      await adapter.writeFile("/project/input", new TextEncoder().encode("inside"));
      await adapter.symlink("/project/input", "/project/existing-absolute");
      const symlink = vi.spyOn(adapter, "symlink");
      const fs = createModule({ adapter, root, cwd: "/project/work" });
      for (const target of ["/project/input", "/project/missing"]) {
        await expect(fs.symlink(target, "absolute")).rejects.toMatchObject({ code: "ENOTSUP" });
      }
      if (root !== "/") {
        await expect(fs.symlink("/outside/input", "outside-target")).rejects.toMatchObject({
          code: "EACCES"
        });
        await expect(fs.symlink("/project/input", "/outside/link")).rejects.toMatchObject({
          code: "EACCES"
        });
      }
      expect(symlink).not.toHaveBeenCalled();
      await fs.symlink("../input", "relative");
      expect(await adapter.readlink("/project/work/relative")).toBe("../input");
      expect(await fs.readFile("relative", "utf8")).toBe("inside");
      expect(await fs.readFile("/project/existing-absolute", "utf8")).toBe("inside");
      const unrooted = createModule({ adapter });
      await unrooted.symlink("/project/input", "/project/default-absolute");
      expect(await unrooted.readlink("/project/default-absolute")).toBe("/project/input");
      expect(await unrooted.readFile("/project/default-absolute", "utf8")).toBe("inside");
    }
  );

  it.each(["/project/input", "/outside/input"])(
    `${facade} cancellation precedes absolute target rejection for %s`,
    async (target) => {
      const adapter = new MemoryFileSystem();
      await adapter.mkdir("/project");
      const controller = new AbortController();
      controller.abort({ target });
      const symlink = vi.spyOn(adapter, "symlink");
      const realpath = vi.spyOn(adapter, "realpath");
      const fs = createModule({ adapter, root: "/project", signal: controller.signal });
      await expect(fs.symlink(target, "new-link")).rejects.toMatchObject({ code: "ABORT_ERR" });
      expect(symlink).not.toHaveBeenCalled();
      expect(realpath).not.toHaveBeenCalled();
    }
  );

  it(`${facade} explicit root refuses mount-local absolute creation and accepts checked relative migration`, async () => {
    const backend = new MemoryFileSystem();
    await backend.mkdir("/work");
    await backend.mkdir("/mnt/work", { recursive: true });
    await backend.writeFile("/work/input", new TextEncoder().encode("inside"));
    await backend.writeFile("/mnt/work/input", new TextEncoder().encode("outside"));
    const adapter = new MountFileSystem({
      root: new MemoryFileSystem(),
      mounts: { "/mnt": backend }
    });
    const symlink = vi.spyOn(backend, "symlink");
    const fs = createModule({ adapter, root: "/mnt/work", cwd: "/mnt/work" });
    await expect(fs.symlink("/mnt/work/input", "absolute")).rejects.toMatchObject({
      code: "ENOTSUP"
    });
    expect(symlink).not.toHaveBeenCalled();
    await expect(backend.lstat("/work/absolute")).rejects.toMatchObject({ code: "ENOENT" });
    await fs.symlink("input", "relative");
    expect(await fs.readlink("relative")).toBe("input");
    expect(await fs.readFile("relative", "utf8")).toBe("inside");
    expect(new TextDecoder().decode(await backend.readFile("/mnt/work/input"))).toBe("outside");
  });

  it.each(rootedOperations)(
    `${facade} explicit root guards $operation $operand independently of cwd`,
    async ({ operation, operand, inside, call }) => {
      const adapter = new MemoryFileSystem();
      await adapter.mkdir("/project/work", { recursive: true });
      await adapter.mkdir("/project/empty");
      await adapter.mkdir("/outside");
      await adapter.mkdir("/project-sibling");
      await adapter.writeFile("/project/input", new TextEncoder().encode("inside"));
      await adapter.writeFile("/outside/input", new TextEncoder().encode("outside"));
      await adapter.writeFile("/project-sibling/input", new TextEncoder().encode("sibling"));
      await adapter.symlink("input", "/project/link");
      await adapter.symlink("/outside/input", "/project/escape");
      await adapter.symlink("/outside/missing", "/project/dangling");
      const writes = [
        "writeFile",
        "mkdir",
        "rm",
        "rmdir",
        "rename",
        "copyFile",
        "symlink",
        "link",
        "chmod",
        "utimes",
        "truncate"
      ] as const;
      const effects = writes.map((name) => vi.spyOn(adapter, name));
      const read = vi.spyOn(adapter, "readFile");
      const readdir = vi.spyOn(adapter, "readdir");
      const fs = createModule({ adapter, root: "/project", cwd: "/project/work" });
      expect(new Set(rootedOperations.map((entry) => entry.operation)).size).toBe(21);
      expect(readHostOperationPolicy(fs[operation])).toBe(
        ["access", "lstat", "readFile", "readdir", "readlink", "realpath", "stat"].includes(
          operation
        )
          ? "re-issue"
          : "read-side-effect"
      );
      for (const outside of [
        "/outside/input",
        "../../outside/input",
        "/project-sibling/input",
        "/project/escape",
        "/project/dangling"
      ]) {
        const absoluteTarget =
          operation === "symlink" && operand === "target" && outside.startsWith("/project/");
        await expect(call(fs, outside)).rejects.toMatchObject({
          code: absoluteTarget ? "ENOTSUP" : "EACCES"
        });
      }
      for (const effect of effects) expect(effect).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
      expect(readdir).not.toHaveBeenCalled();
      expect(new TextDecoder().decode(await adapter.readFile("/outside/input"))).toBe("outside");
      expect(new TextDecoder().decode(await adapter.readFile("/project-sibling/input"))).toBe(
        "sibling"
      );
      await call(
        fs,
        operation === "symlink" && operand === "target" ? inside : `/project/${inside}`
      );
    }
  );
});

it("confines rooted Node-shaped mkdtemp names while preserving native prefix separators", async () => {
  vol.mkdirSync("/work");
  const fs = makeFsModule({ root: "/work" });
  await expect(fs.mkdtemp("/work")).rejects.toMatchObject({ code: "EACCES" });
  expect(vol.readdirSync("/")).toEqual(["work"]);
  const created = await fs.mkdtemp("/work/");
  expect(created.startsWith("/work/")).toBe(true);
  expect(vol.statSync(created).isDirectory()).toBe(true);
  expect(vol.readdirSync("/")).toEqual(["work"]);
});
