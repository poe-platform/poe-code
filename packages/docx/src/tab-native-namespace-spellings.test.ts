import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const prefix of ["w", "aWord", "default"] as const)
for (const action of ["move", "add"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} edits native ${action} tabs with ${prefix} namespace spelling; strict=${strict}; kind=${kind}`, async () => {
  const parts = readPackage(await textFixture('<w:p w:rsidR="00ABCDEF"><w:pPr><w:tabs><w:tab w:pos="720" w:val="center"/><w:tab w:pos="1800" w:val="decimal"/><!--original-tabs--></w:tabs></w:pPr><w:r><w:t>Original עברית 日本 🌊</w:t></w:r></w:p>', {}, strict));
  const ns = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
  let source = new TextDecoder().decode(parts.get("word/document.xml"));
  if (prefix === "aWord") source = source.split("w:").join("aWord:").replace("xmlns:w=", "xmlns:aWord=");
  else if (prefix === "default") source = source.split("<w:").join("<").split("</w:").join("</").replace("<document ", `<document xmlns="${ns}" `);
  parts.set("word/document.xml", new TextEncoder().encode(source));
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({"/input": "", "/out": ""});
  await api.writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/out", bytes);}}, operations = [
    {operation: "model.document.Document.paragraphs.get", receiver: {resultHandle: "document"}, arguments: {}, resultHandle: "paragraphs"},
    {operation: "model.text.paragraph.Paragraph.paragraph_format.get", receiver: {resultHandle: "paragraphs", index: 0}, arguments: {}, resultHandle: "format"},
    {operation: "model.text.parfmt.ParagraphFormat.tab_stops.get", receiver: {resultHandle: "format"}, arguments: {}, resultHandle: "tabs"},
    ...(action === "move" ? [
      {operation: "model.text.tabstops.TabStops.__getitem__.get", receiver: {resultHandle: "tabs"}, arguments: {index: 0}, resultHandle: "stop"},
      {operation: "model.text.tabstops.TabStop.position.set", receiver: {resultHandle: "stop"}, arguments: {value: {value: 2200, unit: "twip"}}}
    ] : [{operation: "model.text.tabstops.TabStops.add_tab_stop.call", receiver: {resultHandle: "tabs"}, arguments: {position: {value: 1000, unit: "twip"}}}])
  ];
  if (route === "model") {const doc = await api.Document(input, textContext), tabs = doc.paragraphs[0]!.paragraph_format.tab_stops; if (action === "move") tabs.at(0).position = api.Twips(2200); else tabs.add_tab_stop(api.Twips(1000)); await doc.save(sink);}
  else if (route === "sdk") await (await api.applyStyleModelBatch(input, {version: 1, operations}, textContext)).save(sink);
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({fs}).use(docxCommands({engine: api.createDocxInspectionCommandEngine({limits: textContext.limits})}));
    try {const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({version: 1, operations})}' --output /out --json`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out"));} finally {await shell.dispose();}
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), after = readPackage(output); assertPackageLinks(after);
  for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const saved = new TextDecoder().decode(after.get("word/document.xml")); expect(saved).toContain("<!--original-tabs-->"); expect(saved).toContain('rsidR="00ABCDEF"');
  const doc = await api.Document(output, textContext); expect([...doc.paragraphs[0]!.paragraph_format.tab_stops].map(t => t.position.twips)).toEqual(action === "move" ? [1800, 2200] : [720, 1000, 1800]);
  expect(doc.paragraphs[0]!.text).toBe("Original עברית 日本 🌊"); expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
