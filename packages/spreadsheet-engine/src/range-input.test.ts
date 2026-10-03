import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createEngine } from "./engine.js";
import type { Codec } from "./codecs.js";
import type { RangeSource } from "./contracts.js";

const operation = () => ({ signal: new AbortController().signal });
const book = { sheets: [{ id: "s", name: "Data", cells: [] }] };

it("reads a caller-owned range source without collecting its payload", async () => {
  const size = 128 * 1024 * 1024, reads: number[] = [];
  const source: RangeSource = { size, async read(position, maximum) {
    reads.push(maximum); return new Uint8Array(Math.min(maximum, size - position)).fill(position % 251);
  } };
  const codec: Codec = { id: "range", description: "range fixture", extensions: [],
    async readSource(input) {
      expect(input.size).toBe(size);
      expect(await input.read(size - 3, 3)).toEqual(new Uint8Array(3).fill((size - 3) % 251));
      return book;
    }
  };
  const engine = createEngine({ codecs: [codec] });
  await engine.readWorkbook({ kind: "range", source }, { importType: "range" }, operation());
  expect(reads).toEqual([3]);
  await engine.dispose();
});

it("spills reused input chunks only into the injected filesystem and reads bounded ranges", async () => {
  const fs = createMemoryFileSystem(), open = fs.open.bind(fs);
  let persisted = 0, largestWrite = 0, largestRead = 0;
  const acquisition = vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args);
    const read = handle.read.bind(handle), write = handle.write.bind(handle);
    vi.spyOn(handle, "read").mockImplementation(async (bytes, position, options) => {
      largestRead = Math.max(largestRead, bytes.length); return read(bytes, position, options);
    });
    vi.spyOn(handle, "write").mockImplementation(async (bytes, position, options) => {
      persisted += bytes.length; largestWrite = Math.max(largestWrite, bytes.length); return write(bytes, position, options);
    });
    return handle;
  });
  const readFile = vi.spyOn(fs, "readFile").mockRejectedValue(new Error("payload readFile"));
  const writeFile = vi.spyOn(fs, "writeFile").mockRejectedValue(new Error("payload writeFile"));
  const buffered = vi.fn(async () => { throw new Error("buffered reader"); });
  const codec: Codec = { id: "range", description: "range fixture", extensions: [], read: buffered,
    async readSource(input) {
      expect(input.size).toBe(256 * 4096);
      for (const page of [0, 255, 17, 128, 0]) expect(await input.read(page * 4096 + 7, 19)).toEqual(new Uint8Array(19).fill(page));
      return book;
    }
  };
  const engine = createEngine({ codecs: [codec], workingFiles: { fs, directory: "/", cacheBytes: 32768 } });
  await engine.readWorkbook({ kind: "stream", source: (async function* () {
    const chunk = new Uint8Array(4096);
    for (let i = 0; i < 256; i++) { chunk.fill(i); yield chunk; }
    chunk.fill(99);
  })() }, { importType: "range" }, operation());
  expect(buffered).not.toHaveBeenCalled();
  expect(readFile).not.toHaveBeenCalled(); expect(writeFile).not.toHaveBeenCalled();
  expect(acquisition).toHaveBeenCalledOnce();
  expect(persisted).toBeGreaterThanOrEqual(256 * 4096);
  expect(largestWrite).toBeLessThanOrEqual(16384); expect(largestRead).toBeLessThanOrEqual(16384);
  expect(await fs.readdir("/")).toEqual([]);
  await engine.dispose();
});

it("probes a range-backed reader without invoking its byte-array probe", async () => {
  const probeContent = vi.fn(async () => { throw new Error("whole-payload probe"); });
  const codec: Codec = { id: "range", description: "range fixture", extensions: ["range"], contentProbe: true,
    probeName: () => true, probeContent,
    async probeSource(source) { return (await source.read(0, 1))[0] === 42; },
    async readSource() { return book; }
  };
  const engine = createEngine({ codecs: [codec] });
  await engine.readWorkbook({ kind: "range", filename: "a.range", source: { size: 1, async read() { return Uint8Array.of(42); } } }, {}, operation());
  expect(probeContent).not.toHaveBeenCalled();
  await engine.dispose();
});

it("owns reused range responses before admitting another read", async () => {
  const buffer = new Uint8Array(4);
  const engine = createEngine({ codecs: [{ id: "range", description: "range fixture", extensions: [],
    async readSource(source) {
      const [first, second] = await Promise.all([source.read(0, 4), source.read(4, 4)]);
      expect(first).toEqual(new Uint8Array(4)); expect(second).toEqual(new Uint8Array(4).fill(4));
      return book;
    }
  }] });
  await engine.readWorkbook({ kind: "range", source: { size: 8, async read(position) { buffer.fill(position); return buffer; } } }, { importType: "range" }, operation());
  await engine.dispose();
});

it("forwards operation cancellation into an admitted backend range read", async () => {
  const controller = new AbortController(), reason = new Error("cancel range");
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const engine = createEngine({ codecs: [{ id: "range", description: "range fixture", extensions: [],
    async readSource(source) { await source.read(0, 1); return book; }
  }] });
  const reading = engine.readWorkbook({ kind: "range", source: { size: 1, async read(_position, _maximum, options) {
    entered();
    if (!options?.signal) throw new Error("range operation signal missing");
    const signal = options.signal;
    return new Promise<Uint8Array>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  } } }, { importType: "range" }, { signal: controller.signal });
  const rejected = expect(reading).rejects.toBe(reason);
  await ready; controller.abort(reason); await rejected;
  await engine.dispose();
});

it("uses a resource binding's retained ranges without requiring writable scratch storage", async () => {
  const closed = vi.fn(), read = vi.fn(async () => { throw new Error("sequential input used"); });
  const engine = createEngine({ codecs: [{ id: "range", description: "range fixture", extensions: [],
    async readSource(source) { expect(await source.read(17, 1)).toEqual(Uint8Array.of(42)); return book; }
  }], filesystem: { read, async write() { throw new Error("read-only"); }, async openInput(_name, context) {
    context.own(closed);
    return { size: 1000, async read() { return Uint8Array.of(42); } };
  } } });
  await engine.readWorkbook({ kind: "resource", uri: "/read-only.data" }, { importType: "range" }, operation());
  expect(read).not.toHaveBeenCalled(); expect(closed).toHaveBeenCalledOnce();
  await engine.dispose();
});

it("keeps the opened file identity after pathname replacement and revokes ranges at operation end", async () => {
  const { createVfsInput } = await import("./io/retained-input.js");
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", Uint8Array.of(42)); await fs.writeFile("/replacement", Uint8Array.of(99));
  let saved!: RangeSource;
  const engine = createEngine({ codecs: [{ id: "range", description: "range fixture", extensions: [],
    async readSource(source) {
      saved = source;
      await fs.rename("/replacement", "/input");
      expect(await source.read(0, 1)).toEqual(Uint8Array.of(42));
      return book;
    }
  }], filesystem: { openInput: createVfsInput(fs), async read() { throw new Error("sequential input"); }, async write() {} } });
  await engine.readWorkbook({ kind: "resource", uri: "/input" }, { importType: "range" }, operation());
  expect(await fs.readFile("/input")).toEqual(Uint8Array.of(99));
  await expect(saved.read(0, 1)).rejects.toThrow("closed");
  await engine.dispose();
});

it.each(["write", "cancel"] as const)("retires input and backing handles after spill %s failure", async failure => {
  const fs = createMemoryFileSystem(), open = fs.open.bind(fs), controller = new AbortController();
  const reason = new Error("spill failed");
  let retired = 0, closed = 0;
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), close = handle.close.bind(handle);
    vi.spyOn(handle, "write").mockImplementation(async () => {
      if (failure === "cancel") controller.abort(reason);
      throw reason;
    });
    vi.spyOn(handle, "close").mockImplementation(async options => { closed++; await close(options); });
    return handle;
  });
  const readSource = vi.fn(async () => book);
  const engine = createEngine({ codecs: [{ id: "range", description: "range fixture", extensions: [], readSource }],
    workingFiles: { fs, directory: "/", cacheBytes: 32768 } });
  await expect(engine.readWorkbook({ kind: "stream", source: (async function* () {
    try { const chunk = new Uint8Array(4096); for (let i = 0; i < 32; i++) yield chunk; }
    finally { retired++; }
  })() }, { importType: "range" }, { signal: controller.signal })).rejects.toBe(reason);
  expect(readSource).not.toHaveBeenCalled(); expect(retired).toBe(1); expect(closed).toBe(1);
  expect(await fs.readdir("/")).toEqual([]);
  await engine.dispose();
});

it("isolates range-probe byte mutations and freezes the shared source capability", async () => {
  const bytes = Uint8Array.of(42);
  const engine = createEngine({ codecs: [
    { id: "first", description: "mutating probe", extensions: [], async readSource() { return book; },
      async probeSource(source) {
        (await source.read(0, 1)).fill(0);
        expect(Reflect.set(source, "size", 0)).toBe(false);
        return false;
      } },
    { id: "second", description: "accepting probe", extensions: [], async readSource() { return book; },
      async probeSource(source) { expect(source.size).toBe(1); expect(await source.read(0, 1)).toEqual(Uint8Array.of(42)); return true; } }
  ] });
  await engine.readWorkbook({ kind: "range", source: { size: 1, async read() { return bytes; } } }, {}, operation());
  expect(bytes).toEqual(Uint8Array.of(42));
  await engine.dispose();
});

it("drains an admitted range read before closing its retained handle", async () => {
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const events: string[] = [];
  let outstanding!: Promise<Uint8Array>;
  const engine = createEngine({ codecs: [{ id: "range", description: "range fixture", extensions: [],
    async readSource(source) {
      outstanding = source.read(0, 1);
      void outstanding.catch(() => {});
      await ready;
      return book;
    }
  }], filesystem: { async read() { throw new Error("sequential input"); }, async write() {},
    async openInput(_name, context) {
      context.own(() => { events.push("close"); });
      return { size: 1, async read() { entered(); await blocked; events.push("read"); return Uint8Array.of(42); } };
    }
  } });
  const reading = engine.readWorkbook({ kind: "resource", uri: "/input" }, { importType: "range" }, operation());
  await ready;
  await Promise.resolve(); await Promise.resolve();
  expect(events).toEqual([]);
  release();
  await reading;
  await outstanding.catch(() => {});
  expect(events).toEqual(["read", "close"]);
  await engine.dispose();
});

it("routes uppercase resource schemes through retained input adapters", async () => {
  const { createResourceIO } = await import("./io/index.js");
  const openInput = vi.fn(async () => ({ size: 1, async read() { return Uint8Array.of(42); } }));
  const binding = { openInput, async read() { throw new Error("sequential input"); }, async write() {} };
  const engine = createEngine({ codecs: [{ id: "range", description: "fixture", extensions: [],
    async readSource(source) { expect(await source.read(0, 1)).toEqual(Uint8Array.of(42)); return book; }
  }], filesystem: createResourceIO({ cwd: "/", filesystem: binding, adapters: { custom: binding } }) });
  for (const uri of ["FILE:///input", "CUSTOM://input"])
    await engine.readWorkbook({ kind: "resource", uri }, { importType: "range" }, operation());
  expect(openInput).toHaveBeenCalledTimes(2);
  await engine.dispose();
});

it.each(["closed", "denied"] as const)("does not acquire a retained handle when ownership is %s", async mode => {
  const { createVfsInput } = await import("./io/retained-input.js");
  const fs = createMemoryFileSystem();
  const openReadFile = vi.fn(fs.openReadFile.bind(fs));
  const input = createVfsInput({ capabilities: fs.capabilities, openReadFile });
  const engine = createEngine({ codecs: [{ id: "range", description: "fixture", extensions: [],
    async readSource(_source, context) {
      let cleanup: void | Promise<void>;
      await expect(input("/input", { ...context, own(close) {
        if (mode === "denied") throw new Error("ownership denied");
        cleanup = close();
      } })).rejects.toThrow(mode === "denied" ? "ownership denied" : "closed");
      await cleanup!;
      expect(openReadFile).not.toHaveBeenCalled();
      return book;
    }
  }] });
  await engine.readWorkbook({ kind: "range", source: { size: 0, async read() { return new Uint8Array(); } } }, { importType: "range" }, operation());
  await engine.dispose();
});
