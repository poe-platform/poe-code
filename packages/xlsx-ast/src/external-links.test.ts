import { expect, it } from "vitest";
import { createZipCodec, type ZipLimits } from "@poe-code/office-package";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import { parseExpression } from "@poe-code/spreadsheet-engine/formulas/parser";
import { visitFormula } from "@poe-code/spreadsheet-engine/formulas/rewriting";
import { readXlsx, createXlsxWriter } from "./xlsx.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 2, operations: 10000 } };
const limits: ZipLimits = { maxArchiveBytes: 1000000, maxEntryBytes: 1000000, maxTotalBytes: 1000000,
  maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 1000000, chunkSize: 4096 };
const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const pkg = "http://schemas.openxmlformats.org/package/2006/relationships";

async function fixture(expression: string, mode = "External", shared = false, target = "dir/linked.xls", definitionSheet?: number, sheets = ["Other"], definition = "[1]Other!$A$1"): Promise<Uint8Array> {
  const zip = createZipCodec();
  const parts = {
    "_rels/.rels": `<Relationships xmlns="${pkg}"><Relationship Id="w" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="Data" sheetId="1" r:id="s"/></sheets><externalReferences><externalReference r:id="e"/></externalReferences><definedNames><definedName name="Alias">${expression}</definedName></definedNames></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${pkg}"><Relationship Id="s" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="unused" Type="${rel}/externalLink" Target="externalLinks/unused.xml"/><Relationship Id="e" Type="${rel}/externalLink" Target="externalLinks/link.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="${ns}"><sheetData><row r="1"><c r="A1"><f ${shared ? 't="shared" si="0" ref="A1:A2"' : ""}>${expression}</f><v>999</v></c></row>${shared ? '<row r="2"><c r="A2"><f t="shared" si="0"/><v>999</v></c></row>' : ""}</sheetData></worksheet>`,
    "xl/externalLinks/link.xml": `<externalLink xmlns="${ns}" xmlns:r="${rel}"><externalBook r:id="target"><sheetNames>${sheets.map(sheet => `<sheetName val="${sheet}"/>`).join("")}</sheetNames><definedNames><definedName name="Rate" refersTo="${definition}" ${definitionSheet === undefined ? "" : `sheetId="${definitionSheet}"`}/></definedNames></externalBook></externalLink>`,
    "xl/externalLinks/unused.xml": `<externalLink xmlns="${ns}"/>`,
    "xl/externalLinks/_rels/link.xml.rels": `<Relationships xmlns="${pkg}"><Relationship Id="target" Type="${rel}/externalLinkPath" Target="${target}" TargetMode="${mode}"/></Relationships>`
  };
  const entries = [];
  for (const [name, text] of Object.entries(parts)) entries.push(await zip.makeZipEntry(name, new TextEncoder().encode(text),
    { modified: new Date("2000-01-01Z"), mode: 0o644, directory: false, symlink: false, compression: "store" }, limits, context.signal));
  return zip.writeZipArchive({ entries, comment: new Uint8Array() }, limits, context.signal);
}

it.each(["[1]Other!$A$1+1", "SUM([1]Other!$A$1:$B$2)", "[1]!Rate+1", "[1]Other!Rate+1"])("resolves XLSX relationship identity in cells and names: %s", async expression => {
  const book = await readXlsx(await fixture(expression), { ...context, externalReferences: { resolve() { throw new Error("Import must not fetch links"); } } });
  for (const source of [book.sheets[0]!.cells[0]!.formula!, book.names![0]!.expression]) {
    const parsed = parseExpression(source, { position: { sheet: "1", row: 0, column: 0 } });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const targets: string[] = [];
    visitFormula(parsed.document.root, node => {
      if (node.kind === "reference" && node.first.workbook !== undefined) targets.push(node.first.workbook);
      if (node.kind === "name" && node.workbook !== undefined) targets.push(node.workbook);
    });
    expect(targets).toEqual(["dir/linked.xls"]);
  }
});

it("resolves the shared master before translating its followers", async () => {
  const book = await readXlsx(await fixture("[1]Other!A1", "External", true), context);
  expect(book.sheets[0]!.cells.map(cell => cell.formula)).toEqual(["=[dir/linked.xls]'Other'!A1", "=[dir/linked.xls]'Other'!A2"]);
});

it("keeps external-looking string literals unchanged", async () => {
  const book = await readXlsx(await fixture('&quot;[1]Other!A1&quot;'), context);
  expect(book.sheets[0]!.cells[0]!.formula).toBe('="[1]Other!A1"');
});

it("refuses referenced targets without external relationship authority", async () => {
  await expect(readXlsx(await fixture("[1]Other!A1", "Internal"), context)).rejects.toThrow("Unsupported XLSX external link target");
});

it.each(["a]b.xls", "表 空間.xls", "Bob&apos;s book.xls"])("keeps linked workbook spelling: %s", async target => {
  const book = await readXlsx(await fixture("[1]Other!A1", "External", false, target), context);
  const parsed = parseExpression(book.sheets[0]!.cells[0]!.formula!, { position: { sheet: "1", row: 0, column: 0 } });
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.document.root).toMatchObject({ kind: "reference", first: { workbook: target.split("&apos;").join("'") } });
});

it.each([false, true])("preserves external-name definitions when link numbering changes: %s", async reordered => {
  const imported = await readXlsx(await fixture("[1]!Rate+1"), context);
  const book = reordered ? { ...imported, sheets: [{ ...imported.sheets[0]!, cells: [
    { row: 0, column: 0, formula: "=['earlier.xls']Other!A1", value: { kind: "number" as const, value: 999 } },
    { ...imported.sheets[0]!.cells[0]!, column: 1 }
  ] }] } : imported;
  const warnings: string[] = [];
  const bytes = await createXlsxWriter("2008")(book, [], { ...context, diagnostic: async d => { warnings.push(d.message); },
    externalReferences: { resolve() { throw new Error("Definition preservation must not execute links"); } } });
  const zip = createZipCodec(), archive = await zip.readZipArchive(bytes, limits, context.signal);
  const index = reordered ? 2 : 1;
  const entry = archive.entries.find(entry => entry.name === `xl/externalLinks/externalLink${index}.xml`)!;
  let xml = ""; for await (const chunk of zip.decodeZipEntry(entry, limits, context.signal)) xml += new TextDecoder().decode(chunk);
  expect(xml).toContain('name="Rate"');
  expect(xml).toContain(`[${index}]Other`);
  expect(warnings.some(warning => warning.includes("definition for external name"))).toBe(false);
});

it.each(["Rate", "RATE"])("retains case-insensitive external name bindings: %s", async name => {
  const book = await readXlsx(await fixture(`[1]!${name}+1`), context);
  const warnings: string[] = [];
  await createXlsxWriter("2008")(book, [], { ...context, diagnostic: async d => { warnings.push(d.message); } });
  expect(warnings.some(warning => warning.includes("definition for external name"))).toBe(false);
});

it("preserves the definition's sheet scope after an earlier reference", async () => {
  const imported = await readXlsx(await fixture("[1]Other!Rate", "External", false, "dir/linked.xls", 0), context);
  const book = { ...imported, sheets: [{ ...imported.sheets[0]!, cells: [
    { row: 0, column: 0, formula: "=['dir/linked.xls']Unused!A1", value: { kind: "number" as const, value: 999 } },
    { ...imported.sheets[0]!.cells[0]!, column: 1 }
  ] }] };
  const zip = createZipCodec(), archive = await zip.readZipArchive(await createXlsxWriter("2008")(book, [], context), limits, context.signal);
  const entry = archive.entries.find(entry => entry.name === "xl/externalLinks/externalLink1.xml")!;
  let xml = ""; for await (const chunk of zip.decodeZipEntry(entry, limits, context.signal)) xml += new TextDecoder().decode(chunk);
  expect(xml).toContain('sheetId="0"');
  expect(xml).toContain('<sheetNames><sheetName val="Other"/><sheetName val="Unused"/></sheetNames>');
});

it("rejects conflicting retained definitions instead of choosing a target", async () => {
  const imported = await readXlsx(await fixture("[1]!Rate+1"), context);
  const book = { ...imported, unsupportedRecords: [...imported.unsupportedRecords!, {
    source: "other", kind: "externalLink", disposition: "retained" as const,
    data: { externalNameDefinitions: { workbook: "dir/linked.xls", names: [
      { name: "RATE", expression: "=['dir/linked.xls']Other!B1" }
    ] } }
  }] };
  await expect(createXlsxWriter("2008")(book, [], context)).rejects.toThrow("Conflicting retained external name definitions");
});

it("refuses an undeclared numeric link instead of inventing a workbook path", async () => {
  await expect(readXlsx(await fixture("[2]Other!A1"), context)).rejects.toThrow("Unresolved XLSX external link index");
});

it("resolves leading-zero numeric link indexes", async () => {
  const book = await readXlsx(await fixture("[01]Other!A1"), context);
  const parsed = parseExpression(book.sheets[0]!.cells[0]!.formula!, { position: { sheet: "1", row: 0, column: 0 } });
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.document.root).toMatchObject({ kind: "reference", first: { workbook: "dir/linked.xls" } });
});

it.each([false, true])("preserves intermediate sheets and original order for external spans, named: %s", async named => {
  const imported = await readXlsx(await fixture(named ? "SUM([1]!Rate)" : "SUM([1]Other:Last!$A$1)", "External", false, "linked.xls", undefined,
    ["Other", "Middle", "Last"], named ? "[1]Other:Last!$A$1" : ""), context);
  const book = { ...imported, sheets: [{ ...imported.sheets[0]!, cells: [
    { row: 0, column: 0, formula: "=['linked.xls']Last!A1", value: { kind: "number" as const, value: 999 } },
    { ...imported.sheets[0]!.cells[0]!, column: 1 }
  ] }] };
  const zip = createZipCodec(), archive = await zip.readZipArchive(await createXlsxWriter("2008")(book, [], context), limits, context.signal);
  const entry = archive.entries.find(entry => entry.name === "xl/externalLinks/externalLink1.xml")!;
  let xml = ""; for await (const chunk of zip.decodeZipEntry(entry, limits, context.signal)) xml += new TextDecoder().decode(chunk);
  expect(xml).toContain('<sheetNames><sheetName val="Other"/><sheetName val="Middle"/><sheetName val="Last"/></sheetNames>');
});

for (const edition of ["2006", "2008"] as const)
it.each(["_x005F_x0041_", "_x005F_x005F_x005F_x0041_", "表"])(`preserves external sheet XStrings and scopes in ${edition}: %s`, async wire => {
  const imported = await readXlsx(await fixture(`'[1]${wire}'!Rate`, "External", false, "linked.xls", 0,
    [wire], `'[1]${wire}'!$A$1`), context);
  const zip = createZipCodec();
  let book = imported;
  for (let repeat = 0; repeat < 2; repeat++) {
    const warnings: string[] = [];
    const bytes = await createXlsxWriter(edition)(book, [], { ...context, diagnostic: async d => { warnings.push(d.message); } });
    const archive = await zip.readZipArchive(bytes, limits, context.signal);
    const entry = archive.entries.find(entry => entry.name === "xl/externalLinks/externalLink1.xml")!;
    let xml = ""; for await (const chunk of zip.decodeZipEntry(entry, limits, context.signal)) xml += new TextDecoder().decode(chunk);
    expect(xml).toContain(`<sheetName val="${wire}"/>`);
    expect(warnings.some(warning => warning.includes("definition for external name"))).toBe(false);
    book = await readXlsx(bytes, context);
  }
});
