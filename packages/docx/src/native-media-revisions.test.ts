import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, editDocumentRevisions, extractDocumentText, replaceDocumentText, writeArchive } from "./index.js";
import { parseDocumentXml, type XmlElement } from "./package-xml.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["main", "header"] as const) for (const carrier of ["native", "inactive"] as const)
for (const parameter of ["", ";audit=coast", '; audit="coast; dune"'] as const)
for (const operation of ["insert", "replace"] as const) for (const route of ["sdk", "shell"] as const)
it(`${route} ${operation} reserves ${owner}/${carrier} revision identities with MIME ${JSON.stringify(parameter)}; ${kind} strict=${strict}`, async () => {
  const encode = (text: string) => new TextEncoder().encode(text), decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  const namespace = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
  const markers = '<w:ins w:id="+01" w:author="Earlier"><w:r><w:t>Retained</w:t></w:r></w:ins><w:del w:id="02" w:author="Earlier"><w:r><w:delText>Past</w:delText></w:r></w:del>';
  const retained = carrier === "native" ? `<w:p>${markers}</w:p>` : `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x="urn:original:unavailable"><mc:Choice Requires="x"><w:p>${markers}</w:p></mc:Choice><mc:Fallback><w:p><w:r><w:t>Fallback</w:t></w:r></w:p></mc:Fallback></mc:AlternateContent>`;
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Coast</w:t></w:r></w:p>' + (owner === "main" ? retained : '<w:sectPr><w:headerReference w:type="default" r:id="header"/></w:sectPr>'), owner === "header" ? {header: {kind: "header", xml: `<w:hdr xmlns:w="${w}">${retained}<!--Retain header--></w:hdr>`}} : {}, strict));
  const type = `application/vnd.openxmlformats-officedocument.wordprocessingml.${owner === "main" ? (kind === "dotx" ? "template" : "document") + ".main" : "header"}+xml`;
  parts.set("[Content_Types].xml", encode(decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`).replace(`ContentType="${type}"`, `ContentType="${(type + parameter).replaceAll('"', '&quot;')}"`)));
  const memory = Volume.fromJSON({"/input": "", "/output": ""});
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), metadata = {author: "Current", timestamp: "2026-01-02T03:04:06Z"};
  if (route === "sdk") {
    const context = {...textContext, encoding: {order: "input", compression: "store"} as const, stdout: {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}}};
    if (operation === "insert") await editDocumentRevisions(input, {kind: "insert", text: "Bay", paragraph: 1, ...metadata, output: "-"}, context);
    else await replaceDocumentText(input, {find: "Coast", with: "Bay", first: true, trackChanges: true, ...metadata, output: "-"}, context);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
    const result = await shell.exec(`docx ${operation === "insert" ? "revisions add /input --kind insert --text Bay --paragraph 1" : "text replace /input --find Coast --with Bay --first --track-changes"} --author Current --timestamp 2026-01-02T03:04:06Z --output - > /output`);
    expect(result.exitCode, result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output), identities: string[] = [];
  const visit = (node: XmlElement): void => {if (node.namespace === namespace && ["ins", "del"].includes(node.localName)) identities.push(node.attributes.find(a => a.namespace === namespace && a.localName === "id")!.value); for (const child of node.children) visit(child);};
  for (const [name, bytes] of parts) {
    if (name === "word/document.xml") {const xml = decode(saved.get(name)!); if (owner === "main") expect(xml).toContain(retained);}
    else expect(saved.get(name), name).toEqual(bytes);
    if (name === "word/document.xml" || name === "word/header.xml") visit(parseDocumentXml(saved.get(name)!).root);
  }
  expect(identities.filter(id => id !== "+01" && id !== "02")).toEqual(operation === "insert" ? ["3"] : ["3", "4"]);
  expect(new Set(identities.map(Number)).size).toBe(identities.length);
  expect((await extractDocumentText(output, textContext)).text.split("\n")[0]).toBe(operation === "insert" ? "CoastBay" : "Bay");
  expect((await extractDocumentText(output, textContext, {view: "original"})).text.split("\n")[0]).toBe("Coast");
  const model = await Document(output, textContext); expect(model.paragraphs.length).toBeGreaterThan(0);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
