import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
const cp = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";
const ref = (resultHandle: string) => ({ resultHandle });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const sample of [{ raw: "+007", value: 7 }, { raw: " &#x9;+007&#xA; ", value: 7 }, { raw: "007", value: 7 }, { raw: "0", value: 0 }, { raw: "9007199254740991", value: Number.MAX_SAFE_INTEGER }])
for (const route of ["model", "model-sdk", "model-cli"] as const)
it(`native core revision model integer parity; strict=${strict}; kind=${kind}; raw=${sample.raw}; route=${route}`, async () => {
  const initial = await textFixture('<w:p><w:r><w:t>Retained</w:t></w:r></w:p>', {}, strict, { kind });
  const archive = await api.readArchive(initial, textContext), types = archive.members.find(member => member.name === "[Content_Types].xml")!, rootRelationships = archive.members.find(member => member.name === "_rels/.rels")!;
  const typeEditor = new api.DocumentXmlEditor(types.bytes), relationshipEditor = new api.DocumentXmlEditor(rootRelationships.bytes);
  typeEditor.insertChildren(typeEditor.root, '<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/metadata/native.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>');
  relationshipEditor.insertChildren(relationshipEditor.root, '<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="core" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="metadata/native.xml"/>');
  const memory = Volume.fromJSON({ "/input": "", "/output": "" }), context = { ...textContext, encoding: { order: "input", compression: "store" } as const }, native = new TextEncoder().encode(`<p:coreProperties xmlns:p="${cp}"><p:revision>${sample.raw}</p:revision><!--retain--></p:coreProperties>`);
  await api.writeArchive({ ...archive, members: [...archive.members.map(member => member === types ? { ...member, bytes: typeEditor.serialize() } : member === rootRelationships ? { ...member, bytes: relationshipEditor.serialize() } : member), { name: "metadata/native.xml", bytes: native, directory: false, modified: new Date("2026-01-02T03:04:06Z") }] }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, context.encoding, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), operations = [{ operation: "model.document.Document.core_properties.get", receiver: ref("document"), arguments: {}, resultHandle: "core" }, { operation: "model.opc.coreprops.CoreProperties.revision.get", receiver: ref("core"), arguments: {} }];
  const utility = await api.inspectDocumentProperties(input, { name: "core:revision" }, context);
  expect(utility.items[0]!.properties[0]!.value).toBe(sample.value);
  if (route === "model") { const document = await api.Document(input, context); expect(document.core_properties.revision).toBe(sample.value); expect(document.core_properties.part.blob).toEqual(native); await document.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } }); expect(new Uint8Array(memory.readFileSync("/output") as Buffer)).toEqual(input); }
  else if (route === "model-sdk") { const result = await api.applyStyleModelBatch(input, { version: 1, operations }, context); expect(result.results[1]!.value).toBe(sample.value); expect(result.affected).toBe(0); await result.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } }); expect(new Uint8Array(memory.readFileSync("/output") as Buffer)).toEqual(input); }
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/destination", new TextEncoder().encode("Retained"));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try { const response = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({ version: 1, operations })}' --dry-run --output /destination --force --json`); expect(response.exitCode, response.stdout + response.stderr).toBe(0); expect(JSON.parse(response.stdout).data.results[1].data).toBe(sample.value); expect(await fs.readFile("/input")).toEqual(input); expect(new TextDecoder().decode(await fs.readFile("/destination"))).toBe("Retained"); } finally { await shell.dispose(); }
  }
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
