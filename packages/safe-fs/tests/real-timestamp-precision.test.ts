import * as native from "node:fs/promises";
import { fs, vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RealFileSystem } from "../src/fs/real/index.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return { ...fs.promises, utimes: vi.fn() };
});

beforeEach(() => {
  vol.reset();
  vol.fromJSON({ "/machine/file": "unchanged", "/outside/file": "outside" });
  fs.symlinkSync("file", "/machine/link");
  fs.symlinkSync("/outside/file", "/machine/escape");
  vi.mocked(native.utimes).mockReset().mockResolvedValue(undefined);
});

describe("real timestamp conversion without Date clipping", () => {
  it.each([
    [1000.75, 2000.5, 1.00075, 2.0005],
    [0.125, 0.75, 0.000125, 0.00075],
    [0, 1000, 0, 1],
    [1788565013695.82, 1788565013695.125, 1788565013.69582, 1788565013.695125],
  ])("forwards %s/%s milliseconds as numeric seconds", async (atimeMs, mtimeMs, atimeSeconds, mtimeSeconds) => {
    const filesystem = new RealFileSystem("/machine");
    await filesystem.utimes("/file", atimeMs!, mtimeMs!);
    expect(native.utimes).toHaveBeenCalledExactlyOnceWith("/machine/file", atimeSeconds, mtimeSeconds);
    expect(vol.toJSON()).toMatchObject({ "/machine/file": "unchanged" });
  });

  it.each([
    [-1000, -2000, "-1", "-2"],
    [-1000.75, -2000.5, "-1.00075", "-2.0005"],
    [-0.125, 2000.5, "-0.000125", 2.0005],
    [1000.75, -2000.5, 1.00075, "-2.0005"],
  ] as const)("preserves pre-epoch %s/%s milliseconds without Node's negative-number now convention", async (atimeMs, mtimeMs, atimeSeconds, mtimeSeconds) => {
    await new RealFileSystem("/machine").utimes("/file", atimeMs, mtimeMs);
    expect(native.utimes).toHaveBeenCalledExactlyOnceWith("/machine/file", atimeSeconds, mtimeSeconds);
  });

  it("resolves an in-root symlink before applying exact fractional values", async () => {
    await new RealFileSystem("/machine").utimes("/link", 1000.75, 2000.5);
    expect(native.utimes).toHaveBeenCalledExactlyOnceWith("/machine/file", 1.00075, 2.0005);
  });

  it.each([NaN, Infinity, -Infinity])("rejects nonfinite %s in either field before the native setter", async invalid => {
    const filesystem = new RealFileSystem("/machine");
    for (const [atimeMs, mtimeMs] of [[invalid, 2000.5], [1000.75, invalid]]) {
      await expect(filesystem.utimes("/file", atimeMs!, mtimeMs!)).rejects.toMatchObject({ code: "EINVAL", syscall: "utimes", path: "/file" });
    }
    expect(native.utimes).not.toHaveBeenCalled();
  });

  it.each([
    [8640000000000000, 8640000000000],
    [-8640000000000000, "-8640000000000"],
    [8639999999999999, 8639999999999.999],
    [-8639999999999999, "-8639999999999.999"],
  ] as const)("admits the legacy Date range endpoint or adjacent interior value %s", async (milliseconds, seconds) => {
    expect(Number.isFinite(new Date(milliseconds).getTime())).toBe(true);
    await new RealFileSystem("/machine").utimes("/file", milliseconds, milliseconds);
    expect(native.utimes).toHaveBeenCalledExactlyOnceWith("/machine/file", seconds, seconds);
  });

  it.each([8640000000000001, -8640000000000001, Number.MAX_VALUE, -Number.MAX_VALUE])("rejects finite %s outside the legacy Date range in either field", async invalid => {
    expect(Number.isFinite(invalid)).toBe(true);
    expect(Number.isNaN(new Date(invalid).getTime())).toBe(true);
    const filesystem = new RealFileSystem("/machine");
    for (const [atimeMs, mtimeMs] of [[invalid, 2000.5], [1000.75, invalid]]) {
      await expect(filesystem.utimes("/file", atimeMs!, mtimeMs!)).rejects.toMatchObject({ code: "EINVAL", syscall: "utimes", path: "/file" });
    }
    expect(native.utimes).not.toHaveBeenCalled();
  });

  it.each([["/missing", "ENOENT"], ["/escape", "EACCES"], ["/file/child", "ENOTDIR"]])("preserves path admission for %s", async (path, code) => {
    await expect(new RealFileSystem("/machine").utimes(path!, 1000.75, 2000.5)).rejects.toMatchObject({ code, syscall: "utimes", path });
    expect(native.utimes).not.toHaveBeenCalled();
  });

  it.each(["EACCES", "EPERM", "EROFS", "EINVAL"])("preserves native %s errors", async code => {
    vi.mocked(native.utimes).mockRejectedValue(Object.assign(new Error("native setter refused"), { code }));
    await expect(new RealFileSystem("/machine").utimes("/file", 1000.75, 2000.5)).rejects.toMatchObject({ code, syscall: "utimes", path: "/file" });
    expect(native.utimes).toHaveBeenCalledOnce();
  });

  it("preserves cancellation before native admission", async () => {
    const controller = new AbortController();
    controller.abort(false);
    await expect(new RealFileSystem("/machine").utimes("/file", 1000.75, 2000.5, { signal: controller.signal })).rejects.toBe(false);
    expect(native.utimes).not.toHaveBeenCalled();
  });

  it("preserves cancellation precedence over native setter failure", async () => {
    const controller = new AbortController();
    vi.mocked(native.utimes).mockImplementation(async () => {
      controller.abort(false);
      throw Object.assign(new Error("secondary setter failure"), { code: "EIO" });
    });
    await expect(new RealFileSystem("/machine").utimes("/file", 1000.75, 2000.5, { signal: controller.signal })).rejects.toBe(false);
    expect(native.utimes).toHaveBeenCalledOnce();
  });
});
