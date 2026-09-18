import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textFixture, textContext, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value), ref = (resultHandle: string) => ({ resultHandle });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const encoding of ["utf8", "utf16be"] as const)
for (const carrier of ["direct", "choice", "fallback", "process", "nested", "properties-choice", "properties-fallback", "properties-process"] as const)
for (const start of ["default", "EVEN_PAGE"] as const)
for (const route of ["model", "sdk", "shell", "utility-sdk", "utility-shell"] as const)
it(`${route} adds ${start} section through ${carrier} with inherited bindings; ${encoding} ${kind} strict=${strict}`, async () => {
  const properties = '<w:headerReference w:type="default" r:id="heading"/><w:type w:val="continuous"/><w:pgSz w:w="12000" w:h="16000"/><w:pgMar w:left="1000" w:right="1000" w:top="1000" w:bottom="1000"/>';
  const inactive = carrier.startsWith("properties-") ? '<w:pgSz w:w="5000" w:h="6000"/>' : '<w:sectPr><w:pgSz w:w="5000" w:h="6000"/></w:sectPr>';
  const alternate = (inner: string, fallback = false) => `<mc:AlternateContent><!--retained carrier--><mc:Choice Requires="${fallback ? "f" : "w"}">${fallback ? inactive : inner}</mc:Choice><mc:Fallback>${fallback ? inner : inactive}</mc:Fallback></mc:AlternateContent>`;
  const section = `<w:sectPr>${carrier === "properties-process" ? `<f:pass>${properties}</f:pass>` : carrier.startsWith("properties-") ? alternate(properties, carrier === "properties-fallback") : properties}</w:sectPr>`;
  const boundary = carrier === "direct" || carrier.startsWith("properties-") ? section : carrier === "process" ? `<f:pass>${section}</f:pass>` : carrier === "nested" ? alternate(`<f:pass>${section}</f:pass>`) : alternate(section, carrier === "fallback");
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Retained coast</w:t></w:r></w:p>' + boundary, { heading: { kind: "header", xml: `<w:hdr xmlns:w="${w}"><w:p><w:r><w:t>Shared heading</w:t></w:r></w:p></w:hdr>` } }, strict));
  const xml = new TextDecoder().decode(parts.get("word/document.xml")!).replace("<w:body>", '<w:body xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:coast:future" mc:Ignorable="f" mc:ProcessContent="f:pass">');
  parts.set("word/document.xml", encoding === "utf8" ? enc(xml) : new Uint8Array(Buffer.from("\ufeff" + xml, "utf16le").swap16()));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" }), context = { ...textContext, encoding: { order: "input", compression: "store" } as const }, sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), options = start === "default" ? {} : { startType: { enum: "WD_SECTION_START" as const, name: "EVEN_PAGE" as const } };
  const operations = [
    { operation: "model.document.Document.add_section.call", receiver: ref("document"), arguments: options, resultHandle: "added" },
    { operation: "model.section.Section.page_width.get", receiver: ref("added"), arguments: {} }
  ];
  let afterPath: readonly number[] | undefined;
  if (route === "model") {
    const document = await api.Document(input, context), added = start === "default" ? document.add_section() : document.add_section(api.WD_SECTION_START.EVEN_PAGE);
    expect(added.page_width?.twips).toBe(12000); expect(added.header.is_linked_to_previous).toBe(true); await document.save(sink);
  } else if (route === "sdk") {
    const result = await api.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...context, stdout: sink }); expect(result.results[1]!.data).toEqual({ value: 12000 * 635, unit: "emu" });
  } else if (route === "utility-sdk") {
    const result = await api.editDocumentSections(input, { operation: "sections.add", options: { ...options, output: "-" } }, { ...context, stdout: sink }); expect(result.changes).toHaveLength(1); afterPath = result.changes[0]!.after.value.path;
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const result = await shell.exec(route === "shell" ? "docx batch /input --ops-file /ops --output /output --json" : `docx sections add /input${start === "default" ? "" : " --start-type EVEN_PAGE"} --output /output --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(0); const envelope = JSON.parse(result.stdout); expect(envelope.errors).toEqual([]);
      if (route === "shell") expect(envelope.data.results[1].data).toEqual({ value: 12000 * 635, unit: "emu" }); else afterPath = envelope.data.changes[0].after.value.path;
      memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output), listed = await api.inspectDocumentSections(output, {}, context);
  expect(listed.items).toHaveLength(2); expect(listed.items.map(item => item.owner)).toEqual(["paragraph", "body"]);
  expect(listed.items.map(item => item.direct.startType)).toEqual(["continuous", start === "default" ? "nextPage" : "evenPage"]);
  for (const item of listed.items) expect(item.direct).toMatchObject({ pageWidth: 12000, pageHeight: 16000, leftMargin: 1000, rightMargin: 1000, topMargin: 1000, bottomMargin: 1000 });
  expect(listed.items[0]!.headers.default).toEqual({ linkedToPrevious: false, sourceSection: 1, part: "/word/heading.xml" });
  expect(listed.items[1]!.headers.default).toEqual({ linkedToPrevious: true, sourceSection: 1, part: "/word/heading.xml" });
  if (afterPath) expect(afterPath).toEqual(listed.items[1]!.location.value.path);
  for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(saved.get(name), name).toEqual(bytes);
  const savedXml = new TextDecoder(encoding === "utf8" ? "utf-8" : "utf-16be").decode(saved.get("word/document.xml")!);
  expect(savedXml).toContain('<w:p><w:r><w:t>Retained coast</w:t></w:r></w:p>');
  if (["choice", "fallback", "nested", "properties-choice", "properties-fallback"].includes(carrier)) { expect(savedXml).toContain(inactive); expect(savedXml).toContain("<!--retained carrier-->"); }
  if (encoding === "utf16be") expect(saved.get("word/document.xml")!.slice(0, 2)).toEqual(Uint8Array.of(254, 255));
  const reopened = await api.Document(output, context); expect(reopened.sections[1]!.header.paragraphs[0]!.text).toBe("Shared heading"); expect(reopened.sections.length).toBe(2);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["model", "sdk", "shell", "utility-sdk", "utility-shell"] as const)
it(`${route} adds a section to an implicit terminal section; ${kind} strict=${strict}`, async () => {
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Implicit coast</w:t></w:r></w:p>', {}, strict));
  if (kind === "dotx") parts.set("[Content_Types].xml", enc(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" }), context = { ...textContext, encoding: { order: "input", compression: "store" } as const }, sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), operations = [{ operation: "model.document.Document.add_section.call", receiver: ref("document"), arguments: {} }];
  if (route === "model") { const doc = await api.Document(input, context); expect(doc.add_section().start_type).toBe(api.WD_SECTION_START.NEW_PAGE); await doc.save(sink); }
  else if (route === "sdk") await api.executeDocumentBatch(input, { version: 1, operations }, { output: "-" }, { ...context, stdout: sink });
  else if (route === "utility-sdk") await api.editDocumentSections(input, { operation: "sections.add", options: { output: "-" } }, { ...context, stdout: sink });
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try { const result = await shell.exec(route === "shell" ? "docx batch /input --ops-file /ops --output /output --json" : "docx sections add /input --output /output --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input); }
    finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), doc = await api.Document(output, context), saved = readPackage(output);
  expect(doc.sections.length).toBe(2); expect(doc.sections[1]!.start_type).toBe(api.WD_SECTION_START.NEW_PAGE); expect(doc.paragraphs[0]!.text).toBe("Implicit coast");
  for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(saved.get(name), name).toEqual(bytes);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
