import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import type * as compiledTypes from "docx";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
const api = await compiledPublicRuntime as unknown as typeof compiledTypes;
import { chartFixture, chartContext as fixtureContext } from "../tests/fixtures/charts.js";
import { readPackage } from "../tests/assertions.js";

const chartContext = { limits: fixtureContext.limits, signal: fixtureContext.signal };
const store = "{7CC185E1-4A31-4AB8-A420-FA578658AA11}";
const encode = (value: string) => new TextEncoder().encode(value);
const decode = (value: Uint8Array) => new TextDecoder().decode(value);

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["choice", "fallback", "process"] as const)
for (const site of ["properties", "binding"] as const)
for (const operation of ["bind", "same-store", "different-store", "raw-item", "raw-props", "raw-word"] as const)
for (const route of ["sdk", "cli"] as const)
  it(`native ${route} ${operation} admits binding ownership in ${carrier} ${site}; ${kind}; strict=${strict}`, async () => {
    const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const ds = strict ? "http://purl.oclc.org/ooxml/officeDocument/customXml" : "http://schemas.openxmlformats.org/officeDocument/2006/customXml";
    const wrap = (value: string) => carrier === "process" ? `<u:bridge>${value}</u:bridge>` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "u"}">${carrier === "choice" ? value : ""}</mc:Choice><mc:Fallback>${carrier === "fallback" ? value : ""}</mc:Fallback></mc:AlternateContent>`;
    const control = (tag: string, id = store) => {
      const binding = `<w:dataBinding w:storeItemID="${id}" w:xpath="/v:record/v:value" w:prefixMappings="xmlns:v='urn:original:binding-carrier'"/>`;
      const properties = `<w:sdtPr><w:text/><w:tag w:val="${tag}"/>${site === "binding" ? wrap(binding) : binding}</w:sdtPr>`;
      return `<w:sdt xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:u="urn:original:binding-carrier-mce" mc:Ignorable="u" mc:ProcessContent="u:bridge">${site === "properties" ? wrap(properties) : properties}<w:sdtContent><w:r><w:rPr><w:i/></w:rPr><w:t>Original</w:t></w:r></w:sdtContent></w:sdt>`;
    };
    const glossary = operation === "same-store" || operation === "different-store";
    const resources = [
      { name: "customXml/item.xml", type: "application/xml", bytes: '<v:record xmlns:v="urn:original:binding-carrier"><v:value>Original</v:value><!--retained--></v:record>' },
      { name: "customXml/props.xml", type: "application/vnd.openxmlformats-officedocument.customXmlProperties+xml", bytes: `<ds:datastoreItem xmlns:ds="${ds}" ds:itemID="${store}"/>` },
      ...(glossary ? [{ name: "word/glossary.xml", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.glossary+xml", bytes: `<w:glossaryDocument xmlns:w="${w}"><w:docParts><w:docPart><w:docPartPr><w:name w:val="Retained block"/></w:docPartPr><w:docPartBody><w:p>${control("glossary", operation === "different-store" ? "{11111111-2222-3333-4444-555555555555}" : store)}</w:p></w:docPartBody></w:docPart></w:docParts></w:glossaryDocument>` }] : [])
    ];
    const parts = readPackage(await chartFixture({ strict, definitions: [], body: `<w:p>${control("target")}${control("alias")}</w:p>`, resources, relationships: [
      { owner: "/word/document.xml", id: "store", type: r + "/customXml", target: "../customXml/item.xml" },
      { owner: "/customXml/item.xml", id: "props", type: r + "/customXmlProps", target: "props.xml" },
      ...(glossary ? [{ owner: "/word/document.xml", id: "glossary", type: r + "/glossaryDocument", target: "glossary.xml" }] : [])
    ] }));
    if (kind === "dotx") {
      const types = new api.DocumentXmlEditor(parts.get("[Content_Types].xml")!);
      const main = types.root.children.find(node => node.attributes.some(attribute => attribute.localName === "PartName" && attribute.value === "/word/document.xml"))!;
      types.setAttribute(main, "ContentType", "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml");
      parts.set("[Content_Types].xml", types.serialize());
    }
    const memory = Volume.fromJSON({ "/input": "", "/output": "" });
    await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, chartContext);
    const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
    const raw = operation.startsWith("raw-");
    const part = operation === "raw-item" ? "/customXml/item.xml" : operation === "raw-props" ? "/customXml/props.xml" : "/word/document.xml";
    const replacement = encode(decode(parts.get(part.slice(1))!).replace(operation === "raw-props" ? store : "Original", operation === "raw-props" ? "{11111111-2222-3333-4444-555555555555}" : "Updated"));
    const rejected = raw || operation === "same-store";
    if (route === "sdk") {
      const context = { ...chartContext, encoding: { order: "input", compression: "store" } as const, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
      const pending = raw ? api.replaceDocumentXmlPart(input, replacement, { part, output: "-" }, context) : api.editDocumentControlBindings(input, { all: true, binding: "target", valueJson: "Updated", output: "-" }, context);
      if (rejected) await expect(pending).rejects.toMatchObject({ code: "unsupported-edit" });
      else expect((await pending).changed).toBe(true);
    } else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/replacement", replacement); await fs.writeFile("/output", encode("Existing destination"));
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: chartContext.limits }) }));
      try {
        const result = await shell.exec(`docx ${raw ? `xml set /input --part ${part} --file /replacement` : "controls bind /input --all --binding target --value-json '\"Updated\"'"} --output /output --force --json`);
        expect(result.exitCode, result.stdout + result.stderr).toBe(rejected ? 1 : 0);
        if (rejected) {
          expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, affected: 0, errors: [{ code: "unsupported-edit" }] });
          expect(await fs.readFile("/output")).toEqual(encode("Existing destination"));
        } else memory.writeFileSync("/output", await fs.readFile("/output"));
        expect(await fs.readFile("/input")).toEqual(input);
      } finally { await shell.dispose(); }
    }
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer);
    if (rejected) expect(output).toHaveLength(0);
    else {
      const saved = readPackage(output);
      expect((await api.inspectDocumentControls(output, {}, chartContext)).items.map(item => [item.tag, item.value, item.binding?.storeItemId])).toEqual([["target", "Updated", store], ["alias", "Updated", store]]);
      expect(decode(saved.get("customXml/item.xml")!)).toBe(decode(parts.get("customXml/item.xml")!).replace("Original", "Updated"));
      expect([...saved.keys()]).toEqual([...parts.keys()]);
      for (const [name, bytes] of parts) if (!["word/document.xml", "customXml/item.xml"].includes(name)) expect(saved.get(name), name).toEqual(bytes);
      const before = new api.DocumentXmlEditor(parts.get("word/document.xml")!), after = new api.DocumentXmlEditor(saved.get("word/document.xml")!);
      const mask = (xml: compiledTypes.DocumentXmlEditor) => {
        const controls = xml.root.children[0]!.children[0]!.children;
        let value = decode(xml.serialize());
        for (const node of controls) value = value.replace(xml.sourceXml(node.children.find(child => child.localName === "sdtContent")!), "<selected-content/>");
        return value;
      };
      expect(mask(after)).toBe(mask(before));
    }
    expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
  });
