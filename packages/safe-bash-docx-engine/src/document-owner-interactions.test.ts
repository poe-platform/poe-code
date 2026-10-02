import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const enc = (text: string) => new TextEncoder().encode(text);
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["primary", "document", "header", "footer", "comments"] as const)
for (const protectedInput of [false, true]) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} reads ${owner} native styles with actual owner and protected=${protectedInput}; strict=${strict}; kind=${kind}`, async () => {
  const fixture = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p/>');
  const seed = await api.Document(fixture.input, textContext), w = seed.element.namespace;
  const primaryStyle = seed.styles.add_style("Primary Style", api.WD_STYLE_TYPE.PARAGRAPH);
  const id = primaryStyle.style_id!;
  const chapter = await api.DocumentPartView.load("/appendix/chapter.xml", seed.part.content_type,
    enc(`<w:document xmlns:w="${w}"><w:body><w:p/><w:sectPr/></w:body></w:document>`), seed.part.package);
  const styles = await api.StylesPart.load("/appendix/styles.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml",
    enc(`<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="Appendix Style"/></w:style></w:styles>`), seed.part.package);
  chapter.relate_to(styles, fixture.relationships + "/styles"); seed.part.relate_to(chapter, "urn:coast:appendix");
  let part: api.StoryPart = chapter;
  if (owner === "primary") part = seed.part;
  else if (owner === "header" || owner === "footer") part = chapter.document.sections[0]![owner].part;
  else if (owner === "comments") { void chapter.comments; part = chapter.part_related_by(fixture.relationships + "/comments") as api.StoryPart; }
  seed.part.relate_to(part, "urn:coast:selected");
  const memory = Volume.fromJSON({ "/seed": "", "/input": "", "/output": "" });
  await seed.save({ async write(bytes) { memory.appendFileSync("/seed", bytes); } });
  const members = readPackage(new Uint8Array(memory.readFileSync("/seed") as Buffer));
  if (protectedInput) {
    members.set("coastal-protection.xml", enc(`<w:settings xmlns:w="${w}"><w:documentProtection w:edit="readOnly" w:enforcement="1"/></w:settings>`));
    members.set("[Content_Types].xml", enc(new TextDecoder().decode(members.get("[Content_Types].xml")!).replace("</Types>", '<Override PartName="/coastal-protection.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>')));
  }
  await api.writeArchive({ comment: new Uint8Array(), members: [...members].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.opc.part.Part.part_related_by.call", receiver: ref("main"), arguments: { reltype: "urn:coast:selected" }, resultHandle: "selected" },
    { operation: "model.parts.story.StoryPart.get_style.call", receiver: ref("selected"), arguments: { styleId: id, styleType: { enum: "WD_STYLE_TYPE", name: "PARAGRAPH" } }, resultHandle: "style" },
    { operation: "model.styles.style.ParagraphStyle.name.get", receiver: ref("style"), arguments: {} }
  ];
  const expected = owner === "primary" ? "Primary Style" : "Appendix Style";
  if (route === "model") {
    const document = await api.Document(input, textContext), selected = document.part.part_related_by("urn:coast:selected") as api.StoryPart;
    expect(selected.get_style(id, api.WD_STYLE_TYPE.PARAGRAPH).name).toBe(expected);
    const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
    if (protectedInput) {
      for (const member of document.part.package.parts) expect(member.blob).toEqual(members.get(member.partname.toString().slice(1)));
      await expect(document.save(sink)).rejects.toMatchObject({ code: "unsupported-edit" });
      expect(memory.readFileSync("/output").length).toBe(0);
    } else {
      await document.save(sink);
      expect(readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer))).toEqual(members);
    }
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext);
    expect(result.results.at(-1)!.value).toBe(expected);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      // The typed getter may create style definitions: its declared batch route
      // requires publication validation even when invoked as a dry-run.
      const result = await shell.exec("docx batch /input --ops-file /ops --dry-run --json");
      if (protectedInput) { expect(result.exitCode).toBe(1); expect(JSON.parse(result.stdout).errors[0].code).toBe("unsupported-edit"); }
      else { expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout).data.results.at(-1).data).toBe(expected); }
      expect(await fs.readFile("/input")).toEqual(input);
    }
    finally { await shell.dispose(); }
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const mode of ["table-read", "table-write", "comment"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} resolves additional-owner ${mode} style definitions without changing primary styles; strict=${strict}; kind=${kind}`, async () => {
  const fixture = await nativeStoryFixture("document.DocumentPart", strict, kind, '<w:p/>');
  const context = { ...textContext, timestamp: new Date("2026-03-04T05:06:07Z") };
  const seed = await api.Document(fixture.input, context), w = seed.element.namespace;
  seed.styles.add_style("Primary Table", api.WD_STYLE_TYPE.TABLE);
  const child = await api.DocumentPartView.load("/appendix/chapter.xml", seed.part.content_type,
    enc(`<w:document xmlns:w="${w}"><w:body><w:tbl><w:tblPr><w:tblStyle w:val="CoastalTable"/></w:tblPr><w:tblGrid><w:gridCol w:w="1440"/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl><w:p/><w:sectPr/></w:body></w:document>`), seed.part.package);
  const styles = await api.StylesPart.load("/appendix/styles.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml",
    enc(`<w:styles xmlns:w="${w}"><w:style w:type="table" w:styleId="CoastalTable"><w:name w:val="Appendix Table"/></w:style></w:styles>`), seed.part.package);
  child.relate_to(styles, fixture.relationships + "/styles"); seed.part.relate_to(child, "urn:coast:appendix"); void child.comments;
  const memory = Volume.fromJSON({ "/input": "", "/output": "" });
  await seed.save({ async write(bytes) { memory.appendFileSync("/input", bytes); } });
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), before = readPackage(input);
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.opc.part.Part.part_related_by.call", receiver: ref("main"), arguments: { reltype: "urn:coast:appendix" }, resultHandle: "chapter" },
    { operation: "model.parts.document.DocumentPart.document.get", receiver: ref("chapter"), arguments: {}, resultHandle: "appendix" },
    ...(mode === "comment" ? [
      { operation: "model.document.Document.comments.get", receiver: ref("appendix"), arguments: {}, resultHandle: "comments" },
      { operation: "model.comments.Comments.add_comment.call", receiver: ref("comments"), arguments: { text: "Appendix note", author: "Coast", initials: "C" }, resultHandle: "comment" },
      { operation: "model.comments.Comment.text.get", receiver: ref("comment"), arguments: {} }
    ] : [
      { operation: "model.document.Document.tables.get", receiver: ref("appendix"), arguments: {}, resultHandle: "tables" },
      ...(mode === "table-write" ? [{ operation: "model.table.Table.style.set", receiver: ref("tables", 0), arguments: { value: "Appendix Table" } }] : []),
      { operation: "model.table.Table.style.get", receiver: ref("tables", 0), arguments: {}, resultHandle: "style" },
      { operation: "model.styles.style._TableStyle.name.get", receiver: ref("style"), arguments: {} }
    ])
  ];
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } }, expected = mode === "comment" ? "Appendix note" : "Appendix Table";
  if (route === "model") {
    const primary = await api.Document(input, context), appendix = (primary.part.part_related_by("urn:coast:appendix") as api.DocumentPartView).document;
    if (mode === "comment") expect(appendix.comments.add_comment("Appendix note", "Coast", "C").text).toBe(expected);
    else { if (mode === "table-write") appendix.tables[0]!.style = "Appendix Table"; expect(appendix.tables[0]!.style?.name).toBe(expected); }
    await primary.save(sink);
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(input, { version: 1, operations }, context); expect(result.results.at(-1)!.value).toBe(expected); await result.save(sink);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const result = await shell.exec(`docx batch /input --ops-file /ops --json${mode === "table-read" ? "" : " --output /output"}${mode === "comment" ? " --timestamp 2026-03-04T05:06:07Z" : ""}`); expect(result.exitCode, result.stdout + result.stderr).toBe(0); expect(JSON.parse(result.stdout).data.results.at(-1).data).toBe(expected); memory.writeFileSync("/output", mode === "table-read" ? await fs.readFile("/input") : await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input); }
    finally { await shell.dispose(); }
  }
  const after = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer));
  for (const [name, bytes] of before) if (!name.startsWith("appendix/")) expect(after.get(name), name).toEqual(bytes);
  if (mode === "comment") expect(new TextDecoder().decode(after.get("appendix/styles.xml"))).toContain("Comment Text");
});
