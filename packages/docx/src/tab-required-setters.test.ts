import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
 for (const member of ["position", "alignment", "leader"] as const)
 for (const route of ["model", "sdk", "cli"] as const)
 it(`rejects omitted required tab ${member} without damaging the live handle; ${route}; ${kind}; strict=${strict}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:pPr><w:tabs><w:tab w:pos="720" w:val="center" w:leader="dot"/></w:tabs></w:pPr><w:r><w:t>Keep é 日本 עברית 🌊</w:t></w:r></w:p>');
  const operations = [
   { operation: "model.document.Document.paragraphs.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "paragraphs" },
   { operation: "model.text.paragraph.Paragraph.paragraph_format.get", receiver: { resultHandle: "paragraphs", index: 0 }, arguments: {}, resultHandle: "format" },
   { operation: "model.text.parfmt.ParagraphFormat.tab_stops.get", receiver: { resultHandle: "format" }, arguments: {}, resultHandle: "stops" },
   { operation: "model.text.tabstops.TabStops.__getitem__.get", receiver: { resultHandle: "stops" }, arguments: { index: 0 }, resultHandle: "stop" },
   { operation: `model.text.tabstops.TabStop.${member}.set`, receiver: { resultHandle: "stop" }, arguments: {} }
  ];
  if (route === "model") {
   const doc = await api.Document(input, textContext), stop = doc.paragraphs[0]!.paragraph_format.tab_stops.at(0), before = doc.part.blob;
   expect(() => { Reflect.set(stop, member, undefined); }).toThrow(api.InputTypeError);
   expect(doc.part.blob).toEqual(before);
   expect(stop.position.twips).toBe(720); expect(stop.alignment).toBe(api.WD_TAB_ALIGNMENT.CENTER); expect(stop.leader).toBe(api.WD_TAB_LEADER.DOTS);
   const memory = Volume.fromJSON({ "/out": "" });
   await doc.save({ async write(bytes) { memory.appendFileSync("/out", bytes); } });
   expect(readPackage(new Uint8Array(memory.readFileSync("/out") as Buffer))).toEqual(readPackage(input));
  } else if (route === "sdk") {
   await expect(api.applyStyleModelBatch(input, { version: 1, operations }, textContext)).rejects.toMatchObject({ code: "usage", message: "Missing required argument: value." });
  } else {
   const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/out", new TextEncoder().encode("Original destination"));
   const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
   try {
    const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --output /out --force --json`);
    expect(result.exitCode, result.stdout + result.stderr).toBe(2); expect(JSON.parse(result.stdout)).toMatchObject({ affected: 0, errors: [{ code: "usage", message: "Missing required argument: value." }] });
    expect(await fs.readFile("/input")).toEqual(input); expect(new TextDecoder().decode(await fs.readFile("/out"))).toBe("Original destination");
   } finally { await shell.dispose(); }
  }
 });
