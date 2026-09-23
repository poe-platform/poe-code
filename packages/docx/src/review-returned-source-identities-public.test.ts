import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure, assertPackageLinks } from "../tests/assertions.js";

const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });
const coreRelationship = "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const row of [232, 233, 1514]) for (const route of ["model", "sdk", "cli"] as const)
it(`executes returned owner and complete single-run annotation source R${row}; strict=${strict}; kind=${kind}; route=${route}`, async () => {
  const native = await textFixture('<w:p><w:r><w:t>Referenced 海🌊</w:t></w:r></w:p>', row === 1514 ? { comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="42" w:author="Archive"><w:p/></w:comment><!--retain--><?audit exact?></w:comments>` } } : {}, strict, { kind });
  const parts = readPackage(native), encode = (text: string) => new TextEncoder().encode(text);
  if (row !== 1514) {
    parts.set("metadata/core.xml", encode('<c:coreProperties xmlns:c="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:d="http://purl.org/dc/elements/1.1/"><d:title>Archive 海🌊</d:title><!--retain--><?audit exact?></c:coreProperties>'));
    const types = new api.DocumentXmlEditor(parts.get("[Content_Types].xml")!); types.insertChildren(types.root, '<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/metadata/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'); parts.set("[Content_Types].xml", types.serialize());
    const edges = new api.DocumentXmlEditor(parts.get("_rels/.rels")!); edges.insertChildren(edges.root, `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="Core" Type="${coreRelationship}" Target="metadata/core.xml"/>`); parts.set("_rels/.rels", edges.serialize());
  }
  const memory = Volume.fromJSON({ "/input": "", "/output": "" }), context = { ...textContext, encoding: { order: "input", compression: "store" } as const };
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), original = input.slice(), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  const operations = row === 1514 ? [
    { operation: "model.document.Document.paragraphs.get", receiver: ref("document"), arguments: {}, resultHandle: "paragraphs" },
    { operation: "model.text.paragraph.Paragraph.runs.get", receiver: ref("paragraphs", 0), arguments: {}, resultHandle: "runs" },
    { operation: "model.text.run.Run.mark_comment_range.call", receiver: ref("runs", 0), arguments: { lastRun: ref("runs", 0), commentId: 42 } }
  ] : [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.parts.document.DocumentPart.package.get", receiver: ref("main"), arguments: {}, resultHandle: "owner" },
    { operation: "model.opc.package.OpcPackage.core_properties.get", receiver: ref("owner"), arguments: {}, resultHandle: "core" },
    { operation: "model.opc.coreprops.CoreProperties.part.get", receiver: ref("core"), arguments: {}, resultHandle: "corePart" },
    { operation: "model.opc.parts.coreprops.CorePropertiesPart.core_properties.get", receiver: ref("corePart"), arguments: {}, resultHandle: "returnedCore" },
    { operation: "model.opc.package.OpcPackage.part_related_by.call", receiver: ref("owner"), arguments: { reltype: coreRelationship }, resultHandle: "relatedPart" },
    { operation: "model.opc.coreprops.CoreProperties.title.get", receiver: ref("returnedCore"), arguments: {} }
  ];
  const observe = (values: unknown[]) => {
    if (row === 1514) return;
    expect(values[2]).toMatchObject({ type: "CoreProperties", owner: "document" }); expect(values[3]).toMatchObject({ type: "CorePropertiesPart", owner: "document" });
    expect(values[4]).toEqual(values[2]); expect(values[5]).toEqual(values[3]); expect(values[6]).toBe("Archive 海🌊");
  };
  if (route === "model") {
    const document = await api.Document(input, context);
    if (row === 1514) { const run = document.paragraphs[0]!.runs[0]!; run.mark_comment_range(run, 42); }
    else { const owner = document.part.package, core = owner.core_properties, part = owner.part_related_by(coreRelationship); expect(core).toBeInstanceOf(api.CoreProperties); expect(part).toBeInstanceOf(api.CorePropertiesPartView); if (!(part instanceof api.CorePropertiesPartView)) throw new Error("Missing owned core part"); expect(core).toBe(part.core_properties); expect(core.part).toBe(part); expect(part.package).toBe(owner); expect(core.title).toBe("Archive 海🌊"); }
    await document.save(sink);
  } else if (route === "sdk") { const batch = await api.applyStyleModelBatch(input, { version: 1, operations }, context); observe(batch.results.map(item => item.value)); await batch.save(sink); }
  else {
    const fs = new MemoryFileSystem(), destination = encode("Retained destination"); await fs.writeFile("/input", input); await fs.writeFile("/output", destination); await fs.writeFile("/operations", encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try { const response = await shell.exec("docx batch /input --ops-file /operations --output /output --force --json"); expect(response.exitCode, response.stdout + response.stderr).toBe(0); observe(JSON.parse(response.stdout).data.results.map((item: { data: unknown }) => item.data)); expect(await fs.readFile("/input")).toEqual(original); memory.writeFileSync("/output", await fs.readFile("/output")); } finally { await shell.dispose(); }
  }
  const saved = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer)); assertPackageLinks(saved);
  for (const [name, bytes] of parts) if (row !== 1514 || name !== "word/document.xml") expect(saved.get(name), name).toEqual(bytes);
  if (row === 1514) {
    const namespace = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
    const paragraph = `<w:p xmlns:w="${namespace}"><w:commentRangeStart w:id="42"/><w:r><w:t>Referenced 海🌊</w:t></w:r><w:commentRangeEnd w:id="42"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="42"/></w:r></w:p>`;
    const reopened = await api.Document(new Uint8Array(memory.readFileSync("/output") as Buffer), context);
    expect(xmlStructure(reopened.paragraphs[0]!.element.serialize())).toEqual(xmlStructure(encode(paragraph))); expect(reopened.comments.get(42)!.author).toBe("Archive"); expect(reopened.paragraphs[0]!.text).toBe("Referenced 海🌊");
  }
  expect(input).toEqual(original); expect(memory.readFileSync("/input")).toEqual(Buffer.from(original));
});
