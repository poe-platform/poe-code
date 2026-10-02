import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Document, DocumentPartView, PackageView, NumberingPart, DocumentXmlEditor, InputTypeError, createDocumentArchive, writeArchive, writeDocumentArchive, applyStyleModelBatch, createDocxInspectionCommandEngine, readDocumentArchive, type DocxBatchOperation } from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";

const types = { docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml", dotx: "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml" };
async function inputFor(kind: "docx" | "dotx", dialect: "strict" | "transitional", uppercase = false, macro = false) {
  const archive = await createDocumentArchive({ kind, dialect }, textContext);
  const member = archive.members.find(member => member.name === "[Content_Types].xml")!;
  const xml = new DocumentXmlEditor(member.bytes);
  const main = xml.root.children.find(node => node.attributes.some(attribute => attribute.localName === "ContentType" && attribute.value === types[kind]))!;
  if (uppercase || macro) xml.setAttribute(main, "ContentType", macro ? "application/vnd.ms-word.template.macroEnabledTemplate.main+xml" : types[kind].toUpperCase());
  const volume = Volume.fromJSON({ "/input": "" });
  const sink = { async write(bytes: Uint8Array) { volume.appendFileSync("/input", bytes); } };
  const candidate = { ...archive, members: archive.members.map(part => part === member ? { ...part, bytes: xml.serialize() } : part) };
  if (macro) await writeArchive(candidate, sink, { order: "input", compression: "store" }, textContext);
  else await writeDocumentArchive(candidate, sink, { order: "input", compression: "store" }, textContext);
  return new Uint8Array(volume.readFileSync("/input") as Buffer);
}
const readOps: readonly DocxBatchOperation[] = [
  { operation: "model.document.Document.part.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "part" },
  { operation: "model.parts.document.DocumentPart.content_type.get", receiver: { resultHandle: "part" }, arguments: {} }
];
const createOps: readonly DocxBatchOperation[] = [...readOps,
  { operation: "model.parts.document.DocumentPart.numbering_part.get", receiver: { resultHandle: "part" }, arguments: {}, resultHandle: "numbering" },
  { operation: "model.parts.numbering.NumberingPart.numbering_definitions.get", receiver: { resultHandle: "numbering" }, arguments: {}, resultHandle: "definitions" },
  { operation: "model.NumberingDefinitionsView.length.get", receiver: { resultHandle: "definitions" }, arguments: {} }
];

for (const kind of ["docx", "dotx"] as const) for (const dialect of ["transitional", "strict"] as const) for (const uppercase of [false, true]) for (const route of ["model", "sdk", "cli"] as const) it(
  `${kind}/${dialect} ${route} binds the main document owner; uppercase=${uppercase}`, async () => {
    const input = await inputFor(kind, dialect, uppercase), expectedType = uppercase ? types[kind].toUpperCase() : types[kind];
    const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" });
    let saved: Uint8Array;
    if (route === "model") {
      const doc = await Document(input, textContext), part = doc.part;
      expect(part).toBeInstanceOf(DocumentPartView);
      expect(part.package.main_document_part).toBe(part);
      expect(part.content_type).toBe(expectedType);
      expect(NumberingPart.new(part.package)).toBe(part.numbering_part);
      expect(part.numbering_part.numbering_definitions.length).toBe(0);
      await doc.save({ async write(bytes) { volume.appendFileSync("/out", bytes); } });
      saved = new Uint8Array(volume.readFileSync("/out") as Buffer);
    } else if (route === "sdk") {
      const result = await applyStyleModelBatch(input, { version: 1, operations: createOps }, textContext);
      expect(result.results[1]!.value).toBe(expectedType);
      expect(result.results.at(-1)!.value).toBe(0);
      await result.save({ async write(bytes) { volume.appendFileSync("/out", bytes); } });
      saved = new Uint8Array(volume.readFileSync("/out") as Buffer);
    } else {
      const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
        args: ["batch", "/input", "--ops-json", JSON.stringify({ version: 1, operations: createOps }), "--output", "-"].map(word => new TextEncoder().encode(word)), cwd: "/", signal: textContext.signal,
        filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} },
        stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
      });
      expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
      saved = new Uint8Array(volume.readFileSync("/out") as Buffer);
    }
    const archive = await readDocumentArchive(saved, textContext);
    expect({ kind: archive.kind, dialect: archive.dialect }).toEqual({ kind, dialect });
    const before = readPackage(input), after = readPackage(saved);
    // The shared independent graph oracle expects canonical MIME spelling.
    // Normalize only its comparison copy; raw output spelling is asserted below.
    const graphParts = new Map(after), declarations = new DocumentXmlEditor(after.get("[Content_Types].xml")!);
    const declaration = declarations.root.children.find(node => node.attributes.some(attribute => attribute.localName === "ContentType" && attribute.value === expectedType))!;
    expect(declaration).toBeDefined();
    declarations.setAttribute(declaration, "ContentType", types[kind]);
    graphParts.set("[Content_Types].xml", declarations.serialize());
    assertPackageLinks(graphParts);
    for (const [name, bytes] of before) if (!["[Content_Types].xml", "word/_rels/document.xml.rels"].includes(name)) expect(after.get(name), name).toEqual(bytes);
    const reopened = await Document(saved, textContext);
    expect(reopened.part.content_type).toBe(expectedType);
    expect(reopened.part.numbering_part.numbering_definitions.length).toBe(0);
    expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
  }
);

for (const dialect of ["transitional", "strict"] as const) it(`keeps DOTX package ownership live and ordinary XML edits pure in ${dialect}`, async () => {
  const input = await inputFor("dotx", dialect), owner = await PackageView.open(input, textContext), main = owner.main_document_part;
  expect(main).toBeInstanceOf(DocumentPartView);
  const before = readPackage(input);
  const snapshot = Volume.fromJSON({ "/before": "", "/after": "" });
  await owner.save({ async write(bytes) { snapshot.appendFileSync("/before", bytes); } });
  expect(readPackage(new Uint8Array(snapshot.readFileSync("/before") as Buffer))).toEqual(before);
  const namespaceURI = main.element.namespace;
  const body = main.element.children.find(node => node.localName === "body")!;
  body.insert(0, { kind: "element", name: { namespaceURI, localName: "p" }, children: [{ kind: "element", name: { namespaceURI, localName: "r" }, children: [{ kind: "element", name: { namespaceURI, localName: "t" }, children: [{ kind: "text", text: "Template edit" }] }] }] });
  main.partname = "/templates/main.xml";
  expect(owner.main_document_part).toBe(main);
  await owner.save({ async write(bytes) { snapshot.appendFileSync("/after", bytes); } });
  const saved = new Uint8Array(snapshot.readFileSync("/after") as Buffer), reopened = await Document(saved, textContext);
  expect(reopened.part.partname.toString()).toBe("/templates/main.xml");
  expect(reopened.paragraphs[0]!.text).toBe("Template edit");
  expect((await readDocumentArchive(saved, textContext)).kind).toBe("dotx");
});

for (const kind of ["docx", "dotx"] as const) for (const dialect of ["transitional", "strict"] as const) for (const uppercase of [false, true]) it(`loads an explicit ${kind}/${dialect} typed document part; uppercase=${uppercase}`, async () => {
  const input = await inputFor(kind, dialect), doc = await Document(input, textContext), owner = doc.store.package;
  const source = readPackage(input).get("word/document.xml")!;
  const contentType = uppercase ? types[kind].toUpperCase() : types[kind];
  const part = await DocumentPartView.load("/word/additional.xml", contentType, source, owner);
  expect(part).toBeInstanceOf(DocumentPartView);
  expect(part.package).toBe(owner);
  expect(part.blob).toEqual(source);
  expect(part.content_type).toBe(contentType);
  await expect(DocumentPartView.load("/word/incompatible.xml", "application/xml", source, owner)).rejects.toThrow(InputTypeError);
  expect(owner.parts.some(part => part.partname.toString() === "/word/incompatible.xml")).toBe(false);
});

for (const dialect of ["transitional", "strict"] as const) it(`rejects macro template admission without publishing in ${dialect}`, async () => {
  const input = await inputFor("dotx", dialect, false, true);
  await expect(Document(input, textContext)).rejects.toMatchObject({ code: "unsupported-profile" });
  await expect(applyStyleModelBatch(input, { version: 1, operations: readOps }, textContext)).rejects.toMatchObject({ code: "unsupported-profile" });
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" });
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["batch", "/input", "--ops-json", JSON.stringify({ version: 1, operations: createOps }), "--output", "-"].map(word => new TextEncoder().encode(word)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
  });
  expect(result.exitCode).not.toBe(0);
  expect(volume.readFileSync("/out")).toHaveLength(0);
  expect(volume.readFileSync("/err", "utf8")).toContain("unsupported-profile");
});

for (const dialect of ["transitional", "strict"] as const) for (const route of ["model", "sdk", "cli"] as const) it(`reads ${dialect} DOTX owner metadata without creating parts through ${route}`, async () => {
  const input = await inputFor("dotx", dialect), volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" });
  if (route === "model") {
    const doc = await Document(input, textContext);
    expect(doc.part.content_type).toBe(types.dotx);
    await doc.save({ async write(bytes) { volume.appendFileSync("/out", bytes); } });
    expect(readPackage(new Uint8Array(volume.readFileSync("/out") as Buffer))).toEqual(readPackage(input));
  } else if (route === "sdk") {
    const result = await applyStyleModelBatch(input, { version: 1, operations: readOps }, textContext);
    expect(result.affected).toBe(0);
    expect(result.results[1]?.value).toBe(types.dotx);
    await result.save({ async write(bytes) { volume.appendFileSync("/out", bytes); } });
    expect(readPackage(new Uint8Array(volume.readFileSync("/out") as Buffer))).toEqual(readPackage(input));
  } else {
    const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
      args: ["batch", "/input", "--ops-json", JSON.stringify({ version: 1, operations: readOps }), "--json"].map(word => new TextEncoder().encode(word)), cwd: "/", signal: textContext.signal,
      filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
    });
    expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
    const resultData = JSON.parse(volume.readFileSync("/out", "utf8") as string);
    expect(resultData.affected).toBe(0);
    expect(resultData.data.results[1].data).toBe(types.dotx);
    expect(volume.readdirSync("/")).toEqual(["err", "input", "out"]);
  }
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
