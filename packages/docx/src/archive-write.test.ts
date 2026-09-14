import { describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { createZipCodec } from "@poe-code/office-package";
import { readArchive, writeArchive, type ArchiveMember, type ArchiveLimits } from "./index.js";

const limits: ArchiveLimits = {
  maxArchiveBytes: 2 * 1024 * 1024,
  maxEntryBytes: 65536,
  maxTotalBytes: 1024 * 1024,
  maxMembers: 10000,
  maxPathBytes: 256,
  maxDepth: 16,
  maxExtraBytes: 0,
  maxCommentBytes: 0,
  maxRetainedBytes: 16 * 1024 * 1024,
  chunkSize: 512
};
const context = { limits, signal: new AbortController().signal };
const options = { order: "name", compression: "store" } as const;
const codecLimits = { ...limits, maxPaxBytes: 0, maxTextBytes: 0 };
const codec = createZipCodec();
function member(name: string, bytes: Uint8Array = new Uint8Array()): ArchiveMember {
  return { name, bytes, directory: name.endsWith("/"), modified: new Date("2025-06-07T08:09:10Z") };
}
function sink() {
  const fs = Volume.fromJSON({ "/out": "" });
  const write = vi.fn(async (bytes: Uint8Array, signal: AbortSignal) => {
    signal.throwIfAborted();
    fs.appendFileSync("/out", bytes);
  });
  return { write, bytes: () => new Uint8Array(fs.readFileSync("/out") as Uint8Array) };
}

describe("deterministic document archive writing", () => {
  it("admits exact serialized size and compression that fits a smaller output ceiling", async () => {
    const empty = sink();
    await writeArchive({ members: [], comment: new Uint8Array() }, empty, options, {
      ...context,
      limits: { ...limits, maxArchiveBytes: 22 }
    });
    expect(empty.bytes().length).toBe(22);
    const exact = sink();
    await writeArchive(
      { members: [member("a", new Uint8Array([1]))], comment: new Uint8Array() },
      exact,
      options,
      { ...context, limits: { ...limits, maxArchiveBytes: 101 } }
    );
    expect(exact.bytes().length).toBe(101);
    const compressed = sink();
    await writeArchive(
      { members: [member("a", new Uint8Array(4096).fill(65))], comment: new Uint8Array() },
      compressed,
      { ...options, compression: "deflate" },
      { ...context, limits: { ...limits, maxArchiveBytes: 256 } }
    );
    expect(compressed.bytes().length).toBeLessThan(256);
    expect((await readArchive(compressed.bytes(), context)).members[0]!.bytes).toEqual(
      new Uint8Array(4096).fill(65)
    );
  });

  it("rejects compression overflow without output and isolates sink chunk buffers", async () => {
    const overflow = sink();
    await expect(
      writeArchive(
        { members: [member("a", new Uint8Array([0, 255, 1, 254]))], comment: new Uint8Array() },
        overflow,
        { ...options, compression: "deflate" },
        { ...context, limits: { ...limits, maxArchiveBytes: 101 } }
      )
    ).rejects.toMatchObject({ code: "limit-exceeded" });
    expect(overflow.write).not.toHaveBeenCalled();
    const output = sink();
    await writeArchive(
      { members: [member("a", new Uint8Array(2048).fill(7))], comment: new Uint8Array() },
      {
        async write(bytes, signal) {
          await output.write(bytes, signal);
          new Uint8Array(bytes.buffer).fill(0);
        }
      },
      options,
      context
    );
    expect((await readArchive(output.bytes(), context)).members[0]!.bytes).toEqual(
      new Uint8Array(2048).fill(7)
    );
  });

  it.each(["store", "deflate"] as const)(
    "writes empty and binary payloads with %s",
    async (compression) => {
      const members = [
        member("z", new Uint8Array([0, 255, 128, 10])),
        member("empty"),
        member("folder/")
      ];
      const output = sink();
      await writeArchive(
        { members, comment: new Uint8Array([255]) },
        output,
        { ...options, compression },
        context
      );
      const archive = await codec.readZipArchive(output.bytes(), codecLimits, context.signal);
      expect(archive.entries.map((entry) => entry.name)).toEqual(["empty", "folder/", "z"]);
      expect(archive.comment).toEqual(new Uint8Array());
      for (const entry of archive.entries) {
        expect(entry.method).toBe(compression === "deflate" && !entry.directory ? 8 : 0);
        expect(entry.modified.toISOString()).toBe("1980-01-01T00:00:00.000Z");
        expect(entry.localExtra).toEqual(new Uint8Array());
        expect(entry.flags).toBe(0x800);
      }
      expect(
        (await readArchive(output.bytes(), context)).members.map((item) => item.bytes)
      ).toEqual([new Uint8Array(), new Uint8Array(), members[0]!.bytes]);
    }
  );

  it("sorts by Unicode code point and supports explicit input order", async () => {
    const members = [member("\u{10000}"), member("\uE000"), member("a")];
    for (const order of ["name", "input"] as const) {
      const output = sink();
      await writeArchive(
        { members, comment: new Uint8Array() },
        output,
        { ...options, order },
        context
      );
      expect((await readArchive(output.bytes(), context)).members.map((item) => item.name)).toEqual(
        order === "name" ? ["a", "\uE000", "\u{10000}"] : members.map((item) => item.name)
      );
    }
  });

  it("preserves unedited original document parts across repacking", async () => {
    const members = [
      member("word/document.xml", new TextEncoder().encode("<note>Harbor</note>")),
      member("media/raw", new Uint8Array(2048).fill(254))
    ];
    const first = sink();
    const second = sink();
    await writeArchive(
      { members, comment: new Uint8Array() },
      first,
      { ...options, compression: "deflate" },
      context
    );
    const archive = await readArchive(first.bytes(), context);
    await writeArchive(archive, second, options, context);
    expect((await readArchive(second.bytes(), context)).members).toEqual(archive.members);
    const repeat = sink();
    await writeArchive(archive, repeat, options, context);
    expect(repeat.bytes()).toEqual(second.bytes());
  });

  it("admits every member and serialized byte before calling the destination", async () => {
    for (const members of [
      [member("a"), member("a")],
      [member("a"), member("../bad")],
      [member("folder/", new Uint8Array([1]))],
      [member("C:bad")]
    ]) {
      const output = sink();
      await expect(
        writeArchive({ members, comment: new Uint8Array() }, output, options, context)
      ).rejects.toMatchObject({ code: "invalid-container" });
      expect(output.write).not.toHaveBeenCalled();
    }
    for (const lower of [
      { maxMembers: 1 },
      { maxArchiveBytes: 180 },
      { maxRetainedBytes: 50 },
      { maxPathBytes: 2 },
      { maxTotalBytes: 1 },
      { maxEntryBytes: 1 }
    ]) {
      const output = sink();
      await expect(
        writeArchive(
          { members: [member("one", new Uint8Array(5)), member("two")], comment: new Uint8Array() },
          output,
          options,
          { ...context, limits: { ...limits, ...lower } }
        )
      ).rejects.toMatchObject({ code: "limit-exceeded" });
      expect(output.write).not.toHaveBeenCalled();
    }
  });

  it("owns bytes and options before suspension and awaits each output write", async () => {
    const payload = new Uint8Array(2048).fill(7);
    const members = [member("first", payload), member("last")];
    const output = sink();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const write = vi.fn(async (bytes: Uint8Array, signal: AbortSignal) => {
      started();
      await blocked;
      await output.write(bytes, signal);
    });
    const mutableOptions = { ...options };
    const mutableLimits = { ...limits };
    const pending = writeArchive(
      { members, comment: new Uint8Array() },
      { write },
      mutableOptions,
      { ...context, limits: mutableLimits }
    );
    payload.fill(0);
    members.reverse();
    mutableLimits.maxArchiveBytes = 1;
    await entered;
    expect(write).toHaveBeenCalledTimes(1);
    release();
    await pending;
    expect(write.mock.calls.every(([bytes]) => bytes.length <= 512)).toBe(true);
    expect((await readArchive(output.bytes(), context)).members[0]!.bytes).toEqual(
      new Uint8Array(2048).fill(7)
    );
  });

  it("reports output failures and stops on abort after an awaited write", async () => {
    const archive = {
      members: [member("binary", new Uint8Array(2048))],
      comment: new Uint8Array()
    };
    const failure = vi.fn(async () => {
      throw new Error("private destination detail");
    });
    await expect(writeArchive(archive, { write: failure }, options, context)).rejects.toMatchObject(
      { code: "sink-failure", message: "Archive output failed." }
    );
    expect(failure).toHaveBeenCalledTimes(1);
    const controller = new AbortController();
    const write = vi.fn(async () => {
      controller.abort();
    });
    await expect(
      writeArchive(archive, { write }, options, { ...context, signal: controller.signal })
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(write).toHaveBeenCalledTimes(1);
    write.mockClear();
    await expect(
      writeArchive(archive, { write }, options, { ...context, signal: controller.signal })
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(write).not.toHaveBeenCalled();
  });

  it("rejects abort during preparation without output", async () => {
    const controller = new AbortController();
    const output = sink();
    const pending = writeArchive(
      { members: [member("binary", new Uint8Array(65536))], comment: new Uint8Array() },
      output,
      { ...options, compression: "deflate" },
      { ...context, signal: controller.signal }
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    expect(output.write).not.toHaveBeenCalled();
  });

  it("requires explicit valid options and byte input", async () => {
    for (const invalid of [
      { ...options, order: "unknown" },
      { ...options, compression: "auto" },
      { ...options, extra: true }
    ]) {
      await expect(
        writeArchive(
          { members: [], comment: new Uint8Array() },
          sink(),
          invalid as typeof options,
          context
        )
      ).rejects.toMatchObject({ code: "usage" });
    }
    await expect(
      writeArchive(
        { members: [member("a", "path" as unknown as Uint8Array)], comment: new Uint8Array() },
        sink(),
        options,
        context
      )
    ).rejects.toMatchObject({ code: "usage" });
  });
});
