import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const ref = (resultHandle: string) => ({ resultHandle });
const settings = 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:stored-measures" mc:Ignorable="f" mc:ProcessContent="f:pass"';
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const value of ["1in", "2.54cm", "25.4mm", "72pt", "6pc", "6pi"])
for (const member of ["font size", "tab position", "line multiple", "line exact", "line at least", "indent"] as const)
for (const route of ["model", "sdk", "cli"] as const)
it(`reads stored universal ${member} ${value} without rewriting; ${route}; ${carrier}; ${kind}; strict=${strict}`, async () => {
  const wrap = (markup: string) => carrier === "direct" ? markup : carrier === "process" ? `<f:pass>${markup}</f:pass>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? markup : ""}</mc:Choice><mc:Fallback>${carrier === "fallback" ? markup : ""}</mc:Fallback></mc:AlternateContent>`;
  const paragraph = member === "tab position" ? `<w:tabs>${wrap(`<w:tab w:val="center" w:leader="dot" w:pos="${value}"/>`)}</w:tabs>` : member === "indent" ? wrap(`<w:ind w:left="-${value}"/>`) : member.startsWith("line") ? wrap(`<w:spacing w:line="${value}" w:lineRule="${member === "line exact" ? "exact" : member === "line at least" ? "atLeast" : "auto"}"/>`) : "";
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, `<w:p ${settings}><w:pPr>${paragraph}</w:pPr><w:r><w:rPr>${member === "font size" ? wrap(`<w:sz w:val="${value}"/>`) : ""}<w:i/></w:rPr><w:t>Retain é 日本 עברית 🌊</w:t></w:r><!--retain--><?policy keep?></w:p>`);
  const volume = Volume.fromJSON({ "/output": "" }), before = readPackage(input);
  const operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
    ...(member === "font size" ? [
      { operation: "model.text.paragraph.Paragraph.runs.get", receiver: { resultHandle: "paragraphs", index: 0 }, arguments: {}, resultHandle: "runs" },
      { operation: "model.text.run.Run.font.get", receiver: { resultHandle: "runs", index: 0 }, arguments: {}, resultHandle: "font" },
      { operation: "model.text.run.Font.size.get", receiver: ref("font"), arguments: {} }
    ] : [
      { operation: "model.text.paragraph.Paragraph.paragraph_format.get", receiver: { resultHandle: "paragraphs", index: 0 }, arguments: {}, resultHandle: "format" },
      ...(member === "tab position" ? [
        { operation: "model.text.parfmt.ParagraphFormat.tab_stops.get", receiver: ref("format"), arguments: {}, resultHandle: "tabs" },
        { operation: "model.text.tabstops.TabStops.__getitem__.get", receiver: ref("tabs"), arguments: { index: 0 }, resultHandle: "tab" },
        { operation: "model.text.tabstops.TabStop.position.get", receiver: ref("tab"), arguments: {} }
      ] : [{ operation: `model.text.parfmt.ParagraphFormat.${member === "indent" ? "left_indent" : "line_spacing"}.get`, receiver: ref("format"), arguments: {} }])
    ])
  ];
  const expected = member === "line multiple" ? 6 : member === "indent" ? -914400 : 914400;
  if (route === "model") {
    const document = await api.Document(input, textContext), p = document.paragraphs[0]!, f = p.paragraph_format;
    const actual = member === "font size" ? p.runs[0]!.font.size : member === "tab position" ? f.tab_stops.at(0).position : member === "indent" ? f.left_indent : f.line_spacing;
    expect(typeof actual === "number" ? actual : actual?.emu).toBe(expected);
    if (member.startsWith("line")) expect(f.line_spacing_rule?.name).toBe(member === "line exact" ? "EXACTLY" : member === "line at least" ? "AT_LEAST" : "MULTIPLE");
    await document.save({ async write(bytes) { volume.appendFileSync("/output", bytes); } });
  } else if (route === "sdk") {
    const batch = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext), value = batch.results.at(-1)!.value;
    expect(value).toEqual(member === "line multiple" ? expected : { value: expected, unit: "emu" });
    await batch.save({ async write(bytes) { volume.appendFileSync("/output", bytes); } });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", new TextEncoder().encode("Retain destination"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --dry-run --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      expect(JSON.parse(result.stdout).data.results.at(-1).data).toEqual(member === "line multiple" ? expected : { value: expected, unit: "emu" });
      expect(await fs.readFile("/input")).toEqual(input); expect(new TextDecoder().decode(await fs.readFile("/destination"))).toBe("Retain destination");
    } finally { await shell.dispose(); }
    return;
  }
  expect(readPackage(new Uint8Array(volume.readFileSync("/output") as Buffer))).toEqual(before);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const member of ["font size", "tab position", "line multiple", "line exact", "indent"] as const)
for (const raw of ["0x10", "1e2", "1.5", "", "9007199254740992", "12e2pt", ".5pt", "12ptjunk"])
it(`rejects malformed stored ${member} ${JSON.stringify(raw)} with a typed semantic error; ${kind}; strict=${strict}`, async () => {
  const paragraph = member === "tab position" ? `<w:tabs><w:tab w:val="left" w:pos="${raw}"/></w:tabs>` : member === "indent" ? `<w:ind w:left="${raw}"/>` : member.startsWith("line") ? `<w:spacing w:line="${raw}" w:lineRule="${member === "line exact" ? "exact" : "auto"}"/>` : "";
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, `<w:p><w:pPr>${paragraph}</w:pPr><w:r><w:rPr>${member === "font size" ? `<w:sz w:val="${raw}"/>` : ""}</w:rPr><w:t>Retain é 日本 עברית 🌊</w:t></w:r></w:p>`), document = await api.Document(input, textContext), p = document.paragraphs[0]!, f = p.paragraph_format, before = document.part.blob;
  const read = () => member === "font size" ? p.runs[0]!.font.size : member === "tab position" ? f.tab_stops.at(0).position : member === "indent" ? f.left_indent : f.line_spacing;
  expect(read).toThrow(api.InvalidDocumentError); expect(read).toThrowError(expect.objectContaining({ code: "invalid-package" }));
  expect(document.part.blob).toEqual(before); expect(p.text).toBe("Retain é 日本 עברית 🌊");
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const [value, spacing, rule] of [["12pt", 1, "SINGLE"], ["18pt", 1.5, "ONE_POINT_FIVE"], ["24pt", 2, "DOUBLE"]] as const)
it(`classifies automatic universal line spacing ${value} by its physical value; ${kind}; strict=${strict}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, `<w:p><w:pPr><w:spacing w:line="${value}" w:lineRule="auto"/></w:pPr></w:p>`);
  const document = await api.Document(input, textContext), format = document.paragraphs[0]!.paragraph_format, before = document.part.blob;
  expect(format.line_spacing).toBe(spacing); expect(format.line_spacing_rule?.name).toBe(rule); expect(document.part.blob).toEqual(before);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const action of ["add", "move"] as const) for (const route of ["model", "sdk", "cli"] as const)
it(`orders ${action} against retained universal tab positions; ${route}; ${carrier}; ${kind}; strict=${strict}`, async () => {
  const active = '<w:tab w:val="left" w:pos="24pt"/><w:tab w:val="right" w:pos="72pt" w:leader="dot"/>', inert = '<w:tab w:val="left" w:pos="wrong"/>';
  const content = carrier === "direct" ? active + `<f:opaque>${inert}</f:opaque>` : carrier === "process" ? `<f:pass>${active}</f:pass><f:opaque>${inert}</f:opaque>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? active : inert}</mc:Choice><mc:Fallback>${carrier === "fallback" ? active : inert}</mc:Fallback></mc:AlternateContent>`;
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, `<w:p ${settings}><w:pPr><w:keepNext/><w:tabs>${content}<!--retain--><?policy keep?></w:tabs></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>Retain é 日本 עברית 🌊</w:t></w:r></w:p>`), volume = Volume.fromJSON({ "/output": "" });
  const operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.paragraph_format.get", receiver: { resultHandle: "paragraphs", index: 0 }, arguments: {}, resultHandle: "format" },
    { operation: "model.text.parfmt.ParagraphFormat.tab_stops.get", receiver: ref("format"), arguments: {}, resultHandle: "tabs" },
    ...(action === "add" ? [{ operation: "model.text.tabstops.TabStops.add_tab_stop.call", receiver: ref("tabs"), arguments: { position: { value: 36, unit: "pt" } } }] : [
      { operation: "model.text.tabstops.TabStops.__getitem__.get", receiver: ref("tabs"), arguments: { index: 1 }, resultHandle: "moving" },
      { operation: "model.text.tabstops.TabStop.position.set", receiver: ref("moving"), arguments: { value: { value: 12, unit: "pt" } } }
    ])
  ];
  if (route === "model") {
    const document = await api.Document(input, textContext), tabs = document.paragraphs[0]!.paragraph_format.tab_stops;
    if (action === "add") tabs.add_tab_stop(api.Pt(36));
    else { const held = tabs.at(1); held.position = api.Pt(12); expect(held.position.pt).toBe(12); expect(tabs.at(0).equals(held)).toBe(true); }
    await document.save({ async write(bytes) { volume.appendFileSync("/output", bytes); } });
  } else if (route === "sdk") await (await api.applyStyleModelBatch(input, { version: 1, operations }, textContext)).save({ async write(bytes) { volume.appendFileSync("/output", bytes); } });
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --output /output --json`); expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      volume.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(volume.readFileSync("/output") as Buffer), after = readPackage(output), before = readPackage(input), d = await api.Document(output, textContext), p = d.paragraphs[0]!;
  expect([...p.paragraph_format.tab_stops].map(stop => stop.position.pt)).toEqual(action === "add" ? [24, 36, 72] : [12, 24]);
  expect(p.paragraph_format.keep_with_next).toBe(true); expect(p.runs[0]!.font.italic).toBe(true); expect(p.text).toBe("Retain é 日本 עברית 🌊");
  for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const xml = new TextDecoder().decode(after.get("word/document.xml")); for (const token of [inert, "<!--retain-->", "<?policy keep?>", 'w:pos="24pt"']) expect(xml).toContain(token);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const context of ["lang", "space", "base"] as const)
it(`moves a universal-position tab past a differently contextualized stop; xml:${context}; ${kind}; strict=${strict}`, async () => {
  const values = context === "lang" ? ["ja", "he"] : context === "space" ? ["default", "preserve"] : ["first/", "second/"];
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, `<w:p><w:pPr><w:tabs><w:tab xml:${context}="${values[0]}" w:val="left" w:pos="24pt"/><w:tab xml:${context}="${values[1]}" w:val="right" w:pos="72pt"/></w:tabs></w:pPr><w:r><w:t>Retain 日本 עברית 🌊</w:t></w:r></w:p>`);
  const document = await api.Document(input, textContext), tabs = document.paragraphs[0]!.paragraph_format.tab_stops, moving = tabs.at(1);
  moving.position = api.Pt(36);
  expect([...tabs].map(stop => stop.position.pt)).toEqual([24, 36]);
  expect(tabs.at(1).equals(moving)).toBe(true);
  expect(document.part.blob).toEqual(expect.any(Uint8Array));
  const volume = Volume.fromJSON({ "/output": "" });
  await document.save({ async write(bytes) { volume.appendFileSync("/output", bytes); } });
  const after = readPackage(new Uint8Array(volume.readFileSync("/output") as Buffer));
  for (const [name, bytes] of readPackage(input)) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const xml = new TextDecoder().decode(after.get("word/document.xml"));
  for (const token of [`xml:${context}="${values[0]}"`, `xml:${context}="${values[1]}"`, 'w:pos="24pt"', "Retain 日本 עברית 🌊"]) expect(xml).toContain(token);
});
