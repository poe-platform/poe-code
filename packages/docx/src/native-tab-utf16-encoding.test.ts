import { Volume } from "memfs";
import { expect, it } from "vitest";
import * as api from "./index.js";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const encoding of ["UTF-16LE", "UTF-16BE"] as const) for (const declaration of [false, true])
for (const owner of ["paragraph", "style"] as const) for (const carrier of ["direct", "choice", "fallback", "process"] as const)
for (const action of ["insert", "move"] as const) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} ${action}s native tabs in ${encoding} ${owner}; declaration=${declaration}; carrier=${carrier}; strict=${strict}; kind=${kind}`, async () => {
  const attrs = 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:tab-encoding" mc:Ignorable="f" mc:ProcessContent="f:pass"';
  const active = `<w:tabs><w:tab w:val="${strict ? "end" : "right"}" w:pos="720" w:leader="dot" f:canary="original"/><!--stop--><w:tab w:val="${strict ? "start" : "left"}" w:pos="2160"/><?audit keep?></w:tabs>`;
  const inactive = '<w:tabs><w:tab w:val="center" w:pos="8000"/></w:tabs>';
  const wrapped = carrier === "direct" ? active : carrier === "process" ? `<f:pass>${active}</f:pass><f:opaque f:identity="retained">${inactive}</f:opaque>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}"${carrier === "fallback" ? ' f:identity="retained"' : ""}>${carrier === "choice" ? active : inactive}</mc:Choice><mc:Fallback${carrier === "choice" ? ' f:identity="retained"' : ""}>${carrier === "fallback" ? active : inactive}</mc:Fallback></mc:AlternateContent>`;
  const properties = `<w:pPr><w:keepNext/>${wrapped}</w:pPr>`;
  const parts = readPackage(await textFixture(`<w:p ${attrs}>${owner === "paragraph" ? properties : ""}<w:r><w:rPr><w:b/></w:rPr><w:t>Original é 日本 עברית 🌊</w:t></w:r></w:p>`, owner === "style" ? { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}" ${attrs}><w:style w:styleId="Survey" w:type="paragraph"><w:name w:val="Survey"/>${properties}<w:rPr><w:i/></w:rPr></w:style><!--styles--></w:styles>` } } : {}, strict)), target = owner === "style" ? "word/styles.xml" : "word/document.xml", memory = Volume.fromJSON({ "/input": "", "/out": "" });
  let xml = new TextDecoder().decode(parts.get(target));
  if (declaration) xml = `<?xml version="1.0" encoding="UTF-16"?>${xml}`;
  const bytes = Buffer.from("\ufeff" + xml, "utf16le"); parts.set(target, new Uint8Array(encoding === "UTF-16BE" ? bytes.swap16() : bytes));
  if (kind === "dotx") parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } }, context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const } };
  const operations: { operation: string; receiver: ReturnType<typeof ref>; arguments: Record<string, unknown>; resultHandle?: string }[] = owner === "style" ? [
    { operation: "model.document.Document.styles.get", receiver: ref("document"), arguments: {}, resultHandle: "styles" },
    { operation: "model.styles.styles.Styles.__getitem__.call", receiver: ref("styles"), arguments: { key: "Survey" }, resultHandle: "selected" },
    { operation: "model.styles.style.ParagraphStyle.paragraph_format.get", receiver: ref("selected"), arguments: {}, resultHandle: "format" }
  ] : [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.paragraph_format.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "format" }
  ];
  operations.push({ operation: "model.text.parfmt.ParagraphFormat.tab_stops.get", receiver: ref("format"), arguments: {}, resultHandle: "tabs" }, { operation: "model.text.tabstops.TabStops.__getitem__.get", receiver: ref("tabs"), arguments: { index: 0 }, resultHandle: "first" }, { operation: "model.text.tabstops.TabStops.__getitem__.get", receiver: ref("tabs"), arguments: { index: 1 }, resultHandle: "retained" }, action === "insert" ? { operation: "model.text.tabstops.TabStops.add_tab_stop.call", receiver: ref("tabs"), arguments: { position: { value: 1440, unit: "twip" } }, resultHandle: "added" } : { operation: "model.text.tabstops.TabStop.position.set", receiver: ref("first"), arguments: { value: { value: 1440, unit: "twip" } } }, { operation: "model.text.tabstops.TabStop.position.get", receiver: ref("retained"), arguments: {}, resultHandle: "observed" });
  if (route === "model") {
    const doc = await api.Document(input, context), format = owner === "style" ? (doc.styles.at("Survey") as api.ParagraphStyle).paragraph_format : doc.paragraphs[0]!.paragraph_format, tabs = format.tab_stops, first = tabs.at(0), retained = tabs.at(1);
    if (action === "insert") expect(tabs.add_tab_stop(api.Twips(1440)).position.twips).toBe(1440); else { first.position = api.Twips(1440); expect(first.position.twips).toBe(1440); }
    expect(retained.position.twips).toBe(2160); await doc.save(sink);
  } else if (route === "sdk") { const batch = await api.applyStyleModelBatch(input, { version: 1, operations }, context); await batch.save(sink); }
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --output /out --json`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(await fs.readFile("/input")).toEqual(input); memory.writeFileSync("/out", await fs.readFile("/out")); } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), after = readPackage(output); expect((await api.validateDocument(output, context)).valid).toBe(true);
  for (const [name, bytes] of parts) if (name !== target) expect(after.get(name), name).toEqual(bytes);
  expect(after.get(target)!.slice(0, 2)).toEqual(encoding === "UTF-16BE" ? Uint8Array.of(254, 255) : Uint8Array.of(255, 254));
  const saved = new TextDecoder(encoding).decode(after.get(target));
  for (const token of ['f:canary="original"', "<!--stop-->", "<?audit keep?>", ...(carrier === "direct" ? [] : [inactive, 'f:identity="retained"'])]) expect(saved.split(token)).toHaveLength(2);
  expect(saved.startsWith('<?xml version="1.0" encoding="UTF-16"?>')).toBe(declaration);
  const doc = await api.Document(output, context), format = owner === "style" ? (doc.styles.at("Survey") as api.ParagraphStyle).paragraph_format : doc.paragraphs[0]!.paragraph_format;
  expect([...format.tab_stops].map(t => t.position.twips)).toEqual(action === "insert" ? [720, 1440, 2160] : [1440, 2160]); expect(format.keep_with_next).toBe(true);
  expect(doc.paragraphs[0]!.text).toBe("Original é 日本 עברית 🌊"); expect(doc.paragraphs[0]!.runs[0]!.bold).toBe(true); expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
