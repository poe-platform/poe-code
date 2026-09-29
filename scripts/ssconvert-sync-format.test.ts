import { expect, it } from "vitest";
import { createStoredZipArchive } from "safe-bash-command-soffice";
import { createSsconvertCommand, evalSyncSsconvert, ssconvertCommands } from "../packages/safe-bash/src/commands/ssconvert/index.js";
import { createEngine } from "@poe-code/spreadsheet-engine";
import { xlsxFormat } from "@poe-code/spreadsheet-format-xlsx";
import { csvFormat } from "@poe-code/spreadsheet-format-csv";
import { build } from "esbuild";
import { Shell } from "../packages/safe-bash/src/shell/index.js";
import { MemoryFileSystem } from "../packages/safe-bash/src/fs/memory/index.js";
import { standardCommands } from "../packages/safe-bash/src/commands/index.js";

const encode = (text: string) => new TextEncoder().encode(text);
const namespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
function workbook(cell: string, prefix = "") {
  const q = prefix ? `${prefix}:` : "";
  return createStoredZipArchive({
    "[Content_Types].xml": encode('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'),
    "_rels/.rels": encode('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    "xl/workbook.xml": encode(`<workbook xmlns="${namespace}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="s"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": encode('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="s" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    "xl/worksheets/sheet1.xml": encode(`<${q}worksheet xmlns${prefix ? `:${prefix}` : ""}="${namespace}"><${q}sheetData><${q}row r="1">${cell}</${q}row></${q}sheetData></${q}worksheet>`),
  });
}

it.each([
  ["escaped literal", '<c r="A1" t="inlineStr"><is><t>_x005F_x0000_</t></is></c>', "_x0000_\n", ""],
  ["rich text", '<c r="A1" t="inlineStr"><is><r><t>alpha</t></r><r><t>beta</t></r></is></c>', "alphabeta\n", ""],
  ["boolean", '<c r="A1" t="b"><v>1</v></c>', "TRUE\n", ""],
  ["namespace prefix", '<s:c r="A1" t="inlineStr"><s:is><s:t>hello</s:t></s:is></s:c>', "hello\n", "s"],
  ["single-quoted attributes", "<c r='A1' t='inlineStr'><is><t>hello</t></is></c>", "hello\n", ""],
  ["CSV whitespace", '<c r="A1" t="inlineStr"><is><t>alpha beta</t></is></c>', '"alpha beta"\n', ""],
  ["numeric representation", '<c r="A1"><v>1.00</v></c>', "1\n", ""],
])("keeps %s identical in synchronous and canonical XLSX conversion", async (_name, cell, expected, prefix) => {
  const bytes = workbook(cell!, prefix);
  const engine = createEngine({ formats: [xlsxFormat, csvFormat] });
  const output: Uint8Array[] = [];
  const operation = { signal: new AbortController().signal };
  try {
    const book = await engine.readWorkbook({ kind: "stream", filename: "book.xlsx", source: [bytes] }, {}, operation);
    await engine.writeWorkbook(book, { kind: "stream", sink: { async write(chunk) { output.push(chunk); } } },
      { exportType: "Gnumeric_stf:stf_csv" }, operation);
    expect(Buffer.concat(output).toString()).toBe(expected);
    const command = createSsconvertCommand();
    expect(evalSyncSsconvert(command.execute, ["-T", "Gnumeric_stf:stf_csv", "/book.xlsx", "fd://1"], undefined, () => bytes)).toBe(expected);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/book.xlsx", bytes);
    const shell = new Shell({ fs }).use(standardCommands()).use(ssconvertCommands());
    try {
      const result = await shell.exec('value=$(ssconvert -T Gnumeric_stf:stf_csv /book.xlsx fd://1); echo "$value"');
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toBe(expected);
    } finally { await shell.dispose(); }
  } finally { await engine.dispose(); }
});

it("falls back before publishing destinations for formatted or formula cells", () => {
  for (const cell of ['<c r="A1" s="1"><v>0.5</v></c>', '<c r="A1"><f>1+1</f><v>2</v></c>']) {
    const writes: Uint8Array[] = [];
    const result = evalSyncSsconvert(createSsconvertCommand().execute, ["/book.xlsx", "/keep.csv"], undefined,
      () => workbook(cell), (_path, bytes) => { writes.push(bytes); return true; });
    expect(result).toBeUndefined();
    expect(writes).toEqual([]);
  }
});

it("bundles synchronous format owners without shell commands, competing formats or rendering", async () => {
  const bundle = await build({
    stdin: { contents: 'export { parseSimpleXlsxTable, buildSimpleXlsx } from "@poe-code/spreadsheet-format-xlsx/sync-table"; export { formatSimpleCsv } from "@poe-code/spreadsheet-format-csv/sync-table";', resolveDir: process.cwd() },
    platform: "browser", format: "esm", bundle: true, write: false, metafile: true, logLevel: "silent",
  });
  const inputs = Object.values(bundle.metafile!.outputs).flatMap(output => Object.entries(output.inputs)
    .filter(([, input]) => input.bytesInOutput > 0).map(([name]) => name));
  expect(inputs.some(name => name.includes("xlsx-ast/") && name.includes("sync-table"))).toBe(true);
  expect(inputs.some(name => name.includes("spreadsheet-format-csv/") && name.includes("sync-table"))).toBe(true);
  expect(inputs.filter(name => ["safe-bash-command-", "spreadsheet-format-ods/", "spreadsheet-format-xls/", "pdf-ast/", "pdf-lib/", "fontkit/"]
    .some(unwanted => name.includes(unwanted)))).toEqual([]);
});

it.each([
  ['<c r="A1" t="b"><v>1</v></c>', { kind: "boolean", value: true }],
  ['<c r="A1" t="inlineStr"><is><t>007</t></is></c>', { kind: "string", value: "007" }],
  ['<c r="A1" t="inlineStr"><is><t>_x005F_x0000_</t></is></c>', { kind: "string", value: "_x0000_" }],
])("preserves typed XLSX cells across the synchronous writer", async (cell, expected) => {
  const input = workbook(cell);
  let output: Uint8Array | undefined;
  expect(evalSyncSsconvert(createSsconvertCommand().execute, ["/book.xlsx", "/out.xlsx"], undefined,
    () => input, (_path, bytes) => { output = bytes; return true; })).toBe("");
  expect(output).toBeDefined();
  const engine = createEngine({ formats: [xlsxFormat] });
  try {
    const book = await engine.readWorkbook({ kind: "stream", filename: "out.xlsx", source: [output!] }, {},
      { signal: new AbortController().signal });
    expect(book.sheets[0]!.name).toBe("Data");
    expect(book.sheets[0]!.cells[0]!.value).toMatchObject(expected);
  } finally { await engine.dispose(); }
});
