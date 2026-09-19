import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
for (const strict of [false, true]) for (const route of ["model", "sdk", "shell"] as const)
for (const text of ["", "foo", "fo ", " é 日本 עברית 🌊", "f o"])
it(`${route} exposes the returned add_text owner as a bounded XML view; text=${JSON.stringify(text)}; strict=${strict}`, async () => {
  const input = await textFixture('<w:p><w:pPr><w:keepNext/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Before</w:t><!--retain--></w:r></w:p>', {}, strict), memory = Volume.fromJSON({ "/out": "" });
  const operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.runs.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "runs" },
    { operation: "model.text.run.Run.add_text.call", receiver: ref("runs", 0), arguments: { text }, resultHandle: "text" },
    { operation: "model.XmlElementView.localName.get", receiver: ref("text"), arguments: {} },
    { operation: "model.XmlElementView.text.get", receiver: ref("text"), arguments: {} },
    { operation: "model.XmlElementView.text.set", receiver: ref("text"), arguments: { value: "Changed" } }
  ];
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } };
  if (route === "model") { const doc = await api.Document(input, textContext), run = doc.paragraphs[0]!.runs[0]!, added = run.add_text(text)!; expect(added).toBeInstanceOf(api.XmlElementView); expect(added.localName).toBe("t"); expect(added.text).toBe(text || null); added.text = "Changed"; expect(run.text).toBe("BeforeChanged"); await doc.save(sink); }
  else if (route === "sdk") { const result = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext); expect(result.results.slice(3, 5).map(r => r.value)).toEqual(["t", text || null]); await result.save(sink); }
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) })); try { const r = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --output /out --json`); expect(r.exitCode, r.stdout + r.stderr).toBe(0); expect(JSON.parse(r.stdout).data.results.slice(3, 5).map((r: { data: unknown }) => r.data)).toEqual(["t", text || null]); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); } }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output);
  for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const doc = await api.Document(output, textContext); expect(doc.paragraphs[0]!.runs[0]!.bold).toBe(true); expect(doc.paragraphs[0]!.text).toBe("BeforeChanged"); expect(doc.paragraphs[0]!.paragraph_format.keep_with_next).toBe(true); expect(new TextDecoder().decode(after.get("word/document.xml")).split("<!--retain-->")).toHaveLength(2);
});
