import { Volume } from "memfs";
import { expect, it } from "vitest";
import { DocumentXmlEditor, createDocxInspectionCommandEngine, editDocumentControlBindings, inspectDocumentControls, inspectDocumentPackageResources, readArchive, replaceDocumentXmlPart, writeArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const store = "{7CC185E1-4A31-4AB8-A420-FA578658AA11}";
const publication = { ...textContext, encoding: { order: "input", compression: "store" } as const };
const encode = (value: string) => new TextEncoder().encode(value);
async function fixture(strict: boolean, uppercase: boolean) {
  const binding = (tag: string) => `<w:sdt><w:sdtPr><w:text/><w:tag w:val="${tag}"/><w:dataBinding w:storeItemID="${store}" w:xpath="/v:root/v:value" w:prefixMappings="xmlns:v='urn:original:binding'"/></w:sdtPr><w:sdtContent><w:r><w:t>Original</w:t></w:r></w:sdtContent></w:sdt>`;
  const archive = await readArchive(await textFixture(`<w:p>${binding("target")}${binding("alias")}</w:p>`, {}, strict), textContext);
  const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships", ds = strict ? "http://purl.oclc.org/ooxml/officeDocument/customXml" : "http://schemas.openxmlformats.org/officeDocument/2006/customXml", rels = "http://schemas.openxmlformats.org/package/2006/relationships";
  const members = archive.members.map(part => {
    if (part.name === "word/_rels/document.xml.rels") return { ...part, bytes: encode(`<Relationships xmlns="${rels}"><Relationship Id="store" Type="${r}/customXml" Target="../customXml/item.xml"/></Relationships>`) };
    if (part.name !== "[Content_Types].xml") return part;
    const editor = new DocumentXmlEditor(part.bytes);
    editor.insertChildren(editor.root, `<Default xmlns="${editor.root.namespace}" Extension="xml" ContentType="application/xml"/><Override xmlns="${editor.root.namespace}" PartName="/customXml/props.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/>`);
    const types = new DocumentXmlEditor(editor.serialize());
    if (uppercase) for (const node of types.root.children) types.setAttribute(node, "ContentType", node.attributes.find(attribute => attribute.localName === "ContentType")!.value.toUpperCase());
    return { ...part, bytes: types.serialize() };
  });
  const files = {
    "customXml/item.xml": '<v:root xmlns:v="urn:original:binding"><v:value>Original</v:value></v:root>',
    "customXml/props.xml": `<ds:datastoreItem xmlns:ds="${ds}" ds:itemID="${store}"><ds:schemaRefs><ds:schemaRef ds:uri="urn:original:binding-schema"/></ds:schemaRefs></ds:datastoreItem>`,
    "customXml/_rels/item.xml.rels": `<Relationships xmlns="${rels}"><Relationship Id="properties" Type="${r}/customXmlProps" Target="props.xml"/></Relationships>`
  };
  for (const [name, xml] of Object.entries(files)) members.push({ name, bytes: encode(xml), directory: false, modified: new Date("2026-01-02T03:04:06Z") });
  const volume = Volume.fromJSON({ "/out": "" });
  await writeArchive({ ...archive, members }, { async write(bytes) { volume.appendFileSync("/out", bytes); } }, publication.encoding, textContext);
  return new Uint8Array(volume.readFileSync("/out") as Buffer);
}
async function command(input: Uint8Array, args: string[], files: Record<string, Uint8Array> = {}) {
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/out": "", "/err": "", ...Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, Buffer.from(bytes)])) });
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: args.map(encode), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); }, readStream(path) { return { async *[Symbol.asyncIterator]() { yield new Uint8Array(volume.readFileSync(path) as Buffer); } }; } },
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } }
  });
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
  return { result, output: new Uint8Array(volume.readFileSync("/out") as Buffer), stderr: volume.readFileSync("/err", "utf8") as string };
}

for (const strict of [false, true]) for (const uppercase of [false, true]) for (const route of ["sdk", "cli"] as const) {
  it(`inventories native datastore metadata via ${route}; strict=${strict}; uppercase MIME=${uppercase}`, async () => {
    const input = await fixture(strict, uppercase), original = input.slice();
    let data;
    if (route === "sdk") data = await inspectDocumentPackageResources(input, "custom-xml.list", {}, textContext);
    else {
      const response = await command(input, ["custom-xml", "list", "/input", "--json"]);
      expect(response.result.exitCode, response.stderr).toBe(0);
      data = JSON.parse(new TextDecoder().decode(response.output)).data;
    }
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({ name: "/customXml/item.xml", details: { kind: "custom-xml", storeItemId: store, schemaReferences: ["urn:original:binding-schema"], propertiesParts: ["/customXml/props.xml"], root: { namespace: "urn:original:binding", localName: "root" } } });
    expect(input).toEqual(original);
  });
  it(`publishes native binding and every alias via ${route}; strict=${strict}; uppercase MIME=${uppercase}`, async () => {
    const input = await fixture(strict, uppercase), before = readPackage(input), value = "Updated <&>";
    let output: Uint8Array;
    if (route === "sdk") {
      const volume = Volume.fromJSON({ "/out": "" });
      const result = await editDocumentControlBindings(input, { all: true, binding: "target", valueJson: value, output: "-" }, { ...publication, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } });
      expect(result.changed).toBe(true); expect(result.changes).toHaveLength(2);
      output = new Uint8Array(volume.readFileSync("/out") as Buffer);
    } else {
      const response = await command(input, ["controls", "bind", "/input", "--all", "--binding", "target", "--value-json", JSON.stringify(value), "--output", "-"]);
      expect(response.result.exitCode, response.stderr).toBe(0); output = response.output;
    }
    const after = readPackage(output);
    expect(xmlStructure(after.get("customXml/item.xml")!)).toEqual(xmlStructure(encode('<v:root xmlns:v="urn:original:binding"><v:value>Updated &lt;&amp;&gt;</v:value></v:root>')));
    const controls = await inspectDocumentControls(output, {}, textContext);
    expect(controls.items.map(item => [item.tag, item.value, item.binding?.storeItemId])).toEqual([["target", value, store], ["alias", value, store]]);
    for (const [name, bytes] of before) if (!["word/document.xml", "customXml/item.xml"].includes(name)) expect(after.get(name), name).toEqual(bytes);
    expect(readPackage(input)).toEqual(before);
  });
  for (const part of ["item", "props"] as const) it(`refuses raw bound ${part} replacement via ${route}; strict=${strict}; uppercase MIME=${uppercase}`, async () => {
    const input = await fixture(strict, uppercase), before = readPackage(input), name = `/customXml/${part}.xml`, xml = new DocumentXmlEditor(before.get(name.slice(1))!);
    if (part === "item") xml.setText(xml.root.children[0]!.content[0]!, "Raw overwrite");
    else xml.setAttribute(xml.root, { namespace: xml.root.namespace, localName: "itemID" }, "{11111111-2222-3333-4444-555555555555}");
    const replacement = xml.serialize();
    if (route === "sdk") {
      const volume = Volume.fromJSON({ "/out": "" });
      await expect(replaceDocumentXmlPart(input, replacement, { part: name, output: "-" }, { ...publication, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } })).rejects.toMatchObject({ code: "unsupported-edit" });
      expect(volume.readFileSync("/out").length).toBe(0);
    } else {
      const response = await command(input, ["xml", "set", "/input", "--part", name, "--file", "/replacement.xml", "--output", "-"], { "/replacement.xml": replacement });
      expect(response.result.exitCode).not.toBe(0); expect(response.stderr).toContain("unsupported-edit"); expect(response.output.length).toBe(0);
    }
    expect(readPackage(input)).toEqual(before);
  });
  for (const mismatch of ["namespace", "relationship"] as const) it(`refuses case-altered datastore ${mismatch} via ${route}; strict=${strict}; uppercase MIME=${uppercase}`, async () => {
    const archive = await readArchive(await fixture(strict, uppercase), textContext), part = mismatch === "namespace" ? "customXml/props.xml" : "customXml/_rels/item.xml.rels";
    const members = archive.members.map(member => {
      if (member.name !== part) return member;
      const xml = new DocumentXmlEditor(member.bytes);
      if (mismatch === "namespace") return { ...member, bytes: encode(`<ds:datastoreItem xmlns:ds="${xml.root.namespace.toUpperCase()}" ds:itemID="${store}"/>`) };
      const edge = xml.root.children[0]!;
      xml.setAttribute(edge, "Type", edge.attributes.find(attribute => attribute.localName === "Type")!.value.toUpperCase());
      return { ...member, bytes: xml.serialize() };
    });
    const volume = Volume.fromJSON({ "/input": "", "/out": "" });
    await writeArchive({ ...archive, members }, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, publication.encoding, textContext);
    const input = new Uint8Array(volume.readFileSync("/input") as Buffer), before = input.slice();
    if (route === "sdk") {
      await expect(editDocumentControlBindings(input, { all: true, binding: "target", valueJson: "Updated", output: "-" }, { ...publication, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } })).rejects.toMatchObject({ code: "unsupported-edit" });
      expect(volume.readFileSync("/out").length).toBe(0);
    } else {
      const response = await command(input, ["controls", "bind", "/input", "--all", "--binding", "target", "--value-json", '"Updated"', "--output", "-"]);
      expect(response.result.exitCode).not.toBe(0); expect(response.stderr).toContain("unsupported-edit"); expect(response.output.length).toBe(0);
    }
    expect(input).toEqual(before);
  });
}
