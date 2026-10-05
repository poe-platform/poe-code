import { afterEach, describe, expect, it, vi } from "vitest";
import { createSession, SESSION_LIMITS } from "./session.js";
import { executeInWorker } from "./execution.js";

// Keep the real in-memory filesystem and quota behavior without bundling the
// browser command registry. Browser compatibility lives in session.integration.ts.
vi.mock("./engine/index.js", async () => {
  const { createMemoryFileSystem } = await import("../../safe-fs/src/fs/memory/index.js");
  const { withFileSystemQuota } = await import("../../safe-fs/src/fs/quota/index.js");
  return {
    createMemoryFileSystem,
    withFileSystemQuota,
    supportedCommands: ["cat", "pwd"],
    browserLimits: { maxOutputBytes: 65536, maxSourceBytes: 16384, maxCommands: 1000, maxLoopIterations: 1000 }
  };
});
vi.mock("./execution.js", () => ({ executeInWorker: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const fileLimit = 2 * 1024 * 1024;
const workspaceLimit = 16 * 1024 * 1024;

describe("PlaygroundSession", () => {
  it("publishes the same byte budgets used by editing and uploads", () => {
    expect(SESSION_LIMITS).toEqual({ maxFileBytes: fileLimit, maxTotalBytes: workspaceLimit });
  });

  it("seeds an isolated recursive workspace with byte sizes", async () => {
    const session = await createSession();
    expect(session.cwd).toBe("/home");
    const entries = await session.entries();
    expect(entries).toContainEqual({
      path: "/home/examples",
      name: "examples",
      kind: "directory",
      size: 0
    });
    const source = await session.readFile("examples/hello.py");
    expect(entries).toContainEqual({
      path: "/home/examples/hello.py",
      name: "hello.py",
      kind: "file",
      size: new TextEncoder().encode(source).length
    });
    await session.writeFile("examples/hello.py", "edited");
    const reset = await createSession();
    expect(await reset.readFile("examples/hello.py")).toBe(source);
    expect(reset.cwd).toBe("/home");
  });

  it("preserves uploaded bytes, sanitizes names, and never overwrites collisions", async () => {
    const session = await createSession();
    const bytes = new Uint8Array([0, 255, 128, 13, 10]);
    const paths = await session.upload([
      { name: "../../photo.bin", data: bytes },
      { name: "C:\\private\\photo.bin", data: bytes },
      { name: "photo.bin", data: bytes },
      { name: "..", data: bytes },
      { name: "bad\n\0name.txt", data: bytes }
    ]);
    expect(paths.slice(0, 3)).toEqual([
      "/home/uploads/photo.bin",
      "/home/uploads/photo-2.bin",
      "/home/uploads/photo-3.bin"
    ]);
    expect(
      paths.every(
        (path) => path.startsWith("/home/uploads/") && !path.includes("\0") && !path.includes("\n")
      )
    ).toBe(true);
    expect(await session.readBytes(paths[0]!)).toEqual(bytes);
    expect(await session.isBinary(paths[0]!)).toBe(true);
    bytes[0] = 99;
    expect((await session.readBytes(paths[0]!))[0]).toBe(0);
    const read = await session.readBytes(paths[0]!);
    read[0] = 98;
    expect((await session.readBytes(paths[0]!))[0]).toBe(0);
  });

  it("prevalidates a whole upload batch and counts UTF-8 edit bytes", async () => {
    const session = await createSession();
    const before = await session.entries();
    await expect(
      session.upload([
        { name: "ok.txt", data: new Uint8Array([1]) },
        { name: "large.bin", data: new Uint8Array(fileLimit + 1) }
      ])
    ).rejects.toThrow("2 MiB");
    expect(await session.entries()).toEqual(before);
    await expect(
      session.writeFile("examples/hello.py", "é".repeat(fileLimit / 2 + 1))
    ).rejects.toThrow("2 MiB");
    expect(await session.entries()).toEqual(before);
    await session.writeFile("boundary.txt", "a".repeat(fileLimit));
    expect((await session.readBytes("boundary.txt")).length).toBe(fileLimit);
  });

  it("rejects workspace overflow atomically and accounts for replacement bytes", async () => {
    const session = await createSession();
    const before = await session.entries();
    await expect(
      session.upload(
        Array.from({ length: 8 }, (_, index) => ({
          name: `large-${index}.bin`,
          data: new Uint8Array(fileLimit)
        }))
      )
    ).rejects.toThrow("16 MiB");
    expect(await session.entries()).toEqual(before);
    const used = before.reduce((total, entry) => total + entry.size, 0);
    await session.upload(
      Array.from({ length: 7 }, (_, index) => ({
        name: `large-${index}.bin`,
        data: new Uint8Array(fileLimit)
      }))
    );
    await session.writeFile("last.txt", "a".repeat(workspaceLimit - used - 7 * fileLimit));
    await session.writeFile("last.txt", "b");
    await expect(session.writeFile("last.txt", "x".repeat(fileLimit))).rejects.toThrow("16 MiB");
    expect(await session.readFile("last.txt")).toBe("b");
  });

  it("reserves capacity across concurrent edits and upload batches", async () => {
    const session = await createSession();
    const batches = await Promise.all([
      session.upload([{ name: "same.txt", data: new Uint8Array([1]) }]),
      session.upload([{ name: "same.txt", data: new Uint8Array([2]) }])
    ]);
    expect(batches).toEqual([["/home/uploads/same.txt"], ["/home/uploads/same-2.txt"]]);
    expect(await session.readBytes(batches[0]![0]!)).toEqual(new Uint8Array([1]));
    expect(await session.readBytes(batches[1]![0]!)).toEqual(new Uint8Array([2]));
  });

  it("completes commands and escaped paths without starting a shell", async () => {
    const session = await createSession();
    await session.writeFile("data/it's here.txt", "safe");
    await session.writeFile("data/back\\slash.txt", "literal");
    expect(await session.complete("pw")).toContain("pwd");
    expect(await session.complete("hel")).toContain("help");
    expect(await session.complete("cd ex")).toContain("cd examples/");
    expect(await session.complete("cat absent/")).toEqual([]);
    expect(await session.complete("cat 'data/it")).toEqual(["cat 'data/it'\\''s here.txt'"]);
    expect(await session.complete('cat "data/back\\s')).toEqual(['cat "data/back\\\\slash.txt"']);
    expect(executeInWorker).not.toHaveBeenCalled();
  });

  it("passes acknowledged cwd to the next execution and resolves relative edits", async () => {
    const session = await createSession();
    vi.mocked(executeInWorker).mockImplementationOnce(async (_fs, _command, _cwd, _help, onState) => {
      onState("/home/examples");
      return { stdout: "", stderr: "", exitCode: 7 };
    }).mockResolvedValueOnce({ stdout: "next", stderr: "", exitCode: 0 });
    expect((await session.run("first")).exitCode).toBe(7);
    expect(session.cwd).toBe("/home/examples");
    await session.writeFile("../data/new.txt", "café 世界");
    expect(await session.readFile("~/data/new.txt")).toBe("café 世界");
    expect(await session.isBinary("/home/data/new.txt")).toBe(false);
    await session.remove("../data/new.txt");
    await expect(session.readFile("/home/data/new.txt")).rejects.toThrow();
    await expect(session.writeFile("bad\0name", "no")).rejects.toThrow();
    await expect(session.remove("/")).rejects.toThrow();
    await expect(session.remove("/home")).rejects.toThrow();
    await session.run("second");
    expect(vi.mocked(executeInWorker).mock.calls[1]!.slice(1, 3)).toEqual(["second", "/home/examples"]);
  });

  it("recovers cwd after removal and converts execution failures into results", async () => {
    const session = await createSession();
    vi.mocked(executeInWorker).mockImplementationOnce(async (_fs, _command, _cwd, _help, onState) => {
      onState("/home/examples");
      throw new Error("worker failed");
    });
    expect(await session.run("failure")).toEqual({ stdout: "", stderr: "worker failed\n", exitCode: 1 });
    await session.remove(".");
    expect(session.cwd).toBe("/home");
    vi.mocked(executeInWorker).mockResolvedValueOnce({ stdout: "recovered", stderr: "", exitCode: 0 });
    expect((await session.run("next")).stdout).toBe("recovered");
  });
});
