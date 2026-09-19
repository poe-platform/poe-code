import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";
import { drawingShapeSourceCases, drawingShapeSourceXml } from "../tests/fixtures/drawing-shape-exact-source.js";
import { readPackage } from "../tests/assertions.js";
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) }), enc = (s: string) => new TextEncoder().encode(s);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const row of [843, 844, 848, 981]) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} missing embedded drawing image is a semantic selection refusal; R${row}; ${kind}; strict=${strict}`, async () => {
  const c = drawingShapeSourceCases.find(c => c.row === row)!, f = drawingShapeSourceXml(c, strict), parts = readPackage(await textFixture(f.paragraph, {}, strict));
  if (f.linked) { const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships"; parts.set("word/_rels/document.xml.rels", enc(new TextDecoder().decode(parts.get("word/_rels/document.xml.rels")).replace("</Relationships>", `<Relationship Id="rId2" Type="${r}/image" Target="https://inert.example.invalid/image.png" TargetMode="External"/></Relationships>`))); }
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  const v = Volume.fromJSON({ "/input": "", "/out": "retained destination" }); await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { v.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(v.readFileSync("/input") as Buffer), operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "ps" },
    { operation: "model.text.paragraph.Paragraph.runs.get", receiver: ref("ps", 0), arguments: {}, resultHandle: "runs" },
    { operation: "model.text.run.Run.iter_inner_content.call", receiver: ref("runs", 0), arguments: {}, resultHandle: "content" },
    { operation: "model.drawing.Drawing.image.get", receiver: ref("content", 0), arguments: {} }
  ];
  if (route === "model") { const doc = await api.Document(input, textContext), d = [...doc.paragraphs[0]!.runs[0]!.iter_inner_content()][0] as api.Drawing; expect(d.has_picture).toBe(false); expect(() => d.image).toThrowError(expect.objectContaining({ code: "missing-selection" })); }
  else if (route === "sdk") await expect(api.applyStyleModelBatch(input, { version: 1, operations }, textContext)).rejects.toMatchObject({ code: "missing-selection", operationIndex: 3 });
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/out", enc("retained destination")); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations }))); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try { const r = await shell.exec("docx batch /input --ops-file /ops --json"); expect(r.exitCode, r.stdout + r.stderr).toBe(1); const e = JSON.parse(r.stdout); expect(e).toMatchObject({ ok: false, affected: 0, data: null }); expect(e.errors[0]).toMatchObject({ code: "missing-selection", operationIndex: 3 }); expect(await fs.readFile("/out")).toEqual(enc("retained destination")); expect(await fs.readFile("/input")).toEqual(input); } finally { await shell.dispose(); } }
  expect(v.readFileSync("/out")).toEqual(Buffer.from("retained destination")); expect(v.readFileSync("/input")).toEqual(Buffer.from(input));
});
