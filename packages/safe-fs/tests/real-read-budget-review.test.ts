import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealFileSystem } from "../src/fs/real/index.js";
import { createNodeFsBridge } from "../src/node/filesystem.js";
import { Shell } from "../../safe-bash/src/shell/shell.js";
import { createStandardCommandsWithGrep } from "../../safe-bash/src/commands/standard.js";

const hooks = vi.hoisted(() => ({ lengths: [] as number[], closes: 0 }));

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    open: vi.fn(async (path: string, flags: number, mode?: number) => {
      const handle = await fs.promises.open(path, flags, mode);
      const read = handle.read.bind(handle);
      const close = handle.close.bind(handle);
      handle.read = async (buffer, offset, length, position) => {
        hooks.lengths.push(length);
        return read(buffer, offset, length, position);
      };
      handle.close = async () => { hooks.closes++; await close(); };
      return handle;
    }),
  };
});

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return { constants: fs.constants };
});

function allocationGuard(): number[] {
  const requests: number[] = [];
  vi.stubGlobal("Uint8Array", new Proxy(Uint8Array, {
    construct(target, args, newTarget) {
      const length: unknown = args[0];
      if (typeof length === "number") {
        requests.push(length);
        if (length > 1024 * 1024) throw new RangeError("review allocation guard: no large allocation performed");
      }
      return Reflect.construct(target, args, newTarget);
    },
  }));
  return requests;
}

beforeEach(() => {
  vol.reset();
  vol.fromJSON({ "/machine/file": "inside\n", "/machine/equal": "inside\n" });
  hooks.lengths = [];
  hooks.closes = 0;
  vi.clearAllMocks();
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("#726 real filesystem read allocation boundary (guarded memfs only)", () => {
  it("admits a direct safe-integer retained-read allocation request before mapping allocation refusal to EFBIG", async () => {
    const filesystem = new RealFileSystem("/machine");
    const handle = await filesystem.openReadFile("/file");
    const requests = allocationGuard();
    try {
      await expect(handle.read(0, Number.MAX_SAFE_INTEGER)).rejects.toMatchObject({ code: "EFBIG" });
      expect(requests).toContain(Number.MAX_SAFE_INTEGER);
      expect(hooks.lengths).toEqual([]);
    } finally { vi.unstubAllGlobals(); await handle.close(); }
    expect(hooks.closes).toBe(1);
  });

  it("admits a direct safe-integer stream chunk request without using the small file size as an allocation cap", async () => {
    const filesystem = new RealFileSystem("/machine");
    const requests = allocationGuard();
    const iterator = filesystem.readStream("/file", { chunkSize: Number.MAX_SAFE_INTEGER })[Symbol.asyncIterator]();
    try {
      await expect(iterator.next()).rejects.toMatchObject({ code: "EIO" });
      expect(requests).toContain(Number.MAX_SAFE_INTEGER);
      expect(hooks.lengths).toEqual([]);
    } finally { vi.unstubAllGlobals(); await iterator.return?.(); }
    expect(hooks.closes).toBe(1);
  });

  it("caps stream allocation by the explicit endExclusive range", async () => {
    const filesystem = new RealFileSystem("/machine");
    const requests = allocationGuard();
    const iterator = filesystem.readStream("/file", { chunkSize: Number.MAX_SAFE_INTEGER, start: 1, endExclusive: 4 })[Symbol.asyncIterator]();
    try {
      const next = await iterator.next();
      expect(new TextDecoder().decode(next.value)).toBe("nsi");
      expect((await iterator.next()).done).toBe(true);
      expect(requests).toContain(3);
      expect(requests).not.toContain(Number.MAX_SAFE_INTEGER);
      expect(hooks.lengths).toEqual([3]);
    } finally { vi.unstubAllGlobals(); await iterator.return?.(); }
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])("rejects invalid retained-read size %s before allocation", async size => {
    const handle = await new RealFileSystem("/machine").openReadFile("/file");
    const requests = allocationGuard();
    try {
      await expect(handle.read(0, size)).rejects.toMatchObject({ code: "EINVAL" });
      expect(requests).toEqual([]);
      expect(hooks.lengths).toEqual([]);
    } finally { vi.unstubAllGlobals(); await handle.close(); }
  });

  it("rejects retained-read offset overflow and pre-abort before allocation", async () => {
    const handle = await new RealFileSystem("/machine").openReadFile("/file");
    const controller = new AbortController();
    const reason = new Error("review pre-abort");
    controller.abort(reason);
    const requests = allocationGuard();
    try {
      await expect(handle.read(1, Number.MAX_SAFE_INTEGER)).rejects.toMatchObject({ code: "EINVAL" });
      await expect(handle.read(0, Number.MAX_SAFE_INTEGER, { signal: controller.signal })).rejects.toBe(reason);
      expect(requests).toEqual([]);
      expect(hooks.lengths).toEqual([]);
    } finally { vi.unstubAllGlobals(); await handle.close(); }
  });

  it("rejects untrusted bridge read options rather than forwarding allocation sizes", async () => {
    const bridge = createNodeFsBridge(new RealFileSystem("/machine"));
    const requests = allocationGuard();
    for (const key of ["chunkSize", "maxBytes", "highWaterMark"]) {
      await expect(Reflect.apply(bridge.readFile, bridge, ["/file", { [key]: Number.MAX_SAFE_INTEGER }])).rejects.toThrow();
    }
    expect(hooks.lengths).toEqual([]);
    expect(requests).not.toContain(Number.MAX_SAFE_INTEGER);
    expect("readStream" in bridge).toBe(false);
    expect("openReadFile" in bridge).toBe(false);
  });

  it.each([
    { script: "head -c 9007199254740991 /file", maximum: 65536, output: "inside\n" },
    { script: "cmp -n 9007199254740991 /file /equal", maximum: 4096, output: "" },
    { script: "cat < /file", maximum: 65536, output: "inside\n" },
  ])("keeps maintained shell reads bounded for $script", async ({ script, maximum, output }) => {
    const shell = new Shell({ fs: new RealFileSystem("/machine") });
    for (const definition of createStandardCommandsWithGrep({}, [])) shell.commands.register(definition);
    const requests = allocationGuard();
    try {
      const result = await shell.exec(script);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(output);
      expect(result.stderr).toBe("");
      expect(hooks.lengths.length).toBeGreaterThan(0);
      expect(Math.max(...hooks.lengths)).toBeLessThanOrEqual(maximum);
      expect(requests).not.toContain(Number.MAX_SAFE_INTEGER);
    } finally { vi.unstubAllGlobals(); await shell.dispose(); }
  });
});
