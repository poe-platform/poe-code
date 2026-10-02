import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { deflateRawSync } from "node:zlib";
import { afterEach, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { readArchive, type ArchiveContext } from "./archive.js";
import { validateDocumentArchive } from "./validation.js";
import { validateDocument } from "./inspection.js";
import { createDocxInspectionCommandEngine } from "./inspection-command.js";
import { parseDocumentXml } from "./package-xml.js";
import { DocumentBudget } from "./budget.js";

const encode = (value: string) => new TextEncoder().encode(value);
const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const pr = "http://schemas.openxmlformats.org/package/2006/relationships";
const context: ArchiveContext = { signal: new AbortController().signal, limits: {
  maxArchiveBytes: 65536, maxEntryBytes: 16384, maxTotalBytes: 32768,
  maxMembers: 32, maxPathBytes: 256, maxDepth: 16, maxExtraBytes: 0,
  maxCommentBytes: 0, maxRetainedBytes: 4 * 1024 * 1024, chunkSize: 512
} };
const relationships = (body: string) => `<Relationships xmlns="${pr}">${body}</Relationships>`;
const relationship = (id: string, target: string, extra = "") => `<Relationship Id="${id}" Type="${r}/hyperlink" Target="${target}" ${extra}/>`;
function parts(body = "<w:p/>") {
  return [
    ["[Content_Types].xml", encode('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')],
    ["_rels/.rels", encode(relationships(`<Relationship Id="rMain" Type="${r}/officeDocument" Target="word/document.xml"/>`))],
    ["word/document.xml", encode(`<w:document xmlns:w="${w}" xmlns:r="${r}"><w:body>${body}</w:body></w:document>`)]
  ] satisfies [string, Uint8Array][];
}

// Original wire fixture builder, independent of the product ZIP writer/checksum.
function wire(entries: [string, Uint8Array][], descriptor: "none" | "signed" | "unsigned" = "none", compressed = false) {
  const records = entries.map(([name, bytes]) => {
    let checksum = 0xffffffff;
    for (const byte of bytes) {
      checksum ^= byte;
      for (let bit = 0; bit < 8; bit++) checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
    }
    return { name: encode(name), bytes, payload: compressed ? new Uint8Array(deflateRawSync(bytes)) : bytes, checksum: (checksum ^ 0xffffffff) >>> 0 };
  });
  const descriptorBytes = descriptor === "none" ? 0 : descriptor === "signed" ? 16 : 12;
  const start = records.reduce((sum, record) => sum + 30 + record.name.length + record.payload.length + descriptorBytes, 0);
  const centralBytes = records.reduce((sum, record) => sum + 46 + record.name.length, 0);
  const bytes = new Uint8Array(start + centralBytes + 22), view = new DataView(bytes.buffer);
  const u16 = (at: number, value: number) => view.setUint16(at, value, true);
  const u32 = (at: number, value: number) => view.setUint32(at, value, true);
  let local = 0, central = start;
  for (const record of records) {
    const flags = descriptor === "none" ? 0 : 8;
    u32(local, 0x04034b50); u16(local + 4, 20); u16(local + 6, flags); u16(local + 8, compressed ? 8 : 0); u16(local + 12, 33);
    if (!flags) { u32(local + 14, record.checksum); u32(local + 18, record.payload.length); u32(local + 22, record.bytes.length); }
    u16(local + 26, record.name.length); bytes.set(record.name, local + 30); bytes.set(record.payload, local + 30 + record.name.length);
    let end = local + 30 + record.name.length + record.payload.length;
    if (flags) {
      if (descriptor === "signed") { u32(end, 0x08074b50); end += 4; }
      u32(end, record.checksum); u32(end + 4, record.payload.length); u32(end + 8, record.bytes.length); end += 12;
    }
    u32(central, 0x02014b50); u16(central + 4, 20); u16(central + 6, 20); u16(central + 8, flags); u16(central + 10, compressed ? 8 : 0); u16(central + 14, 33);
    u32(central + 16, record.checksum); u32(central + 20, record.payload.length); u32(central + 24, record.bytes.length); u16(central + 28, record.name.length); u32(central + 42, local); bytes.set(record.name, central + 46);
    local = end; central += 46 + record.name.length;
  }
  u32(central, 0x06054b50); u16(central + 8, records.length); u16(central + 10, records.length); u32(central + 12, centralBytes); u32(central + 16, start);
  return { bytes, central: start };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(["none", "signed", "unsigned"] as const)("admits a tiny independently authored %s descriptor package", async descriptor => {
  const entries = parts('<w:p><w:r><w:t>River survey</w:t></w:r></w:p>');
  const { bytes } = wire(entries, descriptor);
  expect((await readArchive(bytes, context)).members.map(member => [member.name, member.bytes])).toEqual(entries);
  expect((await validateDocument(bytes, context)).valid).toBe(true);
});

it.each([
  ["local signature", 0, 0, 4], ["local version", 4, 10, 2],
  ["local method", 8, 8, 2], ["local CRC", 14, 0, 4],
  ["local size", 22, 1, 4], ["local name length", 26, 65535, 2],
  ["central signature", 0, 0, 4], ["central CRC", 16, 0, 4],
  ["central compressed size", 20, 1, 4], ["central size", 24, 1, 4],
  ["central offset", 42, 1, 4]
] as const)("rejects a corrupted %s", async (label, offset, value, width) => {
  const { bytes, central } = wire([["a.xml", encode("<a>Delta</a>")]]);
  const view = new DataView(bytes.buffer), at = offset + (label.startsWith("central") ? central : 0);
  if (width === 2) view.setUint16(at, value, true); else view.setUint32(at, value, true);
  await expect(readArchive(bytes, context)).rejects.toMatchObject({ code: "invalid-container" });
});

it.each(["signed", "unsigned"] as const)("rejects mismatched %s descriptor CRC and sizes", async descriptor => {
  for (const offset of [0, 4, 8]) {
    const { bytes, central } = wire([["a.xml", encode("<a>Delta</a>")]], descriptor);
    new DataView(bytes.buffer).setUint32(central - 12 + offset, 0, true);
    await expect(readArchive(bytes, context)).rejects.toMatchObject({ code: "invalid-container" });
  }
});

it("checks actual compressed expansion and CRC even when both headers agree", async () => {
  const entries: [string, Uint8Array][] = [["a.xml", encode("R".repeat(2048))]];
  for (const size of [2047, 2049]) {
    const { bytes, central } = wire(entries, "none", true), view = new DataView(bytes.buffer);
    view.setUint32(22, size, true); view.setUint32(central + 24, size, true);
    await expect(readArchive(bytes, context)).rejects.toMatchObject({ code: "invalid-container" });
  }
  const { bytes, central } = wire(entries, "none", true), view = new DataView(bytes.buffer);
  view.setUint32(14, 0, true); view.setUint32(central + 16, 0, true);
  await expect(readArchive(bytes, context)).rejects.toMatchObject({ code: "invalid-container" });
});

it.each(["word/%2e%2e/out.xml", "word/%2Fout.xml", "word/%5cout.xml", "word/%00out.xml"])("rejects encoded unsafe part %s", async name => {
  const entries = [...parts(), [name, encode("<out/>")] as [string, Uint8Array]];
  expect(await validateDocument(wire(entries).bytes, context)).toMatchObject({ valid: false, diagnostics: expect.arrayContaining([expect.objectContaining({ code: "package-structure" })]) });
});

it("treats a double-encoded dot sequence as an inert literal part name without decoding twice", async () => {
  const name = "word/%252e%252e/out.xml", entries: [string, Uint8Array][] = [...parts(), [name, encode("<out/>")]];
  const bytes = wire(entries).bytes;
  expect((await validateDocument(bytes, context)).valid).toBe(true);
  expect((await readArchive(bytes, context)).members.map(member => member.name)).toContain(name);
});

it("rejects exact and case-colliding part identities without modifying memfs input", async () => {
  for (const name of ["word/document.xml", "WORD/DOCUMENT.XML"]) {
    const bytes = wire([...parts(), [name, encode("<out/>")]]).bytes;
    const volume = Volume.fromJSON({ "/input": Buffer.from(bytes), "/keep": "retained" }), before = volume.toJSON();
    const pending = validateDocument(new Uint8Array(volume.readFileSync("/input") as Uint8Array), context);
    if (name.startsWith("WORD")) expect((await pending).valid).toBe(false);
    else await expect(pending).rejects.toMatchObject({ code: "invalid-container" });
    expect(volume.toJSON()).toEqual(before);
  }
});

it.each([
  relationship("same", "word/document.xml") + relationship("same", "word/document.xml"),
  relationship("escape", "%2e%2e/out.xml"), relationship("slash", "%2fprivate.xml"),
  relationship("missing", "absent.xml"), relationship("query", "document.xml?credential=hidden"),
  relationship("mode", "document.xml", 'TargetMode="Remote"'),
  '<Relationship xmlns="urn:original:spoof" Id="foreign" Type="urn:inert" Target="document.xml"/>'
])("rejects invalid relationship metadata", async body => {
  const entries = [...parts(), ["word/_rels/document.xml.rels", encode(relationships(body))] as [string, Uint8Array]];
  expect((await validateDocument(wire(entries).bytes, context)).valid).toBe(false);
});

it.each([
  ['<w:p><w:bookmarkStart w:id="1" w:name="Cove"/><w:bookmarkStart w:id="01" w:name="Ridge"/><w:bookmarkEnd w:id="1"/></w:p>', "bookmark-range"],
  ['<w:p><w:moveFromRangeStart w:id="1"/><w:moveFromRangeEnd w:id="2"/></w:p>', "revision-id"],
  ['<w:p><w:ins w:id="2"/><w:del w:id="02"/></w:p>', "revision-id"],
  ['<w:p><w:commentRangeEnd w:id="0"/></w:p>', "comment-range"],
  ['<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r></w:p>', "field-balance"],
  ['<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2147483647"/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>', "table-grid"],
  ['<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>', "table-grid"]
])("locates hostile semantic graph %s", async (body, code) => {
  expect(await validateDocument(wire(parts(body)).bytes, context)).toMatchObject({ valid: false, diagnostics: expect.arrayContaining([
    expect.objectContaining({ code, part: "/word/document.xml", location: expect.any(String) })
  ]) });
});

it("uses expanded namespace names rather than prefixes to recognize field markup", async () => {
  const valid = '<w:p><w:fldSimple xmlns:q="urn:original:opaque" w:instr="PAGE"><q:instrText>inert</q:instrText></w:fldSimple></w:p>';
  expect((await validateDocument(wire(parts(valid)).bytes, context)).valid).toBe(true);
  const invalid = `<w:p xmlns:q="${w}"><q:r><q:instrText>PAGE</q:instrText></q:r></w:p>`;
  expect(await validateDocument(wire(parts(invalid)).bytes, context)).toMatchObject({ valid: false, diagnostics: [expect.objectContaining({ code: "field-instruction" })] });
});

it.each([
  '<!DOCTYPE r SYSTEM "file:///not-admitted"><r/>',
  '<!DOCTYPE r [<!ENTITY e SYSTEM "https://example.invalid/secret">]><r>&e;</r>',
  '<!DOCTYPE r [<!ENTITY % e SYSTEM "https://example.invalid/secret">%e;]><r/>',
  '<r>&unbound;</r>', '<r xmlns:xml="urn:original:spoof"/>',
  '<r xmlns:a="urn:original:same" xmlns:b="urn:original:same" a:x="1" b:x="2"/>'
])("rejects declarations and namespace tricks without host or network resolution", source => {
  const unexpected = () => { throw new Error("Implicit authority used"); };
  const reads = vi.spyOn(fs, "readFileSync").mockImplementation(unexpected);
  const asyncReads = vi.spyOn(fs.promises, "readFile").mockImplementation(unexpected);
  const httpRequests = vi.spyOn(http, "request").mockImplementation(unexpected);
  const httpsRequests = vi.spyOn(https, "request").mockImplementation(unexpected);
  const fetch = vi.fn(unexpected); vi.stubGlobal("fetch", fetch);
  expect(() => parseDocumentXml(encode(source))).toThrowError(expect.objectContaining({ code: "invalid-xml" }));
  for (const spy of [reads, asyncReads, httpRequests, httpsRequests, fetch]) expect(spy).not.toHaveBeenCalled();
});

it("keeps external relationships and executable-looking field instructions inert through SDK and CLI", async () => {
  const entries = [...parts('<w:p><w:fldSimple w:instr="INCLUDETEXT file:///not-admitted"><w:r><w:t>Cached</w:t></w:r></w:fldSimple><w:hyperlink r:id="remote"/></w:p>'),
    ["word/_rels/document.xml.rels", encode(relationships(relationship("remote", "https://example.invalid/not-admitted", 'TargetMode="External"')))]] as [string, Uint8Array][];
  const bytes = wire(entries).bytes, volume = Volume.fromJSON({ "/input.docx": Buffer.from(bytes) }), before = volume.toJSON();
  const fetch = vi.fn(() => { throw new Error("Implicit network"); }); vi.stubGlobal("fetch", fetch);
  const unexpected = () => { throw new Error("Implicit host authority"); };
  const hostReads = vi.spyOn(fs, "readFileSync").mockImplementation(unexpected);
  const asyncHostReads = vi.spyOn(fs.promises, "readFile").mockImplementation(unexpected);
  const hostOpens = vi.spyOn(fs, "openSync").mockImplementation(unexpected);
  const httpRequests = vi.spyOn(http, "request").mockImplementation(unexpected);
  const httpsRequests = vi.spyOn(https, "request").mockImplementation(unexpected);
  const reads: string[] = [], chunks: Uint8Array[] = [];
  const sdk = await validateDocument(bytes, context);
  const result = await createDocxInspectionCommandEngine({ limits: context.limits }).execute({
    args: ["validate", "/input.docx", "--json"].map(encode), cwd: "/", signal: context.signal,
    filesystem: { async readFile(path) { reads.push(path); return new Uint8Array(volume.readFileSync(path) as Uint8Array); } },
    stdin: { [Symbol.asyncIterator]() { return { async next(): Promise<IteratorResult<Uint8Array>> { throw new Error("Implicit stdin"); } }; } },
    stdout: { async write(chunk) { chunks.push(chunk); } }, stderr: { async write() {} }
  });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(Buffer.concat(chunks).toString()).data).toEqual(sdk);
  expect(reads).toEqual(["/input.docx"]); expect(volume.toJSON()).toEqual(before);
  for (const spy of [fetch, hostReads, asyncHostReads, hostOpens, httpRequests, httpsRequests]) expect(spy).not.toHaveBeenCalled();
});

it.each([
  ["instruction", '<w:p><w:fldSimple><w:r><w:t>Private passage</w:t></w:r></w:fldSimple></w:p>', [], 1, "invalid-package"],
  ["profile", "<w:p/>", ["--profile", "unknown"], 2, "usage"],
  ["nodes", "<w:p/>", ["--limit", "xmlNodes=1"], 4, "limit-exceeded"]
] as const)("retains shared JSON and exit semantics for hostile %s input", async (_label, body, flags, exit, code) => {
  const bytes = wire(parts(body)).bytes, chunks: Uint8Array[] = [], diagnostics: Uint8Array[] = [];
  const result = await createDocxInspectionCommandEngine({ limits: context.limits }).execute({
    args: ["validate", "-", "--json", ...flags].map(encode), cwd: "/", signal: context.signal,
    filesystem: { async readFile() { throw new Error("Implicit filesystem read"); } },
    stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
    stdout: { async write(chunk) { chunks.push(chunk); } }, stderr: { async write(chunk) { diagnostics.push(chunk); } }
  });
  expect(result.exitCode).toBe(exit);
  expect(JSON.parse(Buffer.concat(chunks).toString())).toMatchObject({ version: 1, operation: "validate", ok: false, data: null, affected: 0, errors: [expect.objectContaining({ code })] });
  expect(Buffer.concat(diagnostics).toString()).not.toContain("Private passage");
});

it("enforces finite actual byte, node, work and table ceilings on small fixtures", async () => {
  const entries = parts(), bytes = wire(entries).bytes;
  await expect(readArchive(bytes, { ...context, limits: { ...context.limits, maxArchiveBytes: bytes.length - 1 } })).rejects.toMatchObject({ code: "limit-exceeded" });
  await expect(readArchive(wire([["a.xml", encode("x".repeat(2048))]], "none", true).bytes,
    { ...context, limits: { ...context.limits, maxEntryBytes: 2047 } })).rejects.toMatchObject({ code: "limit-exceeded" });
  const xml = encode('<r a="1"><x/>text<!--retain--></r>');
  for (const limits of [{ maxNodes: 1 }, { maxDepth: 1 }, { maxAttributesPerElement: 1, maxAttributes: 1 }, { maxWork: xml.length }]) {
    const input = "maxAttributes" in limits ? encode('<r a="1" b="2"/>') : xml;
    expect(() => parseDocumentXml(input, limits)).toThrowError(expect.objectContaining({ code: "limit-exceeded" }));
  }
  const archive = await readArchive(wire(parts('<w:tbl><w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid><w:tr><w:tc><w:p/></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl>')).bytes, context);
  const budget = new DocumentBudget({ tableCells: 1 });
  expect(() => validateDocumentArchive(archive, {}, budget)).toThrowError(expect.objectContaining({ code: "limit-exceeded" }));
  for (const [name, used] of Object.entries(budget.usage)) expect(used).toBeLessThanOrEqual(budget.limits[name as keyof typeof budget.limits]);
});
