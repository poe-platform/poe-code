import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const context of ["lang", "space", "base"] as const)
for (const contextOwner of ["process-wrapper", "native-stop"] as const)
for (const action of ["move", "add"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} handles tab ${context} on ${contextOwner} during ${action}; strict=${strict}; kind=${kind}`, async () => {
  const value = context === "lang" ? "he-IL" : context === "space" ? "preserve" : "../original/";
  const attribute = ` xml:${context}="${value}"`;
  const original = await textFixture(`<w:p xmlns:mc="${mc}" xmlns:f="urn:original:tabs" mc:Ignorable="f" mc:ProcessContent="f:pass"><w:pPr><w:tabs><f:pass${contextOwner === "process-wrapper" ? attribute : ""}><w:tab w:pos="720" w:val="center" f:identity="context"${contextOwner === "native-stop" ? attribute : ""}/></f:pass><w:tab w:pos="1800" w:val="decimal"/><!--original--></w:tabs></w:pPr><w:r><w:t>Original עברית 日本 🌊</w:t></w:r></w:p>`, {}, strict);
  const parts = readPackage(original);
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({"/input": "", "/out": ""});
  await api.writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/out", bytes);}};
  const operations = [
    {operation: "model.document.Document.paragraphs.get", receiver: {resultHandle: "document"}, arguments: {}, resultHandle: "paragraphs"},
    {operation: "model.text.paragraph.Paragraph.paragraph_format.get", receiver: {resultHandle: "paragraphs", index: 0}, arguments: {}, resultHandle: "format"},
    {operation: "model.text.parfmt.ParagraphFormat.tab_stops.get", receiver: {resultHandle: "format"}, arguments: {}, resultHandle: "tabs"},
    ...(action === "move" ? [
      {operation: "model.text.tabstops.TabStops.__getitem__.get", receiver: {resultHandle: "tabs"}, arguments: {index: 0}, resultHandle: "stop"},
      {operation: "model.text.tabstops.TabStop.position.set", receiver: {resultHandle: "stop"}, arguments: {value: {value: 2200, unit: "twip"}}}
    ] : [{operation: "model.text.tabstops.TabStops.add_tab_stop.call", receiver: {resultHandle: "tabs"}, arguments: {position: {value: 360, unit: "twip"}}}])
  ];
  if (route === "model") {
    if (contextOwner === "process-wrapper") {await expect(api.Document(input, textContext)).rejects.toMatchObject({code: "invalid-xml"}); expect(memory.readFileSync("/out")).toHaveLength(0); return;}
    const doc = await api.Document(input, textContext), tabs = doc.paragraphs[0]!.paragraph_format.tab_stops;
    if (action === "move") tabs.at(0).position = api.Twips(2200);
    else tabs.add_tab_stop(api.Twips(360));
    await doc.save(sink);
  } else if (route === "sdk") {
    if (contextOwner === "process-wrapper") {await expect(api.applyStyleModelBatch(input, {version: 1, operations}, textContext)).rejects.toMatchObject({code: "invalid-xml"}); expect(memory.readFileSync("/out")).toHaveLength(0); return;}
    else await (await api.applyStyleModelBatch(input, {version: 1, operations}, textContext)).save(sink);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({fs}).use(docxCommands({engine: api.createDocxInspectionCommandEngine({limits: textContext.limits})}));
    try {
      const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({version: 1, operations})}' --output /out --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(contextOwner === "process-wrapper" ? 1 : 0);
      expect(await fs.readFile("/input")).toEqual(input);
      if (contextOwner === "process-wrapper") {expect(JSON.parse(result.stdout).errors[0].code).toBe("invalid-xml"); await expect(fs.readFile("/out")).rejects.toBeDefined(); return;}
      else memory.writeFileSync("/out", await fs.readFile("/out"));
    } finally {await shell.dispose();}
  }
  const after = readPackage(new Uint8Array(memory.readFileSync("/out") as Buffer)); assertPackageLinks(after);
  for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const saved = new TextDecoder().decode(after.get("word/document.xml"));
  expect(saved).toContain(`xml:${context}="${value}"`);
  expect(saved).toContain('f:identity="context"');
  expect(saved).toContain("<!--original-->");
  const doc = await api.Document(new Uint8Array(memory.readFileSync("/out") as Buffer), textContext);
  expect([...doc.paragraphs[0]!.paragraph_format.tab_stops].map(t => t.position.twips)).toEqual(action === "move" ? [1800, 2200] : [360, 720, 1800]);
  expect(doc.paragraphs[0]!.text).toBe("Original עברית 日本 🌊");
});
