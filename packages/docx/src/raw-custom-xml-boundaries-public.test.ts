import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const encode = (value: string) => new TextEncoder().encode(value);
const store = "{22222222-3333-4444-5555-666666666666}";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const route of ["sdk", "cli"] as const)
for (const scenario of ["unbound-item", "root-owned-item", "bound-item", "bound-properties", "bound-declaration", "bound-item-noop", "bound-properties-noop", "bound-declaration-noop", "changed-root", "malformed-item"] as const)
it(`raw custom XML public boundary ${scenario}; strict=${strict}; kind=${kind}; route=${route}`, async () => {
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const relationships = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const ds = strict ? "http://purl.oclc.org/ooxml/officeDocument/customXml" : "http://schemas.openxmlformats.org/officeDocument/2006/customXml";
  const bound = scenario.startsWith("bound");
  const declaration = `<w:sdt><w:sdtPr><w:text/><w:tag w:val="record"/><w:dataBinding w:storeItemID="${store}" w:xpath="/v:record/v:value" w:prefixMappings="xmlns:v='urn:original:raw-record'"/></w:sdtPr><w:sdtContent><w:r><w:t>Old</w:t></w:r></w:sdtContent></w:sdt>`;
  const item = '<v:record xmlns:v="urn:original:raw-record"><v:value>Old海🌊</v:value><!--retain--><?audit exact?></v:record>';
  const props = `<d:datastoreItem xmlns:d="${ds}" d:itemID="${store}"><d:schemaRefs><d:schemaRef d:uri="https://schema.example.invalid/inert"/></d:schemaRefs></d:datastoreItem>`;
  const initial = await textFixture(`<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Retained海🌊</w:t></w:r>${bound ? declaration : ""}</w:p><!--retain--><?audit exact?>`, {}, strict, { kind });
  const parts = readPackage(initial), types = new api.DocumentXmlEditor(parts.get("[Content_Types].xml")!);
  types.insertChildren(types.root, '<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/records/item.xml" ContentType="application/xml"/><Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/records/properties.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/>'); parts.set("[Content_Types].xml", types.serialize());
  const edgeName = scenario === "root-owned-item" ? "_rels/.rels" : "word/_rels/document.xml.rels";
  const edges = new api.DocumentXmlEditor(parts.get(edgeName)!);
  edges.insertChildren(edges.root, `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="RawRecord" Type="${relationships}/customXml" Target="${scenario === "root-owned-item" ? "" : "../"}records/item.xml"/>`); parts.set(edgeName, edges.serialize());
  parts.set("records/item.xml", encode(item)); parts.set("records/properties.xml", encode(props));
  parts.set("records/_rels/item.xml.rels", encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="Properties" Type="${relationships}/customXmlProps" Target="properties.xml"/><Relationship Id="ExternalSchema" Type="urn:original:inert" Target="https://schema.example.invalid/never-fetch" TargetMode="External"/></Relationships>`));
  const memory = Volume.fromJSON({ "/input": "", "/output": "" }), context = { ...textContext, encoding: { order: "input", compression: "store" } as const };
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("1980-01-01T00:00:00Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), before = readPackage(input);
  const memberName = scenario.includes("properties") ? "records/properties.xml" : scenario.includes("declaration") ? "word/document.xml" : "records/item.xml";
  const original = before.get(memberName)!, noop = scenario.endsWith("noop");
  let replacement = noop ? original : encode(new TextDecoder().decode(original).replace(scenario === "bound-properties" ? store : scenario === "bound-declaration" ? "/v:record/v:value" : "Old海🌊", scenario === "bound-properties" ? "{99999999-3333-4444-5555-666666666666}" : scenario === "bound-declaration" ? "/v:record/v:other" : "New海🌊"));
  if (scenario === "changed-root") replacement = encode('<v:record xmlns:v="urn:original:changed-root"><v:value>New海🌊</v:value></v:record>');
  if (scenario === "malformed-item") replacement = encode('<v:record xmlns:v="urn:original:raw-record">');
  const rejected = bound && !noop || scenario === "changed-root" || scenario === "malformed-item";
  const errorCode = scenario === "malformed-item" ? "invalid-xml" : "unsupported-edit";
  if (route === "sdk") {
    const result = api.replaceDocumentXmlPart(input, replacement, { part: "/" + memberName, output: "-" }, { ...context, stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } } });
    if (rejected) { await expect(result).rejects.toMatchObject({ code: errorCode }); expect(memory.statSync("/output").size).toBe(0); }
    else expect(await result).toMatchObject({ changed: !noop });
  } else {
    const fs = new MemoryFileSystem(), destination = encode("Retained destination"); await fs.writeFile("/input", input); await fs.writeFile("/replacement", replacement); await fs.writeFile("/destination", destination);
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const result = await shell.exec(`docx xml set /input --part /${memberName} --file /replacement --output /destination --force --json`);
      expect(result.exitCode, result.stdout + result.stderr).toBe(rejected ? 1 : 0);
      const envelope = JSON.parse(result.stdout);
      if (rejected) { expect(envelope).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: errorCode }] }); expect(await fs.readFile("/destination")).toEqual(destination); }
      else { expect(envelope).toMatchObject({ ok: true, data: { changed: !noop }, errors: [] }); memory.writeFileSync("/output", await fs.readFile("/destination")); }
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  if (!rejected) {
    const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
    if (noop) expect(output).toEqual(input);
    expect([...after.keys()]).toEqual([...before.keys()]);
    for (const [name, bytes] of before) expect(after.get(name), name).toEqual(name === memberName ? replacement : bytes);
    expect((await api.validateDocument(output, context)).valid).toBe(true);
    const record = (await api.inspectDocumentPackageResources(output, "custom-xml.list", {}, context)).items[0]!;
    expect(record).toMatchObject({ kind: "custom-xml", support: "preserve", details: { storeItemId: store, root: { namespace: "urn:original:raw-record", localName: "record" } } });
    expect(JSON.stringify(record)).not.toContain("New海🌊");
  }
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input); expect(readPackage(input)).toEqual(before);
  expect(new api.DocumentXmlEditor(before.get("word/document.xml")!).root.namespace).toBe(word);
});
