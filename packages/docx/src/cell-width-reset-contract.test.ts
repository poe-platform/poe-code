import { expect, expectTypeOf, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, applyStyleModelBatch, assertDocxFields, createDocxInspectionCommandEngine, docxOperationSchemas, type DocxOperationArguments, type DocxBatchArgumentMap, type DocxLength } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const operation = "model.table._Cell.width.set";
it("declares the live cell width reset in both typed transport argument maps", () => {
  expectTypeOf<DocxOperationArguments<typeof operation>["value"]>().toEqualTypeOf<DocxLength | null>();
  expectTypeOf<DocxBatchArgumentMap[typeof operation]["value"]>().toEqualTypeOf<DocxLength | null>();
  for (const fields of [docxOperationSchemas[operation].fields, docxOperationSchemas[operation].sdkFields, docxOperationSchemas[operation].batchFields]) {
    expect(() => assertDocxFields(fields!, {value: null})).not.toThrow();
    expect(() => assertDocxFields(fields!, {value: {value: 720, unit: "twip"}})).not.toThrow();
    expect(() => assertDocxFields(fields!, {value: "720"})).toThrow();
  }
});
for (const strict of [false, true]) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} clears native cell width and retains its span and other members; strict=${strict}`, async () => {
  const property = '<w:tcW w:type="dxa" w:w="1440"/>';
  const input = await textFixture('<w:tbl><w:tblGrid><w:gridCol w:w="720"/><w:gridCol w:w="720"/></w:tblGrid><w:tr><w:tc><w:tcPr>' + property + '<w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Original</w:t></w:r></w:p></w:tc></w:tr></w:tbl>', {}, strict);
  const volume = Volume.fromJSON({"/input": Buffer.from(input), "/out": ""}), sink = {async write(bytes: Uint8Array) {volume.appendFileSync("/out", bytes);}};
  const batch = {version: 1, operations: [
    {operation: "model.document.Document.tables.get", receiver: {resultHandle: "document"}, arguments: {}, resultHandle: "tables"},
    {operation: "model.table.Table.cell.call", receiver: {resultHandle: "tables", index: 0}, arguments: {rowIdx: 0, colIdx: 0}, resultHandle: "cell"},
    {operation, receiver: {resultHandle: "cell"}, arguments: {value: null}}
  ]};
  if (route === "model") {const doc = await Document(input, textContext); doc.tables[0]!.cell(0, 0).width = null; await doc.save(sink);}
  else if (route === "sdk") await (await applyStyleModelBatch(input, batch, textContext)).save(sink);
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", new TextEncoder().encode(JSON.stringify(batch)));
    const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})})).exec("docx batch /input --ops-file /ops --output - > /out");
    expect(result.exitCode, result.stdout + result.stderr).toBe(0); volume.writeFileSync("/out", await fs.readFile("/out")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), expected = readPackage(input), saved = readPackage(output);
  expected.set("word/document.xml", new TextEncoder().encode(new TextDecoder().decode(expected.get("word/document.xml")).replace(property, "")));
  expect(saved).toEqual(expected); const cell = (await Document(output, textContext)).tables[0]!.cell(0, 0); expect(cell.width).toBeNull(); expect(cell.grid_span).toBe(2); expect(cell.text).toBe("Original");
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
