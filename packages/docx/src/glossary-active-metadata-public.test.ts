import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process", "ignored", "inactive"] as const)
for (const position of ["container", "block", "properties", "name", "category", "types"] as const)
for (const route of ["sdk", "cli"] as const)
  it(`${route} inventories active glossary ${position} metadata in ${carrier}; ${kind}; strict=${strict}`, async () => {
    const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const hidden = carrier === "ignored" || carrier === "inactive";
    const wrap = (value: string) => carrier === "direct" ? value : carrier === "choice" ? `<mc:AlternateContent><mc:Choice Requires="w">${value}</mc:Choice><mc:Fallback><u:inactive/></mc:Fallback></mc:AlternateContent>` : carrier === "fallback" ? `<mc:AlternateContent><mc:Choice Requires="u"><u:inactive/></mc:Choice><mc:Fallback>${value}</mc:Fallback></mc:AlternateContent>` : carrier === "inactive" ? `<mc:AlternateContent><mc:Choice Requires="w"><u:inactive/></mc:Choice><mc:Fallback>${value}</mc:Fallback></mc:AlternateContent>` : `<u:${carrier === "ignored" ? "ignored" : "bridge"}>${value}</u:${carrier === "ignored" ? "ignored" : "bridge"}>`;
    const at = (site: typeof position, value: string) => position === site ? wrap(value) : value;
    const property = at("properties", `<w:docPartPr>${at("name", '<w:name w:val="Coastal opening"/>')}<w:guid w:val="original-coastal-block"/>${at("category", '<w:category><w:name w:val="Coastal reports"/><w:gallery w:val="docParts"/></w:category>')}${at("types", '<w:types><w:type w:val="normal"/></w:types><w:behaviors><w:behavior w:val="content"/></w:behaviors>')}</w:docPartPr>`);
    const body = at("container", `<w:docParts>${at("block", `<w:docPart>${property}<w:docPartBody><w:p><w:r><w:t>Inert glossary 海 🌊</w:t></w:r></w:p></w:docPartBody></w:docPart>`)}</w:docParts>`);
    const input = await textFixture('<w:p><w:r><w:t>Retained body</w:t></w:r></w:p>', { glossary: { kind: "document.glossary", xml: `<w:glossaryDocument xmlns:w="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:u="urn:original:glossary-metadata" mc:Ignorable="u" mc:ProcessContent="u:bridge">${body}<!--retain--><?audit exact?></w:glossaryDocument>` } }, strict, { kind });
    const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
    let data: api.PackageResourceListData;
    if (route === "sdk") {
      data = await api.inspectDocumentPackageResources(input, "glossary.list", {}, textContext);
      await api.replaceDocumentText(input, { find: "Retained body", with: "Changed body", first: true, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } });
    } else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
      try {
        const read = await shell.exec("docx glossary list /input --json");
        expect(read.exitCode, read.stdout + read.stderr).toBe(0);
        const envelope = JSON.parse(read.stdout);
        expect(envelope.warnings).toEqual(hidden && position !== "types" ? [expect.objectContaining({ code: "unrecognized-resource-metadata" })] : []);
        data = envelope.data;
        const changed = await shell.exec("docx text replace /input --find 'Retained body' --with 'Changed body' --first --output /output --json");
        expect(changed.exitCode, changed.stdout + changed.stderr).toBe(0);
        memory.writeFileSync("/output", await fs.readFile("/output"));
        expect(await fs.readFile("/input")).toEqual(input);
      } finally { await shell.dispose(); }
    }
    expect(data.items).toHaveLength(1);
    const blocks = hidden && (position === "container" || position === "block") ? [] : [{
      name: hidden && (position === "properties" || position === "name") ? null : "Coastal opening",
      guid: hidden && position === "properties" ? null : "original-coastal-block",
      category: hidden && (position === "properties" || position === "category") ? null : "Coastal reports",
      gallery: hidden && (position === "properties" || position === "category") ? null : "docParts",
      types: hidden && (position === "properties" || position === "types") ? [] : ["normal"],
      behaviors: hidden && (position === "properties" || position === "types") ? [] : ["content"]
    }];
    expect(data.items[0]).toMatchObject({ name: "/word/glossary.xml", support: "preserve", details: { kind: "glossary", buildingBlocks: blocks } });
    const details = data.items[0]!.details;
    if (details.kind !== "glossary") throw new Error("Expected glossary details.");
    const root = new api.DocumentXmlEditor(readPackage(input).get("word/glossary.xml")!).root;
    for (const block of details.buildingBlocks) {
      let target = root;
      for (const index of block.path) target = target.children[index]!;
      expect(target.localName).toBe("docPart");
      expect(target.namespace).toBe(strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : w);
    }
    expect(JSON.stringify(data)).not.toContain("Inert glossary 海 🌊");
    const before = readPackage(input), after = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer));
    expect([...after.keys()]).toEqual([...before.keys()]);
    for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
    expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
  });
