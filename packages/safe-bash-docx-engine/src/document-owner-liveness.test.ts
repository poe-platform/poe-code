import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
import { rasterPng } from "../tests/fixtures/raster.js";

const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
const enc = (text: string) => new TextEncoder().encode(text);

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const resource of ["comments", "settings", "styles", "inline_shapes"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} binds additional-document ${resource} to the actual native owner; strict=${strict}; kind=${kind}`, async () => {
  const fixture = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>Primary tide</w:t></w:r></w:p>');
  const seed = await api.Document(fixture.input, textContext);
  if (resource === "inline_shapes") await seed.add_picture(rasterPng(2, 3));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" }); await seed.save({ async write(bytes) { memory.appendFileSync("/input", bytes); } });
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), before = readPackage(input);
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const blob = enc(`<w:document xmlns:w="${w}"><w:body><w:p/></w:body></w:document>`), type = seed.part.content_type;
  const prefix = resource === "comments" ? "model.comments.Comments" : resource === "settings" ? "model.settings.Settings" : resource === "styles" ? "model.styles.styles.Styles" : "model.shape.InlineShapes";
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.parts.document.DocumentPart.package.get", receiver: ref("main"), arguments: {}, resultHandle: "package" },
    { operation: "model.parts.document.DocumentPart.load.call", arguments: { partname: "/appendix/chapter.xml", contentType: type, blob: { kind: "bytes", base64: Buffer.from(blob).toString("base64") }, ownerPackage: ref("package") }, resultHandle: "chapter" },
    { operation: `model.parts.document.DocumentPart.${resource}.get`, receiver: ref("chapter"), arguments: {}, resultHandle: "resource" },
    ...(resource === "inline_shapes" ? [{ operation: `${prefix}.__len__.get`, receiver: ref("resource"), arguments: {} }]
      : resource === "comments" ? [{ operation: "model.parts.document.DocumentPart.part_related_by.call", receiver: ref("chapter"), arguments: { reltype: fixture.relationships + "/comments" }, resultHandle: "resourcePart" }, { operation: "model.opc.part.Part.partname.get", receiver: ref("resourcePart"), arguments: {} }]
      : [{ operation: `${prefix}.part.get`, receiver: ref("resource"), arguments: {}, resultHandle: "resourcePart" }, { operation: "model.opc.part.XmlPart.partname.get", receiver: ref("resourcePart"), arguments: {} }])
  ];
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  let resultValue: unknown;
  if (route === "model") {
    const doc = await api.Document(input, textContext), chapter = await api.DocumentPartView.load("/appendix/chapter.xml", type, blob, doc.part.package);
    if (resource === "inline_shapes") resultValue = chapter.inline_shapes.length;
    else if (resource === "comments") { expect(chapter.comments.length).toBe(0); resultValue = chapter.part_related_by(fixture.relationships + "/comments").partname.toString(); }
    else resultValue = chapter[resource].part.partname.toString();
    await doc.save(sink);
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext); resultValue = result.results.at(-1)!.value; await result.save(sink);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec("docx batch /input --ops-file /ops --output /output --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); resultValue = JSON.parse(result.stdout).data.results.at(-1).data; memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input); }
    finally { await shell.dispose(); }
  }
  if (resource === "inline_shapes") expect(resultValue).toBe(0); else expect(resultValue).toMatch(/^\/appendix\//u);
  const after = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer));
  for (const [name, bytes] of before) if (name !== "[Content_Types].xml") expect(after.get(name), name).toEqual(bytes);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} retains live document content handles when its native main part is renamed; strict=${strict}; kind=${kind}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>Before tide</w:t></w:r></w:p>');
  const operations = [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.parts.document.DocumentPart.partname.set", receiver: ref("main"), arguments: { value: "/report/body.xml" } },
    { operation: "model.text.paragraph.Paragraph.text.set", receiver: ref("paragraphs", 0), arguments: { value: "After tide" } },
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "current" },
    { operation: "model.text.paragraph.Paragraph.text.get", receiver: ref("current", 0), arguments: {} }
  ];
  const memory = Volume.fromJSON({ "/output": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  if (route === "model") {
    const doc = await api.Document(input, textContext), paragraph = doc.paragraphs[0]!, element = paragraph.element, part = doc.part;
    part.partname = "/report/body.xml"; expect(doc.part).toBe(part); expect(part.document).toBe(doc); expect(paragraph.text).toBe("Before tide");
    paragraph.text = "After tide"; expect(doc.paragraphs[0]!.equals(paragraph)).toBe(true); expect(new TextDecoder().decode(element.serialize())).toContain("After tide"); await doc.save(sink);
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext); expect(result.results.at(-1)!.value).toBe("After tide"); await result.save(sink);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec("docx batch /input --ops-file /ops --output /output --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout).data.results.at(-1).data).toBe("After tide"); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input); }
    finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
  expect(after.has("word/document.xml")).toBe(false); expect(after.has("word/_rels/document.xml.rels")).toBe(false); expect(after.has("report/body.xml")).toBe(true); expect(after.has("report/_rels/body.xml.rels")).toBe(true);
  expect((await api.Document(output, textContext)).paragraphs[0]!.text).toBe("After tide");
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} binds a loaded native document to its own body instead of the primary owner; strict=${strict}; kind=${kind}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>Primary tide</w:t></w:r></w:p>');
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const blob = enc(`<w:document xmlns:w="${w}"><w:body><w:p><w:r><w:t>Appendix tide</w:t></w:r></w:p></w:body></w:document>`);
  const type = `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "docx" ? "document" : "template"}.main+xml`;
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.parts.document.DocumentPart.package.get", receiver: ref("main"), arguments: {}, resultHandle: "package" },
    { operation: "model.parts.document.DocumentPart.load.call", arguments: { partname: "/appendix/chapter.xml", contentType: type, blob: { kind: "bytes", base64: Buffer.from(blob).toString("base64") }, ownerPackage: ref("package") }, resultHandle: "chapter" },
    { operation: "model.parts.document.DocumentPart.document.get", receiver: ref("chapter"), arguments: {}, resultHandle: "appendix" },
    { operation: "model.document.Document.paragraphs.get", receiver: ref("appendix"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.text.get", receiver: ref("paragraphs", 0), arguments: {} },
    { operation: "model.text.paragraph.Paragraph.text.set", receiver: ref("paragraphs", 0), arguments: { value: "Appendix recorded" } }
  ];
  const memory = Volume.fromJSON({ "/output": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  if (route === "model") {
    const primary = await api.Document(input, textContext), chapter = await api.DocumentPartView.load("/appendix/chapter.xml", type, blob, primary.part.package), appendix = chapter.document;
    expect(appendix.part).toBe(chapter); expect(appendix).not.toBe(primary); expect(appendix.paragraphs[0]!.text).toBe("Appendix tide"); appendix.paragraphs[0]!.text = "Appendix recorded"; expect(primary.paragraphs[0]!.text).toBe("Primary tide"); await primary.save(sink);
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext); expect(result.results.at(-2)!.value).toBe("Appendix tide"); await result.save(sink);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec("docx batch /input --ops-file /ops --output /output --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout).data.results.at(-2).data).toBe("Appendix tide"); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input); }
    finally { await shell.dispose(); }
  }
  const after = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer));
  expect(new TextDecoder().decode(after.get("appendix/chapter.xml"))).toContain("Appendix recorded");
  for (const [name, bytes] of readPackage(input)) if (name !== "[Content_Types].xml") expect(after.get(name), name).toEqual(bytes);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const variant of ["header", "first_page_header", "even_page_header", "footer", "first_page_footer", "even_page_footer"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} creates ${variant} under its loaded document owner; strict=${strict}; kind=${kind}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p><w:r><w:t>Primary archive</w:t></w:r></w:p><w:sectPr/>');
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const blob = enc(`<w:document xmlns:w="${w}" xmlns:x="urn:coastal-retention" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x" x:archive="retained"><w:body><!--keep owner--><?shore keep?><w:p/><w:sectPr/></w:body></w:document>`);
  const type = `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "docx" ? "document" : "template"}.main+xml`;
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.parts.document.DocumentPart.package.get", receiver: ref("main"), arguments: {}, resultHandle: "package" },
    { operation: "model.parts.document.DocumentPart.load.call", arguments: { partname: "/appendix/chapter.xml", contentType: type, blob: { kind: "bytes", base64: Buffer.from(blob).toString("base64") }, ownerPackage: ref("package") }, resultHandle: "chapter" },
    { operation: "model.parts.document.DocumentPart.document.get", receiver: ref("chapter"), arguments: {}, resultHandle: "appendix" },
    { operation: "model.document.Document.sections.get", receiver: ref("appendix"), arguments: {}, resultHandle: "sections" },
    { operation: `model.section.Section.${variant}.get`, receiver: ref("sections", 0), arguments: {}, resultHandle: "story" },
    { operation: "model.types.ProvidesStoryPart.part.get", receiver: ref("story"), arguments: {}, resultHandle: "part" },
    { operation: "model.opc.part.Part.partname.get", receiver: ref("part"), arguments: {} }
  ];
  const volume = Volume.fromJSON({ "/output": "" }), sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/output", bytes); } };
  let name: string;
  if (route === "model") {
    const doc = await api.Document(input, textContext), chapter = await api.DocumentPartView.load("/appendix/chapter.xml", type, blob, doc.part.package);
    name = chapter.document.sections[0]![variant].part.partname.toString(); await doc.save(sink);
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext); name = result.results.at(-1)!.value as string; await result.save(sink);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec("docx batch /input --ops-file /ops --output /output --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); name = JSON.parse(result.stdout).data.results.at(-1).data; volume.writeFileSync("/output", await fs.readFile("/output")); }
    finally { await shell.dispose(); }
  }
  expect(name.startsWith("/appendix/")).toBe(true);
  const after = readPackage(new Uint8Array(volume.readFileSync("/output") as Buffer));
  const chapter = new TextDecoder().decode(after.get("appendix/chapter.xml"));
  for (const retained of ['x:archive="retained"', '<!--keep owner-->', '<?shore keep?>']) expect(chapter).toContain(retained);
  expect(chapter).toContain(variant.endsWith("header") ? "headerReference" : "footerReference");
  for (const [name, bytes] of readPackage(input)) if (name !== "[Content_Types].xml") expect(after.get(name), name).toEqual(bytes);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} preserves bound styles and XML handles through native style part rename; strict=${strict}; kind=${kind}`, async () => {
  const { input: initial } = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p/>');
  const seed = await api.Document(initial, textContext); seed.styles.add_style("Coastal Heading", api.WD_STYLE_TYPE.PARAGRAPH);
  const originalName = seed.styles.part.partname.toString().slice(1);
  const volume = Volume.fromJSON({ "/input": "", "/output": "" }); await seed.save({ async write(bytes) { volume.appendFileSync("/input", bytes); } });
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer);
  const operations = [
    { operation: "model.document.Document.styles.get", receiver: ref("document"), arguments: {}, resultHandle: "styles" },
    { operation: "model.styles.styles.Styles.__getitem__.call", receiver: ref("styles"), arguments: { key: "Coastal Heading" }, resultHandle: "style" },
    { operation: "model.styles.styles.Styles.part.get", receiver: ref("styles"), arguments: {}, resultHandle: "part" },
    { operation: "model.opc.part.Part.partname.set", receiver: ref("part"), arguments: { value: "/metadata/stylebook.xml" } },
    { operation: "model.styles.style.ParagraphStyle.name.get", receiver: ref("style"), arguments: {} }
  ];
  const sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/output", bytes); } };
  if (route === "model") {
    const doc = await api.Document(input, textContext), styles = doc.styles, selected = styles.at("Coastal Heading"), element = selected.element;
    expect(styles.part.partname.toString().slice(1)).toBe(originalName); styles.part.partname = "/metadata/stylebook.xml"; expect(selected.name).toBe("Coastal Heading"); expect(doc.styles).toBe(styles); expect(new TextDecoder().decode(element.serialize())).toContain("Coastal Heading"); await doc.save(sink);
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext); expect(result.results.at(-1)!.value).toBe("Coastal Heading"); await result.save(sink);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec("docx batch /input --ops-file /ops --output /output --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout).data.results.at(-1).data).toBe("Coastal Heading"); volume.writeFileSync("/output", await fs.readFile("/output")); }
    finally { await shell.dispose(); }
  }
  const after = readPackage(new Uint8Array(volume.readFileSync("/output") as Buffer));
  expect(after.get("metadata/stylebook.xml")).toEqual(readPackage(input).get(originalName)); expect(after.has(originalName)).toBe(false);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const mode of ["native", "document", "paragraph", "insertion"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} resolves ${mode} styles in the actual document owner; strict=${strict}; kind=${kind}`, async () => {
  const fixture = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p/>'), seed = await api.Document(fixture.input, textContext);
  const id = seed.styles.add_style("Owner Style", api.WD_STYLE_TYPE.PARAGRAPH).style_id!;
  const volume = Volume.fromJSON({ "/input": "", "/output": "" }); await seed.save({ async write(bytes) { volume.appendFileSync("/input", bytes); } });
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer), w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const document = enc(`<w:document xmlns:w="${w}"><w:body><w:p><w:pPr><w:pStyle w:val="${id}"/></w:pPr></w:p></w:body></w:document>`);
  const styles = enc(`<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="Appendix Style"/></w:style></w:styles>`);
  const type = seed.part.content_type, stylesType = "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml", bytes = (value: Uint8Array) => ({ kind: "bytes", base64: Buffer.from(value).toString("base64") });
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.opc.part.Part.package.get", receiver: ref("main"), arguments: {}, resultHandle: "package" },
    { operation: "model.parts.document.DocumentPart.load.call", arguments: { partname: "/appendix/chapter.xml", contentType: type, blob: bytes(document), ownerPackage: ref("package") }, resultHandle: "chapter" },
    { operation: "model.parts.styles.StylesPart.load.call", arguments: { partname: "/appendix/styles.xml", contentType: stylesType, blob: bytes(styles), ownerPackage: ref("package") }, resultHandle: "ownerStyles" },
    { operation: "model.opc.part.Part.relate_to.call", receiver: ref("chapter"), arguments: { target: ref("ownerStyles"), reltype: fixture.relationships + "/styles" } },
    ...(mode === "native" ? [{ operation: "model.parts.document.DocumentPart.get_style.call", receiver: ref("chapter"), arguments: { styleId: id, styleType: { enum: "WD_STYLE_TYPE", name: "PARAGRAPH" } }, resultHandle: "style" }] : mode === "document" ? [
      { operation: "model.parts.document.DocumentPart.document.get", receiver: ref("chapter"), arguments: {}, resultHandle: "appendix" },
      { operation: "model.document.Document.styles.get", receiver: ref("appendix"), arguments: {}, resultHandle: "styles" },
      { operation: "model.styles.styles.Styles.__getitem__.call", receiver: ref("styles"), arguments: { key: "Appendix Style" }, resultHandle: "style" }
    ] : [
      { operation: "model.parts.document.DocumentPart.document.get", receiver: ref("chapter"), arguments: {}, resultHandle: "appendix" },
      ...(mode === "insertion" ? [{ operation: "model.document.Document.add_paragraph.call", receiver: ref("appendix"), arguments: { text: "Inserted appendix", style: "Appendix Style" }, resultHandle: "paragraph" }] : [{ operation: "model.document.Document.paragraphs.get", receiver: ref("appendix"), arguments: {}, resultHandle: "paragraphs" }]),
      { operation: "model.text.paragraph.Paragraph.style.get", receiver: mode === "insertion" ? ref("paragraph") : ref("paragraphs", 0), arguments: {}, resultHandle: "style" }
    ]),
    { operation: "model.styles.style.ParagraphStyle.name.get", receiver: ref("style"), arguments: {} }
  ];
  const sink = { async write(chunk: Uint8Array) { volume.appendFileSync("/output", chunk); } };
  if (route === "model") {
    const primary = await api.Document(input, textContext), chapter = await api.DocumentPartView.load("/appendix/chapter.xml", type, document, primary.part.package), ownerStyles = await api.StylesPart.load("/appendix/styles.xml", stylesType, styles, primary.part.package);
    chapter.relate_to(ownerStyles, fixture.relationships + "/styles");
    const selected = mode === "native" ? chapter.get_style(id, api.WD_STYLE_TYPE.PARAGRAPH) : mode === "document" ? chapter.document.styles.at("Appendix Style") : mode === "insertion" ? chapter.document.add_paragraph("Inserted appendix", "Appendix Style").style : chapter.document.paragraphs[0]!.style;
    expect(selected?.name).toBe("Appendix Style"); await primary.save(sink);
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext); expect(result.results.at(-1)!.value).toBe("Appendix Style"); await result.save(sink);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec("docx batch /input --ops-file /ops --output /output --json"); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout).data.results.at(-1).data).toBe("Appendix Style"); volume.writeFileSync("/output", await fs.readFile("/output")); }
    finally { await shell.dispose(); }
  }
  const after = readPackage(new Uint8Array(volume.readFileSync("/output") as Buffer));
  for (const [name, bytes] of readPackage(input)) if (name !== "[Content_Types].xml") expect(after.get(name), name).toEqual(bytes);
});
