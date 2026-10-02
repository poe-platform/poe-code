import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Document, StylePartView, DocumentXmlEditor, applyStyleModelBatch, createDocxInspectionCommandEngine, inspectDocument, readArchive, replaceDocumentXmlPart, writeArchive } from "./index.js";
import { textFixture, textContext, w, r } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const encode = (text: string) => new TextEncoder().encode(text);
const publication = { ...textContext, encoding: { order: "input", compression: "store" } as const };
async function fixture(strict: boolean, kind: string, variant: "none" | "native" | "inert" | "case") {
  const archive = await readArchive(await textFixture('<w:p><w:r><w:t>Original</w:t></w:r></w:p>', { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"/>` } }, strict), textContext), owner = kind === "officeDocument" ? "_rels/.rels" : "word/_rels/document.xml.rels";
  const native = `${strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : r}/${kind}`, type = variant === "inert" ? `urn:original:inert/${kind}` : variant === "case" ? "HTTP" + native.slice(4) : native;
  const members = archive.members.map(part => {
    if (part.name !== owner || variant === "none") return part;
    const xml = new DocumentXmlEditor(part.bytes);
    xml.insertChildren(xml.root, `<Relationship xmlns="${xml.root.namespace}" Id="inert" Type="${type}" Target="${kind === "officeDocument" ? "word/document.xml" : kind === "hyperlink" ? "https://example.test/inert" : "styles.xml"}"${kind === "hyperlink" ? ' TargetMode="External"' : ""}/>`);
    return { ...part, bytes: xml.serialize() };
  });
  const volume = Volume.fromJSON({ "/out": "" });
  await writeArchive({ ...archive, members }, { async write(bytes) { volume.appendFileSync("/out", bytes); } }, publication.encoding, textContext);
  return { input: new Uint8Array(volume.readFileSync("/out") as Buffer), owner, type };
}
async function command(input: Uint8Array, args: string[], replacement?: Uint8Array) {
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/replacement": Buffer.from(replacement ?? []), "/out": "", "/err": "" });
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: args.map(encode), cwd: "/", signal: textContext.signal, filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); }, readStream(path) { return { async *[Symbol.asyncIterator]() { yield new Uint8Array(volume.readFileSync(path) as Buffer); } }; } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } } });
  expect(result.exitCode, volume.readFileSync("/out", "utf8") + "\n" + volume.readFileSync("/err", "utf8")).toBe(0);
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
  return new Uint8Array(volume.readFileSync("/out") as Buffer);
}
const ref = (resultHandle: string) => ({ resultHandle });
for (const strict of [false, true]) for (const kind of ["officeDocument", "styles"]) for (const variant of ["none", "inert", "case"] as const) for (const route of ["model", "sdk", "cli"] as const) it(`retains ${kind} owner beside ${variant} URI through ${route}; strict=${strict}`, async () => {
  const { input } = await fixture(strict, kind, variant), original = input.slice(), expected = kind === "officeDocument" ? "/word/document.xml" : "/word/styles.xml";
  if (route === "model") {
    const doc = await Document(input, textContext), part = kind === "officeDocument" ? doc.part.package.main_document_part : StylePartView.default(doc.part.package);
    expect(String(part.partname)).toBe(expected);
    expect(part).toBe(kind === "officeDocument" ? doc.part : doc.styles.part);
    const volume = Volume.fromJSON({ "/out": "" });
    await doc.save({ async write(bytes) { volume.appendFileSync("/out", bytes); } });
    expect(readPackage(new Uint8Array(volume.readFileSync("/out") as Buffer))).toEqual(readPackage(input));
  } else {
    const batch = { version: 1 as const, operations: [
      { operation: "model.document.Document.styles.get", receiver: ref("document"), arguments: {}, resultHandle: "styles" },
      { operation: "model.styles.styles.Styles.part.get", receiver: ref("styles"), arguments: {}, resultHandle: "stylePart" },
      { operation: "model.opc.part.XmlPart.package.get", receiver: ref("stylePart"), arguments: {}, resultHandle: "package" },
      { operation: "model.package.Package.main_document_part.get", receiver: ref("package"), arguments: {}, resultHandle: kind === "officeDocument" ? "selected" : "main" },
      ...(kind === "officeDocument" ? [] : [
        { operation: "model.parts.document.DocumentPart.styles.get", receiver: ref("main"), arguments: {}, resultHandle: "ownedStyles" },
        { operation: "model.styles.styles.Styles.part.get", receiver: ref("ownedStyles"), arguments: {}, resultHandle: "selected" }
      ]),
      { operation: "model.opc.part.Part.partname.get", receiver: ref("selected"), arguments: {} }
    ] };
    if (route === "sdk") {
      const data = await applyStyleModelBatch(input, batch, textContext);
      expect(data.results.at(-1)!.value).toBe(expected); expect(data.affected).toBe(0);
    } else {
      const envelope = JSON.parse(new TextDecoder().decode(await command(input, ["batch", "/input", "--ops-json", JSON.stringify(batch), "--dry-run", "--json"])));
      expect(envelope.data.results.at(-1).data).toBe(expected); expect(envelope.affected).toBe(0);
    }
  }
  expect(input).toEqual(original);
});
for (const strict of [false, true]) for (const variant of ["native", "inert", "case"] as const) for (const route of ["sdk", "cli"] as const) it(`inventories ${variant} hyperlink URI through ${route}; strict=${strict}`, async () => {
  const { input, type } = await fixture(strict, "hyperlink", variant), original = input.slice();
  const data = route === "sdk" ? await inspectDocument(input, textContext) : JSON.parse(new TextDecoder().decode(await command(input, ["inspect", "/input", "--json"]))).data;
  expect(data.features).toContainEqual(expect.objectContaining({ id: "F21", detected: variant === "native" }));
  expect(data.relationships).toContainEqual({ owner: "/word/document.xml", id: "inert", type, target: "https://example.test/inert", external: true });
  expect(input).toEqual(original);
});
for (const strict of [false, true]) for (const kind of ["font", "fontTable"]) for (const variant of ["inert", "case"] as const) for (const route of ["sdk", "cli"] as const) it(`publishes inert ${kind} ${variant} URI rename through ${route}; strict=${strict}`, async () => {
  const { input, owner } = await fixture(strict, kind, variant), original = input.slice(), before = readPackage(input), xml = new DocumentXmlEditor(before.get(owner)!);
  xml.setAttribute(xml.root.children.find(node => node.attributes.some(attribute => attribute.localName === "Id" && attribute.value === "inert"))!, "Id", "retained-inert");
  const replacement = xml.serialize(); let output: Uint8Array;
  if (route === "sdk") {
    const volume = Volume.fromJSON({ "/out": "" });
    const result = await replaceDocumentXmlPart(input, replacement, { part: "/" + owner, output: "-" }, { ...publication, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } });
    expect(result.changed).toBe(true); output = new Uint8Array(volume.readFileSync("/out") as Buffer);
  } else output = await command(input, ["xml", "set", "/input", "--part", "/" + owner, "--file", "/replacement", "--output", "-"], replacement);
  const after = readPackage(output); expect(after.get(owner)).toEqual(replacement);
  const root = xmlStructure(after.get(owner)!).children.find(node => typeof node !== "string")!;
  if (typeof root === "string") throw new Error("Expected relationship root");
  expect(root.children.filter(node => typeof node !== "string").map(node => node.attributes["{}Id"])).toEqual(["styles", "retained-inert"]);
  for (const [name, bytes] of before) if (name !== owner) expect(after.get(name), name).toEqual(bytes);
  expect(input).toEqual(original);
});
