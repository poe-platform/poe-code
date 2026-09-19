import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext, w } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

for (const strict of [false, true]) for (const carrier of ["direct", "choice", "fallback", "process"] as const) for (const route of ["model", "sdk", "cli", "sdk-direct", "cli-direct"] as const)
it(`${route} clears active native tabs and retains their ${carrier} carrier and inactive data; strict=${strict}`, async () => {
  const active = `<w:tab w:pos="720" w:val="${strict ? "start" : "left"}"/><w:tab w:pos="1440" w:val="center"/>`;
  const inactive = '<w:tab w:pos="2880" w:val="center" f:identity="inactive"/>';
  const wrapped = carrier === "direct" ? active : carrier === "process" ? `<f:pass>${active}</f:pass><f:opaque>${inactive}</f:opaque>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : inactive}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : inactive}</mc:Fallback></mc:AlternateContent>`;
  const props = `<w:pPr><w:tabs>${wrapped}<f:retained f:flag="keep"/><!--tab-retain--><?policy keep?></w:tabs><w:keepNext/></w:pPr>`;
  const xml = `<w:p xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:tab-clear" mc:Ignorable="f" mc:ProcessContent="f:pass">${props}<w:r><w:rPr><w:i/></w:rPr><w:t>Original é 日本 עברית 🌊</w:t></w:r><!--paragraph-retain--><?policy keep?></w:p>`;
  const input = await textFixture(xml, {}, strict), volume = Volume.fromJSON({ "/out": "" }), sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
  const operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.paragraph_format.get", receiver: { resultHandle: "paragraphs", index: 0 }, arguments: {}, resultHandle: "format" },
    { operation: "model.text.parfmt.ParagraphFormat.tab_stops.get", receiver: { resultHandle: "format" }, arguments: {}, resultHandle: "tabs" },
    { operation: "model.text.tabstops.TabStops.clear_all.call", receiver: { resultHandle: "tabs" }, arguments: {} },
    { operation: "model.text.tabstops.TabStops.__len__.get", receiver: { resultHandle: "tabs" }, arguments: {} }
  ];
  if (route === "model") {
    const d = await api.Document(input, textContext), tabs = d.paragraphs[0]!.paragraph_format.tab_stops, first = tabs.at(0);
    expect(tabs.length).toBe(2); tabs.clear_all(); expect(tabs.length).toBe(0); expect(() => first.position).toThrow(api.StaleHandleError); await d.save(sink);
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext); expect(result.results.at(-1)!.value).toBe(0); await result.save(sink);
  } else if (route === "sdk-direct") {
    await api.editDocumentParagraphs(input, { operation: "paragraphs.set", options: { paragraph: 1, tabStopsClear: true, output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: sink });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", new TextEncoder().encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(route === "cli" ? "docx batch /input --ops-file /ops --output /out --json" : "docx paragraphs set /input --paragraph 1 --tab-stops-clear true --output /out --json");
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      if (route === "cli") expect(JSON.parse(result.stdout).data.results.at(-1).data).toBe(0);
      expect(await fs.readFile("/input")).toEqual(input); volume.writeFileSync("/out", await fs.readFile("/out"));
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output); assertPackageLinks(after);
  for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const retained = new TextDecoder().decode(after.get("word/document.xml"));
  for (const token of ['<f:retained f:flag="keep"/>', '<!--tab-retain-->', '<?policy keep?>', '<!--paragraph-retain-->']) expect(retained).toContain(token);
  if (carrier !== "direct") expect(retained).toContain(inactive);
  if (carrier === "choice" || carrier === "fallback") { expect(retained).toContain('<mc:AlternateContent>'); expect(retained).toContain('<mc:Fallback>'); }
  if (carrier === "process") expect(retained).toContain('<f:pass></f:pass>');
  const d = await api.Document(output, textContext); expect(d.paragraphs[0]!.paragraph_format.tab_stops.length).toBe(0); expect(d.paragraphs[0]!.text).toBe("Original é 日本 עברית 🌊"); expect(d.paragraphs[0]!.paragraph_format.keep_with_next).toBe(true); expect(d.paragraphs[0]!.runs[0]!.italic).toBe(true);
});

for (const strict of [false, true]) for (const route of ["model", "sdk", "cli"] as const)
it(`${route} rejects clearing an opaque selected tab and retains input and destination; strict=${strict}`, async () => {
  const body = '<w:p xmlns:f="urn:original:tab-clear" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"><w:pPr><w:tabs><w:tab w:pos="720" w:val="center" f:identity="selected"/><f:retained/></w:tabs></w:pPr><w:r><w:t>Original 日本 עברית 🌊</w:t></w:r></w:p>';
  const input = await textFixture(body, {}, strict);
  const operations = [{ operation: "paragraphs.set", arguments: { paragraph: 1, tabStopsClear: true } }];
  if (route === "model") {
    const document = await api.Document(input, textContext), original = document.element.serialize();
    expect(() => document.paragraphs[0]!.paragraph_format.tab_stops.clear_all()).toThrow(api.UnsupportedEditError);
    expect(document.element.serialize()).toEqual(original);
    expect(document.paragraphs[0]!.paragraph_format.tab_stops.length).toBe(1);
  } else if (route === "sdk") {
    const memory = Volume.fromJSON({ "/out": "existing destination" });
    await expect(api.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/out", bytes); } } })).rejects.toMatchObject({ code: "unsupported-edit" });
    expect(memory.readFileSync("/out", "utf8")).toBe("existing destination");
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const destination = new TextEncoder().encode("existing destination"); await fs.writeFile("/out", destination);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec("docx paragraphs set /input --paragraph 1 --tab-stops-clear true --output /out --force --json");
      expect(result.exitCode).toBe(1); expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "unsupported-edit" }] });
      expect(await fs.readFile("/input")).toEqual(input); expect(await fs.readFile("/out")).toEqual(destination);
    } finally { await shell.dispose(); }
  }
});
