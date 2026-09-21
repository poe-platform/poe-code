import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture, w, r } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const encode = (value: string) => new TextEncoder().encode(value);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const resource of ["custom-xml", "glossary", "settings", "signatures"] as const)
for (const route of ["sdk", "cli", "batch"] as const)
  it(`${route} ${resource} inventories use canonical Unicode scalar order; ${kind}; strict=${strict}`, async () => {
    const input = await textFixture('<w:p><w:r><w:t>Retained coast</w:t></w:r></w:p>', {}, strict, { kind });
    const archive = await api.readArchive(input, textContext), files = readPackage(input);
    const namespace = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w;
    const relationship = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : r;
    const type = resource === "custom-xml" ? "application/vnd.openxmlformats-officedocument.customXmlProperties+xml" : resource === "glossary" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document.glossary+xml" : resource === "settings" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml" : "application/vnd.openxmlformats-package.digital-signature-xmlsignature+xml";
    const xml = resource === "custom-xml" ? '<ds:datastoreItem xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml" ds:itemID="{38E185E1-4A31-4AB8-A420-FA578658AA11}"/>' : resource === "glossary" ? `<w:glossaryDocument xmlns:w="${namespace}"><w:docParts/></w:glossaryDocument>` : resource === "settings" ? `<w:settings xmlns:w="${namespace}"><w:updateFields w:val="false"/></w:settings>` : '<s:Signature xmlns:s="http://www.w3.org/2000/09/xmldsig#"/>';
    const types = new api.DocumentXmlEditor(files.get("[Content_Types].xml")!);
    const names = ["🌊", "豈"];
    types.insertChildren(types.root, names.map(name => `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/resources/${name}.xml" ContentType="${type}"/>`).join(""));
    files.set("[Content_Types].xml", types.serialize());
    for (const name of names) files.set(`resources/${name}.xml`, encode(xml));
    // Incoming reference order is tested separately from archive storage order.
    if (resource === "glossary") {
      files.set("word/_rels/document.xml.rels", encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map(name => `<Relationship Id="${name}" Type="${relationship}/glossaryDocument" Target="../resources/${encodeURIComponent(name)}.xml"/>`).join("")}</Relationships>`));
    }
    const memory = Volume.fromJSON({ "/input": "" });
    await api.writeArchive({ ...archive, members: [...files].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-03-04T05:06:08Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
    const bytes = new Uint8Array(memory.readFileSync("/input") as Buffer);
    let items: readonly { readonly name: string }[];
    if (route === "sdk") items = resource === "settings" ? (await api.inspectDocumentSettings(bytes, {}, textContext)).items : resource === "signatures" ? (await api.inspectDocumentSignatures(bytes, {}, textContext)).items : (await api.inspectDocumentPackageResources(bytes, `${resource}.list`, {}, textContext)).items;
    else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", bytes);
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try {
        await fs.writeFile("/ops", encode(JSON.stringify({ version: 1, operations: [{ operation: `${resource}.list`, arguments: {} }] })));
        const result = await shell.exec(route === "cli" ? `docx ${resource} list /input --json` : "docx batch /input --ops-file /ops --json");
        expect(result.exitCode, result.stdout + result.stderr).toBe(0);
        const envelope = JSON.parse(result.stdout); items = route === "cli" ? envelope.data.items : envelope.data.results[0].data.items;
        if (route === "batch") expect(envelope.data.publication).toBeNull();
        expect(await fs.readFile("/input")).toEqual(bytes);
      } finally { await shell.dispose(); }
    }
    expect(items.map(item => item.name)).toEqual(["/resources/豈.xml", "/resources/🌊.xml"]);
    expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(bytes);
  });
