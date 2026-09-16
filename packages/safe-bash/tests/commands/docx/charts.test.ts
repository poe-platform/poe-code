import assert from "node:assert/strict";
import test from "node:test";
import { paragraph, textFixture, textContext } from "../../../../docx/tests/fixtures/text.js";
import { readArchive, writeArchive } from "../../../../docx/src/index.js";
import { createDocxInspectionCommandEngine } from "../../../../docx/src/inspection-command.js";
import { docxCommands } from "../../../src/commands/docx/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { agentCommands } from "../../../src/plugins/index.js";
import { Shell } from "../../../src/shell/index.js";

test("physical chart inventory retains unreferenced definitions and raw cached numeric spellings", async () => {
  const original = await textFixture(paragraph("Original chart area")), archive = await readArchive(original, textContext), encoder = new TextEncoder();
  const types = archive.members.find(member => member.name === "[Content_Types].xml")!;
  const members = archive.members.map(member => member === types ? { ...member, bytes: encoder.encode(new TextDecoder().decode(types.bytes).replace("</Types>", '<Override PartName="/word/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>')) } : member);
  const chart = '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:barChart><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>Original series</c:v></c:tx><c:val><c:numRef><c:f>Data!B2</c:f><c:numCache><c:ptCount val="1"/><c:pt idx="0"><c:v>12.50</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>';
  const volume = new MemoryFileSystem(); await volume.mkdir("/work"); await volume.writeFile("/work/input.docx", new Uint8Array());
  await writeArchive({ ...archive, members: [...members, { name: "word/charts/chart1.xml", bytes: encoder.encode(chart), directory: false, modified: new Date("2025-01-02T03:04:06Z") }] }, { async write(bytes) { await volume.appendFile("/work/input.docx", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = await volume.readFile("/work/input.docx");
  const shell = new Shell({ fs: volume, cwd: "/work" }).use(agentCommands()).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
  try {
    const result = await shell.exec("docx charts list input.docx --json"); assert.equal(result.exitCode, 0, result.stderr);
    const data = JSON.parse(result.stdout); assert.equal(data.affected, 0); assert.equal(data.data.items.length, 1); assert.equal(data.data.items[0].location.kind, "part");
    assert.equal(data.data.items[0].details.chartType, "barChart"); assert.deepEqual(data.data.items[0].details.series[0].cachedValues, ["12.50"]);
    assert.deepEqual(await volume.readFile("/work/input.docx"), input);
  } finally { await shell.dispose(); }
});
