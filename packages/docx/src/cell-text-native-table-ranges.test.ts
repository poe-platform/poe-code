import { Volume } from "memfs";
import { expect, it } from "vitest";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const variant of ["nested-markers", "table-markers", "table-annotations", "field-range", "inactive-field"] as const)
for (const route of ["model", "direct"] as const)
it.concurrent(`cell native table scope retains annotation boundaries and refuses surrounding fields; strict=${strict}; kind=${kind}; ${variant}; ${route}`, async () => {
  const markers = '<w:bookmarkStart w:id="71" w:name="NestedAnchor"/><w:bookmarkEnd w:id="71"/>';
  const annotations = '<!--native-table-retain--><?native retain?>';
  const nested = `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1440"/></w:tblGrid>${variant === "table-markers" ? markers : variant === "table-annotations" ? annotations : ""}<w:tr><w:tc><w:tcPr/><w:p>${variant === "nested-markers" ? markers : ""}<w:r><w:t>Nested 日本 עברית 🌊</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
  const table = `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="1440"/></w:tblGrid><w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>First</w:t></w:r></w:p>${nested}<w:p/></w:tc></w:tr></w:tbl>`;
  const original = await textFixture(variant === "field-range" ? `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> IF 1 = 1 </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r></w:p>${table}<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>` : variant === "inactive-field" ? `<w:p xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:AlternateContent><mc:Choice Requires="w"><w:r><w:t>Active</w:t></w:r></mc:Choice><mc:Fallback><w:r><w:fldChar w:fldCharType="begin"/></w:r></mc:Fallback></mc:AlternateContent></w:p>${table}` : table, {}, strict);
  const parts = readPackage(original), memory = Volume.fromJSON({ "/input": "", "/out": "" });
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const sink = (name: string) => ({ async write(bytes: Uint8Array) { memory.appendFileSync(name, bytes); } });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, sink("/input"), { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), value = "Replaced é 日本 עברית 🌊";
  if (route === "model") {
    const doc = await api.Document(input, textContext), before = doc.part.blob;
    const assign = () => { doc.tables[0]!.cell(0, 0).text = value; };
    if (variant === "field-range") { expect(assign).toThrowError(expect.objectContaining({ code: "unsupported-edit" })); expect(doc.part.blob).toEqual(before); return; }
    assign(); await doc.save(sink("/out"));
  } else {
    const edit = api.editDocumentTables(input, { operation: "tables.set", options: { table: 1, cell: "A1", text: value, output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink("/out") });
    if (variant === "field-range") { await expect(edit).rejects.toMatchObject({ code: "unsupported-edit" }); expect(memory.readFileSync("/out").length).toBe(0); return; }
    await edit;
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), saved = readPackage(output), xml = new TextDecoder().decode(saved.get("word/document.xml"));
  for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(saved.get(name), name).toEqual(bytes);
  if (variant === "table-annotations") expect(xml).toContain(annotations); else if (variant !== "inactive-field") { expect(xml).toContain('w:id="71"'); expect(xml).toContain('w:name="NestedAnchor"'); }
  const doc = await api.Document(output, textContext), cell = doc.tables[0]!.cell(0, 0);
  expect(cell.text).toBe(value); expect(cell.tables.length).toBe(0); expect(cell.paragraphs.length).toBe(1); expect(cell.paragraphs[0]!.runs.length).toBe(1);
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
