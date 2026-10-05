import { beforeEach, expect, test, vi } from "vitest";
import { fs, vol } from "memfs";
import * as native from "node:fs/promises";
import { RealFileSystem } from "../src/fs/real/index.js";
import { DeviceFileSystem } from "../src/fs/devices/index.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return { ...fs.promises, lstat: vi.fn(fs.promises.lstat.bind(fs.promises)) };
});

beforeEach(() => {
  vol.reset();
  vol.fromJSON({ "/machine/a/b/c/d/e/file": "content", "/outside/secret": "secret" });
  vi.clearAllMocks();
});

test("device capability discovery visits each real path component once", async () => {
  const view = new DeviceFileSystem(new RealFileSystem("/machine"));
  expect((await view.capabilitiesFor("/a/b/c/d/e/file")).read).toBe(true);
  expect(vi.mocked(native.lstat).mock.calls.length).toBeLessThanOrEqual(6);
});

class GenericRealFileSystem extends RealFileSystem {}

for (const path of ["/", "/a/b/c", "/relative/file", "/absolute/file", "/escape/secret", "/null", "/null/child", "/loop", "/missing/child", "/a/b/c/d/e/file/child", "/a/../a/b", "/dev/null", "/dev/null/../a", "/a/b/"]) {
  test(`device discovery preserves generic resolution for ${path}`, async () => {
    fs.symlinkSync("a/b/c/d/e", "/machine/relative");
    fs.symlinkSync("/machine/a/b/c/d/e", "/machine/absolute");
    fs.symlinkSync("/outside", "/machine/escape");
    fs.symlinkSync("/dev/null", "/machine/null");
    fs.symlinkSync("loop", "/machine/loop");
    const actual = new DeviceFileSystem(new RealFileSystem("/machine"));
    const reference = new DeviceFileSystem(new GenericRealFileSystem("/machine"));
    for (const method of ["capabilitiesFor", "realpath"] as const) {
      const result = async (view: DeviceFileSystem) => {
        try { return { value: await view[method](path) }; }
        catch (error) { return { code: (error as { code?: string }).code }; }
      };
      expect(await result(actual)).toEqual(await result(reference));
    }
  });
}

test("device discovery observes changed symlinks on each call", async () => {
  const view = new DeviceFileSystem(new RealFileSystem("/machine"));
  expect((await view.capabilitiesFor("/a/b/c")).read).toBe(true);
  fs.renameSync("/machine/a", "/machine/old");
  fs.symlinkSync("/outside", "/machine/a");
  await expect(view.realpath("/a/secret")).rejects.toMatchObject({ code: "EACCES" });
});

test("device discovery honors overridden backend metadata", async () => {
  const real = new RealFileSystem("/machine");
  const lstat = vi.spyOn(real, "lstat").mockRejectedValue(Object.assign(new Error("denied"), { code: "EACCES" }));
  await expect(new DeviceFileSystem(real).capabilitiesFor("/a/b/c")).rejects.toMatchObject({ code: "EACCES" });
  expect(lstat).toHaveBeenCalled();
});

test("device discovery stops when cancellation arrives during a metadata check", async () => {
  const view = new DeviceFileSystem(new RealFileSystem("/machine"));
  const controller = new AbortController();
  const reason = new Error("cancelled");
  const lstat = vi.mocked(native.lstat).getMockImplementation()!;
  vi.mocked(native.lstat).mockImplementationOnce(async (...args) => {
    controller.abort(reason);
    return lstat(...args);
  });
  await expect(view.capabilitiesFor("/a/b/c", { signal: controller.signal })).rejects.toBe(reason);
  expect(native.lstat).toHaveBeenCalledTimes(1);
});

test("device discovery preserves explicit path limits", async () => {
  const view = new DeviceFileSystem(new RealFileSystem("/machine"));
  await expect(view.capabilitiesFor("/a/b/c", { pathLimits: { maxPathComponents: 2 } })).rejects.toMatchObject({ code: "ENAMETOOLONG" });
  expect(native.lstat).not.toHaveBeenCalled();
});

test("real filesystem root validation overlaps independent metadata checks", async () => {
  const real = new RealFileSystem("/machine");
  await real.stat("/");
  let started!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const original = native.realpath;
  const realpath = vi.spyOn(native, "realpath");
  realpath.mockImplementationOnce(async (...args) => {
    started();
    await gate;
    return original(...args);
  });
  const stat = vi.spyOn(native, "stat");
  const pending = real.readdir("/a");
  try {
    await entered;
    expect(stat).toHaveBeenCalled();
  } finally {
    release();
    await pending;
    realpath.mockRestore();
    stat.mockRestore();
  }
});

test("root validation awaits both checks and preserves canonical-path errors", async () => {
  const real = new RealFileSystem("/machine");
  await real.stat("/");
  let started!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const realpath = vi.spyOn(native, "realpath").mockRejectedValueOnce(Object.assign(new Error("canonical failure"), { code: "EACCES" }));
  const stat = vi.spyOn(native, "stat").mockImplementationOnce(async () => {
    started();
    await gate;
    throw Object.assign(new Error("metadata failure"), { code: "ENOENT" });
  });
  let settled = false;
  const pending = real.readdir("/a").finally(() => { settled = true; });
  const result = expect(pending).rejects.toMatchObject({ code: "EACCES" });
  try {
    await entered;
    expect(settled).toBe(false);
  } finally {
    release();
    await result;
    realpath.mockRestore();
    stat.mockRestore();
  }
});
