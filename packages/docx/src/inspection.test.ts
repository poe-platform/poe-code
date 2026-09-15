import { describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { inspectDocument, validateDocument, readArchive, writeArchive, type ArchiveContext } from "./index.js";
import { createDocumentFixture } from "../tests/fixtures/documents.js";

const context = (): ArchiveContext => ({ signal: new AbortController().signal, limits: {
  maxArchiveBytes: 65536, maxEntryBytes: 32768, maxTotalBytes: 65536, maxMembers: 64,
  maxPathBytes: 256, maxDepth: 32, maxExtraBytes: 1024, maxCommentBytes: 1024,
  maxRetainedBytes: 32 * 1024 * 1024, chunkSize: 512
} });

async function enriched(change?: (fs: Volume) => void, minimal = false) {
  const source = await createDocumentFixture(minimal ? "garden" : "equipment", minimal ? "empty" : "valid");
  const archive = await readArchive(source.bytes, context());
  const fs = Volume.fromJSON(Object.fromEntries(archive.members.map(m => ["/" + m.name, Buffer.from(m.bytes)])));
  const add = (name: string, type: string, xml: string) => {
    fs.mkdirSync("/" + name.slice(0, name.lastIndexOf("/")), { recursive: true });
    fs.writeFileSync("/" + name, xml);
    const types = fs.readFileSync("/[Content_Types].xml", "utf8") as string;
    fs.writeFileSync("/[Content_Types].xml", types.replace("</Types>", `<Override PartName="/${name}" ContentType="${type}"/></Types>`));
  };
  const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  add("docProps/app.xml", "application/vnd.openxmlformats-officedocument.extended-properties+xml", '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Pages>12</Pages><Application>Original editor</Application></Properties>');
  add("docProps/custom.xml", "application/vnd.openxmlformats-officedocument.custom-properties+xml", '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property name="Reviewed" pid="2" fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}"><vt:bool>true</vt:bool></property></Properties>');
  add("word/settings.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml", `<w:settings xmlns:w="${w}"><w:documentProtection w:edit="readOnly" w:enforcement="1"/><w:writeProtection/></w:settings>`);
  add("word/fontTable.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml", `<w:fonts xmlns:w="${w}"><w:font w:name="Cedar Serif"/></w:fonts>`);
  add("_xmlsignatures/sig1.xml", "application/vnd.openxmlformats-package.digital-signature-xmlsignature+xml", '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo/></Signature>');
  const main = fs.readFileSync("/word/document.xml", "utf8") as string;
  fs.writeFileSync("/word/document.xml", main.replace("<w:sectPr>", '<w:p><w:r><w:rPr><w:rFonts w:ascii="Cedar Serif" w:eastAsiaTheme="minorEastAsia"/></w:rPr><w:lastRenderedPageBreak/></w:r></w:p><w:sectPr>'));
  const names = [...archive.members.map(m => m.name), "docProps/app.xml", "docProps/custom.xml", "word/settings.xml", "word/fontTable.xml", "_xmlsignatures/sig1.xml"];
  change?.(fs);
  const members = names.map(name => ({ name, bytes: new Uint8Array(fs.readFileSync("/" + name) as Uint8Array), directory: false, modified: new Date("1980-01-01T00:00:00Z") }));
  fs.writeFileSync("/result", new Uint8Array());
  await writeArchive({ members, comment: new Uint8Array() }, { async write(b) { fs.appendFileSync("/result", b); } }, { order: "name", compression: "store" }, context());
  return new Uint8Array(fs.readFileSync("/result") as Uint8Array);
}

describe("document inspection and byte validation", () => {
  it("reports an original minimal package deterministically without mutation", async () => {
    const { bytes, parts } = await createDocumentFixture("garden", "empty");
    const before = bytes.slice();
    const result = await inspectDocument(bytes, context());
    expect(result).toMatchObject({ kind: "docx", dialect: "transitional", signed: false, protected: false,
      counts: { paragraphs: 1, tables: 0, images: 0, cachedPages: null },
      pages: { rendered: null, cachedBreaks: 0 }, fonts: { installed: null }, signatures: { verified: null } });
    expect(result.parts.map(p => p.name)).toEqual([...parts.keys()].map(n => "/" + n).sort());
    for (const part of result.parts) {
      expect(part.bytes).toBe(parts.get(part.name.slice(1))!.length);
      expect(part.sha256).toHaveLength(64);
    }
    expect(result.stories).toHaveLength(1);
    expect(result.stories[0]!.location.value.sourceSha256).toHaveLength(64);
    expect(JSON.stringify(await inspectDocument(bytes, context()))).toBe(JSON.stringify(result));
    expect(bytes).toEqual(before);
  });

  it("counts complex tables and image occurrences separately from embedded resources", async () => {
    const { bytes } = await createDocumentFixture("museum");
    const result = await inspectDocument(bytes, context());
    expect(result.counts).toMatchObject({ paragraphs: 9, tables: 2, images: 2, rows: 5, cells: 7 });
    expect(result.media).toHaveLength(1);
    expect(result.media[0]).toMatchObject({ name: "/word/media/pixel.bmp", contentType: "image/bmp", bytes: 62 });
    expect(result.features).toContainEqual(expect.objectContaining({ id: "F19", detected: true, level: "read" }));
  });

  it("inventories cached pages, annotations, protection, font references and unverified signatures", async () => {
    const bytes = await enriched();
    const before = bytes.slice();
    const result = await inspectDocument(bytes, context());
    expect(result).toMatchObject({ signed: true, protected: true,
      counts: { cachedPages: 12 }, pages: { rendered: null, cachedBreaks: 1 },
      fonts: { references: ["Cedar Serif"], themeReferences: ["minorEastAsia"], installed: null },
      signatures: { parts: ["/_xmlsignatures/sig1.xml"], verified: null } });
    expect(result.annotations.filter(a => a.kind === "ins" || a.kind === "del")).toHaveLength(2);
    expect(result.protection).toContainEqual(expect.objectContaining({ kind: "documentProtection", enforced: true, edit: "readOnly" }));
    expect(result.properties).toContainEqual(expect.objectContaining({ name: "pages", value: 12, cached: true }));
    expect(result.properties).toContainEqual(expect.objectContaining({ name: "Reviewed", value: true, type: "boolean" }));
    expect(result.relationships).toContainEqual(expect.objectContaining({ external: true, target: "https://equipment.invalid/catalog" }));
    expect(result.warnings.map(w => w.code)).toEqual(expect.arrayContaining(["partial-validation", "cached-layout", "font-availability", "unverified-signatures"]));
    expect(bytes).toEqual(before);
  });

  it.each(["strict", "template"] as const)("retains the admitted %s profile", async variant => {
    const { bytes } = await createDocumentFixture("garden", variant);
    expect(await inspectDocument(bytes, context())).toMatchObject(variant === "strict" ? { dialect: "strict" } : { kind: "dotx" });
  });

  it("counts only the active compatibility branch and inventories note/comment bodies", async () => {
    const equipment = await inspectDocument((await createDocumentFixture("equipment")).bytes, context());
    expect(equipment.counts.paragraphs).toBe(5);
    const notes = await inspectDocument((await createDocumentFixture("observatory")).bytes, context());
    expect(notes.annotations.filter(a => a.kind === "comment")).toHaveLength(1);
    expect(notes.counts).toMatchObject({ comments: 1, footnotes: 1, endnotes: 1, sections: 2 });
  });

  it.each(["empty", "valid", "invalid-grid"] as const)("validates original %s data without repairing it", async variant => {
    const { bytes } = await createDocumentFixture("museum", variant);
    const before = bytes.slice();
    const report = await validateDocument(bytes, context());
    expect(report.valid).toBe(variant !== "invalid-grid");
    expect(report.checks).toContainEqual({ id: "container", status: "passed" });
    expect(report.checks).toContainEqual({ id: "signatures", status: "unvalidated" });
    expect(bytes).toEqual(before);
  });

  it.each(["missing-target", "malformed-xml"] as const)("reports original %s failures and never repairs input", async variant => {
    const { bytes } = await createDocumentFixture("garden", variant);
    const before = bytes.slice();
    expect((await validateDocument(bytes, context())).valid).toBe(false);
    await expect(inspectDocument(bytes, context())).rejects.toMatchObject({ code: variant === "malformed-xml" ? "invalid-xml" : "invalid-package" });
    expect(bytes).toEqual(before);
  });

  it("rejects unknown profiles, exhausted budgets and invalid ZIP bytes", async () => {
    const { bytes } = await createDocumentFixture("garden");
    await expect(validateDocument(bytes, context(), { profile: "invented" as never })).rejects.toMatchObject({ code: "usage" });
    await expect(inspectDocument(bytes, { ...context(), limits: { ...context().limits, maxArchiveBytes: 8 } })).rejects.toMatchObject({ code: "limit-exceeded" });
    await expect(validateDocument(new Uint8Array([1, 2, 3]), context())).rejects.toMatchObject({ code: "invalid-container" });
  });
});

it("retains relationship XML order and reports byte totals", async () => {
  const { bytes, parts } = await createDocumentFixture("museum");
  const result = await inspectDocument(bytes, context());
  expect(result.relationships.filter(r => r.owner === "/word/document.xml").map(r => r.id)).toEqual(["rStyles", "rImage", "rShelf"]);
  expect(result.sizes).toEqual({ archiveBytes: bytes.length, expandedBytes: [...parts.values()].reduce((sum, b) => sum + b.length, 0), mediaBytes: 62 });
});

it("does not acquire external resources or turn invalid cached values into measurements", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network is unavailable"));
  try {
    const bytes = await enriched(fs => {
      const text = fs.readFileSync("/docProps/app.xml", "utf8") as string;
      fs.writeFileSync("/docProps/app.xml", text.replace("<Pages>12</Pages>", "<Pages>0x20</Pages>"));
      const core = fs.readFileSync("/docProps/core.xml", "utf8") as string;
      fs.writeFileSync("/docProps/core.xml", core.replace("2026-01-02T03:04:05Z", "2026-02-30T03:04:05Z"));
    });
    const report = await inspectDocument(bytes, context());
    expect(report.counts.cachedPages).toBeNull();
    expect(report.properties.find(p => p.name === "created")!.value).toBeNull();
    expect(report.properties.find(p => p.name === "application")).toMatchObject({ cached: true });
    expect(report.warnings).toContainEqual(expect.objectContaining({ code: "invalid-property" }));
    await validateDocument(bytes, context());
    expect(fetch).not.toHaveBeenCalled();
  } finally { fetch.mockRestore(); }
});

it("inventories ignored extensions and does not flatten unsupported typed properties", async () => {
  const bytes = await enriched(fs => {
    const main = fs.readFileSync("/word/document.xml", "utf8") as string;
    fs.writeFileSync("/word/document.xml", main.replace("</w:body>", "<x:widget/></w:body>"));
    const custom = fs.readFileSync("/docProps/custom.xml", "utf8") as string;
    fs.writeFileSync("/docProps/custom.xml", custom.replace("<vt:bool>true</vt:bool>", '<vt:vector size="2" baseType="lpstr"><vt:lpstr>ab</vt:lpstr><vt:lpstr>cd</vt:lpstr></vt:vector>'));
  });
  const result = await inspectDocument(bytes, context());
  expect(result.properties.find(p => p.name === "Reviewed")).toBeUndefined();
  expect(result.warnings).toContainEqual(expect.objectContaining({ code: "invalid-property" }));
  expect(result.features.find(f => f.id === "F41")).toMatchObject({ detected: false });
  expect(result.warnings).toContainEqual(expect.objectContaining({ code: "unvalidated-extensions" }));
});

it("detects MCE declarations and settings even without alternate branches, fonts or protection", async () => {
  const bytes = await enriched(fs => {
    const main = fs.readFileSync("/word/document.xml", "utf8") as string;
    fs.writeFileSync("/word/document.xml", main.replace('<w:rFonts w:ascii="Cedar Serif" w:eastAsiaTheme="minorEastAsia"/>', "").replace("</w:body>", "<x:widget/></w:body>"));
    const fonts = fs.readFileSync("/word/fontTable.xml", "utf8") as string;
    fs.writeFileSync("/word/fontTable.xml", fonts.replace('<w:font w:name="Cedar Serif"/>', ""));
    fs.writeFileSync("/word/settings.xml", '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="100"/></w:settings>');
  }, true);
  const report = await inspectDocument(bytes, context());
  expect(report.fonts.references).toEqual([]);
  expect(report.protected).toBe(false);
  expect(report.features.find(f => f.id === "F05")).toMatchObject({ detected: true });
  expect(report.features.find(f => f.id === "F42")).toMatchObject({ detected: true });
  expect(report.warnings).toContainEqual(expect.objectContaining({ code: "unvalidated-extensions" }));
});

it("rejects macro-bearing package declarations in byte validation", async () => {
  const bytes = await enriched(fs => {
    const types = fs.readFileSync("/[Content_Types].xml", "utf8") as string;
    fs.writeFileSync("/[Content_Types].xml", types.replace('ContentType="application/vnd.openxmlformats-package.digital-signature-xmlsignature+xml"', 'ContentType="application/vnd.ms-office.vbaProject"'));
  });
  await expect(inspectDocument(bytes, context())).rejects.toMatchObject({ code: "unsupported-profile" });
  await expect(validateDocument(bytes, context())).rejects.toMatchObject({ code: "unsupported-profile" });
});

it.each([
  { markup: '<w:sdt><w:sdtPr/><w:sdtContent><w:p/></w:sdtContent></w:sdt>', controls: true, review: false },
  { markup: '<w:p><w:moveFrom w:id="7" w:author="Editor"><w:r><w:t>Moved text</w:t></w:r></w:moveFrom></w:p>', controls: false, review: true }
])("distinguishes control and complex review feature families: $controls/$review", async ({ markup, controls, review }) => {
  const bytes = await enriched(fs => {
    const main = fs.readFileSync("/word/document.xml", "utf8") as string;
    fs.writeFileSync("/word/document.xml", main.replace("</w:body>", markup + "</w:body>"));
  }, true);
  const before = bytes.slice();
  const result = await inspectDocument(bytes, context());
  expect(result.features.find(feature => feature.id === "F27")).toMatchObject({ detected: review });
  expect(result.features.find(feature => feature.id === "F28")).toMatchObject({ detected: controls });
  expect(bytes).toEqual(before);
});
it("does not count inert Word-shaped user data as document controls or protection", async () => {
  const { textFixture } = await import("../tests/fixtures/text.js"); const ctx = context(), source = await readArchive(await textFixture('<w:p/>'), ctx), encode = (value: string) => new TextEncoder().encode(value);
  const metadata = encode('<data xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent><w:r><w:t>Inert</w:t></w:r></w:sdtContent></w:sdt></w:p><w:documentProtection w:enforcement="1"/></data>');
  const members = [...source.members.map(member => member.name !== "[Content_Types].xml" ? member : { ...member, bytes: encode(new TextDecoder().decode(member.bytes).replace('</Types>', '<Override PartName="/payload/data.xml" ContentType="application/xml"/></Types>')) }), { name: "payload/data.xml", bytes: metadata, directory: false, modified: new Date("2025-01-01") }];
  const fs = Volume.fromJSON({ "/input": "" }); await writeArchive({ ...source, members }, { async write(bytes) { fs.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, ctx);
  const result = await inspectDocument(new Uint8Array(fs.readFileSync("/input") as Buffer), ctx);
  expect(result).toMatchObject({ protected: false, protection: [], counts: { paragraphs: 1, controls: 0 } }); expect(result.parts.find(part => part.name === "/payload/data.xml")).toMatchObject({ bytes: metadata.length });
});
it("does not identify unofficial custom-data relationship suffixes as declared resources", async () => {
  const { textFixture } = await import("../tests/fixtures/text.js"), ctx = context(), archive = await readArchive(await textFixture('<w:p/>', { data: { kind: "header", xml: '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p/></w:hdr>' } }), ctx), encode = (value: string) => new TextEncoder().encode(value);
  const members = archive.members.map(member => member.name !== "word/_rels/document.xml.rels" ? member : { ...member, bytes: encode(new TextDecoder().decode(member.bytes).replace('http://schemas.openxmlformats.org/officeDocument/2006/relationships/header', 'urn:original/customXml')) });
  const fs = Volume.fromJSON({ "/input": "" }); await writeArchive({ ...archive, members }, { async write(bytes) { fs.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, ctx);
  expect((await inspectDocument(new Uint8Array(fs.readFileSync("/input") as Buffer), ctx)).features.find(feature => feature.id === "F41")!.detected).toBe(false);
});
it.each(["unofficial-type", "folder", "official-origin"])("classifies signature graphs by exact declared roles: %s", async scenario => {
  const { textFixture } = await import("../tests/fixtures/text.js"), ctx = context(), source = await readArchive(await textFixture('<w:p/>'), ctx), encode = (value: string) => new TextEncoder().encode(value), name = scenario === "folder" ? "_xmlsignatures/data.xml" : "payload/data.xml", type = scenario === "unofficial-type" ? "application/vnd.openxmlformats-package.digital-signature-notes+xml" : "application/xml";
  const members = [...source.members.map(member => member.name === "[Content_Types].xml" ? { ...member, bytes: encode(new TextDecoder().decode(member.bytes).replace('</Types>', `<Override PartName="/${name}" ContentType="${type}"/></Types>`)) } : member.name === "_rels/.rels" && scenario === "official-origin" ? { ...member, bytes: encode(new TextDecoder().decode(member.bytes).replace('</Relationships>', `<Relationship Id="origin" Type="http://schemas.openxmlformats.org/package/2006/relationships/digital-signature/origin" Target="${name}"/></Relationships>`)) } : member), { name, bytes: encode('<data/>'), directory: false, modified: new Date("2025-01-01") }];
  const fs = Volume.fromJSON({ "/input": "" }); await writeArchive({ ...source, members }, { async write(bytes) { fs.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, ctx);
  const data = await inspectDocument(new Uint8Array(fs.readFileSync("/input") as Buffer), ctx); expect(data.signed).toBe(scenario === "official-origin"); expect(data.features.find(feature => feature.id === "F43")!.detected).toBe(scenario === "official-origin"); expect(data.signatures.parts).toEqual(scenario === "official-origin" ? ['/'+name] : []);
});
it("does not invent typed property values from unrelated namespace-shaped XML", async () => {
  const source = await createDocumentFixture("garden", "empty"), archive = await readArchive(source.bytes, context()), bytes = new TextEncoder().encode('<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Inert payload</dc:title></cp:coreProperties>');
  const members = [...archive.members.map(member => member.name !== "[Content_Types].xml" ? member : { ...member, bytes: new TextEncoder().encode(new TextDecoder().decode(member.bytes).replace("</Types>", '<Override PartName="/payload/data.xml" ContentType="application/xml"/></Types>')) }), { name: "payload/data.xml", bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") }], fs = Volume.fromJSON({ "/input": "" });
  await writeArchive({ ...archive, members }, { async write(chunk) { fs.appendFileSync("/input", chunk); } }, { order: "input", compression: "store" }, context());
  const data = await inspectDocument(new Uint8Array(fs.readFileSync("/input") as Buffer), context());
  expect(data.properties.find(p => p.part === "/payload/data.xml")).toBeUndefined();
});
