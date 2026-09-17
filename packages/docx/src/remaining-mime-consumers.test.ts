import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Document, DocumentXmlEditor, createDocxInspectionCommandEngine, editDocumentControls, editDocumentControlRepeats, inspectDocument, inspectDocumentImages, inspectDocumentProperties, readArchive, replaceDocumentImage, sanitizeDocument, writeArchive, type DocumentArchive } from "./index.js";
import { textContext, textFixture, w, r } from "../tests/fixtures/text.js";
import { rasterPng } from "../tests/fixtures/raster.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const publication = { ...textContext, encoding: { order: "input", compression: "store" } as const };
async function archiveBytes(archive: DocumentArchive) {
  const volume = Volume.fromJSON({ "/out": "" });
  await writeArchive(archive, { async write(bytes) { volume.appendFileSync("/out", bytes); } }, publication.encoding, textContext);
  return new Uint8Array(volume.readFileSync("/out") as Buffer);
}
async function uppercaseTypes(input: Uint8Array) {
  const archive = await readArchive(input, textContext), member = archive.members.find(part => part.name === "[Content_Types].xml")!, xml = new DocumentXmlEditor(member.bytes);
  for (const node of xml.root.children) xml.setAttribute(node, "ContentType", node.attributes.find(attribute => attribute.localName === "ContentType")!.value.toUpperCase());
  return archiveBytes({ ...archive, members: archive.members.map(part => part === member ? { ...part, bytes: xml.serialize() } : part) });
}
async function imageFixture(strict: boolean) {
  const doc = await Document(await textFixture("<w:p/>", {}, strict), textContext);
  await doc.add_picture(rasterPng());
  const volume = Volume.fromJSON({ "/out": "" });
  await doc.save({ async write(bytes) { volume.appendFileSync("/out", bytes); } });
  return new Uint8Array(volume.readFileSync("/out") as Buffer);
}
function elements(node: DocumentXmlEditor["root"]): DocumentXmlEditor["root"][] {
  return [node, ...node.children.flatMap(elements)];
}
function observedElements(bytes: Uint8Array) {
  const visit = (node: ReturnType<typeof xmlStructure>): ReturnType<typeof xmlStructure>[] => [node, ...node.children.flatMap(child => typeof child === "string" ? [] : visit(child))];
  return visit(xmlStructure(bytes));
}
async function pictureControlFixture(strict: boolean, repeat: boolean) {
  const archive = await readArchive(await imageFixture(strict), textContext), main = archive.members.find(part => part.name === "word/document.xml")!, xml = new DocumentXmlEditor(main.bytes);
  const run = elements(xml.root).find(node => node.localName === "r" && node.children.some(child => child.localName === "drawing"))!;
  let markup = xml.sourceXml(run), content: string;
  if (repeat) {
    const reduced = new DocumentXmlEditor(new TextEncoder().encode(markup));
    reduced.replaceElement(elements(reduced.root).find(node => node.localName === "cNvGraphicFramePr")!, "");
    markup = new TextDecoder().decode(reduced.serialize());
    content = `<w:sdt xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml"><w:sdtPr><w:id w:val="1"/><v:repeatingSection/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><w:id w:val="7"/><v:repeatingSectionItem/></w:sdtPr><w:sdtContent><w:p>${markup}</w:p></w:sdtContent></w:sdt></w:sdtContent></w:sdt>`;
  } else {
    const copy = new DocumentXmlEditor(new TextEncoder().encode(markup));
    copy.setAttribute(elements(copy.root).find(node => node.localName === "docPr")!, "id", "2");
    content = `<w:p><w:sdt><w:sdtPr><w:id w:val="7"/><w:picture/></w:sdtPr><w:sdtContent>${markup}</w:sdtContent></w:sdt>${new TextDecoder().decode(copy.serialize())}</w:p>`;
  }
  const source = `<w:document xmlns:w="${xml.root.namespace}"><w:body>${content}</w:body></w:document>`;
  return archiveBytes({ ...archive, members: archive.members.map(part => part === main ? { ...part, bytes: new TextEncoder().encode(source) } : part) });
}
async function addParts(input: Uint8Array, files: Record<string, { bytes: Uint8Array; type: string }>, relationships: Record<string, string> = {}) {
  const archive = await readArchive(input, textContext), types = archive.members.find(part => part.name === "[Content_Types].xml")!, xml = new DocumentXmlEditor(types.bytes);
  xml.insertChildren(xml.root, Object.entries(files).map(([name, part]) => `<Override xmlns="${xml.root.namespace}" PartName="/${name}" ContentType="${part.type}"/>`).join(""));
  const members = archive.members.map(part => part === types ? { ...part, bytes: xml.serialize() } : relationships[part.name] ? { ...part, bytes: new TextEncoder().encode(relationships[part.name]) } : part);
  for (const [name, part] of Object.entries(files)) members.push({ name, bytes: part.bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") });
  return archiveBytes({ ...archive, members });
}
async function objectFixture(strict: boolean, shared: boolean) {
  const relationship = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : r;
  const source = await textFixture('<w:p><w:r><w:t>Retained object label</w:t></w:r><w:r><w:object xmlns:o="urn:schemas-microsoft-com:office:office"><o:OLEObject r:id="payload"/></w:object></w:r></w:p>', {}, strict);
  const encode = (xml: string) => new TextEncoder().encode(xml), rels = "http://schemas.openxmlformats.org/package/2006/relationships";
  return addParts(source, {
    "word/embeddings/item.bin": { bytes: new Uint8Array([17, 91, 38]), type: "application/vnd.openxmlformats-officedocument.oleObject" },
    "word/embeddings/_rels/item.bin.rels": { bytes: encode(`<Relationships xmlns="${rels}"/>`), type: "application/vnd.openxmlformats-package.relationships+xml" },
    ...(shared ? {
      "audit/owner.xml": { bytes: encode('<audit xmlns="urn:original:audit"/>'), type: "application/x.audit-relationships+xml" },
      "audit/_rels/owner.xml.rels": { bytes: encode(`<Relationships xmlns="${rels}"><Relationship Id="retained" Type="urn:original:keep" Target="../word/embeddings/item.bin"/></Relationships>`), type: "application/vnd.openxmlformats-package.relationships+xml" }
    } : {})
  }, { "word/_rels/document.xml.rels": `<Relationships xmlns="${rels}"><Relationship Id="payload" Type="${relationship}/oleObject" Target="embeddings/item.bin"/></Relationships>` });
}
async function command(input: Uint8Array, args: string[], files: Record<string, Uint8Array> = {}) {
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "", ...Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, Buffer.from(bytes)])) });
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: args.map(word => new TextEncoder().encode(word)), cwd: "/", signal: textContext.signal,
    filesystem: {
      async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); },
      readStream(path) { return { async *[Symbol.asyncIterator]() { yield new Uint8Array(volume.readFileSync(path) as Buffer); } }; }
    }, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
  });
  expect(result.exitCode, volume.readFileSync("/err", "utf8") as string).toBe(0);
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
  return new Uint8Array(volume.readFileSync("/out") as Buffer);
}

for (const strict of [false, true]) for (const uppercase of [false, true]) for (const route of ["sdk", "cli"] as const) for (const kind of ["fontTable", "settings"] as const) it(
  `detects ${kind} feature via ${route}; uppercase MIME=${uppercase}; strict=${strict}`, async () => {
    const root = kind === "fontTable" ? "fonts" : "settings", base = await textFixture("<w:p/>", { [kind]: { kind, xml: `<w:${root} xmlns:w="${w}"/>` } }, strict), input = uppercase ? await uppercaseTypes(base) : base, original = input.slice();
    const data = route === "sdk" ? await inspectDocument(input, textContext) : JSON.parse(new TextDecoder().decode(await command(input, ["inspect", "/input", "--json"]))).data;
    expect(data.features.find((feature: { id: string }) => feature.id === "F42")).toMatchObject({ detected: true, level: "read" });
    expect(data.fonts.embedded).toEqual([]);
    expect(data.fonts.references).toEqual([]);
    expect(data.protected).toBe(false);
    expect(data.fontResources.fontTables).toEqual(kind === "fontTable" ? [{ part: "/word/fontTable.xml", fonts: [] }] : []);
    expect(input).toEqual(original);
  }
);

for (const strict of [false, true]) for (const uppercase of [false, true]) for (const route of ["sdk", "cli"] as const) for (const shared of [false, true]) it(
  `replaces an image via ${route}; shared=${shared}; uppercase MIME=${uppercase}; strict=${strict}`, async () => {
    const base = await imageFixture(strict), input = uppercase ? await uppercaseTypes(base) : base, before = readPackage(input), replacement = rasterPng(1, 1, [3780, 3780, 1]);
    let output: Uint8Array;
    if (route === "sdk") {
      const volume = Volume.fromJSON({ "/out": "" });
      const result = await replaceDocumentImage(input, { operation: "images.replace", options: { image: 1, shared, file: { kind: "bytes", base64: Buffer.from(replacement).toString("base64") }, output: "-" } }, { ...publication, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } });
      expect(result.changed).toBe(true); expect(result.changes).toHaveLength(1);
      output = new Uint8Array(volume.readFileSync("/out") as Buffer);
    } else output = await command(input, ["images", "replace", "/input", "--image", "1", ...(shared ? ["--shared"] : []), "--file", "/new.png", "--output", "-"], { "/new.png": replacement });
    const after = readPackage(output), images = (await inspectDocumentImages(output, { operation: "images.list" }, textContext)).items!;
    expect(images).toHaveLength(1);
    expect([...after.values()].filter(bytes => Buffer.from(bytes).equals(Buffer.from(replacement)))).toHaveLength(1);
    for (const [name, bytes] of before) if (!["word/document.xml", "word/_rels/document.xml.rels", "[Content_Types].xml"].includes(name) && !name.startsWith("word/media/")) expect(after.get(name), name).toEqual(bytes);
    const drawingNamespace = strict ? "http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing" : "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
    const elements = (node: ReturnType<typeof xmlStructure>): ReturnType<typeof xmlStructure>[] => [node, ...node.children.flatMap(child => typeof child === "string" ? [] : elements(child))];
    const originalExtent = elements(xmlStructure(before.get("word/document.xml")!)).filter(node => node.name === `{${drawingNamespace}}extent`);
    expect(elements(xmlStructure(after.get("word/document.xml")!)).filter(node => node.name === `{${drawingNamespace}}extent`)).toEqual(originalExtent);
    expect((await Document(output, textContext)).inline_shapes.length).toBe(1);
    expect(readPackage(input)).toEqual(before);
  }
);

for (const strict of [false, true]) for (const uppercase of [false, true]) for (const route of ["sdk", "cli"] as const) it(
  `sanitizes properties via ${route}; uppercase MIME=${uppercase}; strict=${strict}`, async () => {
    const doc = await Document(await textFixture('<w:p><w:r><w:t>Retained text</w:t></w:r></w:p>', {}, strict), { ...textContext, timestamp: new Date("2026-01-02T03:04:05Z") });
    doc.core_properties.author = "Original author";
    const seed = Volume.fromJSON({ "/out": "" }); await doc.save({ async write(bytes) { seed.appendFileSync("/out", bytes); } });
    const base = new Uint8Array(seed.readFileSync("/out") as Buffer), input = uppercase ? await uppercaseTypes(base) : base, before = readPackage(input);
    let output: Uint8Array;
    if (route === "sdk") {
      const volume = Volume.fromJSON({ "/out": "" });
      const result = await sanitizeDocument(input, { remove: ["properties"], output: "-" }, { ...publication, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } });
      expect(result.changed).toBe(true);
      expect(result.actions[0]!.records).toContain("core:author");
      output = new Uint8Array(volume.readFileSync("/out") as Buffer);
    } else output = await command(input, ["sanitize", "/input", "--remove", "properties", "--output", "-"]);
    const after = readPackage(output);
    for (const [name, bytes] of before) if (!name.startsWith("docProps/")) expect(after.get(name), name).toEqual(bytes);
    expect((await inspectDocumentProperties(output, {}, textContext)).items.some(property => property.name === "core:author")).toBe(false);
    expect((await Document(output, textContext)).paragraphs[0]!.text).toBe("Retained text");
    expect(readPackage(input)).toEqual(before);
  }
);

for (const strict of [false, true]) for (const uppercase of [false, true]) for (const route of ["sdk", "cli"] as const) for (const repeat of [false, true]) it(
  `${repeat ? "repeats" : "fills"} picture controls via ${route}; uppercase MIME=${uppercase}; strict=${strict}`, async () => {
    const base = await pictureControlFixture(strict, repeat), input = uppercase ? await uppercaseTypes(base) : base, before = readPackage(input), picture = rasterPng(1, 1, [3780, 3780, 1]);
    let output: Uint8Array;
    if (route === "sdk") {
      const volume = Volume.fromJSON({ "/out": "" }), context = { ...publication, stdout: { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } } };
      const result = repeat ? await editDocumentControlRepeats(input, { control: 1, data: [{ values: [] }, { values: [] }], output: "-" }, context) : await editDocumentControls(input, { control: 1, file: { kind: "bytes", base64: Buffer.from(picture).toString("base64") }, output: "-" }, context);
      expect(result.changed).toBe(true);
      output = new Uint8Array(volume.readFileSync("/out") as Buffer);
    } else output = await command(input, ["controls", repeat ? "repeat" : "set", "/input", "--control", "1", ...(repeat ? ["--data-json", '[{"values":[]},{"values":[]}]'] : ["--file", "/new.png"]), "--output", "-"], { "/new.png": picture });
    const after = readPackage(output), originalMedia = [...before.keys()].filter(name => name.startsWith("word/media/"));
    expect(originalMedia).toHaveLength(1);
    expect(after.get(originalMedia[0]!)).toEqual(before.get(originalMedia[0]!));
    expect([...after.keys()].filter(name => name.startsWith("word/media/"))).toHaveLength(repeat ? 1 : 2);
    for (const [name, bytes] of before) if (!["word/document.xml", "word/_rels/document.xml.rels", "[Content_Types].xml"].includes(name)) expect(after.get(name), name).toEqual(bytes);
    if (repeat) expect(after.get("[Content_Types].xml")).toEqual(before.get("[Content_Types].xml"));
    else expect([...after.values()].filter(bytes => Buffer.from(bytes).equals(Buffer.from(picture)))).toHaveLength(1);
    const nodes = (node: ReturnType<typeof xmlStructure>): ReturnType<typeof xmlStructure>[] => [node, ...node.children.flatMap(child => typeof child === "string" ? [] : nodes(child))];
    const all = nodes(xmlStructure(after.get("word/document.xml")!)), wp = strict ? "http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing" : "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing", a = strict ? "http://purl.oclc.org/ooxml/drawingml/main" : "http://schemas.openxmlformats.org/drawingml/2006/main", r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    expect(all.filter(node => node.name === `{${wp}}docPr`).map(node => node.attributes["{}id"])).toEqual(repeat ? ["2", "4"] : ["1", "2"]);
    expect(all.filter(node => node.name === `{${a}}blip`).map(node => node.attributes[`{${r}}embed`])).toEqual(repeat ? ["rId2", "rId3"] : ["rId2", "rId1"]);
    expect((await inspectDocumentImages(output, { operation: "images.list" }, textContext)).items).toHaveLength(2);
    expect(readPackage(input)).toEqual(before);
  }
);

for (const strict of [false, true]) for (const uppercase of [false, true]) for (const route of ["sdk", "cli"] as const) for (const shared of [false, true]) it(
  `sanitizes inert objects via ${route}; lookalike owner=${shared}; uppercase MIME=${uppercase}; strict=${strict}`, async () => {
    const base = await objectFixture(strict, shared), input = uppercase ? await uppercaseTypes(base) : base, before = readPackage(input);
    if (strict) {
      const volume = Volume.fromJSON({ "/out": "", "/err": "" }), stdout = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
      if (route === "sdk") await expect(sanitizeDocument(input, { remove: ["objects"], output: "-" }, { ...publication, stdout })).rejects.toMatchObject({ code: "invalid-package" });
      else {
        const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["sanitize", "/input", "--remove", "objects", "--output", "-"].map(word => new TextEncoder().encode(word)), cwd: "/", signal: textContext.signal, filesystem: { async readFile() { return input; } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } } });
        expect(result.exitCode).not.toBe(0); expect(volume.readFileSync("/err", "utf8")).toContain("invalid-package");
      }
      expect(volume.readFileSync("/out").length).toBe(0); expect(readPackage(input)).toEqual(before);
      return;
    }
    let output: Uint8Array;
    if (route === "sdk") {
      const volume = Volume.fromJSON({ "/out": "" });
      const result = await sanitizeDocument(input, { remove: ["objects"], output: "-" }, { ...publication, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } });
      expect(result.changed).toBe(true);
      expect(result.actions.map(action => [action.category, action.affected])).toEqual([["objects", 1]]);
      expect(result.removedParts).toEqual(shared ? [] : ["/word/embeddings/item.bin", "/word/embeddings/_rels/item.bin.rels"]);
      expect(result.removedRelationships).toEqual([{ owner: "/word/document.xml", id: "payload" }]);
      output = new Uint8Array(volume.readFileSync("/out") as Buffer);
    } else output = await command(input, ["sanitize", "/input", "--remove", "objects", "--output", "-"]);
    const after = readPackage(output);
    expect(observedElements(after.get("word/_rels/document.xml.rels")!).filter(node => node.name.endsWith("}Relationship"))).toEqual([]);
    for (const name of ["word/embeddings/item.bin", "word/embeddings/_rels/item.bin.rels"]) expect(after.get(name)).toEqual(shared ? before.get(name) : undefined);
    for (const [name, bytes] of before) if (!["word/document.xml", "word/_rels/document.xml.rels", "[Content_Types].xml", "word/embeddings/item.bin", "word/embeddings/_rels/item.bin.rels"].includes(name)) expect(after.get(name), name).toEqual(bytes);
    expect((await Document(output, textContext)).paragraphs[0]!.text).toBe("Retained object label");
    expect(new TextDecoder().decode(after.get("word/document.xml"))).not.toContain("OLEObject");
    expect(readPackage(input)).toEqual(before);
  }
);

for (const strict of [false, true]) for (const uppercase of [false, true]) for (const route of ["sdk", "cli"] as const) it(
  `refuses modern comment cloning via ${route}; uppercase MIME=${uppercase}; strict=${strict}`, async () => {
    const repeat = '<w:sdt xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml"><w:sdtPr><w:id w:val="1"/><v:repeatingSection/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><w:id w:val="7"/><v:repeatingSectionItem/></w:sdtPr><w:sdtContent><w:p><w:commentRangeStart w:id="3"/><w:r><w:t>Retained range</w:t></w:r><w:commentRangeEnd w:id="3"/><w:r><w:commentReference w:id="3"/></w:r></w:p></w:sdtContent></w:sdt></w:sdtContent></w:sdt>';
    const base = await addParts(await textFixture(repeat, { comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="3" w:author="Reviewer"><w:p><w:r><w:t>Review note</w:t></w:r></w:p></w:comment></w:comments>` } }, strict), {
      "word/thread.xml": { bytes: new TextEncoder().encode('<v:commentsEx xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml"/>'), type: "application/vnd.ms-word.commentsExtended+xml" }
    });
    const input = uppercase ? await uppercaseTypes(base) : base, original = input.slice(), volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "" });
    const stdout = { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } };
    if (route === "sdk") await expect(editDocumentControlRepeats(input, { control: 1, data: [{ values: [] }], output: "-" }, { ...publication, stdout })).rejects.toMatchObject({ code: "unsupported-edit", message: "Modern comments cannot be cloned." });
    else {
      const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
        args: ["controls", "repeat", "/input", "--control", "1", "--data-json", '[{"values":[]}]', "--output", "-"].map(word => new TextEncoder().encode(word)), cwd: "/", signal: textContext.signal,
        filesystem: { async readFile() { return input; } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout,
        stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
      });
      expect(result.exitCode).not.toBe(0); expect(volume.readFileSync("/err", "utf8")).toContain("unsupported-edit");
    }
    expect(volume.readFileSync("/out").length).toBe(0); expect(input).toEqual(original); expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
  }
);

for (const strict of [false, true]) for (const uppercase of [false, true]) for (const route of ["sdk", "cli"] as const) for (const shared of [false, true]) it(
  `retains image references from a relationship MIME lookalike via ${route}; shared=${shared}; uppercase MIME=${uppercase}; strict=${strict}`, async () => {
    const seed = await imageFixture(strict), seedParts = readPackage(seed), media = [...seedParts.keys()].find(name => name.startsWith("word/media/"))!, encode = (xml: string) => new TextEncoder().encode(xml);
    const base = await addParts(seed, {
      "audit/owner.xml": { bytes: encode('<audit xmlns="urn:original:audit"/>'), type: "application/x.audit-relationships+xml" },
      "audit/_rels/owner.xml.rels": { bytes: encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="retained" Type="urn:original:keep" Target="../${media}"/></Relationships>`), type: "application/vnd.openxmlformats-package.relationships+xml" }
    }), input = uppercase ? await uppercaseTypes(base) : base, before = readPackage(input), replacement = rasterPng(1, 1, [3780, 3780, 1]);
    const inspection = route === "sdk" ? await inspectDocument(input, textContext) : JSON.parse(new TextDecoder().decode(await command(input, ["inspect", "/input", "--json"]))).data;
    expect(inspection.relationships).toContainEqual(expect.objectContaining({ owner: "/audit/owner.xml", id: "retained", type: "urn:original:keep" }));
    let output: Uint8Array;
    if (route === "sdk") {
      const volume = Volume.fromJSON({ "/out": "" });
      await replaceDocumentImage(input, { operation: "images.replace", options: { image: 1, shared, file: { kind: "bytes", base64: Buffer.from(replacement).toString("base64") }, output: "-" } }, { ...publication, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } });
      output = new Uint8Array(volume.readFileSync("/out") as Buffer);
    } else output = await command(input, ["images", "replace", "/input", "--image", "1", ...(shared ? ["--shared"] : []), "--file", "/new.png", "--output", "-"], { "/new.png": replacement });
    const after = readPackage(output), edge = observedElements(after.get("audit/_rels/owner.xml.rels")!).find(node => node.name.endsWith("}Relationship"))!;
    const target = edge.attributes["{}Target"]!.slice(3);
    expect(after.get(target)).toEqual(shared ? replacement : before.get(media));
    expect(after.get(media)).toEqual(shared ? undefined : before.get(media));
    expect(after.get("audit/owner.xml")).toEqual(before.get("audit/owner.xml"));
    expect(readPackage(input)).toEqual(before);
  }
);
