import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Document, createDocxInspectionCommandEngine, editDocumentTables, readArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import type { TableEditRequest } from "./table-edit.js";

const enc = (s: string) => new TextEncoder().encode(s);
for (const strict of [false, true]) for (const route of ["sdk", "cli"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"] as const)
it.each(["tables.merge", "tables.split", "tables.rows.remove"] as const)(`F20 native ${carrier} ${route} strict=${strict} %s`, async operation => {
  const wrap = (s: string) => carrier === "direct" ? s : carrier === "process" ? `<f:pass>${s}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? s : '<f:keep stamp="unselected"/>'}</mc:Choice><mc:Fallback>${carrier === "fallback" ? s : '<f:keep stamp="unselected"/>'}</mc:Fallback></mc:AlternateContent>`;
  const cell = (s: string, row: number, merged: boolean) => `<w:tc><w:tcPr><w:tcW w:w="${merged ? 1400 : 900}" w:type="dxa"/>${merged ? `<w:gridSpan w:val="2"/><w:vMerge w:val="${row ? "continue" : "restart"}"/>` : ""}<w:shd w:fill="F0F0F0"/></w:tcPr>${s ? `<w:p><w:r><w:t>${s}</w:t></w:r></w:p>` : '<w:p/>'}</w:tc>`;
  const grid = '<w:tblGrid><w:gridCol w:w="600"/><w:gridCol w:w="800"/><w:gridCol w:w="900"/></w:tblGrid>';
  const input = await textFixture(`<w:tbl xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:native" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:tblPr><!--retain--><?original merge?></w:tblPr>${wrap(grid)}${[0, 1].map(r => wrap(`<w:tr>${wrap(cell(r ? "" : "Harbor", r, true))}${wrap(cell(r ? "South" : "North", r, false))}</w:tr>`)).join("")}</w:tbl>`, {}, strict);
  const options = operation === "tables.merge" ? { from: "A1", to: "C2", join: "paragraphs" as const } : operation === "tables.split" ? { cell: "B2", rows: 2, cols: 2, distribute: "anchor" as const } : { index: 1, join: "paragraphs" as const };
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" }), stdout = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
  // Removing this active row would also erase its nested unselected cell
  // branches. F05/F04 require retention; affected opaque deletion must reject.
  const reject = operation === "tables.rows.remove" && (carrier === "choice" || carrier === "fallback");
  if (route === "sdk") {
    const result = editDocumentTables(input, { operation, options: { table: 1, ...options, output: "-" } } as TableEditRequest, { ...textContext, encoding: { order: "input", compression: "store" }, stdout });
    if (reject) await expect(result).rejects.toMatchObject({ code: "unsupported-edit" });
    else await result;
  }
  else {
    const args = Object.entries(options).flatMap(([key, value]) => ["--" + key, String(value)]);
    const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: [...operation.split("."), "/input", "--table", "1", ...args, "--output", "-"].map(enc), cwd: "/", signal: textContext.signal, filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } } });
    expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(reject ? 1 : 0);
    if (reject) expect(volume.readFileSync("/err", "utf8")).toContain("unsupported-edit");
  }
  if (reject) { expect(volume.readFileSync("/out")).toHaveLength(0); expect(volume.readFileSync("/input")).toEqual(Buffer.from(input)); return; }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), table = (await Document(output, textContext)).tables[0]!;
  expect(table.rows.length).toBe(operation === "tables.rows.remove" ? 1 : 2); expect(table.columns.length).toBe(3);
  if (operation === "tables.merge") { expect(table.cell(0, 0).text).toBe("Harbor\nNorth\nSouth"); for (const r of [0, 1]) for (const c of [0, 1, 2]) expect(table.cell(r, c)).toBe(table.cell(0, 0)); }
  else if (operation === "tables.split") { expect(table.cell(0, 0).text).toBe("Harbor"); for (const [r, c] of [[0, 1], [1, 0], [1, 1]]) { expect(table.cell(r!, c!).text).toBe(""); expect(table.cell(r!, c!)).not.toBe(table.cell(0, 0)); } expect(table.cell(0, 2).text).toBe("North"); expect(table.cell(1, 2).text).toBe("South"); }
  else { expect(table.cell(0, 0).text).toBe("Harbor"); expect(table.cell(0, 1)).toBe(table.cell(0, 0)); expect(table.cell(0, 2).text).toBe("South"); }
  const before = await readArchive(input, textContext), after = await readArchive(output, textContext);
  for (const member of before.members) if (member.name !== "word/document.xml") expect(after.members.find(m => m.name === member.name)!.bytes).toEqual(member.bytes);
  const oldXml = new TextDecoder().decode(before.members.find(m => m.name === "word/document.xml")!.bytes), newXml = new TextDecoder().decode(after.members.find(m => m.name === "word/document.xml")!.bytes);
  expect(newXml).toContain('<!--retain--><?original merge?>');
  if (carrier === "choice" || carrier === "fallback") expect(newXml.split('<f:keep stamp="unselected"/>').length).toBe(oldXml.split('<f:keep stamp="unselected"/>').length);
});
