import { describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { storedArchive } from "../tests/fixtures/archive.js";
import { readPackage } from "./package-reader.js";

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
  { name: "ppt/presentation.xml", bytes: text("<garden/>") },
  { name: "ppt/_rels/presentation.xml.rels", bytes: text("<Relationships/>") },
  { name: "_rels/.rels", bytes: text("<RootLinks/>") },
  { name: "ppt/media/tile.bin", bytes: Uint8Array.of(0, 255, 17) }
];

describe("package byte reader", () => {
  it("reads content-type bytes as a reserved package stream", async () => {
    const reader = await readPackage(
      storedArchive([{ name: "[Content_Types].xml", bytes: text("<Types/>") }]),
      context
    );
    expect(reader.get("/[Content_Types].xml")).toEqual(text("<Types/>"));
  });

  it("accepts a direct pull source and finishes it before returning", async () => {
    const bytes = storedArchive(members);
    let offset = 0;
    let ended = false;
    const reader = await readPackage(
      {
        async read(maxBytes) {
          if (offset === bytes.length) {
            ended = true;
            return null;
          }
          const chunk = bytes.subarray(offset, offset + maxBytes);
          offset += chunk.length;
          return chunk;
        }
      },
      context
    );
    expect(ended).toBe(true);
    expect(reader.get("/ppt/presentation.xml")).toEqual(text("<garden/>"));
  });

  it("provides exact bytes, presence and absent-member errors", async () => {
    const reader = await readPackage(storedArchive(members), context);
    expect(reader.has("/ppt/presentation.xml")).toBe(true);
    expect(reader.has("/ppt/missing.xml")).toBe(false);
    expect(reader.get("/ppt/presentation.xml")).toEqual(text("<garden/>"));
    expect(reader.get("/ppt/media/tile.bin")).toEqual(Uint8Array.of(0, 255, 17));
    expect(() => reader.get("/ppt/missing.xml")).toThrowError(
      expect.objectContaining({ code: "missing-binding", phase: "index" })
    );
    expect(reader.names).toEqual(members.map((member) => `/${member.name}`));
  });

  it("returns relationship bytes or null without creating parts", async () => {
    const reader = await readPackage(storedArchive(members), context);
    expect(reader.relsXmlFor("/ppt/presentation.xml")).toEqual(text("<Relationships/>"));
    expect(reader.relsXmlFor("/")).toEqual(text("<RootLinks/>"));
    expect(reader.relsXmlFor("/ppt/media/tile.bin")).toBeNull();
    expect(reader.names).toHaveLength(4);
  });

  it("owns admitted input and all returned byte arrays", async () => {
    const input = storedArchive(members);
    const pending = readPackage(input, context);
    input.fill(0);
    const reader = await pending;
    reader.get("/ppt/presentation.xml").fill(0);
    reader.relsXmlFor("/ppt/presentation.xml")!.fill(0);
    expect(reader.get("/ppt/presentation.xml")).toEqual(text("<garden/>"));
    expect(reader.relsXmlFor("/ppt/presentation.xml")).toEqual(text("<Relationships/>"));
    expect(Object.isFrozen(reader.names)).toBe(true);
  });

  it("reads a memfs capability once and retains data across producer reuse", async () => {
    const volume = Volume.fromJSON({ "/vault/deck": "" });
    volume.writeFileSync("/vault/deck", storedArchive(members));
    const buffer = new Uint8Array(17);
    const openRead = vi.fn(async (path: string) => {
      const input = volume.readFileSync(`/vault/${path}`) as Uint8Array;
      let offset = 0;
      return {
        async read(maxBytes: number) {
          buffer.fill(0);
          if (offset === input.length) return null;
          const length = Math.min(maxBytes, buffer.length, input.length - offset);
          buffer.set(input.subarray(offset, offset + length));
          offset += length;
          return buffer.subarray(0, length);
        }
      };
    });
    const reader = await readPackage({ path: "deck", capability: { openRead } }, context);
    expect(openRead).toHaveBeenCalledOnce();
    volume.unlinkSync("/vault/deck");
    expect(reader.get("/ppt/presentation.xml")).toEqual(text("<garden/>"));
    expect(reader.get("/ppt/media/tile.bin")).toEqual(Uint8Array.of(0, 255, 17));
  });

  it("rejects a later corrupt member before returning any reader", async () => {
    const bytes = storedArchive(members);
    const payload =
      members
        .slice(0, -1)
        .reduce((offset, member) => offset + 30 + member.name.length + member.bytes.length, 0) +
      30 +
      members.at(-1)!.name.length;
    bytes[payload] = 42;
    await expect(readPackage(bytes, context)).rejects.toMatchObject({
      code: "invalid-archive",
      phase: "parse"
    });
  });

  it("rejects non-archives and implicit host paths", async () => {
    await expect(readPackage(text("not an archive"), context)).rejects.toMatchObject({
      code: "invalid-archive"
    });
    await expect(readPackage("/host/deck.pptx" as never, context)).rejects.toMatchObject({
      code: "invalid-type"
    });
  });

  it.each([0, -1, 1.5, NaN, Infinity])(
    "rejects invalid ceilings before I/O: %s",
    async (maxMembers) => {
      const read = vi.fn();
      await expect(
        readPackage(
          { read },
          {
            ...context,
            archiveLimits: { ...context.archiveLimits, maxMembers }
          }
        )
      ).rejects.toMatchObject({ code: "invalid-value" });
      expect(read).not.toHaveBeenCalled();
    }
  );

  it("applies the archive input ceiling during stream admission", async () => {
    const read = vi.fn(async () => new Uint8Array(9));
    await expect(
      readPackage(
        { read },
        {
          ...context,
          archiveLimits: { ...context.archiveLimits, maxArchiveBytes: 8 }
        }
      )
    ).rejects.toMatchObject({ code: "resource-limit" });
    expect(read).toHaveBeenCalledOnce();
    expect(read.mock.calls[0]).toEqual([8, undefined]);
  });

  it("rejects symbolic links without exposing their contents", async () => {
    await expect(
      readPackage(
        storedArchive([{ name: "ppt/link", bytes: text("/private/target"), mode: 0o120777 }]),
        context
      )
    ).rejects.toMatchObject({ code: "unsafe-path" });
  });

  it.each([
    ["ppt/a.xml", "PPT/A.xml"],
    ["ppt/node", "ppt/node/child.xml"],
    ["ppt/node/child.xml", "PPT/NODE"]
  ])("rejects colliding part identities: %s, %s", async (first, second) => {
    await expect(
      readPackage(
        storedArchive([
          { name: first, bytes: text("one") },
          { name: second, bytes: text("two") }
        ]),
        context
      )
    ).rejects.toMatchObject({ code: "invalid-opc" });
  });

  it.each([
    "ppt/a%2fb.xml",
    "ppt/a%5Cb.xml",
    "ppt/%61.xml",
    "ppt/a%.xml",
    "ppt/a%0g.xml",
    "ppt/a\\b.xml",
    "ppt/a?.xml",
    "ppt/a#b.xml",
    "ppt/a./b.xml"
  ])("rejects unsafe logical names: %s", async (name) => {
    await expect(
      readPackage(storedArchive([{ name, bytes: text("a") }]), context)
    ).rejects.toMatchObject({ code: "unsafe-path" });
  });

  it("maps encoded Unicode names without folding non-ASCII characters", async () => {
    const reader = await readPackage(
      storedArchive([
        { name: "ppt/%C3%A9.xml", bytes: text("lower") },
        { name: "ppt/%C3%89.xml", bytes: text("upper") }
      ]),
      context
    );
    expect(reader.get("/PPT/é.XML")).toEqual(text("lower"));
    expect(reader.get("/ppt/É.xml")).toEqual(text("upper"));
  });

  it("preserves supplementary Unicode through lookup and enumeration", async () => {
    const reader = await readPackage(
      storedArchive([{ name: "ppt/%F0%9F%8C%B1.xml", bytes: text("seedling") }]),
      context
    );
    expect(reader.names).toEqual(["/ppt/🌱.xml"]);
    expect(reader.get("/ppt/🌱.xml")).toEqual(text("seedling"));
  });

  it.each(["ppt/%C2%80.xml", "ppt/%EE%80%80.xml", "ppt/%EF%BF%BF.xml", "ppt/%ED%A0%80.xml"])(
    "rejects encoded non-IRI characters: %s",
    async (name) => {
      await expect(
        readPackage(storedArchive([{ name, bytes: text("a") }]), context)
      ).rejects.toMatchObject({ code: "unsafe-path" });
    }
  );

  it("honors cancellation before reading", async () => {
    const read = vi.fn();
    await expect(
      readPackage({ read }, { ...context, signal: AbortSignal.abort() })
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(read).not.toHaveBeenCalled();
  });

  it("reports invalid context without native errors or source reads", async () => {
    const read = vi.fn();
    await expect(
      readPackage({ read }, { archiveLimits: context.archiveLimits } as never)
    ).rejects.toMatchObject({ code: "invalid-type", phase: "usage" });
    expect(read).not.toHaveBeenCalled();
  });
});
