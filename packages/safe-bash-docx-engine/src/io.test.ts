import { describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { DocumentIo, DocumentBudget, createDocumentArchive, writeDocumentArchive, type ArchiveLimits } from "./index.js";

const limits: ArchiveLimits = {
  maxArchiveBytes: 65536, maxEntryBytes: 32768, maxTotalBytes: 65536,
  maxMembers: 100, maxPathBytes: 256, maxDepth: 16, maxExtraBytes: 0,
  maxCommentBytes: 0, maxRetainedBytes: 16 * 1024 * 1024, chunkSize: 512
};
const context = () => ({ limits, signal: new AbortController().signal });
const options = { order: "name", compression: "store" } as const;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function fixture() {
  const archive = await createDocumentArchive({}, context());
  const fs = Volume.fromJSON({ "/document": "" });
  await writeDocumentArchive(archive, { async write(bytes) { fs.appendFileSync("/document", bytes); } }, options, context());
  return { archive, bytes: new Uint8Array(fs.readFileSync("/document") as Uint8Array) };
}

describe("document byte I/O lifetime", () => {
  it("owns reused byte views before advancing or finalizing a source", async () => {
    const { bytes } = await fixture();
    const scratch = new Uint8Array(127);
    const io = new DocumentIo(context());
    const result = await io.read({ async *open() {
      try {
        for (let offset = 0; offset < bytes.length; offset += scratch.length) {
          const size = Math.min(scratch.length, bytes.length - offset);
          scratch.set(bytes.subarray(offset, offset + size));
          yield scratch.subarray(0, size);
        }
      } finally { scratch.fill(0); }
    } });
    expect(result.mainPart).toBe("word/document.xml");
    await io.cleanup();
  });

  it("registers before acquisition, closes admission and shares draining cleanup", async () => {
    const gate = deferred();
    const entered = deferred();
    const finished = vi.fn();
    let cleanup!: () => Promise<void>;
    const io = new DocumentIo({ ...context(), registerCleanup(callback) { cleanup = callback; } });
    const read = io.read({ async *open(signal) {
      expect(cleanup).toBeTypeOf("function");
      entered.resolve();
      try { await gate.promise; signal.throwIfAborted(); yield new Uint8Array(); }
      finally { finished(); }
    } });
    const rejected = expect(read).rejects.toMatchObject({ code: "cancelled" });
    await entered.promise;
    const first = cleanup();
    expect(cleanup()).toBe(first);
    const settled = vi.fn();
    void first.then(settled);
    await expect(io.read({ open: vi.fn() })).rejects.toMatchObject({ code: "cancelled" });
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    gate.resolve();
    await rejected;
    await first;
    expect(finished).toHaveBeenCalledOnce();
  });

  it("awaits sink backpressure and drains an admitted write on cleanup", async () => {
    const { archive } = await fixture();
    const io = new DocumentIo(context());
    const gate = deferred();
    const entered = deferred();
    const sink = { write: vi.fn(async (_bytes: Uint8Array, signal: AbortSignal) => {
      entered.resolve(); await gate.promise; signal.throwIfAborted();
    }) };
    const write = io.write(archive, sink, options);
    const rejected = expect(write).rejects.toMatchObject({ code: "cancelled" });
    await entered.promise;
    await Promise.resolve();
    expect(sink.write).toHaveBeenCalledOnce();
    const close = io.cleanup();
    gate.resolve();
    await rejected;
    await close;
    expect(sink.write).toHaveBeenCalledOnce();
  });

  it("keeps sibling scopes and borrowed signals alive when one scope closes", async () => {
    const shared = context();
    const first = new DocumentIo(shared);
    const sibling = new DocumentIo(shared);
    await first.cleanup();
    expect(shared.signal.aborted).toBe(false);
    const { bytes } = await fixture();
    expect((await sibling.read({ async *open() { yield bytes; } })).kind).toBe("docx");
    await sibling.cleanup();
  });

  it("propagates source and iterator-close errors without leaking pending work", async () => {
    const failure = new Error("source unavailable");
    const io = new DocumentIo(context());
    await expect(io.read({ open() { throw failure; } })).rejects.toBe(failure);
    await expect(io.read({ open(): AsyncIterableIterator<Uint8Array> { return {
      [Symbol.asyncIterator]() { return this; },
      async next() { return { done: false as const, value: new Uint8Array(65537) }; },
      async return() { throw failure; }
    }; } })).rejects.toMatchObject({ code: "limit-exceeded" });
    await io.cleanup();
  });

  it("preserves source failure when finalization also fails", async () => {
    const io = new DocumentIo(context());
    const failure = new Error("read failed");
    const close = vi.fn(async () => { throw new Error("close failed"); });
    await expect(io.read({ open(): AsyncIterableIterator<Uint8Array> { return {
      [Symbol.asyncIterator]() { return this; },
      async next(): Promise<IteratorResult<Uint8Array>> { throw failure; },
      return: close
    }; } })).rejects.toBe(failure);
    expect(close).toHaveBeenCalledOnce();
    await io.cleanup();
  });

  it.each(["before", "source", "sink"] as const)("preserves borrowed cancellation at %s", async phase => {
    const controller = new AbortController();
    const io = new DocumentIo({ limits, signal: controller.signal });
    const reason = new Error("caller stopped");
    const { archive, bytes } = await fixture();
    if (phase === "before") controller.abort(reason);
    const source = vi.fn(async function* () { controller.abort(reason); yield bytes; });
    const result = phase === "sink"
      ? io.write(archive, { async write() { controller.abort(reason); throw new Error("late sink failure"); } }, options)
      : io.read({ open: source });
    await expect(result).rejects.toMatchObject({ code: "cancelled", cause: reason });
    if (phase === "before") expect(source).not.toHaveBeenCalled();
    await io.cleanup();
  });

  it("preserves sink failures and awaits iterator finalization without optional hooks", async () => {
    const { archive } = await fixture();
    const io = new DocumentIo(context());
    await expect(io.write(archive, { async write() { throw new Error("destination full"); } }, options))
      .rejects.toMatchObject({ code: "sink-failure" });
    const gate = deferred();
    const entered = deferred();
    const result = io.read({ open(): AsyncIterableIterator<Uint8Array> { return {
      [Symbol.asyncIterator]() { return this; },
      async next() { return { done: false as const, value: new Uint8Array(65537) }; },
      async return() { entered.resolve(); await gate.promise; return { done: true as const, value: undefined }; }
    }; } });
    const rejected = expect(result).rejects.toMatchObject({ code: "limit-exceeded" });
    await entered.promise;
    const closed = io.cleanup();
    gate.resolve();
    await rejected;
    await closed;
  });

  it("closes admission when registration immediately invokes cleanup", async () => {
    let registered!: Promise<void>;
    const source = { open: vi.fn() };
    const io = new DocumentIo({ ...context(), registerCleanup(close) { registered = close(); } });
    expect(io.cleanup()).toBe(registered);
    await expect(io.read(source)).rejects.toMatchObject({ code: "cancelled" });
    expect(source.open).not.toHaveBeenCalled();
    await registered;
  });

  it("enrolls acquisition before a source reenters cleanup", async () => {
    const next = vi.fn();
    const close = vi.fn(async () => ({ done: true as const, value: undefined }));
    const io = new DocumentIo(context());
    let completion!: Promise<void>;
    await expect(io.read({ open() {
      completion = io.cleanup();
      return { [Symbol.asyncIterator]() { return { next, return: close }; } };
    } })).rejects.toMatchObject({ code: "cancelled" });
    await completion;
    expect(next).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("preserves caller provenance when cancellation arrives during finalization", async () => {
    const controller = new AbortController();
    const io = new DocumentIo({ limits, signal: controller.signal });
    const callerReason = new Error("caller finalization abort");
    await expect(io.read({ open(): AsyncIterableIterator<Uint8Array> { return {
      [Symbol.asyncIterator]() { return this; },
      async next() { throw new Error("source failure"); },
      async return() { controller.abort(callerReason); throw new Error("finalization failure"); }
    }; } })).rejects.toMatchObject({ code: "cancelled", cause: callerReason });
    await io.cleanup();
  });

  it("cancels parsing through the injected cooperative scheduler", async () => {
    const { bytes } = await fixture();
    const controller = new AbortController();
    const reason = new Error("parse cancelled");
    let ended = false;
    const budget = new DocumentBudget({}, controller.signal, async () => {
      if (ended) controller.abort(reason);
    });
    const io = new DocumentIo({ limits, signal: controller.signal, budget });
    await expect(io.read({ async *open() { yield bytes; ended = true; } }))
      .rejects.toMatchObject({ code: "cancelled", cause: reason });
    await io.cleanup();
  });

  it("owns write input before the caller can reuse payloads", async () => {
    const { archive } = await fixture();
    const io = new DocumentIo(context());
    const fs = Volume.fromJSON({ "/output": "" });
    const pending = io.write(archive, { async write(bytes) { fs.appendFileSync("/output", bytes); } }, options);
    for (const member of archive.members) member.bytes.fill(0);
    await pending;
    const output = new Uint8Array(fs.readFileSync("/output") as Uint8Array);
    expect((await io.read({ async *open() { yield output; } })).kind).toBe("docx");
    await io.cleanup();
  });

  it("preserves escaping sink failure over scope-local cleanup", async () => {
    const { archive } = await fixture();
    const io = new DocumentIo(context());
    const gate = deferred();
    const entered = deferred();
    const failure = new Error("destination failed after close");
    const pending = io.write(archive, { async write() {
      entered.resolve(); await gate.promise; throw failure;
    } }, options);
    const rejected = expect(pending).rejects.toMatchObject({ code: "sink-failure", cause: failure });
    await entered.promise;
    const close = io.cleanup();
    gate.resolve();
    await rejected;
    await close;
  });

  it("charges retained fragment bookkeeping before admitting tiny chunks", async () => {
    const io = new DocumentIo({ ...context(), limits: { ...limits, maxRetainedBytes: 128 } });
    let produced = 0;
    await expect(io.read({ async *open() {
      while (true) { produced++; yield new Uint8Array([1]); }
    } })).rejects.toMatchObject({ code: "limit-exceeded" });
    expect(produced).toBe(2);
    await io.cleanup();
  });

  it("cooperatively yields during acquisition before requesting another fragment", async () => {
    const controller = new AbortController();
    const reason = new Error("acquisition cancelled");
    const scheduler = vi.fn(async () => { controller.abort(reason); });
    const budget = new DocumentBudget({}, controller.signal, scheduler);
    const io = new DocumentIo({ limits, signal: controller.signal, budget });
    let produced = 0;
    const pending = io.read({ async *open() {
      for (let index = 0; index < 2; index++) { produced++; yield new Uint8Array(4096); }
    } });
    await expect(pending).rejects.toMatchObject({ code: "cancelled", cause: reason });
    expect(scheduler).toHaveBeenCalledOnce();
    expect(produced).toBe(1);
    await io.cleanup();
  });

  it("bounds empty-source work and input retention before copies", async () => {
    const budget = new DocumentBudget({ work: 3 }, context().signal);
    const io = new DocumentIo({ ...context(), budget });
    let reads = 0;
    await expect(io.read({ async *open() { while (true) { reads++; yield new Uint8Array(); } } }))
      .rejects.toMatchObject({ code: "limit-exceeded" });
    expect(reads).toBeLessThanOrEqual(4);
    await io.cleanup();
  });
});
