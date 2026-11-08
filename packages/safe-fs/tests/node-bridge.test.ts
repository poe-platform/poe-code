import { describe, expect, it } from "vitest";
import { createNodeFsBridge, MemoryFileSystem } from "@poe-code/safe-fs";
import type { NodeFsImplementation } from "@poe-code/safe-fs";

describe("neutral Node filesystem bridge", () => {
  it("adapts paths, bytes, stats and directory entries without an interpreter", async () => {
    const filesystem = new MemoryFileSystem();
    await filesystem.mkdir("/work");
    const bridge: NodeFsImplementation = createNodeFsBridge(filesystem, { cwd: "/work" });
    await bridge.writeFile("note", "hello", "utf8");
    expect(await bridge.readFile("note", "utf8")).toBe("hello");
    expect(Buffer.isBuffer(await bridge.readFile("note"))).toBe(true);
    expect((await bridge.stat("note")).isFile()).toBe(true);
    const entries = await bridge.readdir(".", { withFileTypes: true });
    const entry = entries[0];
    if (entry === undefined) throw new Error("Missing directory entry");
    expect(entry.name).toBe("note");
    expect(entry.isFile()).toBe(true);
    expect(Reflect.get(entry, "path")).toBe("/work/.");
  });

  it("copies recursively and preserves symlink entry semantics", async () => {
    const bridge = createNodeFsBridge(new MemoryFileSystem());
    await bridge.mkdir("/source");
    await bridge.writeFile("/source/file", "content");
    await bridge.cp("/source", "/copy", { recursive: true });
    expect(await bridge.readFile("/copy/file", "utf8")).toBe("content");
    await bridge.symlink("file", "/copy/link");
    expect((await bridge.lstat("/copy/link")).isSymbolicLink()).toBe(true);
    expect(await bridge.readlink("/copy/link")).toBe("file");
  });

  it("uses explicit cancellation and does not invoke absent rmdir fallbacks", async () => {
    const filesystem = new MemoryFileSystem();
    const controller = new AbortController();
    controller.abort();
    await expect(
      createNodeFsBridge(filesystem, { signal: controller.signal }).writeFile("/no", "no")
    ).rejects.toMatchObject({ code: "ABORT_ERR" });
    await filesystem.mkdir("/empty");
    Object.defineProperty(filesystem, "rmdir", { value: undefined });
    await expect(createNodeFsBridge(filesystem).rmdir("/empty")).rejects.toMatchObject({
      code: "ENOTSUP"
    });
  });

  it("rejects unknown options and unsupported bigint stats", async () => {
    const bridge = createNodeFsBridge(new MemoryFileSystem());
    await expect(bridge.stat("/", { bigint: true })).rejects.toMatchObject({ code: "ENOTSUP" });
    await expect(
      bridge.readFile("/", { encoding: "utf8", unexpected: true } as never)
    ).rejects.toBeInstanceOf(TypeError);
  });
});
