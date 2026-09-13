import { describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { inspectZip } from "../tests/zip-reader.js";
import { storedArchive } from "../tests/fixtures/archive.js";
import { writeBinary } from "./bytes.js";
import { writePackageArchive } from "./package-writer.js";

const context = {
  limits: { maxBytes: 65536, maxReads: 1000, chunkBytes: 512 },
  archiveLimits: {
    maxArchiveBytes: 65536,
    maxEntryBytes: 4096,
    maxTotalBytes: 8192,
    maxMembers: 20,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 1024,
    chunkSize: 512
  }
};
const text = (value: string) => new TextEncoder().encode(value);
const members = [
  { name: "ppt/slides/slide1.xml", bytes: text("<slide>Orchard</slide>") },
  { name: "[Content_Types].xml", bytes: text("<Types/>") },
  { name: "_rels/.rels", bytes: text('<Links target="https://example.invalid/"/>') },
  { name: "ppt/media/é.bin", bytes: Uint8Array.of(0, 255, 17) }
];

function withDescriptor(signed: boolean, deflated: boolean): Uint8Array {
  const original = storedArchive([{ name: "keep", bytes: text("123456789") }]);
  const payload = deflated
    ? Uint8Array.of(0x33, 0x34, 0x32, 0x36, 0x31, 0x35, 0x33, 0xb7, 0xb0, 0x04, 0)
    : text("123456789");
  const descriptorSize = signed ? 16 : 12;
  const central = 34 + payload.length + descriptorSize;
  const bytes = new Uint8Array(central + 50 + 22);
  bytes.set(original.subarray(0, 34));
  bytes.set(payload, 34);
  bytes.set(original.subarray(43), central);
  const view = new DataView(bytes.buffer);
  view.setUint16(6, 0x808, true);
  view.setUint16(8, deflated ? 8 : 0, true);
  view.setUint32(14, 0, true);
  view.setUint32(18, 0, true);
  view.setUint32(22, 0, true);
  let descriptor = central - descriptorSize;
  if (signed) {
    view.setUint32(descriptor, 0x08074b50, true);
    descriptor += 4;
  }
  view.setUint32(descriptor, 0xcbf43926, true);
  view.setUint32(descriptor + 4, payload.length, true);
  view.setUint32(descriptor + 8, 9, true);
  view.setUint16(central + 8, 0x808, true);
  view.setUint16(central + 10, deflated ? 8 : 0, true);
  view.setUint32(central + 20, payload.length, true);
  view.setUint32(central + 66, central, true);
  return bytes;
}

describe("package ZIP serialization", () => {
  it("writes every supplied part in deterministic name order", async () => {
    const first = await writePackageArchive(members, context, { compression: "store" });
    const second = await writePackageArchive([...members].reverse(), context, {
      compression: "store"
    });
    expect(first).toEqual(second);
    const entries = inspectZip(first);
    expect(entries.map(({ name }) => name)).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "ppt/media/é.bin",
      "ppt/slides/slide1.xml"
    ]);
    for (const member of members) {
      expect(entries.find(({ name }) => name === member.name)?.payload).toEqual(member.bytes);
    }
    expect(entries.every(({ flags, method }) => flags === 0x800 && method === 0)).toBe(true);
  });

  it.each(["store", "auto"] as const)(
    "writes empty archives and entries with %s policy",
    async (compression) => {
      expect(inspectZip(await writePackageArchive([], context, { compression }))).toEqual([]);
      const entries = inspectZip(
        await writePackageArchive([{ name: "empty", bytes: new Uint8Array() }], context, {
          compression
        })
      );
      expect(entries[0]).toMatchObject({
        name: "empty",
        checksum: 0,
        method: 0,
        payload: new Uint8Array()
      });
    }
  );

  it("preserves UTF-8 names without Unicode normalization or BOM stripping", async () => {
    const names = ["\ufeffentry", "🌱", "é", "e\u0301"];
    const entries = inspectZip(
      await writePackageArchive(
        names.map((name) => ({ name, bytes: text(name) })),
        context,
        { compression: "store" }
      )
    );
    expect(entries.map(({ name }) => name)).toEqual(["e\u0301", "é", "🌱", "\ufeffentry"]);
    for (const entry of entries) expect(entry.payload).toEqual(text(entry.name));
  });

  it("writes three parts and their explicitly supplied relationship streams", async () => {
    const items = [
      { name: "ppt/alpha.xml", bytes: text("<alpha/>") },
      { name: "ppt/_rels/alpha.xml.rels", bytes: text("<alphaLinks/>") },
      { name: "ppt/beta.xml", bytes: text("<beta/>") },
      { name: "ppt/_rels/beta.xml.rels", bytes: text("<betaLinks/>") },
      { name: "ppt/gamma.xml", bytes: text("<gamma/>") },
      { name: "ppt/_rels/gamma.xml.rels", bytes: text("<gammaLinks/>") }
    ];
    const entries = inspectZip(await writePackageArchive(items, context, { compression: "store" }));
    expect(entries).toHaveLength(6);
    for (const item of items)
      expect(entries.find((entry) => entry.name === item.name)?.payload).toEqual(item.bytes);
  });

  it("applies the output ceiling to an empty archive", async () => {
    expect(
      (
        await writePackageArchive(
          [],
          { ...context, limits: { ...context.limits, maxBytes: 22 } },
          { compression: "store" }
        )
      ).length
    ).toBe(22);
    await expect(
      writePackageArchive(
        [],
        { ...context, limits: { ...context.limits, maxBytes: 21 } },
        { compression: "store" }
      )
    ).rejects.toMatchObject({ code: "resource-limit" });
  });

  it("compresses only when smaller under the explicit automatic policy", async () => {
    const entries = inspectZip(
      await writePackageArchive(
        [
          { name: "large", bytes: text("orchard ".repeat(200)) },
          { name: "tiny", bytes: Uint8Array.of(9) }
        ],
        context,
        { compression: "auto" }
      )
    );
    expect(entries.map(({ method }) => method)).toEqual([8, 0]);
    expect(entries[0]!.payload).toEqual(text("orchard ".repeat(200)));
    expect(entries[1]!.payload).toEqual(Uint8Array.of(9));
  });

  it("allows compression to fit a ceiling smaller than the decoded member", async () => {
    const entries = inspectZip(
      await writePackageArchive(
        [{ name: "small", bytes: text("x".repeat(2048)) }],
        {
          ...context,
          limits: { ...context.limits, maxBytes: 160 },
          archiveLimits: { ...context.archiveLimits, maxArchiveBytes: 160 }
        },
        { compression: "auto" }
      )
    );
    expect(entries[0]!.method).toBe(8);
    expect(entries[0]!.payload).toEqual(text("x".repeat(2048)));
  });

  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true]
  ])(
    "rebuilds complete headers from descriptor input signed=%s deflated=%s",
    async (signed, deflated) => {
      const source = withDescriptor(signed, deflated);
      const entries = inspectZip(
        await writePackageArchive(
          [
            { name: "keep", bytes: text("123456789") },
            { name: "added", bytes: text("new") }
          ],
          context,
          { compression: "auto", source }
        )
      );
      expect(entries[1]!.payload).toEqual(text("123456789"));
      expect(entries[1]!.method).toBe(deflated ? 8 : 0);
      expect(entries[1]!.compressed).toEqual(source.slice(34, 34 + (deflated ? 11 : 9)));
      expect(entries[1]!.flags & 8).toBe(0);
    }
  );

  it("owns all member payloads before the first asynchronous turn", async () => {
    const items = [
      { name: "a", bytes: text("123456789") },
      { name: "b", bytes: text("second") }
    ];
    const pending = writePackageArchive(items, context, { compression: "auto" });
    items[1]!.bytes.fill(0);
    items[0]!.name = "changed";
    items.reverse();
    expect(inspectZip(await pending).map(({ name, payload }) => [name, payload])).toEqual([
      ["a", text("123456789")],
      ["b", text("second")]
    ]);
  });

  it("publishes a complete archive through an explicit memfs sink", async () => {
    const volume = Volume.fromJSON({ "/deck": "old" });
    const output = await writePackageArchive(members, context, { compression: "store" });
    const chunks: Uint8Array[] = [];
    const close = vi.fn(async () => volume.writeFileSync("/deck", Buffer.concat(chunks)));
    await writeBinary(
      output,
      {
        async write(chunk) {
          chunks.push(chunk);
        },
        close
      },
      context,
      { close: true }
    );
    expect(close).toHaveBeenCalledOnce();
    expect(inspectZip(volume.readFileSync("/deck") as Uint8Array)).toHaveLength(4);
  });

  it("reuses unchanged compressed member bytes while replacing another payload", async () => {
    const originalMembers = [
      { name: "keep", bytes: text("orchard ".repeat(200)) },
      { name: "edit", bytes: text("before") }
    ];
    const source = await writePackageArchive(originalMembers, context, { compression: "auto" });
    const output = await writePackageArchive(
      [originalMembers[0]!, { name: "edit", bytes: text("after") }],
      context,
      { compression: "store", source }
    );
    const entries = inspectZip(output);
    expect(entries[1]!.compressed).toEqual(inspectZip(source)[1]!.compressed);
    expect(entries[1]!.method).toBe(8);
    expect(entries[1]!.payload).toEqual(originalMembers[0]!.bytes);
    expect(entries[0]!.payload).toEqual(text("after"));
    expect(output).not.toEqual(source);
  });

  it("rejects corrupt source members even when they are omitted from the output", async () => {
    const source = storedArchive([{ name: "bad", bytes: text("payload") }]);
    source[33] = 0;
    await expect(
      writePackageArchive([], context, { compression: "store", source })
    ).rejects.toMatchObject({ code: "invalid-archive" });
  });

  it.each(["a\\b", "C:/outside"])(
    "rejects unsafe omitted source member names: %s",
    async (name) => {
      const source = storedArchive([{ name, bytes: text("discarded") }]);
      await expect(
        writePackageArchive([], context, { compression: "store", source })
      ).rejects.toMatchObject({ code: "unsafe-path" });
    }
  );

  it.each(["", "/root", "../escape", "a/../b", "a\\b", "C:/a", "a\0b", "\ud800"])(
    "rejects unsafe archive names: %j",
    async (name) => {
      await expect(
        writePackageArchive([{ name, bytes: new Uint8Array() }], context, { compression: "store" })
      ).rejects.toMatchObject({ code: "unsafe-path" });
    }
  );

  it("rejects duplicate names and directory entries", async () => {
    await expect(
      writePackageArchive([members[0]!, members[0]!], context, { compression: "store" })
    ).rejects.toMatchObject({ code: "invalid-archive" });
    await expect(
      writePackageArchive([{ name: "folder/", bytes: new Uint8Array() }], context, {
        compression: "store"
      })
    ).rejects.toMatchObject({ code: "unsafe-path" });
  });

  it("admits exact byte ceilings and rejects one byte less", async () => {
    const items = [{ name: "digits", bytes: text("123456789") }];
    const output = await writePackageArchive(items, context, { compression: "store" });
    const exact = {
      ...context,
      limits: { ...context.limits, maxBytes: output.length },
      archiveLimits: {
        ...context.archiveLimits,
        maxArchiveBytes: output.length,
        maxEntryBytes: 9,
        maxTotalBytes: 9,
        maxMembers: 1,
        maxPathBytes: 6
      }
    };
    expect(
      inspectZip(await writePackageArchive(items, exact, { compression: "store" }))[0]!.checksum
    ).toBe(0xcbf43926);
    for (const key of [
      "maxArchiveBytes",
      "maxEntryBytes",
      "maxTotalBytes",
      "maxPathBytes"
    ] as const) {
      await expect(
        writePackageArchive(
          items,
          {
            ...exact,
            archiveLimits: { ...exact.archiveLimits, [key]: exact.archiveLimits[key] - 1 }
          },
          { compression: "store" }
        )
      ).rejects.toMatchObject({ code: "resource-limit" });
    }
    await expect(
      writePackageArchive(
        items,
        { ...exact, limits: { ...exact.limits, maxBytes: output.length - 1 } },
        { compression: "store" }
      )
    ).rejects.toMatchObject({ code: "resource-limit" });
  });

  it("rejects the classic member-count sentinel before inspecting entries", async () => {
    const items = new Array(65535);
    await expect(
      writePackageArchive(
        items,
        { ...context, archiveLimits: { ...context.archiveLimits, maxMembers: 70000 } },
        { compression: "store" }
      )
    ).rejects.toMatchObject({ code: "resource-limit" });
  });

  it.each([0xffffffff, 0x100000000])(
    "rejects reserved 32-bit member size metadata before copying: %s",
    async (length) => {
      const bytes = new Uint8Array();
      Object.defineProperty(bytes, "length", { value: length });
      await expect(
        writePackageArchive(
          [{ name: "large", bytes }],
          {
            ...context,
            archiveLimits: {
              ...context.archiveLimits,
              maxEntryBytes: length,
              maxTotalBytes: length
            }
          },
          { compression: "store" }
        )
      ).rejects.toMatchObject({ code: "resource-limit" });
    }
  );

  it("admits the 16-bit UTF-8 name boundary and rejects the next byte", async () => {
    const name = "é".repeat(32767) + "a";
    const wide = {
      ...context,
      limits: { ...context.limits, maxBytes: 140000 },
      archiveLimits: { ...context.archiveLimits, maxArchiveBytes: 140000, maxPathBytes: 70000 }
    };
    const output = await writePackageArchive([{ name, bytes: new Uint8Array() }], wide, {
      compression: "store"
    });
    expect(inspectZip(output)[0]!.name).toBe(name);
    await expect(
      writePackageArchive([{ name: name + "b", bytes: new Uint8Array() }], wide, {
        compression: "store"
      })
    ).rejects.toMatchObject({ code: "resource-limit" });
  });

  it("checks aggregate bytes and member count before source admission", async () => {
    const read = vi.fn();
    const items = [
      { name: "a", bytes: text("ab") },
      { name: "b", bytes: text("cd") }
    ];
    for (const archiveLimits of [
      { ...context.archiveLimits, maxTotalBytes: 3 },
      { ...context.archiveLimits, maxMembers: 1 }
    ]) {
      await expect(
        writePackageArchive(
          items,
          { ...context, archiveLimits },
          { compression: "store", source: { read } }
        )
      ).rejects.toMatchObject({ code: "resource-limit" });
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects invalid options and limits before reading a source", async () => {
    const read = vi.fn();
    for (const compression of [undefined, null, "deflate", 0]) {
      await expect(
        writePackageArchive([], context, { compression, source: { read } } as never)
      ).rejects.toMatchObject({ code: "invalid-value" });
    }
    await expect(
      writePackageArchive(
        [],
        { ...context, archiveLimits: { ...context.archiveLimits, maxMembers: NaN } },
        { compression: "store", source: { read } }
      )
    ).rejects.toMatchObject({ code: "invalid-value" });
    expect(read).not.toHaveBeenCalled();
  });

  it("cancels before admission and during serialization without returning output", async () => {
    const controller = new AbortController();
    const read = vi.fn();
    controller.abort();
    await expect(
      writePackageArchive(
        [],
        { ...context, signal: controller.signal },
        { compression: "store", source: { read } }
      )
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(read).not.toHaveBeenCalled();
    const running = new AbortController();
    const pending = writePackageArchive(
      members,
      { ...context, signal: running.signal },
      { compression: "auto" }
    );
    setTimeout(() => running.abort(), 0);
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  });

  it("proves the independent reader detects payload and header corruption", async () => {
    const bytes = await writePackageArchive(
      [{ name: "digits", bytes: text("123456789") }],
      context,
      { compression: "store" }
    );
    const changed = bytes.slice();
    const view = new DataView(changed.buffer);
    const payload = 36 + view.getUint16(28, true);
    changed[payload] = changed[payload]! ^ 1;
    expect(() => inspectZip(changed)).toThrow();
    new DataView(bytes.buffer).setUint32(22, 8, true);
    expect(() => inspectZip(bytes)).toThrow();
  });
});
