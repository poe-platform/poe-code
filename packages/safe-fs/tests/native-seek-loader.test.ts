import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { vol } from "memfs";

const hooks = vi.hoisted(() => ({
  runtime: { platform: "linux", arch: "x64", versions: { napi: "10" }, report: { getReport: vi.fn() } },
  createRequire: vi.fn(), require: vi.fn(),
  opened: [] as string[], closed: [] as string[], flags: [] as number[], readLengths: [] as number[],
  fault: "" as string, reason: undefined as unknown,
  closeFault: false, closeReason: undefined as unknown,
  reportedSize: undefined as number | undefined,
  shortReads: false,
  beforeRead: undefined as (() => void | Promise<void>) | undefined,
  beforeClose: undefined as (() => void | Promise<void>) | undefined,
}));

vi.mock("node:process", () => ({ default: hooks.runtime }));
vi.mock("node:module", () => ({ createRequire: hooks.createRequire }));
vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  const { constants } = await import("node:fs");
  return { open: vi.fn(async (filename: string, flags: number) => {
    if (hooks.fault === "open") throw hooks.reason;
    if ((flags & constants.O_NOFOLLOW) !== 0 && fs.lstatSync(filename).isSymbolicLink()) {
      throw Object.assign(new Error("symlink refused"), { code: "ELOOP" });
    }
    const handle = await fs.promises.open(filename, flags);
    hooks.opened.push(filename);
    hooks.flags.push(flags);
    const stat = handle.stat.bind(handle), read = handle.read.bind(handle), close = handle.close.bind(handle);
    handle.stat = async () => {
      if (hooks.fault === "stat") throw hooks.reason;
      const value = await stat();
      if (hooks.reportedSize !== undefined) Object.defineProperty(value, "size", { value: hooks.reportedSize });
      return value;
    };
    handle.read = async (buffer, offset, length, position) => {
      hooks.readLengths.push(length);
      await hooks.beforeRead?.();
      if (hooks.fault === "read") throw hooks.reason;
      return read(buffer, offset, hooks.shortReads ? Math.min(length, 3) : length, position);
    };
    handle.close = async () => {
      await hooks.beforeClose?.();
      hooks.closed.push(filename);
      await close();
      if (hooks.closeFault) throw hooks.closeReason;
    };
    return handle;
  }) };
});

const directory = fileURLToPath(new URL("../native/", import.meta.url));
const manifestPath = `${directory}manifest.json`;
const binaryPath = `${directory}linux-x64-glibc.node`;
const binary = Buffer.from("opaque-test-only-native-bytes");
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function manifest() {
  return { version: 1, napi: 6, maxBinaryBytes: 1048576, targets: [{ platform: "linux", arch: "x64", libc: "glibc", minimumLibc: "2.31", size: binary.length, sha256: digest(binary) }] };
}

function writeManifest(value: unknown) { vol.writeFileSync(manifestPath, JSON.stringify(value)); }

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vol.reset();
  vol.mkdirSync(directory, { recursive: true });
  vol.writeFileSync(binaryPath, binary);
  writeManifest(manifest());
  Object.assign(hooks, { opened: [], closed: [], flags: [], readLengths: [], fault: "", reason: undefined, closeFault: false, closeReason: undefined, reportedSize: undefined, shortReads: false, beforeRead: undefined, beforeClose: undefined });
  hooks.runtime.platform = "linux";
  hooks.runtime.arch = "x64";
  hooks.runtime.versions.napi = "10";
  hooks.runtime.report.getReport.mockImplementation(function () {
    expect(this).toBe(hooks.runtime.report);
    return { header: { glibcVersionRuntime: "2.36" }, get environmentVariables() { throw new Error("must not inspect environment"); } };
  });
  hooks.createRequire.mockReturnValue(hooks.require);
  hooks.require.mockReturnValue({ seekEnd: vi.fn(async () => ({ offset: 0n, errno: 0 })) });
});

afterEach(() => { expect(hooks.closed).toEqual(hooks.opened); });

describe("private native seek loader", () => {
  it("imports lazily, shares one load promise and preserves binding identity/receiver", async () => {
    const binding = { seekEnd: vi.fn(async function (this: unknown, descriptor: number) { expect(this).toBe(binding); return { offset: BigInt(descriptor), errno: 0 }; }) };
    hooks.require.mockImplementation((filename: string) => {
      expect(filename).toBe(binaryPath);
      expect(hooks.closed).toEqual([manifestPath, binaryPath]);
      return binding;
    });
    const { loadBinding } = await import("../native/loader.mjs");
    expect(hooks.createRequire).not.toHaveBeenCalled();
    expect(hooks.opened).toEqual([]);
    expect(hooks.runtime.report.getReport).not.toHaveBeenCalled();
    const first = loadBinding(), second = loadBinding();
    expect(second).toBe(first);
    expect(await first).toBe(binding);
    expect(await (await second).seekEnd(7)).toEqual({ offset: 7n, errno: 0 });
    expect(loadBinding()).toBe(first);
    expect(hooks.require).toHaveBeenCalledExactlyOnceWith(binaryPath);
    expect(hooks.createRequire).toHaveBeenCalledExactlyOnceWith(new URL("../native/loader.mjs", import.meta.url).href);
    expect(hooks.flags.every(flags => (flags & constants.O_NOFOLLOW) !== 0 && (flags & constants.O_NONBLOCK) !== 0 && (flags & (constants.O_WRONLY | constants.O_RDWR)) === 0)).toBe(true);
  });

  it("accepts short descriptor reads without pathname readFile or reopens", async () => {
    hooks.shortReads = true;
    const { loadBinding } = await import("../native/loader.mjs");
    await loadBinding();
    expect(hooks.opened).toEqual([manifestPath, binaryPath]);
    expect(Math.max(...hooks.readLengths)).toBeLessThanOrEqual(16384);
  });

  it("accepts publisher build provenance without using its paths or loading other assets", async () => {
    const value = { ...manifest(), build: {
      sourceSha256: "1".repeat(64), loaderSha256: "2".repeat(64), declarationSha256: "3".repeat(64),
      headers: { version: "1.9.0", files: Object.fromEntries(["node_api.h", "node_api_types.h", "js_native_api.h", "js_native_api_types.h"].map(name => [name, { size: 1, sha256: "4".repeat(64) }])) },
      compiler: { path: "/usr/bin/cc", sha256: "5".repeat(64), version: "provenance only" },
    } };
    writeManifest(value);
    const { loadBinding } = await import("../native/loader.mjs");
    await loadBinding();
    expect(hooks.opened).toEqual([manifestPath, binaryPath]);
    expect(hooks.require).toHaveBeenCalledExactlyOnceWith(binaryPath);
  });

  it("shares reentrant loading while preserving the public report receiver", async () => {
    const { loadBinding } = await import("../native/loader.mjs");
    let reentrant: ReturnType<typeof loadBinding> | undefined;
    hooks.runtime.report.getReport.mockImplementation(function () {
      expect(this).toBe(hooks.runtime.report);
      reentrant = loadBinding();
      return { header: { glibcVersionRuntime: "2.36" } };
    });
    const initial = loadBinding();
    await initial;
    expect(reentrant).toBe(initial);
    expect(hooks.require).toHaveBeenCalledOnce();
  });

  it("waits for actual admitted reads and descriptor close before require or settlement", async () => {
    let readEntered!: () => void, releaseRead!: () => void, closeEntered!: () => void, releaseClose!: () => void;
    const reading = new Promise<void>(resolve => { readEntered = resolve; });
    const readGate = new Promise<void>(resolve => { releaseRead = resolve; });
    const closing = new Promise<void>(resolve => { closeEntered = resolve; });
    const closeGate = new Promise<void>(resolve => { releaseClose = resolve; });
    hooks.beforeRead = () => { readEntered(); return readGate; };
    hooks.beforeClose = () => { closeEntered(); return closeGate; };
    const { loadBinding } = await import("../native/loader.mjs");
    let settled = false;
    const pending = loadBinding();
    const observed = pending.then(() => { settled = true; }, () => { settled = true; });
    try {
      await reading;
      expect(hooks.closed).toEqual([]);
      expect(hooks.require).not.toHaveBeenCalled();
      expect(settled).toBe(false);
      releaseRead();
      await closing;
      expect(hooks.closed).toEqual([]);
      expect(settled).toBe(false);
      expect(hooks.require).not.toHaveBeenCalled();
    } finally { releaseRead(); releaseClose(); await observed; }
    await pending;
    expect(hooks.closed).toEqual([manifestPath, binaryPath]);
  });

  it.each(["version", "napi", "maxBinaryBytes"])("does not accept a manifest override of %s", async field => {
    writeManifest({ ...manifest(), [field]: 9999999 });
    const { loadBinding } = await import("../native/loader.mjs");
    await expect(loadBinding()).rejects.toMatchObject({ code: "EINVAL" });
    expect(hooks.opened).toEqual([manifestPath]);
  });

  it("accepts a manifest exactly at the byte ceiling", async () => {
    vol.writeFileSync(manifestPath, JSON.stringify(manifest()).padEnd(16384, " "));
    const { loadBinding } = await import("../native/loader.mjs");
    await loadBinding();
    expect(hooks.require).toHaveBeenCalledOnce();
  });

  it("accepts an exact one-MiB opaque binary with matching size and digest", async () => {
    const bytes = Buffer.alloc(1048576, 13);
    const value = manifest();
    value.targets[0]!.size = bytes.length;
    value.targets[0]!.sha256 = digest(bytes);
    vol.writeFileSync(binaryPath, bytes);
    writeManifest(value);
    const { loadBinding } = await import("../native/loader.mjs");
    await loadBinding();
    expect(Math.max(...hooks.readLengths)).toBeLessThanOrEqual(1048576);
    expect(hooks.require).toHaveBeenCalledOnce();
  });

  it("rejects invalid manifest UTF-8 rather than replacing bytes", async () => {
    vol.writeFileSync(manifestPath, Buffer.from([0xff]));
    const { loadBinding } = await import("../native/loader.mjs");
    const error = await loadBinding().catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).not.toBe("ENOTSUP");
    expect(hooks.require).not.toHaveBeenCalled();
  });

  it("does not lower the measured libc floor through the manifest", async () => {
    const value = manifest();
    value.targets[0]!.minimumLibc = "2.17";
    writeManifest(value);
    const { loadBinding } = await import("../native/loader.mjs");
    await expect(loadBinding()).rejects.toMatchObject({ code: "EINVAL" });
  });

  it("does not load an asset requiring a newer libc than the observed runtime", async () => {
    const value = manifest();
    value.targets[0]!.minimumLibc = "2.99";
    writeManifest(value);
    const { loadBinding } = await import("../native/loader.mjs");
    await expect(loadBinding()).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(hooks.opened).toEqual([manifestPath]);
  });

  it("preserves a binding getter's original failure without retries", async () => {
    const getter = vi.fn(() => { throw false; });
    hooks.require.mockReturnValue(Object.defineProperty({}, "seekEnd", { get: getter }));
    const { loadBinding } = await import("../native/loader.mjs");
    const pending = loadBinding();
    await expect(pending).rejects.toBe(false);
    expect(loadBinding()).toBe(pending);
    expect(getter).toHaveBeenCalledOnce();
  });

  it.each(["darwin", "win32", "unknown"])("reports unsupported platform %s without reading assets", async platform => {
    hooks.runtime.platform = platform;
    const { loadBinding } = await import("../native/loader.mjs");
    await expect(loadBinding()).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(hooks.opened).toEqual([]);
    expect(hooks.require).not.toHaveBeenCalled();
  });

  it.each(["arm64", "../x64"])("reports unsupported architecture %s", async arch => {
    hooks.runtime.arch = arch;
    const { loadBinding } = await import("../native/loader.mjs");
    await expect(loadBinding()).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(hooks.opened).toEqual([]);
  });

  it.each(["", "5", "6garbage", "Infinity"])("refuses unsupported NAPI %s without fallback", async napi => {
    hooks.runtime.versions.napi = napi;
    const { loadBinding } = await import("../native/loader.mjs");
    await expect(loadBinding()).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(hooks.opened).toEqual([]);
  });

  it.each([undefined, "", "2.30", "2.31-musl", "2", "Infinity.1"])("refuses unknown/old libc %s", async version => {
    hooks.runtime.report.getReport.mockReturnValue({ header: { glibcVersionRuntime: version } });
    const { loadBinding } = await import("../native/loader.mjs");
    await expect(loadBinding()).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(hooks.opened).toEqual([]);
  });

  it("admits the exact NAPI/libc floor through public report header only", async () => {
    hooks.runtime.versions.napi = "6";
    hooks.runtime.report.getReport.mockReturnValue({ header: { glibcVersionRuntime: "2.31" }, get environmentVariables() { throw false; } });
    const { loadBinding } = await import("../native/loader.mjs");
    await loadBinding();
    expect(hooks.require).toHaveBeenCalledOnce();
  });

  it.each(["manifest", "binary"])("keeps missing %s a genuine ENOENT failure", async asset => {
    vol.unlinkSync(asset === "manifest" ? manifestPath : binaryPath);
    const { loadBinding } = await import("../native/loader.mjs");
    await expect(loadBinding()).rejects.toMatchObject({ code: "ENOENT" });
    expect(hooks.require).not.toHaveBeenCalled();
  });

  it.each(["manifest", "binary"])("refuses a symlink %s before reading or loading it", async asset => {
    const filename = asset === "manifest" ? manifestPath : binaryPath;
    vol.renameSync(filename, `${filename}.other`);
    vol.symlinkSync(`${filename}.other`, filename);
    const { loadBinding } = await import("../native/loader.mjs");
    await expect(loadBinding()).rejects.toMatchObject({ code: "ELOOP" });
    expect(hooks.require).not.toHaveBeenCalled();
  });

  it.each(["manifest", "binary"])("rejects directory %s assets as real failures", async asset => {
    const filename = asset === "manifest" ? manifestPath : binaryPath;
    vol.unlinkSync(filename);
    vol.mkdirSync(filename);
    const { loadBinding } = await import("../native/loader.mjs");
    const outcome = await loadBinding().then(() => undefined, error => error);
    expect(outcome).toBeInstanceOf(Error);
    expect(outcome.code).not.toBe("ENOTSUP");
    expect(hooks.require).not.toHaveBeenCalled();
  });

  it.each(["", "{broken", "null", "[]", '{"version":2}'])("rejects malformed manifest %s", async text => {
    vol.writeFileSync(manifestPath, text);
    const { loadBinding } = await import("../native/loader.mjs");
    const error = await loadBinding().catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).not.toBe("ENOTSUP");
    expect(hooks.require).not.toHaveBeenCalled();
  });

  it.each(["size", "digest", "empty", "oversize"])("rejects binary %s before require", async fault => {
    if (fault === "size") vol.appendFileSync(binaryPath, "x");
    if (fault === "digest") vol.writeFileSync(binaryPath, Buffer.alloc(binary.length, 1));
    if (fault === "empty") vol.writeFileSync(binaryPath, "");
    if (fault === "oversize") vol.writeFileSync(binaryPath, Buffer.alloc(1048577));
    const { loadBinding } = await import("../native/loader.mjs");
    const error = await loadBinding().catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).not.toBe("ENOTSUP");
    expect(hooks.require).not.toHaveBeenCalled();
  });

  it("refuses oversized manifests before reading payload bytes", async () => {
    vol.writeFileSync(manifestPath, " ".repeat(16385));
    const { loadBinding } = await import("../native/loader.mjs");
    await expect(loadBinding()).rejects.toMatchObject({ code: "EFBIG" });
    expect(hooks.readLengths).toEqual([]);
  });

  it.each(["platform", "arch", "libc", "sha256", "size", "minimumLibc"])("rejects malformed target field %s", async field => {
    const value = manifest();
    Object.assign(value.targets[0]!, { [field]: field === "size" ? 0 : "../outside" });
    writeManifest(value);
    const { loadBinding } = await import("../native/loader.mjs");
    await expect(loadBinding()).rejects.toMatchObject({ code: "EINVAL" });
    expect(hooks.opened).toEqual([manifestPath]);
    expect(hooks.require).not.toHaveBeenCalled();
  });

  it("refuses ambiguous duplicate targets rather than selecting first", async () => {
    const value = manifest();
    value.targets.push({ ...value.targets[0]! });
    writeManifest(value);
    const { loadBinding } = await import("../native/loader.mjs");
    await expect(loadBinding()).rejects.toMatchObject({ code: "EINVAL" });
  });

  it("reports an absent supported tuple as ENOTSUP without trying another asset", async () => {
    const value = manifest();
    value.targets[0]!.arch = "arm64";
    writeManifest(value);
    const { loadBinding } = await import("../native/loader.mjs");
    await expect(loadBinding()).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(hooks.opened).toEqual([manifestPath]);
  });

  it("accepts a valid empty target manifest as unsupported without attempting a binary", async () => {
    writeManifest({ version: 1, napi: 6, maxBinaryBytes: 1048576, targets: [], build: { headers: null, compiler: null } });
    const { loadBinding } = await import("../native/loader.mjs");
    const pending = loadBinding();
    await expect(pending).rejects.toMatchObject({ code: "ENOTSUP" });
    expect(loadBinding()).toBe(pending);
    expect(hooks.opened).toEqual([manifestPath]);
    expect(hooks.require).not.toHaveBeenCalled();
  });

  it.each([0, 1, NaN, Infinity])("refuses inconsistent reported manifest size %s", async size => {
    hooks.reportedSize = size;
    const { loadBinding } = await import("../native/loader.mjs");
    const error = await loadBinding().catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).not.toBe("ENOTSUP");
    expect(hooks.require).not.toHaveBeenCalled();
  });

  for (const phase of ["open", "stat", "read", "close", "require", "report"] as const) {
    it.each([false, null, 0, "", NaN, undefined])(`caches original falsey ${phase} failure: %s`, async reason => {
      if (phase === "close") { hooks.closeFault = true; hooks.closeReason = reason; }
      else if (phase === "require") hooks.require.mockImplementation(() => { throw reason; });
      else if (phase === "report") hooks.runtime.report.getReport.mockImplementation(() => { throw reason; });
      else { hooks.fault = phase; hooks.reason = reason; }
      const { loadBinding } = await import("../native/loader.mjs");
      const first = loadBinding(), second = loadBinding();
      expect(second).toBe(first);
      await expect(first).rejects.toBe(reason);
      await expect(second).rejects.toBe(reason);
      expect(loadBinding()).toBe(first);
    });
  }

  it("preserves a falsey read primary over a close failure", async () => {
    hooks.fault = "read";
    hooks.reason = false;
    hooks.closeFault = true;
    hooks.closeReason = new Error("secondary");
    const { loadBinding } = await import("../native/loader.mjs");
    await expect(loadBinding()).rejects.toBe(false);
  });

  it("preserves an undefined read primary over a falsey close failure", async () => {
    hooks.fault = "read";
    hooks.reason = undefined;
    hooks.closeFault = true;
    hooks.closeReason = false;
    const { loadBinding } = await import("../native/loader.mjs");
    const pending = loadBinding();
    await expect(pending).rejects.toBeUndefined();
    expect(loadBinding()).toBe(pending);
    expect(hooks.require).not.toHaveBeenCalled();
  });

  it.each([undefined, null, false, {}, { seekEnd: 1 }])("rejects invalid binding %s without fallback", async binding => {
    hooks.require.mockReturnValue(binding);
    const { loadBinding } = await import("../native/loader.mjs");
    await expect(loadBinding()).rejects.toMatchObject({ code: "EIO" });
    expect(hooks.require).toHaveBeenCalledOnce();
  });
});
