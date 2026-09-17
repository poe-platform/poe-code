import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { DocumentXmlEditor, createDocxInspectionCommandEngine, editDocumentControlBindings, inspectDocumentControls, replaceDocumentXmlPart, writeArchive } from "./index.js";
import { chartFixture, chartContext } from "../tests/fixtures/charts.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const role of ["main", "header", "props"] as const) for (const parameter of ["", ";audit=coast", '; audit="coast; dune"'] as const)
for (const carrier of ["native", "inactive"] as const) for (const operation of ["bind", "raw-item"] as const) for (const route of ["sdk", "shell"] as const)
it(`${route} ${operation} respects ${carrier} bindings with ${role} MIME ${JSON.stringify(parameter)}; ${kind} strict=${strict}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main", r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships", ds = strict ? "http://purl.oclc.org/ooxml/officeDocument/customXml" : "http://schemas.openxmlformats.org/officeDocument/2006/customXml";
  const store = "{7CC185E1-4A31-4AB8-A420-FA578658AA11}", encode = (text: string) => new TextEncoder().encode(text), decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  const control = (tag: string) => `<w:sdt><w:sdtPr><w:text/><w:tag w:val="${tag}"/><w:dataBinding w:storeItemID="${store}" w:xpath="/v:record/v:value" w:prefixMappings="xmlns:v='urn:original:values'"/></w:sdtPr><w:sdtContent><w:r><w:t>Original</w:t></w:r></w:sdtContent></w:sdt>`;
  const alias = `<w:p>${control("alias")}</w:p>`, header = `<w:hdr xmlns:w="${w}">${carrier === "native" ? alias : `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x="urn:original:unavailable"><mc:Choice Requires="x">${alias}</mc:Choice><mc:Fallback><w:p/></mc:Fallback></mc:AlternateContent>`}<!--retained--></w:hdr>`;
  const item = '<v:record xmlns:v="urn:original:values"><v:value>Original</v:value><!--retained--></v:record>';
  const parts = readPackage(await chartFixture({strict, definitions: [], body: `<w:p>${control("target")}</w:p><w:sectPr><w:headerReference w:type="default" r:id="header"/></w:sectPr>`, resources: [
    {name: "word/header.xml", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml" + (role === "header" ? parameter : ""), bytes: header},
    {name: "customXml/item.xml", type: "application/xml", bytes: item},
    {name: "customXml/props.xml", type: "application/vnd.openxmlformats-officedocument.customXmlProperties+xml" + (role === "props" ? parameter : ""), bytes: `<ds:datastoreItem xmlns:ds="${ds}" ds:itemID="${store}"/>`}
  ], relationships: [
    {owner: "/word/document.xml", id: "header", type: r + "/header", target: "header.xml"},
    {owner: "/word/document.xml", id: "store", type: r + "/customXml", target: "../customXml/item.xml"},
    {owner: "/customXml/item.xml", id: "props", type: r + "/customXmlProps", target: "props.xml"}
  ]}));
  const main = `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`;
  parts.set("[Content_Types].xml", encode(decode(parts.get("[Content_Types].xml")!).replace("application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml", (main + (role === "main" ? parameter : "")).replaceAll('"', '&quot;'))));
  const memory = Volume.fromJSON({"/input": "", "/output": ""}); await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, chartContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), rejected = operation === "raw-item" || carrier === "inactive", replacement = encode(item.replace("Original", "Updated"));
  if (route === "sdk") {
    const context = {...chartContext, encoding: {order: "input", compression: "store"} as const, stdout: {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}}};
    const pending = operation === "bind" ? editDocumentControlBindings(input, {scope: "all-stories", all: true, binding: "target", valueJson: "Updated", output: "-"}, context) : replaceDocumentXmlPart(input, replacement, {part: "/customXml/item.xml", output: "-"}, context);
    if (rejected) await expect(pending).rejects.toMatchObject({code: "unsupported-edit"}); else expect((await pending).changed).toBe(true);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/replacement.xml", replacement); const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: chartContext.limits})}));
    const result = await shell.exec(`docx ${operation === "bind" ? "controls bind /input --scope all-stories --all --binding target --value-json '\"Updated\"'" : "xml set /input --part /customXml/item.xml --file /replacement.xml"} --output - > /output`);
    expect(result.exitCode, result.stderr).toBe(rejected ? 1 : 0); if (rejected) expect(result.stderr).toContain("unsupported-edit"); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer);
  if (rejected) expect(output.length).toBe(0);
  else {
    const saved = readPackage(output); expect((await inspectDocumentControls(output, {scope: "all-stories"}, chartContext)).items.map(c => c.value)).toEqual(["Updated", "Updated"]);
    for (const [name, bytes] of parts) {
      if (["word/document.xml", "word/header.xml"].includes(name)) {
        const before = new DocumentXmlEditor(bytes), after = new DocumentXmlEditor(saved.get(name)!);
        const body = before.root.localName === "document" ? before.root.children[0]! : before.root, result = after.root.localName === "document" ? after.root.children[0]! : after.root;
        const originalContent = body.children[0]!.children[0]!.children.find(n => n.namespace === w && n.localName === "sdtContent")!, updatedContent = result.children[0]!.children[0]!.children.find(n => n.namespace === w && n.localName === "sdtContent")!;
        expect(decode(saved.get(name)!).replace(after.sourceXml(updatedContent), "<selected-content/>"), name).toBe(decode(bytes).replace(before.sourceXml(originalContent), "<selected-content/>"));
      } else expect(saved.get(name), name).toEqual(name === "customXml/item.xml" ? encode(decode(bytes).replace("Original", "Updated")) : bytes);
    }
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
