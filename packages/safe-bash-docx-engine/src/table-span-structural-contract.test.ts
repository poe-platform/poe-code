import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Document, createDocxInspectionCommandEngine, editDocumentTables, readArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const enc = (s: string) => new TextEncoder().encode(s);
const scenarios = [
  ...[1, 2, 3, 4].map(index => ({ operation: "tables.columns.add" as const, index })),
  ...[1, 2, 3].map(index => ({ operation: "tables.columns.remove" as const, index })),
  ...[1, 2, 3].map(index => ({ operation: "tables.rows.add" as const, index }))
];
for (const strict of [false, true]) for (const route of ["sdk", "cli"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"] as const)
it.each(scenarios)(`F19-F20 span structural ${route} strict=${strict} ${carrier} $operation at $index`, async ({ operation, index }) => {
  const wrap = (s: string) => carrier === "direct" ? s : carrier === "process" ? `<f:pass>${s}</f:pass>` :
    `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? s : '<f:retained stamp="inactive"/>'}</mc:Choice><mc:Fallback>${carrier === "fallback" ? s : '<f:retained stamp="inactive"/>'}</mc:Fallback></mc:AlternateContent>`;
  const cell = (text: string, merged: boolean, row: number) => `<w:tc><w:tcPr><w:tcW w:w="${merged ? 1400 : 900}" w:type="dxa"/>${merged ? `<w:gridSpan w:val="2"/><w:vMerge w:val="${row ? "continue" : "restart"}"/>` : ""}<w:shd w:fill="F0F0F0"/></w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
  const rows = [0, 1].map(r => `<w:tr><w:trPr>${r ? "" : '<w:tblHeader/>'}<w:cantSplit/></w:trPr>${wrap(cell(r ? "" : "Harbor é 海", true, r))}${wrap(cell(r ? "South" : "North", false, r))}</w:tr>`);
  const grid = '<w:tblGrid><w:gridCol w:w="600"/><w:gridCol w:w="800"/><w:gridCol w:w="900"/></w:tblGrid>';
  const input = await textFixture(`<w:tbl xmlns:mc="${mc}" xmlns:f="urn:original:future" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:tblPr><!--retain--><?original span?><w:tblW w:w="2300" w:type="dxa"/></w:tblPr>${wrap(grid)}${rows.map(wrap).join("")}</w:tbl>`, {}, strict);
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" });
  const stdout = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
  if (route === "sdk") {
    const result = await editDocumentTables(input, { operation, options: { table: 1, index, ...(operation === "tables.columns.add" ? { width: { value: 250, unit: "pt" as const } } : {}), output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout });
    expect(result.changes).toHaveLength(1);
  } else {
    const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
      args: [...operation.split("."), "/input", "--table", "1", "--index", String(index), ...(operation === "tables.columns.add" ? ["--width", "250pt"] : []), "--output", "-"].map(enc),
      cwd: "/", signal: textContext.signal, filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
      stdin: { async *[Symbol.asyncIterator]() {} }, stdout, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
    });
    expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
  }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), table = (await Document(output, textContext)).tables[0]!;
  const rowAdd = operation === "tables.rows.add", colAdd = operation === "tables.columns.add";
  expect(table.rows.length).toBe(rowAdd ? 3 : 2); expect(table.columns.length).toBe(rowAdd ? 3 : colAdd ? 4 : 2);
  const ownerRow = rowAdd && index === 1 ? 1 : 0, ownerColumn = colAdd && index === 1 ? 1 : 0;
  const owner = table.cell(ownerRow, ownerColumn), span = rowAdd ? 2 : colAdd ? index === 2 ? 3 : 2 : index < 3 ? 1 : 2;
  expect(owner.text).toBe("Harbor é 海"); expect(owner.grid_span).toBe(span);
  expect(owner.width?.twips).toBe(rowAdd ? 1400 : colAdd ? index === 2 ? 6400 : 1400 : index === 1 ? 800 : index === 2 ? 600 : 1400);
  const ownerRows = rowAdd && index === 2 ? [0, 1, 2] : [ownerRow, ownerRow + 1];
  for (const r of ownerRows) for (let c = ownerColumn; c < ownerColumn + span; c++) expect(table.cell(r, c)).toBe(owner);
  if (rowAdd) for (let c = 0; c < 3; c++) if (!(index === 2 && c < 2)) { expect(table.cell(index - 1, c).text).toBe(""); expect(table.cell(index - 1, c).paragraphs).toHaveLength(1); }
  if (colAdd && index !== 2) for (const r of [0, 1]) { expect(table.cell(r, index - 1).text).toBe(""); expect(table.cell(r, index - 1).width?.twips).toBe(5000); }
  const before = await readArchive(input, textContext), after = await readArchive(output, textContext);
  for (const member of before.members) if (member.name !== "word/document.xml") expect(after.members.find(m => m.name === member.name)!.bytes).toEqual(member.bytes);
  const original = new TextDecoder().decode(before.members.find(m => m.name === "word/document.xml")!.bytes), saved = new TextDecoder().decode(after.members.find(m => m.name === "word/document.xml")!.bytes);
  expect(saved).toContain('<!--retain--><?original span?>');
  if (carrier === "choice" || carrier === "fallback") expect(saved.split('<f:retained stamp="inactive"/>').length).toBe(original.split('<f:retained stamp="inactive"/>').length);
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
