import assert from "node:assert/strict";
import { it } from "node:test";
import { createEngine } from "@poe-code/spreadsheet-engine";
import { xlsxFormat } from "@poe-code/spreadsheet-format-xlsx";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSofficeCommand, createStoredZipArchive, runSofficeCli, runSofficeCliSync } from "./index.js";

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

function odsFixture(): Uint8Array {
  return createStoredZipArchive({
    mimetype: encode("application/vnd.oasis.opendocument.spreadsheet"),
    "META-INF/manifest.xml": encode('<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>'),
    "content.xml": encode(`<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2"><office:body><office:spreadsheet>
      <table:table table:name="Data"><table:table-row>
        <table:table-cell office:value-type="string"><text:p>Name</text:p></table:table-cell>
        <table:table-cell office:value-type="string"><text:p>Amount</text:p></table:table-cell>
        <table:table-cell office:value-type="string"><text:p>Enabled</text:p></table:table-cell>
      </table:table-row><table:table-row>
        <table:table-cell office:value-type="string"><text:p>Łódź, "office"<text:line-break/>second</text:p></table:table-cell>
        <table:table-cell office:value-type="float" office:value="42.5"><text:p>42.5</text:p></table:table-cell>
        <table:table-cell office:value-type="boolean" office:boolean-value="true"><text:p>TRUE</text:p></table:table-cell>
      </table:table-row></table:table>
      <table:table table:name="Extras"><table:table-row><table:table-cell table:number-columns-repeated="27"/><table:table-cell office:value-type="string"><text:p>Column AB</text:p></table:table-cell></table:table-row></table:table>
    </office:spreadsheet></office:body></office:document-content>`)
  });
}

it("exports ODS as actual CSV with embedded line breaks, quoting and typed values", async () => {
  const source = odsFixture();
  const files = new Map([["/source.ods", source]]);
  const result = await runSofficeCli(["--convert-to", "csv", "--outdir", "/out", "/source.ods"], files);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(decode(files.get("/out/source.csv")!), 'Name,Amount,Enabled\n"Łódź, ""office""\nsecond",42.5,TRUE\n');
  assert.equal(files.get("/source.ods"), source);
});

it("applies StarCalc CSV separator and quote-all options to ODS", async () => {
  const files = new Map([["/source.ods", odsFixture()]]);
  const result = await runSofficeCli(["--convert-to", "csv:Text - txt - csv (StarCalc):59,34,0,1,,0,true", "/source.ods"], files);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(decode(files.get("/source.csv")!), '"Name";"Amount";"Enabled"\n"Łódź, ""office""\nsecond";"42.5";"TRUE"\n');
});

it("exports ODS as a readable XLSX workbook preserving types, sheets and column positions", async () => {
  const files = new Map([["/source.ods", odsFixture()]]);
  const result = await runSofficeCli(["--convert-to", "xlsx", "/source.ods"], files);
  assert.equal(result.exitCode, 0, result.stderr);
  const output = files.get("/source.xlsx")!;
  assert.deepEqual([...output.slice(0, 4)], [0x50, 0x4b, 3, 4]);
  const engine = createEngine({ formats: [xlsxFormat] });
  try {
    const book = await engine.readWorkbook({ kind: "stream", filename: "source.xlsx", source: [output] }, {}, { signal: new AbortController().signal });
    assert.deepEqual(book.sheets.map(sheet => sheet.name), ["Data", "Extras"]);
    assert.deepEqual(book.sheets[0]!.cells.filter(cell => cell.row === 1).map(cell => ({ ...cell.value })), [
      { kind: "string", value: 'Łódź, "office"\nsecond' }, { kind: "number", value: 42.5 }, { kind: "boolean", value: true }
    ]);
    assert.deepEqual(book.sheets[1]!.cells.filter(cell => cell.value.kind !== "blank").map(cell => [cell.column, { ...cell.value }]), [[27, { kind: "string", value: "Column AB" }]]);
  } finally { await engine.dispose(); }
});

it("uses the same ODS conversion in the shell command", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/source.ods", odsFixture());
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await createSofficeCommand().execute({
    command: "soffice", cwd: "/", env: {}, fs,
    ...createCommandArguments(["--headless", "--convert-to", "csv", "/source.ods"]),
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr.push(bytes.slice()); } }
  });
  assert.equal(result.exitCode, 0, stderr.map(decode).join(""));
  assert.equal(decode(await fs.readFile("/source.csv")), 'Name,Amount,Enabled\n"Łódź, ""office""\nsecond",42.5,TRUE\n');
  assert.ok(stdout.map(decode).join("").includes("using filter : Text - txt - csv (StarCalc)"));
});

it("preserves an existing destination when ODS conversion fails", async () => {
  const saved = encode("existing workbook");
  const files = new Map([["/broken.ods", createStoredZipArchive({ "content.xml": encode("<broken>") })], ["/broken.xlsx", saved]]);
  const result = await runSofficeCli(["--convert-to", "xlsx", "/broken.ods"], files);
  assert.notEqual(result.exitCode, 0);
  assert.equal(files.get("/broken.xlsx"), saved);
});

it("does not claim a synchronous ODS export succeeded with plain text in an XLSX file", () => {
  const saved = encode("existing workbook");
  const files = new Map([["/source.ods", odsFixture()], ["/source.xlsx", saved]]);
  const result = runSofficeCliSync(["--convert-to", "xlsx", "/source.ods"], files);
  assert.notEqual(result.exitCode, 0);
  assert.equal(files.get("/source.xlsx"), saved);
});

for (const timing of ["before", "during"] as const)
it(`honors cancellation ${timing} an async ODS conversion without publishing`, async () => {
  const saved = encode("existing workbook");
  const files = new Map([["/source.ods", odsFixture()], ["/source.xlsx", saved]]);
  const controller = new AbortController();
  const reason = new Error("conversion cancelled");
  if (timing === "before") controller.abort(reason);
  const conversion = runSofficeCli(["--convert-to", "xlsx", "/source.ods"], files, "/", { signal: controller.signal });
  if (timing === "during") controller.abort(reason);
  await assert.rejects(conversion, error => error === reason);
  assert.equal(files.get("/source.xlsx"), saved);
});
