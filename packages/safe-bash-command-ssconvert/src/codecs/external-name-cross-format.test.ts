import { expect, it } from "vitest";
import { createZipCodec, type ZipLimits } from "@poe-code/office-package";
import type { CapabilityContext } from "../contracts.js";
import { readBiff } from "./biff.js";
import { writeBiffStream } from "./biff-write.js";
import { readBiffRecords } from "./biff-binary.js";
import { createXlsxWriter, readXlsx } from "./xlsx.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 4, operations: 10000 },
  externalReferences: { resolve() { throw new Error("Converting definitions must not execute external links"); } } };
const limits: ZipLimits = { maxArchiveBytes: 1000000, maxEntryBytes: 1000000, maxTotalBytes: 1000000,
  maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 1000000, chunkSize: 4096 };
function join(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0; for (const part of parts) { output.set(part, at); at += part.length; } return output;
}
function words(...values: number[]): Uint8Array {
  const result = new Uint8Array(values.length * 2), view = new DataView(result.buffer);
  values.forEach((value, index) => view.setUint16(index * 2, value, true)); return result;
}
function record(opcode: number, payload: Uint8Array = new Uint8Array()): Uint8Array { return join(words(opcode, payload.length), payload); }
function text(value: string): Uint8Array { return join(words(value.length), new Uint8Array([0]), new TextEncoder().encode(value)); }
function biffFixture(named = true): Uint8Array {
  const cell = new Uint8Array(29), view = new DataView(cell.buffer);
  view.setFloat64(6, 999, true); view.setUint16(20, 7, true); cell.set(named ? [0x59, 0, 0, 1, 0, 0, 0] : [0x5a, 0, 0, 0, 0, 0, 0], 22);
  const definition = join(new Uint8Array([0x3a]), words(1, 1, 2, 3));
  return join(record(0x809, words(0x600, 5)),
    record(0x1ae, join(words(2), text("\u0001book.xls"), text("Unused"), text("Other"))),
    named ? record(0x23, join(words(0, 0, 0), new Uint8Array([4, 0]), new TextEncoder().encode("Rate"), words(definition.length), definition)) : new Uint8Array(),
    record(0x17, named ? words(1, 0, 0xfffe, 0xfffe) : words(1, 0, 1, 1)), record(10), record(0x809, words(0x600, 16)), record(6, cell), record(10));
}
async function xlsxFixture(expression = "[1]Other!$D$3"): Promise<Uint8Array> {
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main", rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships", pkg = "http://schemas.openxmlformats.org/package/2006/relationships";
  const parts = {
    "_rels/.rels": `<Relationships xmlns="${pkg}"><Relationship Id="w" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="Here" sheetId="1" r:id="s"/></sheets><externalReferences><externalReference r:id="e"/></externalReferences></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${pkg}"><Relationship Id="s" Type="${rel}/worksheet" Target="worksheets/s.xml"/><Relationship Id="e" Type="${rel}/externalLink" Target="externalLinks/e.xml"/></Relationships>`,
    "xl/worksheets/s.xml": `<worksheet xmlns="${ns}"><sheetData><row r="1"><c r="A1"><f>[1]!Rate</f><v>999</v></c></row></sheetData></worksheet>`,
    "xl/externalLinks/e.xml": `<externalLink xmlns="${ns}" xmlns:r="${rel}"><externalBook r:id="p"><sheetNames><sheetName val="Unused"/><sheetName val="Other"/></sheetNames><definedNames><definedName name="Rate" refersTo="${expression}"/></definedNames></externalBook></externalLink>`,
    "xl/externalLinks/_rels/e.xml.rels": `<Relationships xmlns="${pkg}"><Relationship Id="p" Type="${rel}/externalLinkPath" Target="book.xls" TargetMode="External"/></Relationships>`
  };
  const zip = createZipCodec(), entries = [];
  for (const [name, xml] of Object.entries(parts)) entries.push(await zip.makeZipEntry(name, new TextEncoder().encode(xml),
    { modified: new Date("2000-01-01Z"), mode: 0o644, directory: false, symlink: false, compression: "store" }, limits, context.signal));
  return zip.writeZipArchive({ entries, comment: new Uint8Array() }, limits, context.signal);
}

it("retains the native BIFF external-name definition in XLSX", async () => {
  const book = await readBiff(biffFixture(), context), zip = createZipCodec();
  const archive = await zip.readZipArchive(await createXlsxWriter("2008")(book, [], context), limits, context.signal);
  const entry = archive.entries.find(entry => entry.name === "xl/externalLinks/externalLink1.xml")!;
  let xml = ""; for await (const chunk of zip.decodeZipEntry(entry, limits, context.signal)) xml += new TextDecoder().decode(chunk);
  expect(xml).toContain('name="Rate"'); expect(xml).toContain("$D$3");
});

it("compiles the native XLSX definition into BIFF external-name tokens", async () => {
  const book = await readXlsx(await xlsxFixture(), context);
  const external = readBiffRecords(await writeBiffStream(book, 8, false, context), context).find(record => record.opcode === 0x23)!;
  const start = 8 + external.data.u8(6) * 2;
  expect(external.data.u16(start)).toBe(9);
  expect(external.data.slice(start + 2, 9)).toEqual(join(new Uint8Array([0x3a]), words(1, 1, 2, 3)));
});

for (const expression of ["[1]Other!D3", "[1]Other!$D$65537", "[1]Other!$IW$3", "1+2"]) {
  it(`refuses unsupported external definition ${expression} before BIFF publication`, async () => {
    const book = await readXlsx(await xlsxFixture(expression), context);
    await expect(writeBiffStream(book, 8, false, context)).rejects.toThrow("Unsupported BIFF external name definition");
  });
}

it("compiles an absolute external area definition", async () => {
  const book = await readXlsx(await xlsxFixture("[1]Other!$D$3:$E$4"), context);
  const external = readBiffRecords(await writeBiffStream(book, 8, false, context), context).find(record => record.opcode === 0x23)!;
  const start = 8 + external.data.u8(6) * 2;
  expect(external.data.u16(start)).toBe(13);
  expect(external.data.slice(start + 2, 13)).toEqual(join(new Uint8Array([0x3b]), words(1, 1, 2, 3, 3, 4)));
});

it.each([false, true])("preserves unused external sheets through BIFF to XLSX transport, named: %s", async named => {
  const book = await readBiff(biffFixture(named), context), zip = createZipCodec();
  const archive = await zip.readZipArchive(await createXlsxWriter("2008")(book, [], context), limits, context.signal);
  const entry = archive.entries.find(entry => entry.name === "xl/externalLinks/externalLink1.xml")!;
  let xml = ""; for await (const chunk of zip.decodeZipEntry(entry, limits, context.signal)) xml += new TextDecoder().decode(chunk);
  expect(xml).toContain('<sheetNames><sheetName val="Unused"/><sheetName val="Other"/></sheetNames>');
});

for (const expression of ["[1]Unused:Missing!$D$3", "[1]Missing:Other!$D$3", "[1]Missing:Absent!$D$3"]) {
  it(`refuses to invent sheet order for external span ${expression}`, async () => {
    const book = await readXlsx(await xlsxFixture(expression), context);
    await expect(writeBiffStream(book, 8, false, context)).rejects.toThrow("Unsupported BIFF external name definition");
  });
}

it.each(["[1]Unused:Other!$D$3", "[1]UNUSED:other!$D$3"])("keeps known external span order for %s", async expression => {
  const book = await readXlsx(await xlsxFixture(expression), context);
  const external = readBiffRecords(await writeBiffStream(book, 8, false, context), context).find(record => record.opcode === 0x23)!;
  const start = 8 + external.data.u8(6) * 2;
  expect(external.data.slice(start + 2, 13)).toEqual(join(new Uint8Array([0x3b]), words(0, 1, 2, 2, 3, 3)));
});
