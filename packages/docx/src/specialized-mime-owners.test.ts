import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Document, DocumentXmlEditor, NumberingPart, CorePropertiesPartView, ImagePartView, InputTypeError, InvalidValueError, UnsupportedEditError, readArchive, writeArchive, applyStyleModelBatch, createDocxInspectionCommandEngine, type DocxBatchOperation } from "./index.js";
import { textFixture, textContext, w } from "../tests/fixtures/text.js";
import { rasterPng } from "../tests/fixtures/raster.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const types = { numbering: "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml", core: "application/vnd.openxmlformats-package.core-properties+xml", image: "image/png" };
type Role = keyof typeof types;
const roles = Object.keys(types) as Role[];
async function saved(model: { save(output: { write(bytes: Uint8Array): Promise<void> }): Promise<void> }) {
  const volume = Volume.fromJSON({ "/output": "" });
  await model.save({ async write(bytes) { volume.appendFileSync("/output", bytes); } });
  return new Uint8Array(volume.readFileSync("/output") as Buffer);
}
async function fixture(role: Role, uppercase: boolean, strict: boolean) {
  const doc = await Document(await textFixture("<w:p/>", { numbering: { kind: "numbering", xml: `<w:numbering xmlns:w="${w}"/>` } }, strict), { ...textContext, timestamp: new Date("2024-02-29T12:34:56Z"), author: "Original" });
  doc.core_properties.title = "Original metadata";
  await doc.add_picture(rasterPng(10, 20));
  const archive = await readArchive(await saved(doc), textContext), member = archive.members.find(member => member.name === "[Content_Types].xml")!;
  const xml = new DocumentXmlEditor(member.bytes);
  const declaration = xml.root.children.find(node => node.attributes.some(attribute => attribute.localName === "ContentType" && attribute.value === types[role]))!;
  if (uppercase) xml.setAttribute(declaration, "ContentType", types[role].toUpperCase());
  const volume = Volume.fromJSON({ "/input": "" });
  await writeArchive({ ...archive, members: archive.members.map(part => part === member ? { ...part, bytes: xml.serialize() } : part) }, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  return new Uint8Array(volume.readFileSync("/input") as Buffer);
}
function operations(role: Role): readonly DocxBatchOperation[] {
  const common: DocxBatchOperation[] = [
    { operation: "model.document.Document.part.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "main" },
    { operation: "model.parts.document.DocumentPart.package.get", receiver: { resultHandle: "main" }, arguments: {}, resultHandle: "package" }
  ];
  if (role === "numbering") return [...common,
    { operation: "model.parts.document.DocumentPart.numbering_part.get", receiver: { resultHandle: "main" }, arguments: {}, resultHandle: "part" },
    { operation: "model.parts.numbering.NumberingPart.numbering_definitions.get", receiver: { resultHandle: "part" }, arguments: {}, resultHandle: "definitions" },
    { operation: "model.NumberingDefinitionsView.length.get", receiver: { resultHandle: "definitions" }, arguments: {} }
  ];
  if (role === "core") return [...common,
    { operation: "model.package.Package.core_properties.get", receiver: { resultHandle: "package" }, arguments: {}, resultHandle: "core" },
    { operation: "model.opc.coreprops.CoreProperties.title.get", receiver: { resultHandle: "core" }, arguments: {} }
  ];
  return [...common,
    { operation: "model.package.Package.get_or_add_image_part.call", receiver: { resultHandle: "package" }, arguments: { imageDescriptor: { kind: "bytes", base64: Buffer.from(rasterPng(10, 20)).toString("base64") } }, resultHandle: "part" },
    { operation: "model.parts.image.ImagePart.image.get", receiver: { resultHandle: "part" }, arguments: {}, resultHandle: "image" },
    { operation: "model.image.image.Image.px_width.get", receiver: { resultHandle: "image" }, arguments: {} }
  ];
}

for (const strict of [false, true]) for (const uppercase of [false, true]) for (const route of ["model", "sdk", "cli"] as const) it.each(roles)(
  `${route} retains an admitted %s owner; strict=${strict}; uppercase=${uppercase}`, async role => {
    const input = await fixture(role, uppercase, strict), type = uppercase ? types[role].toUpperCase() : types[role];
    const expected = role === "numbering" ? 0 : role === "core" ? "Original metadata" : 10;
    if (route === "model") {
      const doc = await Document(input, textContext), owner = doc.part.package;
      if (role === "numbering") {
        const part = doc.part.numbering_part;
        expect(part).toBeInstanceOf(NumberingPart);
        expect(part.content_type).toBe(type);
        expect(part.numbering_definitions.length).toBe(expected);
      } else if (role === "core") {
        const properties = doc.core_properties;
        expect(properties.part).toBeInstanceOf(CorePropertiesPartView);
        expect(properties.part.content_type).toBe(type);
        expect(properties.title).toBe(expected);
      } else {
        expect(owner.image_parts.length).toBe(1);
        const part = [...owner.image_parts][0]!;
        expect(part).toBeInstanceOf(ImagePartView);
        expect(part.content_type).toBe(type);
        expect(part.image.px_width).toBe(expected);
        expect(part.image.px_height).toBe(20);
        expect(part.blob).toEqual(rasterPng(10, 20));
        expect(await owner.get_or_add_image_part(rasterPng(10, 20))).toBe(part);
        expect(owner.image_parts.length).toBe(1);
      }
      const output = await saved(doc);
      expect(readPackage(output)).toEqual(readPackage(input));
      expect((await Document(output, textContext)).part.package.parts.map(part => part.content_type)).toContain(type);
    } else if (route === "sdk") {
      const result = await applyStyleModelBatch(input, { version: 1, operations: operations(role) }, textContext);
      expect(result.affected).toBe(0);
      expect(result.results.at(-1)?.value).toBe(expected);
      expect(readPackage(await saved(result))).toEqual(readPackage(input));
    } else {
      const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" });
      const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
        args: ["batch", "/input", "--ops-json", JSON.stringify({ version: 1, operations: operations(role) }), "--dry-run", "--json"].map(word => new TextEncoder().encode(word)), cwd: "/", signal: textContext.signal,
        filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} },
        stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
      });
      expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
      const envelope = JSON.parse(volume.readFileSync("/out", "utf8") as string);
      expect(envelope.affected).toBe(0);
      expect(envelope.data.results.at(-1).value).toBe(expected);
      expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
      expect(volume.readdirSync("/")).toEqual(["err", "input", "out"]);
    }
  }
);

for (const uppercase of [false, true]) for (const strict of [false, true]) it.each(roles)(
  `loads owned %s parts without rewriting MIME spelling; uppercase=${uppercase}; strict=${strict}`, async role => {
    const doc = await Document(await textFixture("<w:p/>", {}, strict), textContext), owner = doc.part.package;
    const type = uppercase ? types[role].toUpperCase() : types[role], namespace = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
    const bytes = role === "image" ? rasterPng(10, 20) : new TextEncoder().encode(role === "numbering" ? `<w:numbering xmlns:w="${namespace}"/>` : '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Original</dc:title></cp:coreProperties>');
    const part = role === "numbering" ? await NumberingPart.load("/word/loaded.xml", type, bytes, owner) : role === "core" ? await CorePropertiesPartView.load("/docProps/loaded.xml", type, bytes, owner) : await ImagePartView.load("/word/media/loaded.png", type, bytes, owner);
    expect(part.package).toBe(owner);
    expect(part.content_type).toBe(type);
    expect(part.blob).toEqual(bytes);
    if (part instanceof NumberingPart) expect(part.numbering_definitions.length).toBe(0);
    if (part instanceof CorePropertiesPartView) expect(part.core_properties.title).toBe("Original");
    if (part instanceof ImagePartView) expect(part.image.px_width).toBe(10);
    const before = readPackage(await saved(doc));
    await expect((role === "numbering" ? NumberingPart : role === "core" ? CorePropertiesPartView : ImagePartView).load(part.partname, type, bytes, owner)).rejects.toThrow(InvalidValueError);
    expect(readPackage(await saved(doc))).toEqual(before);
  }
);

it.each(["image/jpeg", "IMAGE/JPEG"])("rejects real image MIME mismatch %s without registering a part", async type => {
  const doc = await Document(undefined, textContext), before = readPackage(await saved(doc));
  await expect(ImagePartView.load("/word/media/mismatch.png", type, rasterPng(10, 20), doc.part.package)).rejects.toThrow(InvalidValueError);
  expect(doc.part.package.image_parts.length).toBe(0);
  expect(readPackage(await saved(doc))).toEqual(before);
});

it("keeps newly admitted uppercase image owners separate", async () => {
  const first = await Document(undefined, textContext), second = await Document(undefined, textContext);
  const image = await ImagePartView.load("/word/media/a.png", "IMAGE/PNG", rasterPng(10, 20), first.part.package);
  expect(first.part.package.image_parts.has(image)).toBe(true);
  expect(second.part.package.image_parts.has(image)).toBe(false);
  expect(() => second.part.package.image_parts.append(image)).toThrow(InputTypeError);
});

it.each(["IMAGE/JPEG", "IMAGE/X-ORIGINAL-INERT"])("preserves a mismatched or unsupported image declaration %s without characterizing it", async type => {
  const archive = await readArchive(await fixture("image", false, false), textContext);
  const member = archive.members.find(member => member.name === "[Content_Types].xml")!, xml = new DocumentXmlEditor(member.bytes);
  const declaration = xml.root.children.find(node => node.attributes.some(attribute => attribute.localName === "ContentType" && attribute.value === "image/png"))!;
  xml.setAttribute(declaration, "ContentType", type);
  const volume = Volume.fromJSON({ "/input": "" });
  await writeArchive({ ...archive, members: archive.members.map(part => part === member ? { ...part, bytes: xml.serialize() } : part) }, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer), doc = await Document(input, textContext);
  expect(doc.part.package.image_parts.length).toBe(1);
  const part = [...doc.part.package.image_parts][0]!;
  expect(part.content_type).toBe(type);
  expect(part.blob).toEqual(rasterPng(10, 20));
  expect(() => part.image).toThrow(UnsupportedEditError);
  expect(readPackage(await saved(doc))).toEqual(readPackage(input));
});

for (const strict of [false, true]) for (const route of ["model", "sdk", "cli"] as const) it(
  `renames document parts with uppercase relationship MIME; strict=${strict}; ${route}`, async () => {
    const archive = await readArchive(await textFixture('<w:p/>', {}, strict), textContext);
    const member = archive.members.find(member => member.name === "[Content_Types].xml")!, xml = new DocumentXmlEditor(member.bytes);
    const declaration = xml.root.children.find(node => node.attributes.some(attribute => attribute.localName === "Extension" && attribute.value === "rels"))!;
    const relationshipType = "APPLICATION/VND.OPENXMLFORMATS-PACKAGE.RELATIONSHIPS+XML";
    xml.setAttribute(declaration, "ContentType", relationshipType);
    const volume = Volume.fromJSON({ "/input": "", "/out": "", "/err": "" });
    await writeArchive({ ...archive, members: archive.members.map(part => part === member ? { ...part, bytes: xml.serialize() } : part) }, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
    const input = new Uint8Array(volume.readFileSync("/input") as Buffer);
    const batch: readonly DocxBatchOperation[] = [
      { operation: "model.document.Document.part.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "main" },
      { operation: "model.parts.document.DocumentPart.partname.set", receiver: { resultHandle: "main" }, arguments: { value: "/relocated/main.xml" } }
    ];
    let output: Uint8Array;
    if (route === "model") {
      const doc = await Document(input, textContext), part = doc.part;
      part.partname = "/relocated/main.xml";
      expect(doc.part).toBe(part);
      output = await saved(doc);
    } else if (route === "sdk") {
      const result = await applyStyleModelBatch(input, { version: 1, operations: batch }, textContext);
      expect(result.affected).toBe(1);
      output = await saved(result);
    } else {
      const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
        args: ["batch", "/input", "--ops-json", JSON.stringify({ version: 1, operations: batch }), "--output", "-"].map(word => new TextEncoder().encode(word)), cwd: "/", signal: textContext.signal,
        filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} },
        stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
      });
      expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
      output = new Uint8Array(volume.readFileSync("/out") as Buffer);
    }
    const before = readPackage(input), after = readPackage(output);
    expect(after.has("word/document.xml")).toBe(false);
    expect(after.get("relocated/main.xml")).toEqual(before.get("word/document.xml"));
    expect(after.get("relocated/_rels/main.xml.rels")).toEqual(before.get("word/_rels/document.xml.rels"));
    const types = JSON.stringify(xmlStructure(after.get("[Content_Types].xml")!));
    expect(types).toContain(relationshipType);
    expect(types).toContain("/relocated/main.xml");
    const relationships = JSON.stringify(xmlStructure(after.get("_rels/.rels")!));
    expect(relationships).toContain('"{}Target":"relocated/main.xml"');
    expect((await Document(output, textContext)).part.partname.toString()).toBe("/relocated/main.xml");
    expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
  }
);
