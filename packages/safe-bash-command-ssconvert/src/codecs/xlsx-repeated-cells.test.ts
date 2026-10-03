import { expect, it } from "vitest";
import { createZipCodec, type ZipLimits } from "@poe-code/office-package";
import type { CapabilityContext } from "../contracts.js";
import { readXlsx } from "./xlsx.js";
import { createEngine } from "../engine.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 4, operations: 1000 } };
const limits: ZipLimits = { maxArchiveBytes: 1000000, maxEntryBytes: 1000000, maxTotalBytes: 1000000,
  maxMembers: 100, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 1000000, chunkSize: 4096 };
async function input(content: string) {
  const zip = createZipCodec(), ss = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', pkg = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const parts = { '_rels/.rels': `<Relationships xmlns="${pkg}"><Relationship Id="w" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<workbook xmlns="${ss}" xmlns:r="${rel}"><sheets><sheet name="S" sheetId="1" r:id="s"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${pkg}"><Relationship Id="s" Type="${rel}/worksheet" Target="worksheets/s.xml"/></Relationships>`,
    'xl/worksheets/s.xml': `<worksheet xmlns="${ss}">${content}</worksheet>` };
  const entries = [];
  for (const [name, text] of Object.entries(parts)) entries.push(await zip.makeZipEntry(name, new TextEncoder().encode(text),
    { modified: new Date('2000-01-01Z'), mode: 0o644, directory: false, symlink: false, compression: 'store' }, limits, context.signal));
  return zip.writeZipArchive({ entries, comment: new Uint8Array() }, limits, context.signal);
}
const records = {
  number: '<c r="A1"><v>42</v></c>', missing: '<c r="A1" t="inlineStr"/>', blank: '<c r="A1"/>',
  empty: '<c r="A1" t="inlineStr"><is/></c>', text: '<c r="A1" t="inlineStr"><is><t>text</t></is></c>'
};
for (const [first, last, expected] of [
  ['number', 'missing', { kind: 'number', value: 42 }], ['missing', 'number', { kind: 'number', value: 42 }],
  ['number', 'blank', { kind: 'number', value: 42 }], ['text', 'missing', { kind: 'string', value: 'text' }],
  ['number', 'empty', { kind: 'string', value: '' }], ['empty', 'missing', { kind: 'string', value: '' }]
] as const) for (const split of [false, true]) {
  it(`retains native repeated cell state for ${first}/${last}, separate sections=${split}`, async () => {
    const data = split ? `<sheetData><row r="1">${records[first]}</row></sheetData><sheetData><row r="1">${records[last]}</row></sheetData>`
      : `<sheetData><row r="1">${records[first]}${records[last]}</row></sheetData>`;
    const book = await readXlsx(await input(`<sheetFormatPr defaultRowHeight="25"/>${data}<sheetFormatPr defaultRowHeight="50"/>`), context);
    expect(book.sheets[0]!.cells).toEqual([{ row: 0, column: 0, value: expected }]);
    expect(book.sheets[0]!.rows?.find(row => row.index === 0)?.sizePoints).toBe(25);
  });
}

it("retains a live formula when a later record assigns its cached value", async () => {
  const original = '<c r="A1"><f>1+1</f><v>2</v></c>';
  const reference = await readXlsx(await input(`<sheetData><row r="1">${original}</row></sheetData>`), context);
  const book = await readXlsx(await input(`<sheetData><row r="1">${original}<c r="A1"><v>42</v></c></row></sheetData>`), context);
  expect(book.sheets[0]!.cells).toEqual([{ ...reference.sheets[0]!.cells[0], value: { kind: "number", value: 42 }, cachedResult: { kind: "number", value: 42 } }]);
});
it("retains the prior cache while marking a later uncached formula dirty", async () => {
  const original = '<c r="A1"><f>1+1</f><v>2</v></c>', replacement = '<c r="A1"><f>3+4</f></c>';
  const reference = await readXlsx(await input(`<sheetData><row r="1">${replacement}</row></sheetData>`), context);
  const book = await readXlsx(await input(`<sheetData><row r="1">${original}${replacement}</row></sheetData>`), context);
  expect(book.sheets[0]!.cells).toEqual([{ ...reference.sheets[0]!.cells[0], value: { kind: "number", value: 2 }, cachedResult: { kind: "number", value: 2 } }]);
});
it("removes earlier rich runs when a later record supplies a plain value", async () => {
  const book = await readXlsx(await input('<sheetData><row r="1"><c r="A1" t="inlineStr"><is><r><rPr><b/></rPr><t>rich</t></r></is></c><c r="A1"><v>42</v></c></row></sheetData>'), context);
  expect(book.sheets[0]!.cells).toEqual([{ row: 0, column: 0, value: { kind: "number", value: 42 } }]);
});
it("charges every repeated source cell against the admission limit", async () => {
  const bytes = await input(`<sheetData><row r="1">${records.number}${records.empty}</row></sheetData>`);
  await expect(readXlsx(bytes, { ...context, limits: { ...context.limits, cells: 1 } })).rejects.toMatchObject({ code: "resource-limit" });
});

it("retains rich cached text when a replacement formula has no cache", async () => {
  const original = '<c r="A1" t="inlineStr"><is><r><rPr><b/></rPr><t>rich</t></r></is></c>';
  const reference = await readXlsx(await input(`<sheetData><row r="1">${original}</row></sheetData>`), context);
  const book = await readXlsx(await input(`<sheetData><row r="1">${original}<c r="A1"><f>3+4</f></c></row></sheetData>`), context);
  expect(reference.sheets[0]!.cells[0]!.richText).toHaveLength(1);
  expect(book.sheets[0]!.cells[0]).toMatchObject({ value: { kind: "string", value: "rich" }, cachedResult: { kind: "string", value: "rich" },
    richText: reference.sheets[0]!.cells[0]!.richText, formulaDirty: true });
});

const arrayRecord = (rows: number) => `<c r="A1"><f t="array" ref="A1:A${rows}">ROW(A1:A${rows})</f><v>1</v></c>`;
for (const [first, last, rows, expression, cached] of [
  [arrayRecord(2), '<c r="A1"><v>42</v></c>', 2, '=ROW(A1:A2)', 42],
  [arrayRecord(2), '<c r="A1"><f>3+4</f><v>7</v></c>', 2, '=ROW(A1:A2)', 1],
  ['<c r="A1"><f>1+1</f><v>2</v></c>', arrayRecord(2), 2, '=ROW(A1:A2)', 1],
  [arrayRecord(2), arrayRecord(3), 3, '=ROW(A1:A3)', 1],
  [arrayRecord(3), arrayRecord(2), 3, '=ROW(A1:A3)', 1],
  [arrayRecord(1), '<c r="A1"><f>3+4</f><v>7</v></c>', 0, '=3+4', 7]
] as const) {
  it(`applies native array replacement for ${first} then ${last}`, async () => {
    const book = await readXlsx(await input(`<sheetData><row r="1">${first}${last}</row></sheetData>`), context);
    expect(book.sheets[0]!.cells).toHaveLength(1);
    expect(book.sheets[0]!.cells[0]).toMatchObject({ formula: expression, value: { kind: 'number', value: cached }, cachedResult: { kind: 'number', value: cached } });
    expect(book.sheets[0]!.formulaGroups).toEqual(rows ? [{ id: 'array-0-0', kind: 'array', expression,
      range: { startRow: 0, startColumn: 0, endRow: rows - 1, endColumn: 0 } }] : []);
  });
}

for (const arrayFirst of [false, true]) {
  it(`keeps array members protected during shared-group recalculation, array first=${arrayFirst}`, async () => {
    const array = arrayRecord(2), shared = '<c r="A1"><f t="shared" si="0" ref="A1:A3">9</f><v>9</v></c>';
    const bytes = await input(`<sheetData><row r="1">${arrayFirst ? array + shared : shared + array}</row><row r="3"><c r="A3"><f t="shared" si="0"/><v>9</v></c></row></sheetData>`);
    const engine = createEngine({ limits: context.limits });
    try {
      let output = '';
      const result = await engine.convert({ input: { kind: 'stream', filename: 'input.xlsx', source: [bytes] }, recalc: true,
        exportType: 'Gnumeric_stf:stf_csv', destination: { kind: 'stream', sink: { async write(chunk) { output += new TextDecoder().decode(chunk); } } } },
      { signal: context.signal });
      expect(result.exitCode).toBe(0);
      expect(output).toBe('1\n2\n9\n');
    } finally { await engine.dispose(); }
  });
}

for (const cached of [false, true]) {
  it(`preserves a scalar when an overlapping array is refused, supplied cache=${cached}`, async () => {
    const book = await readXlsx(await input(`<sheetData><row r="1"><c r="A1"><f>3+4</f><v>2</v></c></row>
      <row r="2"><c r="A2"><f t="array" ref="A2:A3">ROW(A2:A3)</f><v>2</v></c></row>
      <row r="1"><c r="A1"><f t="array" ref="A1:A2">ROW(A1:A2)</f>${cached ? '<v>42</v>' : ''}</c></row></sheetData>`), context);
    expect(book.sheets[0]!.cells[0]).toMatchObject({ formula: '=3+4', value: { kind: 'number', value: cached ? 42 : 2 },
      cachedResult: { kind: 'number', value: cached ? 42 : 2 }, formulaDirty: !cached });
    expect(book.sheets[0]!.formulaGroups).toHaveLength(1);
    expect(book.sheets[0]!.formulaGroups![0]!.range).toEqual({ startRow: 1, startColumn: 0, endRow: 2, endColumn: 0 });
  });
}

for (const [middle, expected] of [
  ['', '9\n\n9\n'],
  ['<c r="A2"><v>42</v></c>', '9\n42\n9\n'],
  ['<c r="A2"><f>3+4</f><v>7</v></c>', '9\n7\n9\n'],
  ['<c r="A2"><f t="shared" si="0"/><v>9</v></c>', '9\n9\n9\n']
] as const) {
  it(`preserves explicit cells inside a shared formula declaration: ${middle || 'missing'}`, async () => {
    const bytes = await input(`<sheetData><row r="1"><c r="A1"><f t="shared" si="0" ref="A1:A3">9</f><v>9</v></c></row>
      <row r="2">${middle}</row><row r="3"><c r="A3"><f t="shared" si="0"/><v>9</v></c></row></sheetData>`);
    const engine = createEngine({ limits: context.limits });
    try {
      let output = '';
      const result = await engine.convert({ input: { kind: 'stream', filename: 'input.xlsx', source: [bytes] }, recalc: true,
        exportType: 'Gnumeric_stf:stf_csv', destination: { kind: 'stream', sink: { async write(chunk) { output += new TextDecoder().decode(chunk); } } } },
      { signal: context.signal });
      expect(result.exitCode).toBe(0);
      expect(output).toBe(expected);
    } finally { await engine.dispose(); }
  });
}

it("does not allocate a shared declaration's missing million-row range", async () => {
  const bytes = await input('<sheetData><row r="1"><c r="A1"><f t="shared" si="0" ref="A1:A1048576">9</f><v>9</v></c></row></sheetData>');
  const engine = createEngine({ limits: context.limits });
  try {
    let output = '';
    const result = await engine.convert({ input: { kind: 'stream', filename: 'input.xlsx', source: [bytes] }, recalc: true,
      exportType: 'Gnumeric_stf:stf_csv', destination: { kind: 'stream', sink: { async write(chunk) { output += new TextDecoder().decode(chunk); } } } },
    { signal: context.signal });
    expect(result.exitCode).toBe(0);
    expect(output).toBe('9\n');
  } finally { await engine.dispose(); }
});

it("preserves earlier shared members when the same identifier is redefined", async () => {
  const bytes = await input(`<sheetData>
    <row r="1"><c r="A1"><f t="shared" si="0" ref="A1:A3">9</f><v>9</v></c></row>
    <row r="2"><c r="A2"><f t="shared" si="0"/><v>9</v></c></row>
    <row r="1"><c r="A1"><f t="shared" si="0" ref="A1:A3">7</f><v>7</v></c></row>
    <row r="3"><c r="A3"><f t="shared" si="0"/><v>7</v></c></row></sheetData>`);
  const engine = createEngine({ limits: context.limits });
  try {
    const book = await engine.readWorkbook({ kind: 'stream', filename: 'input.xlsx', source: [bytes] }, {}, { signal: context.signal });
    expect(book.sheets[0]!.cells.map(cell => cell.formula)).toEqual(['=7', '=9', '=7']);
  } finally { await engine.dispose(); }
});
it("ignores follower text when a shared definition is already available", async () => {
  const book = await readXlsx(await input(`<sheetData><row r="1"><c r="A1"><f t="shared" si="0" ref="A1:A2">9</f><v>9</v></c></row>
    <row r="2"><c r="A2"><f t="shared" si="0">7</f><v>7</v></c></row></sheetData>`), context);
  expect(book.sheets[0]!.cells[1]).toMatchObject({ formula: '=9', value: { kind: 'number', value: 7 } });
});
it("anchors relative shared references at the defining cell", async () => {
  const bytes = await input(`<sheetData>
    <row r="2"><c r="A2"><f t="shared" si="0" ref="A1:A3">B2+1</f><v>21</v></c><c r="B2"><v>20</v></c></row>
    <row r="1"><c r="A1"><f t="shared" si="0"/><v>11</v></c><c r="B1"><v>10</v></c></row>
    <row r="3"><c r="A3"><f t="shared" si="0"/><v>31</v></c><c r="B3"><v>30</v></c></row></sheetData>`);
  const engine = createEngine({ limits: context.limits });
  try {
    let output = '';
    const result = await engine.convert({ input: { kind: 'stream', filename: 'input.xlsx', source: [bytes] }, recalc: true,
      exportType: 'Gnumeric_stf:stf_csv', destination: { kind: 'stream', sink: { async write(chunk) { output += new TextDecoder().decode(chunk); } } } },
    { signal: context.signal });
    expect(result.exitCode).toBe(0);
    expect(output).toBe('11,10\n21,20\n31,30\n');
  } finally { await engine.dispose(); }
});

for (const ref of ['', ' ref="A1:A1"']) {
  it(`retains shared followers outside optional declaration bounds: ${ref || 'absent'}`, async () => {
    const bytes = await input(`<sheetData><row r="1"><c r="A1"><f t="shared" si="0"${ref}>9</f><v>9</v></c></row>
      <row r="3"><c r="A3"><f t="shared" si="0"/><v>9</v></c></row></sheetData>`);
    const engine = createEngine({ limits: context.limits });
    try {
      const book = await engine.readWorkbook({ kind: 'stream', filename: 'input.xlsx', source: [bytes] }, {}, { signal: context.signal });
      expect(book.sheets[0]!.cells.map(cell => cell.formula)).toEqual(['=9', '=9']);
    } finally { await engine.dispose(); }
  });
}
