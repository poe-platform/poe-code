import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createZipCodec } from "@poe-code/office-package";
import { createEngine } from "../engine.js";
import type { RuntimeLimits } from "../contracts.js";

const ss = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const pkg = "http://schemas.openxmlformats.org/package/2006/relationships";
const environment = { env: {}, locale: "C", timezone: "UTC" };
const limits: RuntimeLimits = { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 3, operations: 1000 };
async function packageBytes(sheet: string, extra: Readonly<Record<string, string>> = {}) {
  const parts = {
    "_rels/.rels": `<Relationships xmlns="${pkg}"><Relationship Id="w" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook xmlns="${ss}" xmlns:r="${rel}"><sheets><sheet name="S" sheetId="1" r:id="s"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${pkg}"><Relationship Id="s" Type="${rel}/worksheet" Target="worksheets/s.xml"/></Relationships>`,
    "xl/worksheets/s.xml": `<worksheet xmlns="${ss}">${sheet}</worksheet>`, ...extra
  };
  const zip = createZipCodec(); const signal = new AbortController().signal;
  const bounds = { maxArchiveBytes: 100000, maxEntryBytes: 100000, maxTotalBytes: 100000,
    maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 100000, chunkSize: 4096 };
  const entries = [];
  for (const [name, text] of Object.entries(parts)) entries.push(await zip.makeZipEntry(name, new TextEncoder().encode(text),
    { modified: new Date("2000-01-01Z"), mode: 0o644, directory: false, symlink: false, compression: "store" }, bounds, signal));
  return zip.writeZipArchive({ entries, comment: new Uint8Array() }, bounds, signal);
}
async function load(sheet: string, extra: Readonly<Record<string, string>> = {}, suppliedLimits = limits, exportXml = false) {
  const volume = new Volume(); volume.writeFileSync("/book.xlsx", await packageBytes(sheet, extra));
  const messages: string[] = [];
  const engine = createEngine({ codecs: [], environment, limits: suppliedLimits,
    filesystem: { async read(uri, signal) { signal.throwIfAborted(); return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes, signal) { signal.throwIfAborted(); volume.writeFileSync(uri, bytes); } } });
  const operation = { signal: new AbortController().signal, async diagnostic(d: { message: string }) { messages.push(d.message); } };
  try {
    const book = await engine.readWorkbook({ kind: "resource", uri: "/book.xlsx" }, {}, operation);
    if (exportXml) {
      const result = await engine.writeWorkbook(book, { kind: "resource", uri: "/output.xml" }, { exportType: "Gnumeric_XmlIO:sax:0" }, operation);
      expect(result.exitCode).toBe(0);
    }
    return { book, messages, xml: exportXml ? volume.readFileSync("/output.xml", "utf8") as string : undefined };
  }
  finally { await engine.dispose(); }
}

it("matches native canonical formula spelling through the actual engine", async () => {
  const { book } = await load('<sheetData><row><c><f>1+2</f><v>3</v></c></row></sheetData>');
  expect(book.sheets[0]!.cells[0]).toMatchObject({ formula: "=1+2", cachedResult: { kind: "number", value: 3 } });
});
it("matches native first-character boolean caches rather than an attribute boolean parser", async () => {
  const { book } = await load('<sheetData><row><c t="b"><v>2</v></c><c t="b"><v>0false</v></c></row></sheetData>');
  expect(book.sheets[0]!.cells.map(c => c.value)).toEqual([{ kind: "boolean", value: true }, { kind: "boolean", value: false }]);
});
it("does not turn an empty numeric cache into zero", async () => {
  const { book } = await load('<sheetData><row><c><f>1+2</f><v/></c></row></sheetData>');
  expect(book.sheets[0]!.cells[0]).toMatchObject({ formula: "=1+2", value: { kind: "blank" }, formulaDirty: true });
});
it("preserves native missing workbook relationship error wording", async () => {
  await expect(load('', { "_rels/.rels": `<Relationships xmlns="${pkg}"/>` })).rejects.toMatchObject({ message: "E No workbook stream found." });
});
it("reports native unknown worksheet element warning", async () => {
  const { messages } = await load('<sheetData/><mystery foo="bar"/>');
  expect(messages).toEqual(["Unexpected element 'mystery' in state : \n\tworksheet\n"]);
});
it("silences unknown extension subtree when uri is supplied", async () => {
  const { messages } = await load('<sheetData/><extLst><ext uri="original"><other/></ext></extLst>');
  expect(messages).toEqual([]);
});
it("reports missing extension uri at native implied cell position", async () => {
  const { messages } = await load('<sheetData><row><c><v>1</v></c><c><v>2</v></c></row></sheetData><extLst><ext><other/></ext></extLst>');
  expect(messages).toEqual(['S!C2 : Encountered uninterpretable "ext" extension with missing namespace']);
});
it("matches native local-name fallback for foreign namespace cells", async () => {
  const { book } = await load('<sheetData><row><c xmlns="urn:foreign" r="A1" t="inlineStr"><is><t>hello</t></is></c></row></sheetData>');
  expect(book.sheets[0]!.cells).toMatchObject([{ value: { kind: "string", value: "hello" } }]);
});
it("snapshots shared formula groups and translated references through the engine", async () => {
  const { book } = await load('<sheetData><row r="1"><c r="A1"><f t="shared" si="0" ref="A1:A2">B1+$C$1</f><v>5</v></c></row><row r="2"><c r="A2"><f t="shared" si="0"/><v>7</v></c></row></sheetData>');
  expect(book.sheets[0]!.cells.map(c => c.formula)).toEqual(["=B1+$C$1", "=B2+$C$1"]);
  expect(book.sheets[0]!.formulaGroups).toMatchObject([{ kind: "shared", expression: "=B1+$C$1", range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 } }]);
  expect(Object.isFrozen(book.sheets[0]!.formulaGroups)).toBe(true);
});
it("snapshots array formulas and their cached members", async () => {
  const { book } = await load('<sheetData><row><c><f t="array" ref="A1:A2">{1;2}</f><v>1</v></c></row><row><c><v>2</v></c></row></sheetData>');
  expect(book.sheets[0]!.formulaGroups).toMatchObject([{ kind: "array", expression: "={1;2}" }]);
  expect(book.sheets[0]!.cells[0]!.cachedResult).toEqual({ kind: "number", value: 1 });
});
it("enforces the explicit workbook work budget", async () => {
  await expect(load('<sheetData><row><c><v>1</v></c></row></sheetData>', {}, { ...limits, workbookWork: 0 })).rejects.toMatchObject({ code: "resource-limit" });
});
it.each(["drawing", "table"])("ignores unused %s relationships instead of parsing invalid part bytes", async type => {
  const { book } = await load('<sheetData><row><c><v>42</v></c></row></sheetData>', {
    "xl/worksheets/_rels/s.xml.rels": `<Relationships xmlns="${pkg}"><Relationship Id="d" Type="${rel}/${type}" Target="../unused.xml"/></Relationships>`,
    "xl/unused.xml": "this is not xml"
  });
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 42 });
});
it("imports native numeric prefixes without rejecting trailing bytes", async () => {
  const { book } = await load('<sheetData><row><c><v>12junk</v></c></row></sheetData>');
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 12 });
});
it("uses the native unknown ISO-date cell type warning and numeric fallback", async () => {
  const { book, messages } = await load('<sheetData><row><c t="d"><v>2020-01-01T00:00:00Z</v></c></row></sheetData>');
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "number", value: 2020 });
  expect(messages).toEqual(["S!A1 : Unknown enum value 'd' for attribute t"]);
});
it("silences unknown prefixes registered by the native worksheet namespace scan", async () => {
  const { messages } = await load('<sheetData/><f:mystery xmlns:f="urn:foreign"/>');
  expect(messages).toEqual([]);
});
it("emits style warnings before worksheet warnings", async () => {
  const { messages } = await load('<sheetData/><mysterySheet/>', {
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${pkg}"><Relationship Id="s" Type="${rel}/worksheet" Target="worksheets/s.xml"/><Relationship Id="z" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `<styleSheet xmlns="${ss}"><mysteryStyle/></styleSheet>`
  });
  expect(messages).toEqual(["Unexpected element 'mysteryStyle' in state : \n\tstyleSheet\n", "Unexpected element 'mysterySheet' in state : \n\tworksheet\n"]);
});

it("exports unqualified odd header/footer text in native Left section", async () => {
  const { xml } = await load('<sheetData/><headerFooter><oddHeader>Header &amp;P</oddHeader><oddFooter>Footer</oddFooter></headerFooter>', {}, limits, true);
  expect(xml).toContain('<gnm:Header Left="Header &amp;[PAGE]" Middle="" Right=""/>');
  expect(xml).toContain('<gnm:Footer Left="Footer" Middle="" Right=""/>');
});
