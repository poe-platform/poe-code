import { constants } from "node:fs";
import * as native from "node:fs/promises";
import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealFileSystem } from "../src/fs/real/index.js";

const hooks = vi.hoisted(() => ({ beforeOpen: undefined as ((path: string) => void) | undefined }));

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    open: vi.fn(async (path: string, flags: number, mode?: number) => {
      hooks.beforeOpen?.(path);
      return fs.promises.open(path, flags, mode);
    }),
    link: vi.fn(fs.promises.link.bind(fs.promises)),
  };
});

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return { constants: fs.constants };
});

beforeEach(() => {
  vol.reset();
  vol.fromJSON({ "/machine/file": "inside", "/machine/sub/file": "original", "/outside/file": "secret" });
  hooks.beforeOpen = undefined;
  vi.clearAllMocks();
});

afterEach(() => { vi.restoreAllMocks(); });

describe("#725 real filesystem trusted-host containment boundary (memfs only)", () => {
  it("reads and writes a pre-existing in-memory external hardlink alias", async () => {
    vol.linkSync("/outside/file", "/machine/alias");
    const filesystem = new RealFileSystem("/machine");
    const outside = vol.statSync("/outside/file");
    const alias = await filesystem.lstat("/alias");
    expect(alias.ino).toBe(outside.ino);
    expect(alias.nlink).toBe(2);
    expect(new TextDecoder().decode(await filesystem.readFile("/alias"))).toBe("secret");
    await filesystem.writeFile("/alias", new TextEncoder().encode("changed"));
    expect(vol.readFileSync("/outside/file", "utf8")).toBe("changed");
    expect(vol.readFileSync("/machine/file", "utf8")).toBe("inside");
  });

  it("refuses an already-present external symlink before opening it", async () => {
    vol.symlinkSync("/outside/file", "/machine/escape");
    const filesystem = new RealFileSystem("/machine");
    await expect(filesystem.readFile("/escape")).rejects.toMatchObject({ code: "EACCES" });
    await expect(filesystem.writeFile("/escape", new TextEncoder().encode("changed"))).rejects.toMatchObject({ code: "EACCES" });
    expect(native.open).not.toHaveBeenCalled();
    expect(vol.readFileSync("/outside/file", "utf8")).toBe("secret");
  });

  it.each(["/outside/file", "../../outside/file"])("does not interpret link source %s as an outside host path", async source => {
    const filesystem = new RealFileSystem("/machine");
    await expect(filesystem.link(source, "/alias")).rejects.toMatchObject({ code: "ENOENT" });
    expect(native.link).not.toHaveBeenCalled();
    expect(vol.existsSync("/machine/alias")).toBe(false);
    expect(vol.statSync("/outside/file").nlink).toBe(1);
  });

  it("supports virtual-root hardlinks without importing external host names", async () => {
    const filesystem = new RealFileSystem("/machine");
    await filesystem.link("/file", "/alias");
    expect(native.link).toHaveBeenCalledExactlyOnceWith("/machine/file", "/machine/alias");
    expect(new TextDecoder().decode(await filesystem.readFile("/alias"))).toBe("inside");
    expect(vol.statSync("/outside/file").nlink).toBe(1);
  });

  it.each(["read", "write"] as const)("models an external ancestor swap between path checks and %s open", async operation => {
    hooks.beforeOpen = path => {
      expect(path).toBe("/machine/sub/file");
      hooks.beforeOpen = undefined;
      vol.renameSync("/machine/sub", "/machine/original");
      vol.symlinkSync("/outside", "/machine/sub");
    };
    const filesystem = new RealFileSystem("/machine");
    if (operation === "read") {
      expect(new TextDecoder().decode(await filesystem.readFile("/sub/file"))).toBe("secret");
    } else {
      await filesystem.writeFile("/sub/file", new TextEncoder().encode("changed"));
      expect(vol.readFileSync("/outside/file", "utf8")).toBe("changed");
    }
    const flags = vi.mocked(native.open).mock.calls[0]![1];
    expect(typeof flags).toBe("number");
    expect((flags as number) & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
    expect(vol.readFileSync("/machine/original/file", "utf8")).toBe("original");
  });
});
