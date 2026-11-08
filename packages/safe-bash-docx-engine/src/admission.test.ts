import { describe, expect, it } from "vitest";
import { readDocumentArchive, type ArchiveLimits } from "./index.js";
import { createZipCodec } from "@poe-code/office-package";
import { createDocumentFixture, fixtureLimits } from "../tests/fixtures/documents.js";

const settings: ArchiveLimits = {
  maxArchiveBytes: 32768,
  maxEntryBytes: 16384,
  maxTotalBytes: 30000,
  maxMembers: 24,
  maxPathBytes: 256,
  maxDepth: 16,
  maxExtraBytes: 1024,
  maxCommentBytes: 16384,
  maxRetainedBytes: 2 * 1024 * 1024,
  chunkSize: 4096
};
const context = { limits: settings, signal: new AbortController().signal };
const encoder = new TextEncoder();
async function packageBytes(change: (parts: Map<string, Uint8Array>) => void) {
  const { parts } = await createDocumentFixture("garden");
  change(parts);
  const codec = createZipCodec();
  const entries = [];
  for (const [name, bytes] of parts) {
    entries.push(
      await codec.makeZipEntry(
        name,
        bytes,
        {
          modified: new Date("1980-01-01T00:00:00Z"),
          mode: 0o100644,
          directory: false,
          symlink: false
        },
        fixtureLimits,
        context.signal
      )
    );
  }
  return codec.writeZipArchive(
    { entries, comment: new Uint8Array() },
    fixtureLimits,
    context.signal
  );
}
function replace(parts: Map<string, Uint8Array>, name: string, before: string, after: string) {
  parts.set(
    name,
    encoder.encode(new TextDecoder().decode(parts.get(name)!).replace(before, after))
  );
}
function extendedEnd(input: Uint8Array) {
  const end = input.length - 22;
  const bytes = new Uint8Array(input.length + 76);
  bytes.set(input.subarray(0, end));
  bytes.set(input.subarray(end), end + 76);
  const old = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(end, 0x06064b50, true);
  view.setBigUint64(end + 4, 44n, true);
  view.setUint16(end + 12, 45, true);
  view.setUint16(end + 14, 45, true);
  view.setBigUint64(end + 24, BigInt(old.getUint16(end + 8, true)), true);
  view.setBigUint64(end + 32, BigInt(old.getUint16(end + 10, true)), true);
  view.setBigUint64(end + 40, BigInt(old.getUint32(end + 12, true)), true);
  view.setBigUint64(end + 48, BigInt(old.getUint32(end + 16, true)), true);
  view.setUint32(end + 56, 0x07064b50, true);
  view.setBigUint64(end + 64, BigInt(end), true);
  view.setUint32(end + 72, 1, true);
  view.setUint16(end + 84, 65535, true);
  view.setUint16(end + 86, 65535, true);
  view.setUint32(end + 88, 0xffffffff, true);
  view.setUint32(end + 92, 0xffffffff, true);
  return bytes;
}

describe("document container admission", () => {
  it.each(["valid", "strict", "template"] as const)(
    "identifies %s by content in ZIP32 and ZIP64",
    async (variant) => {
      const { bytes, parts } = await createDocumentFixture("garden", variant);
      for (const input of [bytes, extendedEnd(bytes)]) {
        const result = await readDocumentArchive(input, context);
        expect(result.kind).toBe(variant === "template" ? "dotx" : "docx");
        expect(result.dialect).toBe(variant === "strict" ? "strict" : "transitional");
        expect(result.mainPart).toBe("word/document.xml");
        expect(result.members.find((member) => member.name === result.mainPart)!.bytes).toEqual(
          parts.get("word/document.xml")
        );
      }
    }
  );

  it("keeps configured ZIP64 size and count limits distinct from corruption", async () => {
    const { bytes } = await createDocumentFixture("garden");
    for (const lower of [
      { maxMembers: 1 },
      { maxEntryBytes: 10 },
      { maxArchiveBytes: 22 },
      { maxRetainedBytes: 1 }
    ]) {
      await expect(
        readDocumentArchive(extendedEnd(bytes), { ...context, limits: { ...settings, ...lower } })
      ).rejects.toMatchObject({ code: "limit-exceeded" });
    }
    const malformed = extendedEnd(bytes);
    new DataView(malformed.buffer).setBigUint64(malformed.length - 34, 1n << 63n, true);
    await expect(readDocumentArchive(malformed, context)).rejects.toMatchObject({
      code: "invalid-container"
    });
  });

  it("admits a percent-encoded main part name", async () => {
    const bytes = await packageBytes((parts) => {
      const main = parts.get("word/document.xml")!;
      parts.delete("word/document.xml");
      parts.set("word/main%20notes.xml", main);
      const rels = parts.get("word/_rels/document.xml.rels")!;
      parts.delete("word/_rels/document.xml.rels");
      parts.set("word/_rels/main%20notes.xml.rels", rels);
      replace(parts, "[Content_Types].xml", "/word/document.xml", "/word/main%20notes.xml");
      replace(parts, "_rels/.rels", "word/document.xml", "word/main%20notes.xml");
    });
    expect((await readDocumentArchive(bytes, context)).mainPart).toBe("word/main%20notes.xml");
  });

  it("preserves public usage and cancellation errors", async () => {
    await expect(
      readDocumentArchive("file.docx" as unknown as Uint8Array, context)
    ).rejects.toMatchObject({ code: "usage" });
    const controller = new AbortController();
    controller.abort();
    await expect(
      readDocumentArchive(new Uint8Array(), { ...context, signal: controller.signal })
    ).rejects.toMatchObject({ code: "cancelled" });
  });

  it("detects compound binary containers without a filename", async () => {
    await expect(
      readDocumentArchive(Uint8Array.of(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1), context)
    ).rejects.toMatchObject({ code: "unsupported-profile" });
  });

  it.each([
    "application/vnd.ms-word.document.macroEnabled.main+xml",
    "application/vnd.ms-word.template.macroEnabledTemplate.main+xml"
  ])("detects macro main content type %s", async (type) => {
    const bytes = await packageBytes((parts) =>
      replace(
        parts,
        "[Content_Types].xml",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
        type
      )
    );
    await expect(readDocumentArchive(bytes, context)).rejects.toMatchObject({
      code: "unsupported-profile"
    });
  });

  it("detects a macro payload declared under an unrelated part name", async () => {
    const bytes = await packageBytes((parts) => {
      parts.set("word/payload.dat", Uint8Array.of(1));
      replace(
        parts,
        "[Content_Types].xml",
        "</Types>",
        '<Override PartName="/word/payload.dat" ContentType="application/vnd.ms-office.vbaProject"/></Types>'
      );
    });
    await expect(readDocumentArchive(bytes, context)).rejects.toMatchObject({
      code: "unsupported-profile"
    });
  });

  it("preserves inert custom types whose names merely contain a macro marker", async () => {
    const bytes = await packageBytes((parts) => {
      parts.set("customXml/history.xml", encoder.encode("<history/>"));
      replace(
        parts,
        "[Content_Types].xml",
        "</Types>",
        '<Override PartName="/customXml/history.xml" ContentType="application/x-vbadata-history+xml"/></Types>'
      );
    });
    expect((await readDocumentArchive(bytes, context)).kind).toBe("docx");
  });

  it.each([
    (parts: Map<string, Uint8Array>) => parts.delete("[Content_Types].xml"),
    (parts: Map<string, Uint8Array>) => parts.delete("_rels/.rels"),
    (parts: Map<string, Uint8Array>) => parts.delete("word/document.xml"),
    (parts: Map<string, Uint8Array>) => parts.set("untyped.bin", Uint8Array.of(0)),
    (parts: Map<string, Uint8Array>) =>
      replace(
        parts,
        "_rels/.rels",
        'Target="word/document.xml"',
        'Target="https://outside.invalid/doc" TargetMode="External"'
      ),
    (parts: Map<string, Uint8Array>) =>
      replace(
        parts,
        "[Content_Types].xml",
        "</Types>",
        '<Override PartName="/word/document.xml" ContentType="application/xml"/></Types>'
      ),
    (parts: Map<string, Uint8Array>) =>
      replace(
        parts,
        "[Content_Types].xml",
        "http://schemas.openxmlformats.org/package/2006/content-types",
        "urn:wrong"
      )
  ])("rejects invalid OPC admission case %#", async (change) => {
    await expect(readDocumentArchive(await packageBytes(change), context)).rejects.toMatchObject({
      code: "invalid-package"
    });
  });

  it.each([
    (parts: Map<string, Uint8Array>) => replace(parts, "word/document.xml", "</w:document>", ""),
    (parts: Map<string, Uint8Array>) =>
      parts.set(
        "[Content_Types].xml",
        encoder.encode('<!DOCTYPE Types [<!ENTITY x "data">]><Types/>')
      )
  ])("reports malformed or prohibited XML separately %#", async (change) => {
    await expect(readDocumentArchive(await packageBytes(change), context)).rejects.toMatchObject({
      code: "invalid-xml"
    });
  });

  it("rejects encrypted and multi-disk ZIP headers", async () => {
    const { bytes } = await createDocumentFixture("garden");
    for (const encrypted of [true, false]) {
      const input = bytes.slice();
      const view = new DataView(input.buffer);
      if (encrypted) view.setUint16(6, view.getUint16(6, true) | 1, true);
      else view.setUint16(input.length - 18, 1, true);
      await expect(readDocumentArchive(input, context)).rejects.toMatchObject({
        code: "invalid-container"
      });
    }
  });
});
