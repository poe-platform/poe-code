import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Document, createDocxInspectionCommandEngine, executeDocumentBatch, readArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
for (const strict of [false, true]) for (const route of ["model", "sdk", "cli"] as const)
it.each(["direct", "choice", "fallback", "process"] as const)(`F20 native model merge ${route} strict=${strict} %s`, async carrier => {
  const wrap = (s: string) => carrier === "direct" ? s : carrier === "process" ? `<f:pass>${s}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? s : '<f:keep stamp="inactive"/>'}</mc:Choice><mc:Fallback>${carrier === "fallback" ? s : '<f:keep stamp="inactive"/>'}</mc:Fallback></mc:AlternateContent>`;
  const cell = (s: string) => `<w:tc><w:tcPr><w:tcW w:w="900" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${s}</w:t></w:r></w:p></w:tc>`;
  const input = await textFixture(`<w:tbl xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:model" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:tblPr><!--retain--></w:tblPr>${wrap('<w:tblGrid><w:gridCol w:w="900"/><w:gridCol w:w="900"/></w:tblGrid>')}${[0, 1].map(r => wrap(`<w:tr>${wrap(cell(r ? "South" : "North"))}${wrap(cell(r ? "West" : "East"))}</w:tr>`)).join("")}</w:tbl>`, {}, strict);
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" }), stdout = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
  const batch = { version: 1, operations: [
    { operation: "model.document.Document.tables.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "tables" },
    { operation: "model.table.Table.cell.call", receiver: { resultHandle: "tables", index: 0 }, arguments: { rowIdx: 0, colIdx: 0 }, resultHandle: "first" },
    { operation: "model.table.Table.cell.call", receiver: { resultHandle: "tables", index: 0 }, arguments: { rowIdx: 1, colIdx: 1 }, resultHandle: "last" },
    { operation: "model.table._Cell.merge.call", receiver: { resultHandle: "first" }, arguments: { otherCell: { resultHandle: "last" } }, resultHandle: "merged" }
  ] };
  if (route === "model") { const doc = await Document(input, textContext), table = doc.tables[0]!; expect(table.cell(0, 0).merge(table.cell(1, 1)).text).toBe("North\nEast\nSouth\nWest"); await doc.save(stdout); }
  else if (route === "sdk") await executeDocumentBatch(input, batch, { output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout });
  else { const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["batch", "/input", "--ops-json", JSON.stringify(batch), "--output", "-"].map(s => new TextEncoder().encode(s)), cwd: "/", signal: textContext.signal, filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } } }); expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0); }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), table = (await Document(output, textContext)).tables[0]!, owner = table.cell(0, 0);
  expect(owner.text).toBe("North\nEast\nSouth\nWest"); expect(owner.width?.twips).toBe(1800);
  for (const r of [0, 1]) for (const c of [0, 1]) expect(table.cell(r, c)).toBe(owner);
  const before = await readArchive(input, textContext), after = await readArchive(output, textContext);
  for (const m of before.members) if (m.name !== "word/document.xml") expect(after.members.find(n => n.name === m.name)!.bytes).toEqual(m.bytes);
  const saved = new TextDecoder().decode(after.members.find(m => m.name === "word/document.xml")!.bytes), original = new TextDecoder().decode(before.members.find(m => m.name === "word/document.xml")!.bytes);
  expect(saved).toContain('<!--retain-->'); if (carrier === "choice" || carrier === "fallback") expect(saved.split('<f:keep stamp="inactive"/>').length).toBe(original.split('<f:keep stamp="inactive"/>').length);
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
