import { beforeEach, expect, test, vi } from "vitest";
import { fs, vol } from "memfs";
vi.mock("node:fs", async () => (await import("memfs")).fs);
vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);
vi.mock("#safe-fs-platform", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/platform/node.js")>();
  return { ...actual, platform: { ...actual.platform, nativeFileSystem: {
    open: false, permissions: false, timestamps: false, conditionalChmod: false, trustedOwnedStaging: false, atomicRename: false,
  } } };
});
import { RealFileSystem } from "../src/fs/real/index.js";
import { platform as restricted } from "../src/platform/browser.js";

beforeEach(() => {
  vol.reset();
  vol.fromJSON({ "/machine/file": "original" });
  fs.chmodSync("/machine/file", 0o640);
});

test("the restricted native host profile is immutable and leaves retained reads independent", () => {
  const filesystem = new RealFileSystem("/machine");
  for (const name of ["open", "permissions", "timestamps", "conditionalChmod", "trustedOwnedStaging", "atomicRename"] as const) {
    expect(filesystem.capabilities[name]).toBe(false);
    expect(restricted.nativeFileSystem[name]).toBe(false);
  }
  expect(Object.isFrozen(restricted.nativeFileSystem)).toBe(true);
  expect(filesystem.capabilities.retainedRead).toBe(true);
});

test("generic descriptors refuse truncate and noFollow requests before opening files", async () => {
  const filesystem = new RealFileSystem("/machine");
  await expect(filesystem.open("/file", { access: "write", creation: "never", truncate: true }))
    .rejects.toMatchObject({ code: "ENOTSUP", syscall: "open", path: "/file" });
  await expect(filesystem.open("/file", { access: "read", creation: "never", noFollow: true }))
    .rejects.toMatchObject({ code: "ENOTSUP" });
  expect(fs.readFileSync("/machine/file", "utf8")).toBe("original");
  const reason = { canceled: true };
  await expect(filesystem.open("/file", { access: "read", creation: "never", signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
});

test("unsupported native metadata mutations refuse before effects", async () => {
  const filesystem = new RealFileSystem("/machine");
  const before = fs.statSync("/machine/file");
  await expect(filesystem.chmod("/file", 0o700)).rejects.toMatchObject({ code: "ENOTSUP", syscall: "chmod", path: "/file" });
  await expect(filesystem.utimes("/file", 1, 2)).rejects.toMatchObject({ code: "ENOTSUP", syscall: "utimes", path: "/file" });
  expect(fs.statSync("/machine/file").mode).toBe(before.mode);
  expect(fs.statSync("/machine/file").mtimeMs).toBe(before.mtimeMs);
  await expect(filesystem.mkdir("/strict", { exactMode: true, mode: 0o700 })).rejects.toMatchObject({ code: "ENOTSUP" });
  expect(fs.existsSync("/machine/strict")).toBe(false);
  await filesystem.mkdir("/advisory", { mode: 0o700 });
  expect(fs.statSync("/machine/advisory").isDirectory()).toBe(true);
  const reason = { canceled: true };
  await expect(filesystem.chmod("/file", 0o700, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
  await expect(filesystem.utimes("/file", 1, 2, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
});

test("owned staging refuses even when supplied ordinary POSIX metadata", async () => {
  const filesystem = new RealFileSystem("/machine");
  const parent = await filesystem.lstat("/");
  await expect(filesystem.createStagedFile("/staging", "file", { type: "file", data: Uint8Array.of(1) }, { parent }))
    .rejects.toMatchObject({ code: "ENOTSUP" });
  await expect(filesystem.writeFileConditional("/file", Uint8Array.of(2), { parent, expected: await filesystem.lstat("/file") }))
    .rejects.toMatchObject({ code: "ENOTSUP" });
  expect(fs.existsSync("/machine/staging")).toBe(false);
  expect(fs.readFileSync("/machine/file", "utf8")).toBe("original");
});

test("the restricted host cannot elevate atomic rename through a constructor callback", () => {
  const renameNoReplace = vi.fn();
  expect(() => new RealFileSystem({ root: "/machine", renameNoReplace })).toThrow();
  expect(renameNoReplace).not.toHaveBeenCalled();
});
