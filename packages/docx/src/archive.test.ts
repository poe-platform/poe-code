import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import { createZipCodec, type ZipEntry } from "@poe-code/office-package";
import { readArchive, type ArchiveLimits } from "./index.js";
import { createDocumentFixture, fixtureLimits } from "../tests/fixtures/documents.js";

const limits: ArchiveLimits = {
  maxArchiveBytes: 32768,
  maxEntryBytes: 16384,
  maxTotalBytes: 30000,
  maxMembers: 24,
  maxPathBytes: 256,
  maxDepth: 16,
  maxExtraBytes: 1024,
  maxCommentBytes: 16384,
  maxRetainedBytes: 150000,
  chunkSize: 512
};
const signal = new AbortController().signal;
const context = { limits, signal };
const codec = createZipCodec();
const text = new TextEncoder().encode("Coastal notebook");
async function archive(
  names = ["word/document.xml"],
  content = text,
  changes: Partial<ZipEntry> = {}
) {
  const entries = [];
  for (const name of names) {
    const entry = await codec.makeZipEntry(
      name,
      content,
      {
        modified: new Date("2024-02-03T04:05:06Z"),
        mode: 0o100644,
        directory: false,
        symlink: false
      },
      fixtureLimits,
      signal
    );
    entries.push({ ...entry, ...changes });
  }
  return codec.writeZipArchive({ entries, comment: new Uint8Array() }, fixtureLimits, signal);
}
function patch(bytes: Uint8Array, fields: Array<[number, number, number]>) {
  const copy = new Uint8Array(bytes);
  const view = new DataView(copy.buffer);
  for (const [at, value, width] of fields) {
    if (width === 4) view.setUint32(at, value, true);
    else view.setUint16(at, value, true);
  }
  return copy;
}
function central(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset).getUint32(bytes.length - 6, true);
}

describe("document archive admission", () => {
  it.each(["garden", "observatory", "museum", "equipment"] as const)(
    "reads original %s parts with verified payloads",
    async (theme) => {
      const fixture = await createDocumentFixture(theme);
      const result = await readArchive(fixture.bytes, context);
      expect(new Map(result.members.map((member) => [member.name, member.bytes]))).toEqual(
        fixture.parts
      );
    }
  );

  it("admits bounded ZIP64 end records through the package export", async () => {
    const original = await archive();
    const end = original.length - 22;
    const start = central(original);
    const bytes = new Uint8Array(original.length + 76);
    bytes.set(original.subarray(0, end));
    bytes.set(original.subarray(end), end + 76);
    const view = new DataView(bytes.buffer);
    view.setUint32(end, 0x06064b50, true);
    view.setBigUint64(end + 4, 44n, true);
    view.setUint16(end + 12, 45, true);
    view.setUint16(end + 14, 45, true);
    view.setBigUint64(end + 24, 1n, true);
    view.setBigUint64(end + 32, 1n, true);
    view.setBigUint64(end + 40, BigInt(end - start), true);
    view.setBigUint64(end + 48, BigInt(start), true);
    view.setUint32(end + 56, 0x07064b50, true);
    view.setBigUint64(end + 64, BigInt(end), true);
    view.setUint32(end + 72, 1, true);
    expect((await readArchive(bytes, context)).members[0]!.bytes).toEqual(text);
    view.setBigUint64(end + 32, 1n << 63n, true);
    await expect(readArchive(bytes, context)).rejects.toMatchObject({ code: "limit-exceeded" });
  });

  it("admits empty archives under zero metadata budgets", async () => {
    const bytes = new Uint8Array(22);
    new DataView(bytes.buffer).setUint32(0, 0x06054b50, true);
    expect(
      await readArchive(bytes, {
        ...context,
        limits: { ...limits, maxExtraBytes: 0, maxCommentBytes: 0 }
      })
    ).toEqual({ members: [], comment: new Uint8Array() });
  });

  it("reads stored and deflated bytes without changing the memory filesystem", async () => {
    const fs = Volume.fromJSON({ "/keep": "untouched" });
    for (const bytes of [text, new Uint8Array(4096).fill(65)]) {
      const input = await archive(undefined, bytes);
      fs.writeFileSync("/input.docx", input);
      const before = fs.toJSON();
      const result = await readArchive(fs.readFileSync("/input.docx") as Uint8Array, context);
      expect(result.members[0]!.bytes).toEqual(bytes);
      expect(fs.toJSON()).toEqual(before);
    }
  });

  it("validates CRC before returning any member", async () => {
    const bytes = await archive();
    await expect(
      readArchive(
        patch(bytes, [
          [14, 0, 4],
          [central(bytes) + 16, 0, 4]
        ]),
        context
      )
    ).rejects.toMatchObject({ code: "invalid-container" });
  });

  it("rejects actual expansion differing from matching header declarations", async () => {
    const bytes = await archive(undefined, new Uint8Array(4096).fill(65));
    for (const size of [1, 4095, 4097]) {
      await expect(
        readArchive(
          patch(bytes, [
            [22, size, 4],
            [central(bytes) + 24, size, 4]
          ]),
          context
        )
      ).rejects.toMatchObject({ code: "invalid-container" });
    }
  });

  it("rejects exact duplicates and document-unsafe paths and links", async () => {
    for (const names of [["same", "same"], ["folder\\file"], ["C:notes"]]) {
      await expect(readArchive(await archive(names), context)).rejects.toMatchObject({
        code: "invalid-container"
      });
    }
    await expect(
      readArchive(await archive(["link"], text, { mode: 0o120777, symlink: true }), context)
    ).rejects.toMatchObject({ code: "invalid-container" });
  });

  it("rejects traversal, absolute paths, local disagreement, illegal methods and flags", async () => {
    const bytes = await archive(["aa"]);
    const at = central(bytes);
    for (const fields of [
      [
        [6, 1, 2],
        [at + 8, 1, 2]
      ],
      [
        [6, 16, 2],
        [at + 8, 16, 2]
      ],
      [
        [8, 99, 2],
        [at + 10, 99, 2]
      ],
      [[at + 42, 1, 4]],
      [[at + 28, 1, 2]],
      [
        [30, 0x2e2e, 2],
        [at + 46, 0x2e2e, 2]
      ],
      [
        [30, 0x612f, 2],
        [at + 46, 0x612f, 2]
      ],
      [[bytes.length - 18, 1, 2]]
    ] satisfies Array<Array<[number, number, number]>>) {
      await expect(readArchive(patch(bytes, fields), context)).rejects.toMatchObject({
        code: "invalid-container"
      });
    }
    for (const length of [0, 20, bytes.length - 1])
      await expect(readArchive(bytes.subarray(0, length), context)).rejects.toMatchObject({
        code: "invalid-container"
      });
  });

  it("enforces configured archive, member, aggregate, metadata and retained bounds", async () => {
    const bytes = await archive(["one", "two"]);
    for (const lower of [
      { maxArchiveBytes: bytes.length - 1 },
      { maxMembers: 1 },
      { maxEntryBytes: text.length - 1 },
      { maxTotalBytes: text.length },
      { maxPathBytes: 2 },
      { maxExtraBytes: 1 },
      { maxRetainedBytes: bytes.length * 3 - 1 },
      { maxRetainedBytes: bytes.length * 4 + 1024 + 65536 + 2 * text.length - 1 }
    ]) {
      await expect(
        readArchive(bytes, { ...context, limits: { ...limits, ...lower } })
      ).rejects.toMatchObject({ code: "limit-exceeded" });
    }
  });

  it("reserves decoder workspace before admitting compressed payloads", async () => {
    const bytes = await archive(undefined, new Uint8Array(4096).fill(65));
    await expect(
      readArchive(bytes, {
        ...context,
        limits: {
          ...limits,
          maxRetainedBytes: bytes.length * 4 + 2 * limits.chunkSize + 65536 + 4096 - 1
        }
      })
    ).rejects.toMatchObject({ code: "limit-exceeded" });
  });

  it("admits option types before bytes and never reads a host pathname", async () => {
    const bytes = await archive();
    for (const value of [NaN, Infinity, -1, 0, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(
        readArchive(bytes, { ...context, limits: { ...limits, maxMembers: value } })
      ).rejects.toMatchObject({ code: "usage" });
    }
    await expect(readArchive("/host.docx" as unknown as Uint8Array, context)).rejects.toMatchObject(
      { code: "usage" }
    );
  });

  it("owns input and configuration before its first suspension and isolates returned bytes", async () => {
    const bytes = await archive(["one", "two"]);
    const mutableLimits = { ...limits };
    const pending = readArchive(bytes, { limits: mutableLimits, signal });
    bytes.fill(0);
    mutableLimits.maxEntryBytes = 1;
    const result = await pending;
    result.members[0]!.bytes.fill(0);
    expect(result.members[1]!.bytes).toEqual(text);
  });

  it("maps cancellation before admission and after the first suspension", async () => {
    const bytes = await archive(undefined, new Uint8Array(4096).fill(65));
    const controller = new AbortController();
    const pending = readArchive(bytes, { limits, signal: controller.signal });
    controller.abort("stop");
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    await expect(readArchive(bytes, { limits, signal: controller.signal })).rejects.toMatchObject({
      code: "cancelled"
    });
  });
});
