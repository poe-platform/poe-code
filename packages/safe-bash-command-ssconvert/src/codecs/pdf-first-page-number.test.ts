import { expect, it } from "vitest";
import { Volume } from "memfs";
import type { CapabilityContext } from "../contracts.js";
import { createZipCodec } from "@poe-code/office-package";
import { suppliedDefaultFont } from "safe-bash-pdf-engine";
import { createEngine, runCommand } from "../index.js";
import { createXlsxWriter, readXlsx } from "./xlsx.js";
import { readGnumeric } from "./gnumeric.js";
import { writePdf } from "./pdf.js";
import { pdfText } from "./pdf-text.test-support.js";
import { metadataNode } from "./xlsx-write-support.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {}, fonts: { async resolve() { return suppliedDefaultFont().bytes; } },
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 4000000, workbookWork: 4000000, cells: 10000, sheets: 10, operations: 1000 } };
const namespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
async function fixture(settings: readonly Record<string, string>[], rows = 1) {
  const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const pkg = "http://schemas.openxmlformats.org/package/2006/relationships";
  const parts: Record<string, string> = {
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${settings.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    "_rels/.rels": `<Relationships xmlns="${pkg}"><Relationship Id="w" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook xmlns="${namespace}" xmlns:r="${rel}"><sheets>${settings.map((_, i) => `<sheet name="Sheet${i + 1}" sheetId="${i + 1}" r:id="s${i}"/>`).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${pkg}">${settings.map((_, i) => `<Relationship Id="s${i}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`
  };
  settings.forEach((attributes, i) => {
    parts[`xl/worksheets/sheet${i + 1}.xml`] = `<worksheet xmlns="${namespace}"><sheetData>${Array.from({ length: rows }, (_, row) => `<row r="${row + 1}"><c r="A${row + 1}"><v>42</v></c></row>`).join("")}</sheetData><pageSetup ${Object.entries(attributes).map(([key, value]) => `${key}="${value}"`).join(" ")}/><headerFooter><oddHeader>&amp;CHeader &amp;P of &amp;N</oddHeader><oddFooter>&amp;CFooter &amp;P of &amp;N</oddFooter></headerFooter></worksheet>`;
  });
  const zip = createZipCodec(), limits = { maxArchiveBytes: 1000000, maxEntryBytes: 1000000, maxTotalBytes: 1000000, maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 1000000, chunkSize: 4096 };
  const entries = [];
  for (const [name, text] of Object.entries(parts)) entries.push(await zip.makeZipEntry(name, new TextEncoder().encode(text),
    { modified: new Date("2000-01-01Z"), mode: 0o644, directory: false, symlink: false, compression: "store" }, limits, context.signal));
  return zip.writeZipArchive({ entries, comment: new Uint8Array() }, limits, context.signal);
}
async function fields(bytes: Uint8Array) {
  const { pdf, runs } = await pdfText(bytes);
  return { count: pdf.getPageCount(), header: runs.filter(r => r.text.startsWith("Header ")).map(r => r.text),
    footer: runs.filter(r => r.text.startsWith("Footer ")).map(r => r.text) };
}
it.each(["1", "true"])("renders enabled XLSX first page 7 in both fields (%s)", async enabled => {
  const book = await readXlsx(await fixture([{ firstPageNumber: "7", useFirstPageNumber: enabled }]), context);
  expect(await fields(await writePdf(book, [], context))).toEqual({ count: 1, header: ["Header 7 of 1"], footer: ["Footer 7 of 1"] });
});
it.each(["0", "false", undefined])("keeps automatic numbering when first page is disabled (%s)", async enabled => {
  const bytes = await fixture([{ firstPageNumber: "7", ...(enabled === undefined ? {} : { useFirstPageNumber: enabled }) }]);
  expect(await fields(await writePdf(await readXlsx(bytes, context), [], context))).toEqual({ count: 1, header: ["Header 1 of 1"], footer: ["Footer 1 of 1"] });
});
it("continues automatic sheets and resets explicit sheets without changing physical totals", async () => {
  const book = await readXlsx(await fixture([
    { firstPageNumber: "7", useFirstPageNumber: "1" },
    { firstPageNumber: "50", useFirstPageNumber: "0" },
    { firstPageNumber: "20", useFirstPageNumber: "1" }
  ], 90), context);
  const result = await fields(await writePdf(book, [], context));
  expect(result.count % 3).toBe(0);
  const perSheet = result.count / 3;
  expect(perSheet).toBeGreaterThan(1);
  const numbers = [...Array.from({ length: 2 * perSheet }, (_, i) => 7 + i), ...Array.from({ length: perSheet }, (_, i) => 20 + i)];
  expect(result.header).toEqual(numbers.map(n => `Header ${n} of ${result.count}`));
  expect(result.footer).toEqual(numbers.map(n => `Footer ${n} of ${result.count}`));
});
it.each(["true", "false"])("preserves raw settings across XLSX read/write (%s)", async enabled => {
  const bytes = await fixture([{ firstPageNumber: "7", useFirstPageNumber: enabled }]);
  const roundtrip = await readXlsx(await createXlsxWriter("2006")(await readXlsx(bytes, context), [], context), context);
  const setup = metadataNode(roundtrip.sheets[0]!.unsupportedRecords!.find(r => r.kind === "pageSetup")!.data)!;
  expect(setup.attributes).toMatchObject({ firstPageNumber: "7", useFirstPageNumber: enabled });
});
it("uses the same numbering through SDK and command conversions", async () => {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/input.xlsx", await fixture([{ firstPageNumber: "7", useFirstPageNumber: "1" }]));
  const engine = createEngine({ codecs: [], fonts: context.fonts!, environment: context.environment, limits: context.limits,
    filesystem: { async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes) { volume.writeFileSync(uri, bytes); } } });
  const operation = { signal: context.signal, stdout: { async write() {} }, stderr: { async write() {} } };
  try {
    expect((await engine.convert({ input: { kind: "resource", uri: "/input.xlsx" }, destination: { kind: "resource", uri: "/sdk.pdf" } }, operation)).exitCode).toBe(0);
    expect((await runCommand(["/input.xlsx", "/command.pdf"], engine, operation)).exitCode).toBe(0);
    for (const path of ["/sdk.pdf", "/command.pdf"]) expect((await fields(new Uint8Array(volume.readFileSync(path) as Uint8Array))).footer).toEqual(["Footer 7 of 1"]);
  } finally { await engine.dispose(); }
});
it("enforces import, print work, output limits and cancellation with numbered pages", async () => {
  const bytes = await fixture([{ firstPageNumber: "7", useFirstPageNumber: "1" }]);
  await expect(readXlsx(bytes, { ...context, limits: { ...context.limits, inputBytes: 1 } })).rejects.toMatchObject({ code: "resource-limit" });
  const book = await readXlsx(bytes, context);
  for (const limits of [{ workbookWork: 1 }, { outputBytes: 1 }])
    await expect(writePdf(book, [], { ...context, limits: { ...context.limits, ...limits } })).rejects.toMatchObject({ code: "resource-limit" });
  const signal = AbortSignal.abort(new Error("cancelled"));
  await expect(writePdf(book, [], { ...context, signal })).rejects.toThrow("cancelled");
});
it("resets separately imported sheets even when their explicit settings match", async () => {
  const result = await fields(await writePdf(await readXlsx(await fixture([
    { firstPageNumber: "7", useFirstPageNumber: "1" }, { firstPageNumber: "7", useFirstPageNumber: "1" }
  ]), context), [], context));
  expect(result.header).toEqual(["Header 7 of 2", "Header 7 of 2"]);
  expect(result.footer).toEqual(["Footer 7 of 2", "Footer 7 of 2"]);
});
it.each([
  [{ useFirstPageNumber: "1" }, 1],
  [{ firstPageNumber: "0", useFirstPageNumber: "1" }, 0],
  [{ firstPageNumber: "10000", useFirstPageNumber: "1" }, 10000],
  [{ firstPageNumber: "4294967295", useFirstPageNumber: "1" }, 4294967295]
] as const)("preserves explicit XLSX first-page numbers: %j", async (setup, first) => {
  const result = await fields(await writePdf(await readXlsx(await fixture([setup]), context), [], context));
  expect(result.header).toEqual([`Header ${first} of 1`]);
});

it.each([0, 10000, 4294967295])("exports Gnumeric first page %s as enabled XLSX numbering", async first => {
  const source = `<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd" Version="14"><g:Sheets><g:Sheet Rows="65536" Cols="256"><g:Name>S</g:Name><g:PrintInformation><g:first_page_number value="${first}"/><g:Footer Left="" Middle="Footer &amp;[PAGE] of &amp;[PAGES]" Right=""/></g:PrintInformation><g:Cells><g:Cell Row="0" Col="0" ValueType="40">42</g:Cell></g:Cells></g:Sheet></g:Sheets></g:Workbook>`;
  const book = await readGnumeric(new TextEncoder().encode(source), context);
  const roundtrip = await readXlsx(await createXlsxWriter("2006")(book, [], context), context);
  const setup = metadataNode(roundtrip.sheets[0]!.unsupportedRecords!.find(r => r.kind === "pageSetup")!.data)!;
  expect(setup.attributes).toMatchObject({ firstPageNumber: String(first), useFirstPageNumber: "1" });
  expect((await fields(await writePdf(book, [], context))).footer).toEqual([`Footer ${first} of 1`]);
});
it("continues numbering from a zero-numbered cover page", async () => {
  const book = await readXlsx(await fixture([{ firstPageNumber: "0", useFirstPageNumber: "1" }, {}]), context);
  expect((await fields(await writePdf(book, [], context))).header).toEqual(["Header 0 of 2", "Header 1 of 2"]);
});

it.each(["-1", "1.5", "4294967296", "9007199254740992"])("rejects XLSX first page outside unsigned integer bounds (%s)", async first => {
  await expect(readXlsx(await fixture([{ firstPageNumber: first, useFirstPageNumber: "1" }]), context))
    .rejects.toMatchObject({ code: "io" });
});
