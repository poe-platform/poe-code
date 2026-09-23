import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { assertPackageLinks, readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
 for (const route of ["model", "sdk", "cli"] as const) for (const reset of [false, true])
 it(`${route} ${reset ? "retains explicit null reset" : "rejects missing required value"} for tab leader; ${kind}; strict=${strict}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind,
   '<w:p><w:pPr><w:keepNext/><w:tabs><w:tab w:pos="720" w:val="center" w:leader="dot"/></w:tabs></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>Retain é 日本 עברית 🌊</w:t></w:r><!--retain--><?policy keep?></w:p>');
  const parts = readPackage(input);
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "" });
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } };
  const operations = [
   { operation: "model.document.Document.paragraphs.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "paragraphs" },
   { operation: "model.text.paragraph.Paragraph.paragraph_format.get", receiver: { resultHandle: "paragraphs", index: 0 }, arguments: {}, resultHandle: "format" },
   { operation: "model.text.parfmt.ParagraphFormat.tab_stops.get", receiver: { resultHandle: "format" }, arguments: {}, resultHandle: "stops" },
   { operation: "model.text.tabstops.TabStops.__getitem__.get", receiver: { resultHandle: "stops" }, arguments: { index: 0 }, resultHandle: "stop" },
   { operation: "model.text.tabstops.TabStop.leader.set", receiver: { resultHandle: "stop" }, arguments: reset ? { value: null } : {} }
  ];
  if (route === "model") {
   const doc = await api.Document(input, textContext), stop = doc.paragraphs[0]!.paragraph_format.tab_stops.at(0), before = doc.part.blob;
   if (reset) stop.leader = null;
   else { expect(() => { stop.leader = undefined as unknown as null; }).toThrow(api.InputTypeError); expect(doc.part.blob).toEqual(before); }
   expect(stop.leader).toBe(reset ? api.WD_TAB_LEADER.SPACES : api.WD_TAB_LEADER.DOTS);
   expect(stop.position.twips).toBe(720); expect(stop.alignment).toBe(api.WD_TAB_ALIGNMENT.CENTER);
   await doc.save(sink);
  } else if (route === "sdk") {
   if (reset) await (await api.applyStyleModelBatch(input, { version: 1, operations }, textContext)).save(sink);
   else await expect(api.applyStyleModelBatch(input, { version: 1, operations }, textContext)).rejects.toMatchObject({ code: "usage" });
  } else {
   const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/out", new TextEncoder().encode("Original destination"));
   const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
   try {
    const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --output /out --force --json`);
    expect(result.exitCode, result.stdout + result.stderr).toBe(reset ? 0 : 2);
    if (reset) memory.writeFileSync("/out", await fs.readFile("/out"));
    else { expect(JSON.parse(result.stdout).errors[0]).toMatchObject({ code: "usage", message: "Missing required argument: value." }); expect(new TextDecoder().decode(await fs.readFile("/out"))).toBe("Original destination"); }
    expect(await fs.readFile("/input")).toEqual(input);
   } finally { await shell.dispose(); }
  }
  if (memory.readFileSync("/out").length) {
   const output = new Uint8Array(memory.readFileSync("/out") as Buffer), saved = readPackage(output); assertPackageLinks(saved);
   for (const [name, bytes] of parts) if (!reset || name !== "word/document.xml") expect(saved.get(name), name).toEqual(bytes);
   const paragraph = (await api.Document(output, textContext)).paragraphs[0]!;
   expect(paragraph.text).toBe("Retain é 日本 עברית 🌊"); expect(paragraph.runs[0]!.italic).toBe(true); expect(paragraph.paragraph_format.keep_with_next).toBe(true);
   expect(paragraph.paragraph_format.tab_stops.at(0).leader).toBe(reset ? api.WD_TAB_LEADER.SPACES : api.WD_TAB_LEADER.DOTS);
  }
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
 });

for (const strict of [false, true]) it(`retains optional default tab leader on addition; strict=${strict}`, async () => {
 const { input } = await nativeStoryFixture("document.DocumentPart", strict, "docx", '<w:p/>');
 const paragraph = (await api.Document(input, textContext)).paragraphs[0]!, stop = paragraph.paragraph_format.tab_stops.add_tab_stop(api.Pt(12), undefined, undefined);
 expect(stop.leader).toBe(api.WD_TAB_LEADER.SPACES); expect(stop.position.pt).toBe(12);
});
